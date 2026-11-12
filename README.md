# Cornelieur: maintenance guide

Cornelieur is a free personal web app for Ocha: find a funded UK PhD or a visa-sponsoring job (**Opportunity radar**), learn R, Python and statistics (**Learn**), read papers comfortably (**Read**), and keep every document organised (**My files**).
Live site: https://sambeltempoyak.github.io/cornelieur/ · Repo: https://github.com/sambeltempoyak/cornelieur (public)

This guide is written for Ejak, who maintains it. You do not need to code.

---

## 1. How the four pieces fit together

| Piece | What it does | Where it lives | Who runs it |
|---|---|---|---|
| **The website** | The app itself (pages, lessons, reader). Everything runs in Ocha's browser. | This GitHub repo, published by GitHub Pages | GitHub, automatically |
| **The robot** | Every morning collects PhD/job adverts from public feeds, every Monday refreshes the Home Office sponsor list. Saves them in `data/`. | `.github/workflows/…yml` + `scripts/` | GitHub Actions (free) |
| **The Drive server** | Saves Ocha's uploads, the Markdown copies, advert summaries and her progress in **one Google Drive folder**. | `apps-script/Code.gs`, running in your Google account | Google Apps Script (free) |
| **The weekly scout** (optional) | A Claude scheduled task that searches the web more cleverly and writes hand-picked items to `data/agent-radar.json`. | `docs/weekly-scout-prompt.md` | Your Claude account |

Ocha's logins: none. Her browser holds the Drive URL and passcode (see 3.4). Her progress, flags and tracker live in the browser and are copied to Drive.

### What is in the repo
```
index.html            the page shell (menu, title)
css/style.css         colours (macaron palette, gradients, night mode) and layout
js/                   the app: app.js (pages, settings), radar.js (adverts), analyze.js (reads an advert),
                      files.js + classify.js + pdf2md.js (My files), reader.js + md.js (phone reader), drive.js (Drive client),
                      learn.js + lessons.js + coderunner.js (Learn), read.js (Read), jokes.js
config/sources.json   the feeds the robot reads and its relevance keywords
config/ocha-profile.md  her situation, for the weekly scout
data/                 written by the robot / scout (do not upload over it, see 4)
scripts/              the robot's Python code
apps-script/Code.gs   the Drive server code (paste into Google Apps Script)
docs/                 weekly scout prompt
```

---

## 2. The Drive folder (what gets filed where)

The root is your folder "Cornelieur server" (the folder id is in the Apps Script file). Ocha never has to organise anything: the app decides.

```
(root)
├── 00 Inbox/                         (unused spare)
├── 01 Opportunities/
│   └── Analysis cache/               one .md summary per advert she opened; AUTO-DELETED when the advert leaves the feed
│                                     or its deadline has passed (checked once a day when she opens the radar)
├── 02 My documents/
│   ├── CV & application letters/
│   ├── Transcripts & certificates/   transcripts/TOR, degree certificates, IELTS…
│   ├── Drafts & proposals/
│   ├── References & letters/
│   └── Other/
├── 03 Papers/
│   └── <topic>/                      e.g. "Drug delivery & formulation", "Antimicrobial & microbiology", "General"
└── 99 System/
    ├── files-index.json              the list of everything filed (what the My files tab shows)
    └── progress.json                 her progress, so phone and laptop agree
```
Each uploaded file is saved as `YYYY-MM-DD name.ext` plus a readable `YYYY-MM-DD name.md` next to it. The app guesses the category from the file name and its text; Ocha can fix it with ⋯ → Move.
PDFs that are only pictures (scans) cannot be read: the app says so. Files over 12 MB keep only the Markdown copy.

---

## 3. One-time setup (already done unless marked)

### 3.1 Website on GitHub Pages ✅
Settings → Pages → Source: **GitHub Actions**. Every upload to `main` republishes the site in about 3 minutes.

### 3.2 The robot ✅
The workflow file is in `.github/workflows/`. Actions tab → "Update radar and publish" → **Run workflow** runs it by hand.

