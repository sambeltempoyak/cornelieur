# Cornelieur: how the radar should collect opportunities

Written 19 Nov 2026. This is a plan; nothing in it is built yet. Phases are at the end.

## 1. What went wrong

- **jobs.ac.uk.** On 14 Nov all three jobs.ac.uk index URLs returned `HTTP 404` to the robot on GitHub Actions. The robot's own log for that run shows it, and that is why they were dropped.
  - The pages still seem to exist when read through a normal web reader, but that reader may have served a cached copy.
  - Their feeds help page is old: it still points to the RDN viewer, a service that no longer exists.
  - Their advert and search pages also refused automated reads on 19 Nov.
  - So the likely cause is that jobs.ac.uk now turns away automated or datacentre traffic, or quietly moved its feed paths. Either way they offer **no supported feed or API**.
  - We will not disguise the robot as a browser to get round it.
- **Too much noise.** The robot reads 104 feeds but produced only 5 items on 19 Nov.
  - Most of those feeds are whole-university category lists found by the "discover" pages (Bath, Bradford, Royal Holloway, LSHTM), and they are mostly admin, facilities and teaching posts.
  - The problem is not too few sources. It is the wrong kind of source.
- **Jobs.** Jobs are almost uncovered. University feeds don't list industry roles (QC, formulation, regulatory, pharmacovigilance, clinical trials), and the weekly scout can't check aggregator adverts.

## 2. Principles

1. **Use official doors only:** published RSS feeds, documented public job-board APIs, keyed APIs whose terms allow personal use, and email alerts the user signs up for. No scraping around blocks and no fake user agents.
2. **Narrow feeds beat wide ones.** Read one department or category feed (Pharmacy, Pharmacology, Biosciences, Doctoral College) rather than a whole university.
3. **Join every job to the sponsor register.** The robot already downloads the Home Office register (`data/sponsors.json`). Each job should carry `sponsor: yes/likely/no`.
4. **Split the work.** The robot does daily bulk collection. The weekly AI scout does judgement: verifying, programme-level PhD calls, ranking and the email.
5. **Keep a health check per source.** Flag any source that gives 0 items for 14 days, so dead feeds are found within two weeks.

## 3. The five layers

| Layer | What | Who runs it | Examples (status) |
|---|---|---|---|
| A. University feeds | Stonefish `rss.aspx?cat=N` feeds, one per relevant category; Oxford open-data vacancy feeds | Robot, daily | Brighton Pharmacy 1339/1533, Pharmacology 1118, Pharm & Chem Sci 1116, Doctoral College 1175 (seen linked); Greenwich and Leeds root feeds (opened, gave items); Surrey (feed valid, category empty); Oxford data.ox.ac.uk per-unit feeds (documented, endpoint untested) |
| B. Employer job boards | Public job-board APIs from applicant tracking systems: Greenhouse (docs: "authentication is not required for any GET endpoints"), SmartRecruiters (no key, `country=gb` filter), Lever, Ashby | Robot, daily | Eurofins and Bicycle Therapeutics (SmartRecruiters ids confirmed, both on the register); Cambridge/Oxford biotechs on Greenhouse (bit.bio, Altos Labs, biomodal) |
| C. Job APIs with a key | Adzuna API (free key; personal job search allowed; each advert must show an "Adzuna" label linking back) and Reed Jobseeker API (free key, terms not published) | Robot, daily, keys stored as GitHub secrets | Searches such as "QC analyst", "analytical scientist", "formulation scientist", "regulatory affairs associate", "pharmacovigilance", "clinical trial assistant" around London, Herts, Cambridge, Oxford and the M4, then joined to the register |
| D. Email alerts | jobs.ac.uk job alerts (Pharmacy + Studentships), FindAPhD weekly newsletter, optional LinkedIn/Indeed alerts, all sent to one Gmail label | Weekly scout reads the label through the Gmail connector (or a timed Apps Script parses it) | The legitimate way to keep jobs.ac.uk and FindAPhD, which have no feed |
| E. Weekly AI scout | UKRI doctoral programme calendar (DTP/DLA), verifying adverts, ranking, the email to Ocha | Scheduled Claude task | Already running |

The big jobs.ac.uk-style employers that have no public feed (GSK, AstraZeneca, Thermo Fisher, IQVIA, ICON) come in through layer C (aggregators) and layer D (alerts). We don't scrape them.

## 4. Phases

1. **Clean up (small).**
   - Replace the noisy Bath, Bradford, Royal Holloway and LSHTM discovery feeds with their relevant categories only.
   - Add the Brighton, Greenwich and Leeds feeds, and test the Oxford and Surrey ones.
   - Add the health check.
2. **Employer job-board adapter.**
   - Add `type: greenhouse | smartrecruiters | lever | ashby` sources to `config/sources.json` and handle them in `update_radar.py` (standard library only).
   - Add the sponsor join (`sponsor: yes/likely/no`).
3. **Job APIs with a key.**
   - Ejak registers free Adzuna and Reed keys and adds them as repository secrets (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY`).
   - Add the adapter, plus the Adzuna label in the app.
4. **Email-alert intake.**
   - Ejak creates the alerts and a Gmail filter that applies the label "Cornelieur/alerts".
   - Then choose between two ways of reading them: the scout reads the label weekly, or an Apps Script turns it into JSON daily.

Still to check: the exact jobs.ac.uk feed hrefs (if they still exist), Imperial's RSS link, QUB's feed URLs, and which applicant tracking system Quotient Sciences, Sterling, LGC and Catalent use.
