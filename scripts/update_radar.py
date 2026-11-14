#!/usr/bin/env python3
"""Daily robot: read public RSS feeds of UK PhD studentships and science jobs,
keep the relevant ones, and write data/opportunities.json for the Cornelieur app.

Standard library only, so it runs on GitHub Actions with no installs.
Usage: python scripts/update_radar.py [--root .]
"""
import argparse, datetime as dt, email.utils, hashlib, html, json, re, sys, time
import urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

UA = "Mozilla/5.0 (compatible; CornelieurRadar/1.0; personal job-alert reader)"
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        enc = r.headers.get_content_charset() or "utf-8"
    for e in (enc, "utf-8", "iso-8859-1"):
        try:
            return raw.decode(e)
        except Exception:
            continue
    return raw.decode("utf-8", "replace")


def strip_html(s):
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s or "")
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_date(text, ref=None):
    """Find a closing/deadline date in free text. Returns ISO date or None."""
    ref = ref or dt.date.today()
    t = text or ""
    m = re.search(r"(?:closing date|closes|deadline|apply by|applications close)[^0-9a-z]{0,12}(?:\w+day,?\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?", t, re.I)
    if not m:
        m2 = re.search(r"(?:closing date|closes|deadline)[^0-9]{0,12}(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", t, re.I)
        if m2:
            d, mo, y = map(int, m2.groups()); y = y + 2000 if y < 100 else y
            try:
                return dt.date(y, mo, d).isoformat()
            except ValueError:
                return None
        return None
    d, mon, y = m.groups()
    mo = MONTHS.get(mon[:3].lower())
    if not mo:
        return None
    y = int(y) if y else ref.year
    try:
        date = dt.date(y, mo, int(d))
    except ValueError:
        return None
    if not m.group(3) and date < ref - dt.timedelta(days=30):
        date = date.replace(year=date.year + 1)
    return date.isoformat()


def parse_pub(s):
    if not s:
        return None
    try:
        return email.utils.parsedate_to_datetime(s).date().isoformat()
    except Exception:
        pass
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s.strip())
    return m.group(1) if m else None


def local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def parse_feed(text):
    """Return list of dicts with title, link, summary, published. RSS 2.0, RSS 1.0 and Atom."""
    items = []
    text = text.replace("<\\channel>", "</channel>").replace("<\\/channel>", "</channel>")
    try:
        clean = re.sub(r"^\s*<\?xml[^>]*\?>", "", text.strip())  # drop encoding declaration; text is already decoded
        root = ET.fromstring(clean)
        for el in root.iter():
            name = local(el.tag)
            if name not in ("item", "entry"):
                continue
            rec = {"title": "", "link": "", "summary": "", "published": None}
            for ch in el:
                n = local(ch.tag)
                val = (ch.text or "").strip()
                if n == "title":
                    rec["title"] = strip_html(val)
                elif n == "link":
                    rec["link"] = ch.attrib.get("href") or val or rec["link"]
                elif n in ("description", "summary", "content", "encoded") and not rec["summary"]:
                    rec["summary"] = val
                elif n in ("pubdate", "published", "updated", "date") and not rec["published"]:
                    rec["published"] = parse_pub(val)
                elif n == "guid" and not rec["link"] and val.startswith("http"):
                    rec["link"] = val
            if rec["title"] and rec["link"]:
                items.append(rec)
        return items
    except ET.ParseError:
        pass
    # tolerant regex fallback for slightly broken feeds
    for block in re.findall(r"(?is)<item\b.*?</item>", text):
        def grab(tag):
            m = re.search(rf"(?is)<{tag}\b[^>]*>(.*?)</{tag}>", block)
            if not m:
                return ""
            v = m.group(1).strip()
            v = re.sub(r"(?s)^<!\[CDATA\[(.*)\]\]>$", r"\1", v)
            return v
        rec = {"title": strip_html(grab("title")), "link": strip_html(grab("link")) or strip_html(grab("guid")),
               "summary": grab("description"), "published": parse_pub(strip_html(grab("pubDate")))}
        if rec["title"] and rec["link"]:
            items.append(rec)
    return items


