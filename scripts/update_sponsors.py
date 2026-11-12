#!/usr/bin/env python3
"""Weekly robot: download the Home Office 'Register of licensed sponsors: workers'
and write a compact data/sponsors.json (Skilled Worker route only).

Row format: [organisation, town, type_and_rating, life_science_flag]
"""
import argparse, csv, datetime as dt, io, json, re, sys, urllib.request
from pathlib import Path

API = "https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers"
UA = "Mozilla/5.0 (compatible; CornelieurRadar/1.0)"
LIFE = re.compile(r"pharm|biotech|bio[ -]?scien|biolog|therapeut|life scien|diagnost|genom|laborator|\blabs?\b|clinical|medic|vaccin|antibod|molecul|cell|gene|nhs|hospital|health ?care|university|institute|crick|wellcome|research|chemi|analytic|biosimilar|biologic", re.I)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--root", default="."); ap.add_argument("--csv", help="use a local CSV instead of downloading")
    a = ap.parse_args(); root = Path(a.root)
    if a.csv:
        raw, url = Path(a.csv).read_bytes(), a.csv
    else:
        meta = json.loads(get(API))
        atts = [x for x in meta.get("details", {}).get("attachments", []) if str(x.get("url", "")).lower().endswith(".csv")]
        if not atts:
            print("No CSV attachment found"); return 1
        url = atts[0]["url"]
        raw = get(url)
    text = raw.decode("utf-8-sig", "replace")
    rows = []
    reader = csv.DictReader(io.StringIO(text))
    keys = {k.lower().strip(): k for k in (reader.fieldnames or [])}
    k_name = keys.get("organisation name") or list(keys.values())[0]
    k_town = keys.get("town/city"); k_type = keys.get("type & rating"); k_route = keys.get("route")
    seen = set()
    for r in reader:
        route = (r.get(k_route) or "") if k_route else ""
        if k_route and "skilled worker" not in route.lower():
            continue
        name = (r.get(k_name) or "").strip()
        if not name:
            continue
        town = (r.get(k_town) or "").strip().title() if k_town else ""
        key = (name.lower(), town.lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append([name, town, (r.get(k_type) or "").strip() if k_type else "", 1 if LIFE.search(name) else 0])
    rows.sort(key=lambda x: x[0].lower())
    m = re.search(r"(\d{4}-\d{2}-\d{2})", url)
    out = {"updated": dt.date.today().isoformat(), "registerDate": m.group(1) if m else None, "source": url, "count": len(rows), "rows": rows}
    p = root / "data/sponsors.json"; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(rows)} Skilled Worker sponsors ({sum(r[3] for r in rows)} life-science-ish) from {url}")


if __name__ == "__main__":
    sys.exit(main())
