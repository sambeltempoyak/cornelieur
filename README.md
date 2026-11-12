# Cornelieur — Ocha's career, learning & reading studio

A free web app that runs on GitHub Pages: no server, no API keys, nothing for Ocha to connect.

| Corner | What it does |
|---|---|
| **Today** | One small step from each corner, a streak, and a "low energy" mode that shows just one thing. |
| **Opportunity radar** | A GitHub robot reads UK PhD/science job feeds every morning and the Home Office sponsor register every Monday. The app scores each item against her profile (international-friendly? funded? London? deadline?), offers a 5-minute swipe-style digest, one-tap pre-filled searches on LinkedIn/Indeed/NHS/FindAPhD/jobs.ac.uk (using her own logins), a **sponsor checker**, step-by-step **route playbooks** (funded PhD, LPDP-funded PhD, sponsored job, RA → PhD bridge, KTP) and a **tracker** with email/cover-letter templates. |
| **Learn** | A Duolingo-style path of 26 five-minute lessons: pharmacy refresher → statistics → R → R for pharma (PK plots, AUC, half-life, t-tests, EC50) → Python & machine learning → omics → the professional toolkit. **R (webR) and Python (Pyodide) run inside the browser**, so she can code before installing anything. A setup page links to the official installers (jamovi, R + RStudio, Anaconda) for Mac and Windows. |
| **Read** | Search Europe PMC (40M+ papers), get an in-browser digest, jargon highlighted with definitions, free full text section by section, PDF upload, a takeaway journal, and a "Discuss with an AI" button that copies a ready-made prompt for Claude/ChatGPT/Gemini. Plus a curated guide to NotebookLM, Elicit, Perplexity and friends. |

Everything she does is saved in her browser (Settings → Download backup to move devices).

## Put it online (about 10 minutes, once)

1. Sign in at github.com → **New repository** → name it e.g. `cornelieur` → Public → Create.
2. On the empty repo page click **uploading an existing file**, drag in *all* the files and folders from this zip (including the `.github` folder — on a Mac press ⌘⇧. in Finder to show it) → **Commit changes**.
   - If `.github` won't upload: in the repo click **Add file → Create new file**, type `.github/workflows/update.yml` as the name, paste the contents of that file, commit.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. **Actions** tab → if asked, click *I understand… enable workflows* → open **Update radar and publish** → **Run workflow**. The first run takes ~2 minutes and downloads the sponsor register and today's feeds.
5. The site appears at `https://<your-username>.github.io/cornelieur/`. Send Ocha that link — she can "Add to Home Screen" on her phone.

After that it updates itself daily at ~06:17 UTC. Nothing else to do.

## Tuning the radar

- `config/sources.json` — add RSS feeds (`feeds`) or pages that list feeds (`discover`). Any university job site whose address contains `rss.aspx` works. Each run's success/failure per source is in `data/opportunities.json → report`.
- Ocha can change her keywords in **Settings**; scoring happens in her browser.

## Optional: an AI scout (weekly, curated)

The robot only reads feeds. For a smarter weekly sweep, a scheduled AI task can research the web and write hand-picked items with a "why it fits" line into `data/agent-radar.json` (same format as `opportunities.json`, plus `why` and `steps`). The app shows these first with an "AI-curated" badge. Ask Claude to set this up as a weekly scheduled task pointed at this repository.

## Files

```
index.html, css/, js/          the app (plain HTML/CSS/JS modules, no build step)
js/lessons.js                  all lesson content — edit freely
data/                          written by the robot (opportunities.json, sponsors.json) + agent-radar.json
scripts/update_radar.py        feed reader (Python standard library only)
scripts/update_sponsors.py     Home Office register → compact JSON
.github/workflows/update.yml   daily schedule + GitHub Pages deploy
```

Third-party services used from the browser: Europe PMC REST API, webR, Pyodide, pdf.js (jsDelivr), Google Fonts, and — only if she presses the experimental button — WebLLM.