def discover_feeds(page_html, base_url, match):
    """From an HTML page that lists RSS feeds, return [(label, absolute_url)] whose context matches."""
    found = []
    blocks = re.findall(r"(?is)<tr\b.*?</tr>|<li\b.*?</li>|<p\b.*?</p>", page_html) or [page_html]
    for b in blocks:
        ctx = strip_html(b).lower()
        if not any(k in ctx for k in match):
            continue
        for href, label in re.findall(r'(?is)<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', b):
            h = html.unescape(href)
            if re.search(r"rss|feed|\.xml|format=rss|atom", h, re.I):
                found.append((strip_html(label) or ctx[:60], urllib.parse.urljoin(base_url, h)))
    seen, out = set(), []
    for lab, u in found:
        if u not in seen:
            seen.add(u); out.append((lab, u))
    return out[:25]


def guess_type(title, summary):
    t = (title + " " + summary).lower()
    if re.search(r"\bphd\b|studentship|doctoral|dphil|\bcdt\b|\bdtp\b", t):
        return "phd"
    return "job"


def intl_flag(text):
    pos = re.search(r"international (students|applicants|candidates)|all nationalities|overseas (students|applicants)|students worldwide|visa sponsorship (is )?available|skilled worker visa|certificate of sponsorship|open to (all|international)", text, re.I)
    neg = re.search(r"uk (students|applicants|nationals) only|home (fee|students) only|home fee status|uk/home|only (available|open) to (uk|home)|uk or eu candidates|no visa sponsorship|unable to (offer|provide) (visa )?sponsorship|cannot sponsor", text, re.I)
    if neg and not pos:
        return False
    if pos and not neg:
        return True
    return None


def find_org(title, summary, default):
    m = re.search(r"(University of [A-Z][\w' -]+?|[A-Z][\w']+ University|Imperial College London|King's College London|UCL|Queen Mary[\w ]*|Francis Crick Institute|[A-Z][\w']+ Institute)\b", title + " " + summary[:400])
    return m.group(1).strip() if m else default


def build_relevance(words):
    """Whole-word-start matching: 'cell' matches 'cells' but not 'excellence'."""
    ws = [w.strip().lower() for w in words if w.strip()]
    return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in ws) + ")", re.I) if ws else None


def is_relevant(title, summary, rx):
    """Keep an item if a keyword is in the TITLE, or at least two different keywords are in the body.
    One stray word in a long advert (e.g. 'clinical' in a facilities post) is not enough."""
    if rx is None:
        return True
    if rx.search(title):
        return True
    return len({m.lower() for m in rx.findall(summary)}) >= 2


def build_exclude(patterns):
    ps = [p for p in patterns if p]
    return re.compile("|".join(ps), re.I) if ps else None


KEEP_TITLE = re.compile(r"\bphd|studentship|\bdphil|doctoral training|\bcdt\b|\bdtp\b|research (assistant|technician|officer)|technician|scientist", re.I)


