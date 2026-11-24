#!/usr/bin/env python3
"""Robot step: find researchers who publish in Ocha's field.

For every open PhD in data/opportunities.json and data/agent-radar.json, and for every university
in config/people.json, it asks OpenAlex (a free, open index of scholarly papers) who at that
university has published recent papers on her topics. It ranks them by how many matching papers
they have and how recent those are, keeps their latest papers, and adds two open-access reviews
as starter reading. Output: data/people.json, read by the app ("Supervisors & what to read").

This finds people who PUBLISH in her field. It cannot know who has funding or takes students:
the weekly AI scout checks the real staff pages, and Ocha should too.

Standard library only. Usage: python scripts/update_people.py [--root .]
Optional env OPENALEX_KEY (api_key) and OPENALEX_MAILTO (polite pool).
"""
import argparse, datetime as dt, json, os, re, sys, time
import urllib.request, urllib.parse
from pathlib import Path

API = "https://api.openalex.org"
UA = "CornelieurRobot/1.0 (personal PhD helper; github.com/sambeltempoyak/cornelieur)"
CALLS = {"n": 0, "fail": 0}
VERSION = 2  # bump when the ranking changes, to rebuild the university map


def get(path, params):
    p = dict(params)
    if os.environ.get("OPENALEX_KEY"): p["api_key"] = os.environ["OPENALEX_KEY"]
    p["mailto"] = os.environ.get("OPENALEX_MAILTO", "cornelieur-robot@users.noreply.github.com")
    url = f"{API}/{path}?{urllib.parse.urlencode(p)}"
    for attempt in range(3):
        try:
            CALLS["n"] += 1
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                time.sleep(0.15)
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(2 + attempt * 3); continue
            CALLS["fail"] += 1; print(f"  ! {e.code} {path} {params.get('search', '')[:60]}", file=sys.stderr); return None
        except Exception as e:  # network
            if attempt < 2: time.sleep(2); continue
            CALLS["fail"] += 1; print(f"  ! {e} {path}", file=sys.stderr); return None


def short_id(oa_id):
    return (oa_id or "").rsplit("/", 1)[-1]


_inst_cache = {}
def find_institution(name):
    key = name.lower().strip()
    if key in _inst_cache: return _inst_cache[key]
    j = get("institutions", {"search": name, "filter": "country_code:gb", "per-page": 3, "select": "id,display_name,works_count"})
    res = (j or {}).get("results") or []
    inst = None
    if res:
        best = max(res[:3], key=lambda r: (r["display_name"].lower() == key, r.get("works_count", 0)))
        inst = {"id": short_id(best["id"]), "name": best["display_name"]}
    _inst_cache[key] = inst
    return inst


UNI_RE = re.compile(r"(University of [A-Z][\w'’\-]+(?: [A-Z][\w'’\-]+)*|[A-Z][\w'’\-]+(?: [A-Z][\w'’\-]+)* University(?: of [A-Z]\w+)?|Imperial College London|King['’]s College London|University College London|Queen Mary University of London|London School of Hygiene (?:and|&) Tropical Medicine)")


STOP = {"doctoral", "dtp", "phd", "training", "programme", "program", "partnership", "research", "associate", "assistant", "studentship", "non-clinical", "astrazeneca", "school", "department", "faculty", "institute", "centre", "center", "and", "in", "for"}


def clean_name(n):
    toks = n.split(); out = []
    for i, t in enumerate(toks):
        if out and (t.lower() in STOP or (t.isupper() and len(t) > 1) or t in out): break
        out.append(t)
    return " ".join(out).strip()


def institutions_for(item, cfg):
    text = " ".join(str(item.get(k) or "") for k in ("org", "title", "summary"))
    names = []
    for m in UNI_RE.finditer(text):
        n = clean_name(m.group(1))
        if n not in names: names.append(n)
    for ab, full in cfg.get("aliases", {}).items():
        if re.search(r"(?<![\w])" + re.escape(ab) + r"(?![\w])", text) and full not in names: names.append(full)
    out = []
    for n in names[:3]:
        inst = find_institution(n)
        if inst and inst["id"] not in [i["id"] for i in out]: out.append(inst)
    return out