### 3.3 The Drive server (Google Apps Script): about 10 minutes
1. Open https://script.google.com signed in as the Google account that owns the Drive folder → **New project**.
2. Delete the sample code, paste in the whole of `apps-script/Code.gs`.
3. At the top, set `ROOT_ID` to the id of your Drive folder (the long code at the end of the folder's link) and change `PASSCODE` to a long private phrase (16+ letters/numbers). Save.
4. In the toolbar pick the function **authorizeOnce** and press **Run**. Google asks for permission (Drive and "connect to an external service"). Allow it. (If you see "Google hasn't verified this app", click Advanced → Go to project: it is your own script.)
5. **Deploy → New deployment → ⚙ Select type → Web app.** Execute as: **Me**. Who has access: **Anyone**. Deploy, and copy the **Web app URL** (it ends in `/exec`).
6. In the app (on Ocha's laptop): **Settings → Google Drive** → paste the URL and the passcode → **Save & test**. It should say "Connected to Cornelieur server".
7. Still in Settings, press **Copy connect link** and send it to Ocha's phone (WhatsApp to herself is fine). Opening it once connects her phone. Treat it like a password: anyone with it can use the folder through Cornelieur.

### 3.4 What is secret
The Web app URL + passcode work as a key to the Drive folder. They are **never** stored in the repo. They live in the Apps Script file in your Google account and in Ocha's browser. If you think they leaked: change `PASSCODE` in the script, redeploy (see 5), and re-connect her devices.

### 3.5 Weekly scout (optional)
Follow `docs/weekly-scout-prompt.md`. It also explains how to update her profile when something changes.

---

## 4. How to update the app (the patch routine)

You never need to re-upload everything. A patch is just the changed files.

1. Get the patch zip from Claude (it contains only changed files, with their folders) and unzip it on your computer.
2. Open the repo on GitHub → **Add file → Upload files**.
3. Drag the **contents** of the unzipped folder into the page (the `js`, `css`, `config`… folders and loose files). GitHub keeps the folder structure and replaces files with the same path.
4. **Do not upload** the `data/` folder (the robot's and scout's results) or the `.github/` folder (the workflow; a second copy would run twice). The patch zips leave them out, but check.
5. Scroll down → **Commit changes** (to `main`).
6. Open the **Actions** tab; a new run "Update radar and publish" starts. Wait until it turns **green** (about 3 minutes).
7. Open the site and reload without cache: **Ctrl+Shift+R** (laptop), or on a phone close the tab and reopen. Settings → About shows the version number, so you can confirm the patch arrived.

Small edits (a joke, a keyword, a feed): open the file on GitHub, click the **pencil**, edit, **Commit changes**. Same wait.

**Undo a bad update:** on GitHub open the repo → Commits → click the bad commit → **⋯ → Revert** → create the revert. The site republishes the previous version.

**Never press "Re-run jobs" on an old run**: it redeploys the old files. Use "Run workflow" instead.

### Updating the Drive script
If a patch changes `apps-script/Code.gs`: open your script, replace everything with the new file (keep your `ROOT_ID` and `PASSCODE` lines), save, then **Deploy → Manage deployments → ✏ edit → Version: New version → Deploy**. The URL stays the same. (Just saving is not enough.)

---

## 5. Routine upkeep

**Every few weeks (5 minutes)**
- Actions tab: recent runs green? If red, open the run to see which step failed.
- Open `data/opportunities.json` on GitHub: the `report`/`sources` part lists how many items each feed gave. A feed with 0 for weeks has probably moved. Fix or remove it in `config/sources.json`.
- Settings → Google Drive shows a green dot when the server answers.

**When a feed stops working:** edit `config/sources.json` (add `{"name": "...", "url": "https://.../rss"}` under `feeds`, or a listing page under `discover`). Commit. Run the workflow once.

**When her situation changes:** update `config/ocha-profile.md` (see the scout doc) and, in the app, Settings → Profile keywords.

**Deprecation notices in Actions** (for example "Node.js 20 is deprecated"): harmless for now. Later, ask Claude to bump the action versions in the workflow.

**Storage:** Drive counts against your Google storage, not hers. Check the folder size now and then. The advert cache cleans itself; papers and documents stay until she deletes them (⋯ → Delete sends them to the Drive bin).

---

## 6. If something goes wrong

| What you see | Likely cause | Fix |
|---|---|---|
| Site shows 404 | Last deploy was an old/empty commit, or Pages source not set | Settings → Pages → Source = GitHub Actions; Actions → Run workflow |
| Site looks old after a patch | Browser cache | Ctrl+Shift+R; check Settings → About version |
| Actions run is red | One step failed | Open the run, read the red step; the robot steps are allowed to fail, the deploy step is not |
| "Could not reach your Drive script" | Wrong URL, offline, or access not "Anyone" | Re-check URL ends `/exec`; redeploy as Web app with access Anyone |
| "Wrong passcode" | Passcode differs from the script | Re-enter it in Settings, or fix it in the script and redeploy a new version |
| Changes to Code.gs have no effect | Forgot "New version" | Deploy → Manage deployments → edit → New version |
| "This PDF looks like a scan" | Picture-only PDF | OCR it first (Pindai app, or Drive → Open with Google Docs) |
| Advert says "quick read only" | Drive not connected, or the advert page needs JavaScript | Connect Drive; open the advert link to confirm details yourself |
| Lessons' R/Python will not start | Browser blocked the big download, or weak signal | Try Chrome/Edge on wi-fi; the first start takes a minute |

---

## 7. Known limits (honest list)
- The advert reader is rule-based, not an AI. It finds deadlines and common eligibility phrases well, but can miss unusual wording. Every summary says "confirm on the advert".
- Some university pages need JavaScript and cannot be read; those fall back to the feed summary.
- LinkedIn cannot be connected (no official way). The app offers pre-filled search links that open in her own logged-in browser.
- Scanned PDFs are not OCR'd. Very large files (over about 12 MB) keep only the Markdown copy.
- Her files sit in your Drive folder, and you could open them. Tell her this plainly. If she prefers a private Drive of her own, the app can later switch to Google sign-in (OAuth), which needs a Google Cloud project.
- The robot's feed addresses were not all verified from GitHub's servers; check the report after the first runs.

---

## 8. Credits and licence
Built for Ocha by Ejak with Claude. Paper search by Europe PMC; sponsor data from the UK Home Office register; R in the browser via webR; Python via Pyodide; PDF reading via PDF.js; Word reading via mammoth.js. The macaron palette comes from the colour board Ejak chose.
