# Weekly scout: prompt and setup

This is the prompt for the scheduled Claude task that refreshes `data/agent-radar.json` (the "✦ AI-curated" cards in the app)
and keeps `config/ocha-profile.md` and the search keywords up to date.

## 1. Schedule it
Ask Claude: "Create the weekly Cornelieur scout as a scheduled task, every Thursday at 12:00 London time, using the prompt in docs/weekly-scout-prompt.md."
Or in the scheduled-tasks screen, create a task with:
- Schedule: Thursdays 12:00, time zone Europe/London (cron: `CRON_TZ=Europe/London 0 12 * * 4`). Runs can start a few minutes late.
- Prompt: the block below.
- Needs: Claude's GitHub connection must have **push** access to `sambeltempoyak/cornelieur`.
- Approvals: turn on automatic approval for the task if you can; otherwise a run that needs approval stops while nobody is watching.

## 2. The prompt (copy everything in the block)

```
You are the weekly "scout" for Cornelieur, a free web app that helps Ocha find a funded UK PhD or a visa-sponsoring job.
Repo: github.com/sambeltempoyak/cornelieur (public, branch main). Today is the date of this run (Europe/London).

SETUP
1. Get the repo: call add_repo for owner sambeltempoyak, repo cornelieur, access "push", then clone it and work inside the clone.
   If push access is refused, still do steps A-D, save the result as a file, and report clearly that nothing could be saved.
2. If a skill named cornelieur-weekly-scout is available, follow it, but ALSO do step C2 below and use the item format in C.
   Where the skill and this prompt disagree, this prompt wins.

READ FIRST
- config/ocha-profile.md (who she is, goals, hard filters, search angles, update log)
- config/sources.json (feeds and relevance keywords the daily robot uses)
- data/agent-radar.json (what you wrote last week, including "research" and "enrich") and data/opportunities.json
  (what the daily robot found; do not duplicate its links as new items)

DO
A. Search the web (many separate searches, standard then extended if thin) for NEW opportunities that match the profile:
   funded UK PhD studentships open to international students, scholarships, KTP/CASE projects, and sponsor-friendly pharmaceutical/biotech jobs.
   Open each candidate's advert page and check it yourself. Keep only items that are still open (deadline in the future or rolling),
   not restricted to home students or the university's own students, not refusing visa sponsorship, and not needing GPhC registration or a finished PhD.
B. Re-check last week's items: drop any that closed, were withdrawn, or turned out to be ineligible.
C. Write data/agent-radar.json (valid JSON, at most 15 items, best first):
   {"updated":"YYYY-MM-DD","items":[{"id":"scout-<short-slug>","title":"...","org":"...","link":"https://...","type":"phd|job|scholarship",
   "summary":"2-3 sentences in your own words: what it is, who can apply, funding","deadline":"YYYY-MM-DD or null","location":"...",
   "source":"found by weekly scout","intl":true|false|null,"published":"YYYY-MM-DD",
   "why":"one line: why it fits Ocha","steps":["3-5 concrete next steps, e.g. email Dr X with CV by <date>"],
   "research":{...see C2, PhD items only...}}],
   "enrich":{"<robot item id>":{...research object, see C2...}}}
   Set "intl": true only if you read on the advert that international applicants are eligible: the app trusts it over its own text rules.
   Paraphrase; never paste long text from adverts. Only include links you opened and confirmed.
C2. RESEARCH EACH PhD (supervisors, their papers, what to read). Do this for every PhD item you write in C, and for every still-open
   type "phd" item in data/opportunities.json (write those under "enrich", keyed by the robot item's "id"). At most 12 PhDs per run:
   soonest deadline and best fit first; keep last week's research for the rest if it is still valid.
   Research object:
   {"checked":"YYYY-MM-DD",
    "angle":"1-2 lines in plain English linking her MSc in Biotechnology and Pharmaceutics to this group's work, usable in her first email",
    "supervisors":[{"name":"Dr/Prof Full Name","role":"e.g. Reader","dept":"department, university","profile":"official staff page URL",
                    "focus":"one line, your words: what they work on that matters for her"}],
    "publications":[{"title":"exact title","by":"surnames, e.g. Smith & Lee","venue":"journal","year":2025,"link":"DOI or PubMed/Europe PMC URL"}],
    "reading":[{"title":"exact title","authors":"First author et al.","year":2023,"link":"DOI/PubMed/open-access URL",
                "level":"start|deeper","why":"one line: how it helps her (understand the field, prepare the email, the interview)"}]}
   Rules:
   - Supervisors: 1-4 people named on the advert or project page. For a programme advert (DTP/DLA, CDT, school-wide call) with no named
     supervisor, pick 2-4 supervisors from that programme's project list or member staff whose work fits her profile (pharmaceutics,
     drug delivery, formulation, biopharmaceutics, pharmacology, antimicrobials), and say so in "focus" ("listed in the 2027 project list").
     Official university pages only. No email addresses or phone numbers (the repo is public).
   - Publications: 2-4 recent (about the last 5 years) papers by those supervisors that relate to the project. Only papers you opened on
     PubMed, Europe PMC, a DOI page or the journal site, with the title copied exactly.
   - Reading: 3-5 items. 1-2 "start": accessible reviews, open access preferred. 1-3 "deeper": key method or project papers (may be the
     supervisors' own). Write "(paywalled)" at the end of "why" when there is no free full text.
   - Never invent a name, title or link. If you cannot confirm something, leave it out. If nothing can be confirmed, omit "research".
   - The app shows this in a folded "Supervisors & what to read" card on each PhD, and adds it to the Markdown summary saved in her Drive.
     You do not need to write Markdown files.
D. If the profile or search angles clearly need to change (new qualification, goal, university list, new feed worth adding), propose it in your report.
   Only edit config/ocha-profile.md or config/sources.json if Ejak asked for that in this run's instructions; otherwise leave them untouched.
E. Validate the JSON (e.g. python -m json.tool). Commit only data/agent-radar.json (and any file Ejak explicitly asked you to change).
   Message: "Weekly scout YYYY-MM-DD: N items, M PhDs researched". git pull --rebase first, then push to main.
   Never commit secrets, Drive URLs or passcodes. Never touch .github/, js/ or css/.

REPORT (short, plain, for Ejak)
- How many items added, kept, dropped, and the top 3 with one-line reasons.
- How many PhDs got research (new / kept from last week), and any where no supervisor or paper could be confirmed.
- Anything you could not verify, any search that came back empty, and any suggested profile or keyword changes.
- Whether the push succeeded.
```

## 3. Updating the profile when something changes
Easiest: tell Claude in chat: "Ocha now has X (for example, a new certificate, a new goal, a visa change). Update the Cornelieur profile and keywords."
Claude edits `config/ocha-profile.md` (and, if needed, the keywords in `config/sources.json`) and explains the change.
Or edit `config/ocha-profile.md` yourself on GitHub (open the file, click the pencil, change, "Commit changes"). Add a dated line in the log at the bottom.
The next scout run reads it automatically. The in-app keywords (Settings → Profile) are separate and live in Ocha's browser.

## 5. The weekly email (kept out of this public file)
The scheduled task has one extra last step (F): after a successful run with new items, it emails a short, funny "your app is refreshed" note
from the maintainer's Gmail. That step is stored only in the scheduled task itself, not here, because it contains an email address and this repository is public.