def is_non_research(title, rx):
    """Admin, facilities, teaching-only and senior-academic posts. PhD/studentship/research-staff titles always survive."""
    return bool(rx and rx.search(title) and not KEEP_TITLE.search(title))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    args = ap.parse_args()
    root = Path(args.root)
    cfg = json.loads((root / "config/sources.json").read_text(encoding="utf-8"))
    rel = build_relevance(cfg.get("relevance", []))
    excl = build_exclude(cfg.get("exclude_titles", []))
    out_path = root / "data/opportunities.json"
    old = {}
    if out_path.exists():
        try:
            for it in json.loads(out_path.read_text(encoding="utf-8")).get("items", []):
                old[it["id"]] = it
        except Exception:
            pass

    feeds = [dict(f) for f in cfg.get("feeds", [])]
    report = []
    for d in cfg.get("discover", []):
        try:
            page = fetch(d["url"])
            got = discover_feeds(page, d["url"], [m.lower() for m in d.get("match", [])])
            for label, u in got:
                feeds.append({"name": f'{d["name"]} · {label}'[:90], "url": u, "org": d.get("org"), "org_from_item": d.get("org_from_item", False), "type": d.get("type")})
            report.append({"name": d["name"] + " (discovery)", "count": len(got), "ok": True})
        except Exception as e:
            report.append({"name": d["name"] + " (discovery)", "count": 0, "ok": False, "error": str(e)[:120]})
        time.sleep(1)

    today = dt.date.today()
    fresh = {}
    seen_urls = set()
    for f in feeds:
        if f["url"] in seen_urls:
            continue
        seen_urls.add(f["url"])
        try:
            items = parse_feed(fetch(f["url"]))
        except Exception as e:
            report.append({"name": f["name"], "count": 0, "ok": False, "error": str(e)[:120]})
            continue
        kept = 0
        for it in items:
            summary = strip_html(it["summary"])
            blob = (it["title"] + " " + summary).lower()
            if is_non_research(it["title"], excl):
                continue
            if not f.get("all") and not is_relevant(it["title"], summary, rel):
                continue
            iid = "r" + hashlib.sha1(it["link"].encode()).hexdigest()[:12]
            deadline = parse_date(summary) or parse_date(it["title"])
            rec = {
                "id": iid,
                "title": it["title"][:220],
                "link": it["link"],
                "org": find_org(it["title"], summary, f.get("org") or "") if f.get("org_from_item") else (f.get("org") or find_org(it["title"], summary, "")),
                "source": f["name"],
                "type": f.get("type") or guess_type(it["title"], summary),
                "summary": summary[:900],
                "published": it.get("published") or today.isoformat(),
                "deadline": deadline,
                "intl": intl_flag(summary + " " + it["title"]),
                "location": "London" if "london" in blob else "",
                "first_seen": old.get(iid, {}).get("first_seen", today.isoformat()),
            }
            sal = re.search(r"£\s?\d[\d,]{3,}(?:\s*(?:-|to)\s*£?\s?\d[\d,]{3,})?(?:\s*(?:per annum|p\.a\.|pa))?", summary)
            if sal:
                rec["salary"] = sal.group(0)
            fresh[iid] = rec
            kept += 1
        report.append({"name": f["name"], "count": kept, "ok": True})
        time.sleep(0.6)

    # merge with previous run so items don't vanish when a feed hiccups
    merged = dict(old)
    merged.update(fresh)
    keep_days = cfg.get("keep_days", 75)
    all_names = {f["name"] for f in feeds if f.get("all")}
    final = []
    for it in merged.values():
        if it["id"] not in fresh:  # carried over from an earlier run: apply today's (stricter) filters too
            if is_non_research(it["title"], excl):
                continue
            if it.get("source") not in all_names and not is_relevant(it["title"], it.get("summary", ""), rel):
                continue
        fs = dt.date.fromisoformat(it.get("first_seen", today.isoformat()))
        if (today - fs).days > keep_days:
            continue
        if it.get("deadline"):
            try:
                if dt.date.fromisoformat(it["deadline"]) < today - dt.timedelta(days=3):
                    continue
            except ValueError:
                pass
        final.append(it)
    final.sort(key=lambda x: x.get("first_seen", ""), reverse=True)
    final = final[: cfg.get("max_items", 400)]

    ok_sources = [r for r in report if r["ok"] and r["count"] > 0 and "(discovery)" not in r["name"]]
    out = {
        "updated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "count": len(final),
        "sources": [{"name": r["name"].split(" · ")[0], "count": r["count"]} for r in ok_sources][:12],
        "report": report,
        "items": final,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(final)} items ({len(fresh)} fresh) from {len(feeds)} feeds")
    for r in report:
        print(("  ok  " if r["ok"] else "  ERR ") + f'{r["name"]}: {r["count"]}' + (f' — {r.get("error")}' if not r["ok"] else ""))


if __name__ == "__main__":
    sys.exit(main())
