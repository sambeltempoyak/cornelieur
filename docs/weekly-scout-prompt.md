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
   If push access is refused, still do steps 2-5, save the result as a file, and report clearly that nothing could be saved.
2. If a skill named cornelieur-weekly-scout is available, follow it. Otherwise follow the steps here.

READ FIRST
- config/ocha-profile.md (who she is, goals, hard filters, search angles, update log)
- config/sources.json (feeds and relevance keywords the daily robot uses)
- data/agent-radar.json (what you wrote last week) and data/opportunities.json (what the robot found; do not duplicate its links)

DO
A. Search the web (use many separate searches, standard then extended if thin) for NEW opportunities that match the profile:
   funded UK PhD studentships open to international students, scholarships, KTP/CASE projects, and sponsor-friendly pharmaceutical/biotech jobs.
   Open each candidate's advert page and check it yourself. Keep only items that are still open (deadline in the future or rolling),
   not restricted to home students or the university's own students, not refusing visa sponsorship, and not needing GPhC registration or a finished PhD.
B. Re-check last week's items: drop any that closed, were withdrawn, or turned out to be ineligible.
C. Write data/agent-radar.json (valid JSON, at most 15 items, best first):
   {"updated":"YYYY-MM-DD","items":[{"id":"scout-<short-slug>","title":"...","org":"...","link":"https://...","type":"phd|job|scholarship",
   "summary":"2-3 sentences in your own words: what it is, who can apply, funding","deadline":"YYYY-MM-DD or null","location":"...",
   "source":"found by weekly scout","intl":true|false|null,"published":"YYYY-MM-DD",
   "why":"one line: why it fits Ocha","steps":["3-5 concrete next steps, e.g. email Dr X with CV by <date>"]}]}
   Paraphrase; never paste long text from adverts. Only include links you opened and confirmed.
D. If the profile or search angles clearly need to change (new qualification, goal, university list, new feed worth adding), propose it in your report.
   Only edit config/ocha-profile.md or config/sources.json if Ejak asked for that in this run's instructions; otherwise leave them untouched.
E. Commit only data/agent-radar.json (and any file Ejak explicitly asked you to change). Message: "Weekly scout YYYY-MM-DD: N items".
   git pull --rebase first, then push to main. Never commit secrets, Drive URLs or passcodes. Never touch .github/, js/ or css/.

REPORT (short, plain, for Ejak)
- How many items added, kept, dropped, and the top 3 with one-line reasons.
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