def topics_for(item, topics):
    text = " ".join(str(item.get(k) or "") for k in ("title", "summary", "why")).lower()
    hit = [t for t in topics if t.lower() in text]
    return hit or topics


def or_query(terms):
    return " OR ".join(f'"{t}"' if " " in t else t for t in terms)


def venue(w):
    src = ((w.get("primary_location") or {}).get("source") or {})
    return src.get("display_name") or ""


def link(w):
    if w.get("doi"): return w["doi"]
    oa = (w.get("open_access") or {}).get("oa_url")
    return oa or w.get("id")


JUNK = re.compile(r"^(response to|reply to|correction|erratum|corrigendum|comment on|retraction|editorial)", re.I)
CORE = []


def paper_weight(title):
    t = (title or "").lower()
    if any(c in t for c in CORE): return 2.0
    return 0.5


def people_at(inst, terms, since, n_people):
    j = get("works", {
        "search": or_query(terms),
        "filter": f"authorships.institutions.id:{inst['id']},from_publication_date:{since},type:article|review",
        "sort": "relevance_score:desc", "per-page": 100,
        "select": "id,display_name,publication_year,publication_date,doi,authorships,primary_location,open_access,type",
    })
    works = (j or {}).get("results") or []
    people = {}
    for rank, w in enumerate(works):
        if JUNK.match(w.get("display_name") or ""): continue
        weight = paper_weight(w.get("display_name")) * (1.0 + max(0, 50 - rank) / 100)  # her core field first, then search relevance
        yr = w.get("publication_year") or 0
        for a in w.get("authorships") or []:
            if inst["id"] not in [short_id(i.get("id")) for i in a.get("institutions") or []]: continue
            au = a.get("author") or {}
            if not au.get("id") or not au.get("display_name"): continue
            p = people.setdefault(au["id"], {"name": au["display_name"], "openalex": au["id"], "orcid": au.get("orcid"), "score": 0.0, "n": 0, "last": a.get("author_position") == "last", "papers": []})
            p["n"] += 1
            p["score"] += weight + (0.6 if a.get("author_position") == "last" else 0) + max(0, yr - (dt.date.today().year - 5)) * 0.1
            if a.get("author_position") == "last": p["last"] = True
            if len(p["papers"]) < 6:
                p["papers"].append({"title": w.get("display_name") or "", "year": yr, "venue": venue(w), "link": link(w), "date": w.get("publication_date") or ""})
    ranked = sorted((p for p in people.values() if p["n"] >= 2), key=lambda p: -p["score"])[:n_people]
    for p in ranked:
        p["papers"] = sorted(p["papers"], key=lambda x: (paper_weight(x["title"]), x["date"]), reverse=True)[:3]
        for x in p["papers"]: x.pop("date", None)
        p["score"] = round(p["score"], 1)
        p["senior_hint"] = p.pop("last")  # often last author = group leader (a hint, not a rule)
    return ranked, len(works)


def _review_list(params, why, n):
    j = get("works", dict(params, **{"per-page": n, "select": "id,display_name,publication_year,doi,authorships,open_access,primary_location"}))
    out = []
    for w in (j or {}).get("results") or []:
        if JUNK.match(w.get("display_name") or ""): continue
        au = [a["author"]["display_name"] for a in (w.get("authorships") or []) if (a.get("author") or {}).get("display_name")]
        out.append({"title": w.get("display_name") or "", "authors": (au[0] + (" et al." if len(au) > 1 else "")) if au else "",
                    "year": w.get("publication_year"), "link": link(w), "venue": venue(w), "level": "start", "why": why})
    return out


def reviews(terms, insts):
    """One open-access review written at this university (closest to the group), plus one well-cited general review."""
    since = f"{dt.date.today().year - 6}-01-01"
    core = [t for t in terms if t in CORE] or terms
    out = []
    if insts:
        out += _review_list({"search": or_query(core[:5]), "sort": "relevance_score:desc",
                             "filter": f"type:review,is_oa:true,from_publication_date:{since},authorships.institutions.id:{'|'.join(i['id'] for i in insts)}"},
                            "Open-access review written at this university: shows how people here think about the field.", 1)
    gen = _review_list({"search": or_query(core[:3]), "sort": "relevance_score:desc",
                        "filter": f"type:review,is_oa:true,from_publication_date:{since},cited_by_count:>50"},
                       "Well-cited open-access review: a readable overview of the topic before you write to anyone.", 2)
    for g in gen:
        if len(out) >= 2: break
        if g["title"] not in [o["title"] for o in out]: out.append(g)
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--root", default="."); args = ap.parse_args()
    root = Path(args.root)
    cfg = json.loads((root / "config/people.json").read_text(encoding="utf-8"))
    topics = cfg["topics"]
    CORE[:] = [t.lower() for t in cfg.get("core_topics", [])]
    since = f"{dt.date.today().year - int(cfg.get('since_years', 5))}-01-01"
    npp = int(cfg.get("people_per_place", 5))
    out_path = root / "data/people.json"
    old = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    today = dt.date.today().isoformat()

    def load(p):
        try: return json.loads((root / p).read_text(encoding="utf-8")).get("items") or []
        except Exception: return []
    items = [dict(i, _src="scout") for i in load("data/agent-radar.json")] + load("data/opportunities.json")
    phds = []
    for it in items:
        if it.get("type") != "phd": continue
        dl = it.get("deadline")
        if dl and dl < today: continue
        if it.get("id") and it["id"] not in [p["id"] for p in phds]: phds.append(it)

    by_item, place_cache = {}, {}
    for it in phds[:25]:
        insts = institutions_for(it, cfg)
        terms = topics_for(it, topics)
        print(f"- {it['id']}: {', '.join(i['name'] for i in insts) or 'no university found'} | {', '.join(terms[:5])}")
        people, scanned = [], 0
        for inst in insts:
            key = inst["id"] + "|" + "|".join(terms)
            if key not in place_cache: place_cache[key] = people_at(inst, terms, since, npp)
            ppl, n = place_cache[key]; scanned += n
            people += [dict(p, institution=inst["name"]) for p in ppl]
        people = sorted(people, key=lambda p: -p["score"])[:npp]
        by_item[it["id"]] = {"institutions": [i["name"] for i in insts], "topics": terms[:6], "people": people,
                             "reading": reviews(terms, insts), "scanned": scanned, "checked": today}

    # University map (weekly): who publishes on her topics at each target university
    unis = (old.get("universities") or {}) if old.get("version") == VERSION else {}
    fresh_days = int(cfg.get("university_refresh_days", 7))
    for name in cfg.get("universities", []):
        prev = unis.get(name)
        if prev and prev.get("checked") and (dt.date.fromisoformat(today) - dt.date.fromisoformat(prev["checked"])).days < fresh_days:
            continue
        inst = find_institution(name)
        if not inst: continue
        ppl, n = people_at(inst, topics, since, npp)
        unis[name] = {"openalex": inst["id"], "people": ppl, "scanned": n, "checked": today}
        print(f"- university {name}: {len(ppl)} people from {n} papers")

    if CALLS["n"] and CALLS["fail"] >= CALLS["n"] * 0.8 and old:
        print("Most OpenAlex calls failed: keeping the previous data/people.json", file=sys.stderr); return 0
    data = {"_help": "Written by scripts/update_people.py from OpenAlex publication records. People who publish on Ocha's topics at each university; NOT a list of who takes PhD students. The weekly scout verifies.",
            "updated": today, "version": VERSION, "source": "OpenAlex (openalex.org)", "items": by_item, "universities": unis,
            "report": {"phds": len(by_item), "calls": CALLS["n"], "failed": CALLS["fail"]}}
    out_path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}: {len(by_item)} PhDs, {len(unis)} universities, {CALLS['n']} calls ({CALLS['fail']} failed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
