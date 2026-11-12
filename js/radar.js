import { S, save, esc, $, $$, toast, fmtDate, daysLeft, uid, getJSON, modal, copyText, addXP, today } from './util.js';

/* ---------------- data loading & scoring ---------------- */
let cache = null;
async function loadOpps() {
  if (cache) return cache;
  const [robot, agent] = await Promise.all([
    getJSON('data/opportunities.json', { items: [], sources: [], updated: null }),
    getJSON('data/agent-radar.json', { items: [], updated: null }),
  ]);
  const items = [];
  const seenIds = new Set();
  for (const it of [...(agent.items || []).map(x => ({ ...x, curated: true })), ...(robot.items || []), ...S().customOpps]) {
    const id = it.id || hash(it.link || it.title);
    if (seenIds.has(id)) continue; seenIds.add(id);
    items.push({ ...it, id });
  }
  items.forEach(scoreItem);
  items.sort((a, b) => b.score - a.score);
  cache = { items, robot, agent };
  return cache;
}
function hash(s = '') { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return 'h' + (h >>> 0).toString(36); }

const INTL_POS = /(international (students|applicants|candidates)|all nationalities|overseas (students|applicants)|open to (all|international)|regardless of nationality|international fee|visa sponsorship|sponsorship (is )?available|skilled worker visa|certificate of sponsorship|students worldwide)/i;
const INTL_NEG = /(uk (students|applicants|nationals) only|home (fee|students) only|home fee status (only|candidates)|uk\/home (students|fee)|only (available|open) to (uk|home)|uk or eu candidates|uk residents only|right to work in the uk is required|no visa sponsorship|unable to (offer|provide) (visa )?sponsorship|cannot sponsor|does not (offer|provide) sponsorship)/i;

function scoreItem(o) {
  const p = S().profile;
  const title = (o.title || '').toLowerCase();
  const body = ((o.summary || '') + ' ' + (o.org || '')).toLowerCase();
  let score = 0; const tags = []; const hits = [];
  for (const k of p.keywords) {
    const kk = k.toLowerCase(); if (!kk) continue;
    if (title.includes(kk)) { score += 14; hits.push(k); }
    else if (body.includes(kk)) { score += 5; hits.push(k); }
  }
  for (const a of p.avoid) if (a && (title + body).includes(a.toLowerCase())) score -= 25;
  const all = (o.title || '') + ' ' + (o.summary || '');
  if (o.intl === true || INTL_POS.test(all)) { score += 18; tags.push({ label: '🌍 International OK', cls: 'good' }); }
  if (o.intl === false || INTL_NEG.test(all)) { score -= 30; tags.push({ label: 'UK/Home only?', cls: 'bad' }); }
  if (/london/i.test((o.location || '') + all)) { score += 6; tags.push({ label: '📍 London' }); }
  if (/fully[- ]funded|stipend|studentship/i.test(all)) { score += 6; if (o.type === 'phd') tags.push({ label: 'Funded', cls: 'water' }); }
  const dl = daysLeft(o.deadline);
  if (dl != null) {
    if (dl < 0) { score -= 40; tags.push({ label: 'Closed', cls: 'bad' }); }
    else if (dl <= 14) { score += 4; tags.push({ label: `⏳ ${dl}d left`, cls: 'warn' }); }
    else tags.push({ label: `Closes ${fmtDate(o.deadline)}` });
  }
  if (o.curated) { score += 10; tags.unshift({ label: '✦ AI-curated', cls: 'water' }); }
  if (o.published) { const age = -daysLeft(o.published); if (age != null && age <= 7) { score += 5; tags.push({ label: 'New this week' }); } }
  tags.unshift({ label: o.type === 'phd' ? '🎓 PhD' : o.type === 'job' ? '💼 Job' : '✦ ' + (o.type || 'Opportunity') });
  o.score = Math.max(0, Math.min(99, Math.round(score + 20)));
  o.tags = tags; o.hits = [...new Set(hits)].slice(0, 6);
  return o;
}

export async function topOpportunities(n = 3) {
  const { items } = await loadOpps();
  return items.filter(o => !S().seen[o.id] && (daysLeft(o.deadline) ?? 1) >= 0).slice(0, n);
}

export function nextTrackerSteps(n = 3) {
  const out = [];
  for (const t of S().tracker) {
    if (t.stage === 'Outcome') continue;
    const st = t.steps.find(x => !x.done);
    if (st) out.push({ title: t.title, step: st.t, deadline: t.deadline, days: daysLeft(t.deadline) });
  }
  out.sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
  return out.slice(0, n);
}

/* ---------------- page shell ---------------- */
const TABS = [['', 'Feed'], ['digest', '5-min digest'], ['search', 'One-tap searches'], ['sponsors', 'Sponsor checker'], ['routes', 'Routes & steps'], ['tracker', 'My tracker']];

export function renderRadar(el, sub) {
  const tab = sub[0] || '';
  el.innerHTML = `
    <div class="eyebrow">Opportunity radar</div>
    <h1>PhD funding &amp; sponsored jobs</h1>
    <p class="lede">A robot checks public feeds every morning and the Home Office sponsor register every week. Cornelieur scores what it finds against your profile, so you only look at the few that matter.</p>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/radar${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="radarBody"></div>`;
  const body = $('#radarBody', el);
  (({ '': feed, digest, search, sponsors, routes, tracker })[tab] || feed)(body, sub.slice(1));
}

/* ---------------- Feed ---------------- */
async function feed(el) {
  el.innerHTML = '<p class="muted">Loading compiled opportunities…</p>';
  const { items, robot, agent } = await loadOpps();
  let filter = { type: 'all', intl: false, q: '', hideSeen: true };
  const draw = () => {
    const list = items.filter(o =>
      (filter.type === 'all' || o.type === filter.type) &&
      (!filter.intl || o.tags.some(t => t.cls === 'good')) &&
      (!filter.hideSeen || S().seen[o.id] !== 'skip') &&
      (!filter.q || (o.title + ' ' + (o.summary || '') + ' ' + (o.org || '')).toLowerCase().includes(filter.q.toLowerCase())));
    $('#feedList', el).innerHTML = list.length ? list.slice(0, 80).map(oppRow).join('') :
      `<div class="empty">${items.length ? 'Nothing matches these filters.' : 'No compiled opportunities yet — the GitHub robot fills this list after its first run. Until then, try <a href="#/radar/search">one-tap searches</a>.'}</div>`;
    bindOppActions(el, draw);
  };
  const srcInfo = (robot.sources || []).map(s => `${esc(s.name)} (${s.count})`).join(' · ');
  el.innerHTML = `
    <div class="row between" style="margin-bottom:10px">
      <div class="row">
        ${['all', 'phd', 'job'].map(t => `<button class="chip ${t === 'all' ? 'on' : ''}" data-type="${t}">${{ all: 'Everything', phd: '🎓 PhDs', job: '💼 Jobs' }[t]}</button>`).join('')}
        <button class="chip" id="fIntl">🌍 International-friendly only</button>
        <button class="chip on" id="fSeen">Hide skipped</button>
      </div>
      <button class="btn sm ghost" id="addOpp">+ Add one I found</button>
    </div>
    <div class="searchbar" style="margin-bottom:6px"><input type="search" id="fq" placeholder="Filter by word, e.g. formulation, KCL, Imperial…"></div>
    <p class="muted" style="font-size:12.5px">${robot.updated ? `Robot last ran ${fmtDate(robot.updated)}${srcInfo ? ' · ' + srcInfo : ''}` : 'Robot has not run yet.'}${agent.updated ? ` · AI scout ran ${fmtDate(agent.updated)}` : ''} · ${items.length} items</p>
    <div class="card"><div id="feedList"></div></div>`;
  $$('[data-type]', el).forEach(b => b.onclick = () => { $$('[data-type]', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); filter.type = b.dataset.type; draw(); });
  $('#fIntl', el).onclick = e => { filter.intl = !filter.intl; e.target.classList.toggle('on', filter.intl); draw(); };
  $('#fSeen', el).onclick = e => { filter.hideSeen = !filter.hideSeen; e.target.classList.toggle('on', filter.hideSeen); draw(); };
  $('#fq', el).oninput = e => { filter.q = e.target.value; draw(); };
  $('#addOpp', el).onclick = () => addOppModal(() => { cache = null; feed(el); });
  draw();
}

function oppRow(o) {
  const st = S().seen[o.id];
  return `<div class="opp" data-id="${esc(o.id)}">
    <div><h3><a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.title)}</a></h3>
      <div class="meta">${esc(o.org || '')}${o.org && o.source ? ' · ' : ''}${esc(o.source || '')}${o.salary ? ' · ' + esc(o.salary) : ''}</div>
      <div class="why row" style="gap:5px;margin-top:6px">${o.tags.map(t => `<span class="chip ${t.cls || ''}">${esc(t.label)}</span>`).join('')}</div>
      ${o.why ? `<div class="why"><b>Why:</b> ${esc(o.why)}</div>` : o.hits?.length ? `<div class="why muted">Matches: ${o.hits.map(esc).join(', ')}</div>` : ''}
    </div>
    <div class="acts"><span class="score" title="Match score out of 99">${o.score}</span>
      <button class="btn sm" data-act="track">${S().tracker.some(t => t.oppId === o.id) ? '✓ Tracking' : 'Track + plan'}</button>
      <button class="btn sm ghost" data-act="skip">${st === 'skip' ? 'Skipped' : 'Not for me'}</button>
    </div></div>`;
}
function bindOppActions(el, redraw) {
  $$('.opp [data-act]', el).forEach(b => b.onclick = async () => {
    const id = b.closest('.opp').dataset.id;
    const { items } = await loadOpps();
    const o = items.find(x => x.id === id);
    if (b.dataset.act === 'skip') { S().seen[id] = 'skip'; save(); toast('Hidden from your feed'); }
    if (b.dataset.act === 'track') { trackOpp(o); }
    redraw();
  });
}

/* ---------------- Digest (low-load triage) ---------------- */
async function digest(el) {
  const { items } = await loadOpps();
  const queue = items.filter(o => !S().seen[o.id] && (daysLeft(o.deadline) ?? 1) >= 0).slice(0, 5);
  let i = 0;
  const show = () => {
    if (i >= queue.length) {
      el.innerHTML = `<div class="card celebrate"><div class="big">🌿</div><h2>Digest done</h2><p class="muted">${queue.length ? `You triaged ${queue.length} opportunities. That's the job-hunting for today — well done.` : 'Nothing new to triage. Check back tomorrow, or run a one-tap search.'}</p><div class="row" style="justify-content:center"><a class="btn" href="#/radar/tracker">See tracker</a><a class="btn ghost" href="#/home">Back to Today</a></div></div>`;
      if (queue.length) addXP(5);
      return;
    }
    const o = queue[i];
    el.innerHTML = `<div class="digest-card">
      <div class="row between"><span class="muted">${i + 1} of ${queue.length}</span><span class="score">${o.score}</span></div>
      <div class="progress" style="margin:8px 0 16px"><i style="width:${(i / queue.length) * 100}%"></i></div>
      <div class="card">
        <div class="row" style="gap:5px">${o.tags.map(t => `<span class="chip ${t.cls || ''}">${esc(t.label)}</span>`).join('')}</div>
        <div class="big-title">${esc(o.title)}</div>
        <div class="muted">${esc(o.org || o.source || '')}</div>
        ${o.why ? `<p><b>Why it fits:</b> ${esc(o.why)}</p>` : ''}
        <p style="font-size:14.5px">${esc(shorten(o.summary || '', 420))}</p>
        <a href="${esc(o.link)}" target="_blank" rel="noopener">Open the advert ↗</a>
      </div>
      <div class="triage">
        <button class="btn ghost" data-t="skip">👎 Not for me</button>
        <button class="btn soft" data-t="later">🕓 Later</button>
        <button class="btn" data-t="saved">⭐ Track it</button>
      </div>
      <p class="muted" style="text-align:center;font-size:12.5px;margin-top:10px">Keys: <span class="kbd">←</span> skip · <span class="kbd">↓</span> later · <span class="kbd">→</span> track</p>
    </div>`;
    $$('[data-t]', el).forEach(b => b.onclick = () => decide(b.dataset.t));
  };
  const decide = t => {
    const o = queue[i]; S().seen[o.id] = t; save();
    if (t === 'saved') trackOpp(o, true);
    i++; show();
  };
  const onKey = e => {
    if (!document.body.contains(el)) return document.removeEventListener('keydown', onKey);
    if (i >= queue.length) return;
    if (e.key === 'ArrowLeft') decide('skip'); else if (e.key === 'ArrowRight') decide('saved'); else if (e.key === 'ArrowDown') decide('later');
  };
  document.addEventListener('keydown', onKey);
  show();
}
const shorten = (s, n) => s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;

/* ---------------- One-tap searches ---------------- */
const SITES = [
  { name: 'LinkedIn Jobs', note: 'Uses your own LinkedIn login. Past week, London.', kind: 'job', url: (q, l) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=${enc(l + ', England, United Kingdom')}&f_TPR=r604800` },
  { name: 'LinkedIn — "visa sponsorship" in post', note: 'Same, but only posts that mention sponsorship.', kind: 'job', url: (q, l) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q + ' "visa sponsorship"')}&location=${enc(l + ', England, United Kingdom')}` },
  { name: 'Indeed UK', note: 'Last 7 days.', kind: 'job', url: (q, l) => `https://uk.indeed.com/jobs?q=${enc(q)}&l=${enc(l)}&fromage=7` },
  { name: 'NHS Jobs', note: 'NHS trusts are licensed sponsors; check each advert.', kind: 'job', url: (q, l) => `https://www.jobs.nhs.uk/candidate/search/results?keyword=${enc(q)}&location=${enc(l)}` },
  { name: 'Civil Service Jobs (MHRA etc.)', note: 'Regulators like MHRA advertise here.', kind: 'job', url: q => `https://www.civilservicejobs.service.gov.uk/csr/index.cgi?SID=&pageaction=searchbyquery&what=${enc(q)}` },
  { name: 'jobs.ac.uk — jobs', note: 'Research assistant / technician roles at universities.', kind: 'job', url: q => `https://www.jobs.ac.uk/search/?keywords=${enc(q)}` },
  { name: 'Nature Careers', note: 'Industry + academic science jobs.', kind: 'job', url: (q, l) => `https://www.nature.com/naturecareers/jobs/search?keywords=${enc(q)}&location=${enc(l)}` },
  { name: 'New Scientist Jobs', note: 'Life-science industry roles.', kind: 'job', url: q => `https://www.newscientist.com/nsj/jobs/search/?keywords=${enc(q)}` },
  { name: 'KTP vacancies (Innovate UK)', note: 'Knowledge Transfer Partnerships: salaried, company + university.', kind: 'job', url: () => `https://www.ktp-uk.org/vacancies/` },
  { name: 'FindAPhD', note: 'Filter "International" funding on the results page.', kind: 'phd', url: q => `https://www.findaphd.com/phds/?Keywords=${enc(q)}` },
  { name: 'jobs.ac.uk — PhDs', note: 'Studentships; use the "eligibility: international" filter.', kind: 'phd', url: q => `https://www.jobs.ac.uk/search/phds?keywords=${enc(q)}` },
  { name: 'EURAXESS', note: 'Funded PhD positions across Europe (often salaried).', kind: 'phd', url: q => `https://euraxess.ec.europa.eu/jobs/search?keywords=${enc(q)}` },
  { name: 'Google Scholar — possible supervisors', note: 'Find who publishes on your topic in UK schools.', kind: 'phd', url: q => `https://scholar.google.com/scholar?q=${enc(q)}&as_ylo=${new Date().getFullYear() - 3}` },
];
const enc = encodeURIComponent;
const PRESETS = ['pharmaceutical scientist', 'formulation scientist', 'quality control analyst', 'regulatory affairs', 'pharmacovigilance', 'clinical trial assistant', 'research technician', 'bioprocess', 'drug delivery PhD', 'pharmaceutics PhD'];

function search(el) {
  let q = PRESETS[0]; let loc = S().profile.location || 'London';
  const draw = () => {
    $('#links', el).innerHTML = ['job', 'phd'].map(kind => `
      <h3 style="margin:18px 0 8px">${kind === 'job' ? '💼 Jobs' : '🎓 PhDs & funding'}</h3>
      <div class="linkgrid">${SITES.filter(s => s.kind === kind).map(s => `<a class="linkcard" href="${esc(s.url(q, loc))}" target="_blank" rel="noopener"><b>${esc(s.name)} ↗</b><small class="muted">${esc(s.note)}</small></a>`).join('')}</div>`).join('');
  };
  el.innerHTML = `
    <div class="card">
      <p style="margin-top:0">Pick or type what you're looking for. Every tile opens that site's search, already filled in — if a site needs you signed in (LinkedIn, Indeed), it will use your own account in that tab. No passwords pass through Cornelieur.</p>
      <div class="row" id="presets">${PRESETS.map((p, i) => `<button class="chip ${i === 0 ? 'on' : ''}">${esc(p)}</button>`).join('')}</div>
      <div class="grid g2" style="margin-top:10px">
        <div><label class="f">Search words</label><input type="text" id="sq" value="${esc(q)}"></div>
        <div><label class="f">Location</label><input type="text" id="sl" value="${esc(loc)}"></div>
      </div>
      <div id="links"></div>
    </div>
    <div class="spacer"></div>
    <div class="card dew"><h3>Set alerts once, then let them come to you</h3>
      <ol class="steps">
        <li>On LinkedIn, run the search above → toggle <b>Set alert</b> (daily). Turn on <b>Open to work</b> (recruiters only) and add "visa sponsorship required" in your preferences.</li>
        <li>Make a free jobs.ac.uk account → save a PhD search with "Pharmacology, Toxicology &amp; Pharmacy" + "international" eligibility as an email alert.</li>
        <li>FindAPhD → search → <b>Email me PhDs like these</b>.</li>
        <li>NHS Jobs → create an account → save the search.</li>
        <li>Make a Gmail filter that labels these alerts "Radar" so they don't flood your inbox — then open them only during your digest time.</li>
      </ol></div>`;
  $$('#presets .chip', el).forEach(b => b.onclick = () => { $$('#presets .chip', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); q = b.textContent; $('#sq', el).value = q; draw(); });
  $('#sq', el).oninput = e => { q = e.target.value; draw(); };
  $('#sl', el).oninput = e => { loc = e.target.value; draw(); };
  draw();
}

/* ---------------- Sponsor checker ---------------- */
let sponsorData = null;
const norm = s => s.toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|plc|llp|uk|u\.k\.|the|group|holdings|inc|co)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
async function sponsors(el) {
  el.innerHTML = `<div class="card"><p class="muted">Loading the Home Office register (a few MB, first time only)…</p></div>`;
  if (!sponsorData) sponsorData = await getJSON('data/sponsors.json', null);
  const d = sponsorData;
  if (!d || !d.rows?.length) {
    el.innerHTML = `<div class="card"><h3>The sponsor list hasn't been downloaded yet</h3><p>The GitHub robot downloads it on its first run (Actions → "Update radar" → Run workflow). Meanwhile you can search the official list directly:</p><a class="btn" target="_blank" rel="noopener" href="https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers">Open GOV.UK register ↗</a></div>`;
    return;
  }
  if (!d._norm) d._norm = d.rows.map(r => norm(r[0]));
  el.innerHTML = `
    <div class="grid g2">
      <div class="card">
        <h3>Can this employer sponsor a Skilled Worker visa?</h3>
        <p class="muted" style="font-size:13.5px">Type the company as it appears on the advert. Legal names differ from brand names, so try a short distinctive word (e.g. "Astra", "Moderna", "Imperial").</p>
        <div class="searchbar"><input type="search" id="spq" placeholder="Company or university name"></div>
        <div id="spRes" style="margin-top:10px"></div>
        <p class="muted" style="font-size:12px;margin-top:12px">Register dated ${esc(d.registerDate || fmtDate(d.updated))} · ${d.rows.length.toLocaleString()} Skilled Worker sponsors · source: GOV.UK. Being on the list means they <i>can</i> sponsor, not that every role will.</p>
      </div>
      <div class="card">
        <h3>Life-science sponsors near you</h3>
        <p class="muted" style="font-size:13.5px">Licensed sponsors whose names suggest pharma, biotech, diagnostics, labs, NHS or universities. A handy list of employers to research and follow on LinkedIn.</p>
        <input type="search" id="lsTown" placeholder="Town, e.g. London, Cambridge, Stevenage" value="London">
        <div id="lsRes" style="margin-top:10px;max-height:420px;overflow:auto"></div>
      </div>
    </div>`;
  const out = $('#spRes', el), ls = $('#lsRes', el);
  const ratingChip = r => /A rating|A \(/i.test(r) ? `<span class="chip good">${esc(r)}</span>` : `<span class="chip warn">${esc(r)}</span>`;
  $('#spq', el).oninput = e => {
    const q = norm(e.target.value);
    if (q.length < 3) { out.innerHTML = ''; return; }
    const words = q.split(' ');
    const res = [];
    for (let i = 0; i < d.rows.length && res.length < 40; i++) if (words.every(w => d._norm[i].includes(w))) res.push(d.rows[i]);
    out.innerHTML = res.length ? res.map(r => `<div class="result-row"><div><b>${esc(r[0])}</b><br><small class="muted">${esc(r[1] || '')}</small></div><div>${ratingChip(r[2] || '')}</div></div>`).join('')
      : `<div class="notice dew">No match. Try a shorter word — or the employer may not hold a licence (then a sponsored job there isn't possible unless they apply for one).</div>`;
  };
  const drawLs = () => {
    const t = $('#lsTown', el).value.toLowerCase().trim();
    const res = d.rows.filter(r => r[3] === 1 && (!t || (r[1] || '').toLowerCase().includes(t))).slice(0, 300);
    ls.innerHTML = res.length ? res.map(r => `<div class="result-row"><span>${esc(r[0])}</span><small class="muted">${esc(r[1] || '')}</small></div>`).join('') : '<p class="muted">None found for that town.</p>';
  };
  $('#lsTown', el).oninput = drawLs; drawLs();
}

/* ---------------- Routes (step-by-step playbooks) ---------------- */
export const ROUTES = [
  {
    id: 'funded-phd', icon: '🎓', title: 'Funded PhD studentship (project already advertised)',
    who: 'Best first bet. DTPs/CDTs and project studentships pay fees + a tax-free stipend; most UKRI schemes can give up to 30% of places to international students, and some universities top up the international fee difference.',
    when: 'Main UK cycle: adverts Oct–Jan for an October start; a second smaller wave Feb–May.',
    steps: [
      'Read the eligibility line first: does it say international / all nationalities, or "Home fee status only"? Skip Home-only.',
      'Read 2 recent papers by the lead supervisor (use the Read tab → paste their name).',
      'Email the supervisor a short enquiry (template in tracker) — ask if international candidates are competitive for this studentship.',
      'Tailor your CV to the project: put your MSc research project and lab techniques at the top.',
      'Draft the personal statement: why this project, what you bring (pharmacy + biotech), what you will learn.',
      'Ask 2 referees now (MSc supervisor + one more) — give them the deadline and the advert.',
      'Submit the university application + any separate funding form before the deadline.',
      'Prepare for interview: 5-minute talk on your MSc project + 3 questions for the panel.',
    ],
  },
  {
    id: 'scholarship-phd', icon: '🇮🇩', title: 'Self-proposed PhD + your own scholarship (e.g. LPDP)', indo: true,
    who: 'For Indonesian citizens, LPDP fully funds doctoral study at listed universities, and it opens in stages each year (in 2026: stage 1 in Jan–Feb, stage 2 in Jun–Jul). A supervisor\'s support and an offer letter make you much stronger.',
    when: 'Start 9–12 months before you want to begin. Check lpdp.kemenkeu.go.id for the current call and university list.',
    link: 'https://lpdp.kemenkeu.go.id/',
    steps: [
      'Check the current LPDP call: university list, field list, age limit, documents.',
      'Pick a research question that links your MSc to a need in Indonesia (LPDP values this).',
      'Find 3–5 possible UK supervisors on that topic (Read tab + Google Scholar tile).',
      'Email each one: 150 words, your question, your CV, one paper of theirs you liked.',
      'Write a 2–3 page research proposal with the supervisor who replies warmly.',
      'Get the English test the call accepts (IELTS/TOEFL/Duolingo, per that year\'s rules).',
      'Apply to the university for admission → aim for a (conditional) offer letter.',
      'Submit the LPDP application in the next stage; prepare essays and the interview.',
    ],
  },
  {
    id: 'sponsored-job', icon: '💼', title: 'Industry job with Skilled Worker sponsorship',
    who: 'Roles that fit a pharmacy + MSc biotech profile without UK pharmacist registration: QC/QA analyst, formulation or analytical scientist, regulatory affairs, pharmacovigilance, medical information, clinical trial assistant, research technician.',
    when: 'Year-round. Graduate schemes open Sep–Dec.',
    link: 'https://www.gov.uk/skilled-worker-visa',
    steps: [
      'Check the employer in the Sponsor checker tab. Not listed → move on.',
      'Check the role\'s salary and occupation code would meet current Skilled Worker rules (gov.uk "Skilled Worker visa" eligibility checker).',
      'Match your CV to the advert\'s top 5 requirements, using its exact words.',
      'Write a 3-paragraph cover letter: why them, proof you can do it, sponsorship stated plainly and confidently.',
      'Find one person on LinkedIn in that team; send a short, friendly note after applying.',
      'Log the application here and set a follow-up for 10 days later.',
    ],
  },
  {
    id: 'ra-bridge', icon: '🔬', title: 'Research assistant / technician → PhD bridge',
    who: 'Universities and institutes (Crick, KCL, UCL, Imperial, QMUL) are licensed sponsors. A paid RA/technician post builds UK lab experience and supervisor relationships — a common path into a funded PhD.',
    when: 'Year-round on jobs.ac.uk and university job sites.',
    steps: [
      'Search "research assistant" + "research technician" on jobs.ac.uk (one-tap searches).',
      'Prioritise labs whose papers you can read and discuss.',
      'Use the advert\'s person specification as headings in your supporting statement.',
      'Mention R/Python progress from Cornelieur — even beginner skills help.',
      'If shortlisted, ask in the interview whether the lab supports staff into PhDs.',
    ],
  },
  {
    id: 'ktp', icon: '🤝', title: 'KTP Associate (Knowledge Transfer Partnership)',
    who: 'A salaried 1–3 year project between a company and a university, run through Innovate UK. Many host universities sponsor visas, and some KTPs allow a part-time research degree alongside.',
    when: 'Rolling adverts on ktp-uk.org and jobs.ac.uk.',
    link: 'https://www.ktp-uk.org/vacancies/',
    steps: [
      'Browse KTP vacancies weekly for pharma, biotech, food science, diagnostics.',
      'Check whether the advert mentions visa sponsorship; if unclear, ask the contact.',
      'Show you can manage a project: frame your MSc project as a mini-KTP.',
      'Apply through the university portal listed on the advert.',
    ],
  },
];

function routes(el) {
  const indo = S().profile.indonesian;
  el.innerHTML = `<p class="muted">Each route is a playbook. When you track an opportunity, Cornelieur copies its route's steps into a checklist so you only ever see the next small step.</p>
  <div class="grid g2">${ROUTES.filter(r => !r.indo || indo).map(r => `
    <div class="card"><h3>${r.icon} ${esc(r.title)}</h3>
    <p style="font-size:14px">${esc(r.who)}</p>
    <p class="muted" style="font-size:13px"><b>When:</b> ${esc(r.when)}</p>
    <details><summary>See the ${r.steps.length} steps</summary><ol class="steps" style="margin-top:8px">${r.steps.map(s => `<li style="font-size:14px">${esc(s)}</li>`).join('')}</ol></details>
    ${r.link ? `<p style="margin-top:10px"><a href="${r.link}" target="_blank" rel="noopener">Official info ↗</a></p>` : ''}
    </div>`).join('')}</div>
    <div class="spacer"></div>
    <div class="card water"><h3>A realistic weekly rhythm (about 3 hours)</h3>
    <ul><li><b>Mon</b> — 5-minute digest, track 1–2 things.</li><li><b>Tue/Thu</b> — one application step (an email, a CV tweak).</li><li><b>Wed</b> — read one paper by a possible supervisor.</li><li><b>Sat</b> — 20 minutes of R/Python lessons.</li><li><b>Sun</b> — rest. Seriously.</li></ul></div>`;
}

function routeFor(o) {
  if (o.route) return o.route;
  if (o.type === 'phd') return 'funded-phd';
  if (/research (assistant|technician)|technician/i.test(o.title)) return 'ra-bridge';
  if (/\bktp\b|knowledge transfer/i.test(o.title)) return 'ktp';
  return 'sponsored-job';
}
export function trackOpp(o, quiet) {
  if (S().tracker.some(t => t.oppId === o.id)) { if (!quiet) toast('Already in your tracker'); return; }
  const r = ROUTES.find(x => x.id === routeFor(o)) || ROUTES[2];
  const steps = (o.steps && o.steps.length ? o.steps : r.steps).map(t => ({ t, done: false }));
  S().tracker.unshift({ id: uid(), oppId: o.id, title: o.title, org: o.org || '', link: o.link, type: o.type, route: r.id, deadline: o.deadline || '', stage: 'Saved', notes: '', steps, added: today() });
  S().seen[o.id] = 'saved'; save();
  if (!quiet) toast('Added to tracker with a step-by-step plan');
}

/* ---------------- Tracker ---------------- */
const STAGES = ['Saved', 'Preparing', 'Applied', 'Interview', 'Outcome'];
function tracker(el) {
  const t = S().tracker;
  el.innerHTML = `<div class="row between" style="margin-bottom:12px"><p class="muted" style="margin:0">Tap a card to see its plan, notes and email templates.</p><button class="btn sm ghost" id="addT">+ Add manually</button></div>
  <div class="board">${STAGES.map(st => `<div class="col"><h4>${st} <span class="pill-n">${t.filter(x => x.stage === st).length}</span></h4>
    ${t.filter(x => x.stage === st).map(x => {
      const done = x.steps.filter(s => s.done).length; const dl = daysLeft(x.deadline);
      return `<div class="tcard" data-id="${x.id}"><b>${esc(x.title)}</b><small class="muted">${esc(x.org)}</small>
      <div class="progress" style="margin:7px 0 4px;height:5px"><i style="width:${x.steps.length ? done / x.steps.length * 100 : 0}%"></i></div>
      <small class="muted">${done}/${x.steps.length} steps${dl != null ? ` · ${dl < 0 ? 'deadline passed' : dl + ' days left'}` : ''}</small></div>`;
    }).join('') || '<small class="muted" style="padding:4px">—</small>'}</div>`).join('')}</div>`;
  $$('.tcard', el).forEach(c => c.onclick = () => openTracked(c.dataset.id, () => tracker(el)));
  $('#addT', el).onclick = () => addOppModal(() => tracker(el), true);
}

function openTracked(id, onChange) {
  const x = S().tracker.find(t => t.id === id); if (!x) return;
  const r = ROUTES.find(r => r.id === x.route);
  modal(`
    <div class="row between"><div class="eyebrow">${esc(r?.title || 'Plan')}</div><button class="btn sm ghost" data-close>Close</button></div>
    <h2>${esc(x.title)}</h2><p class="muted">${esc(x.org)} ${x.link ? `· <a href="${esc(x.link)}" target="_blank" rel="noopener">advert ↗</a>` : ''}</p>
    <div class="grid g2">
      <div><label class="f">Stage</label><select id="tStage">${STAGES.map(s => `<option ${s === x.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div><label class="f">Deadline</label><input type="date" id="tDl" value="${esc(x.deadline || '')}"></div>
    </div>
    <h3 style="margin-top:16px">Steps</h3>
    <div id="tSteps">${x.steps.map((s, i) => `<label class="check ${s.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${s.done ? 'checked' : ''}><span>${esc(s.t)}</span></label>`).join('')}</div>
    <label class="f">Notes</label><textarea id="tNotes" rows="3" placeholder="Supervisor name, who you emailed, interview date…">${esc(x.notes)}</textarea>
    <h3 style="margin-top:16px">Templates</h3>
    <div class="row"><button class="btn sm soft" data-tpl="supervisor">Supervisor enquiry email</button><button class="btn sm soft" data-tpl="followup">Polite follow-up</button><button class="btn sm soft" data-tpl="cover">Cover-letter skeleton</button><button class="btn sm soft" data-tpl="ai">Ask an AI to tailor my CV</button></div>
    <div class="row between" style="margin-top:20px"><button class="btn ghost" id="tDel" style="color:var(--bad);border-color:var(--bad)">Remove</button><button class="btn" data-close>Done</button></div>
  `, (m, close) => {
    $$('#tSteps input', m).forEach(cb => cb.onchange = () => {
      const s = x.steps[cb.dataset.i]; s.done = cb.checked; cb.parentElement.classList.toggle('done', cb.checked);
      if (cb.checked) { addXP(3); toast('+3 XP — one step closer'); }
      if (x.stage === 'Saved' && cb.checked) { x.stage = 'Preparing'; $('#tStage', m).value = 'Preparing'; }
      save(); onChange();
    });
    $('#tStage', m).onchange = e => { x.stage = e.target.value; save(); onChange(); };
    $('#tDl', m).onchange = e => { x.deadline = e.target.value; save(); onChange(); };
    $('#tNotes', m).oninput = e => { x.notes = e.target.value; save(); };
    $('#tDel', m).onclick = () => { if (confirm('Remove from tracker?')) { S().tracker = S().tracker.filter(t => t.id !== x.id); save(); close(); onChange(); } };
    $$('[data-tpl]', m).forEach(b => b.onclick = () => copyText(template(b.dataset.tpl, x)));
  });
}

function template(kind, x) {
  const name = S().profile.name === 'Ocha' ? 'Cornelia (Ocha) Rowa' : S().profile.name;
  if (kind === 'supervisor') return `Subject: Prospective PhD applicant — ${x.title}

Dear Dr [Surname],

I'm a pharmacy graduate with an MSc in [Biotechnology and Pharmaceutical Sciences] from [university], and I'm very interested in "${x.title}".

In my MSc I worked on [one line about your project and methods], and your paper "[title]" (${new Date().getFullYear() - 1}) made me think about [one genuine question or link to your work].

I'm an international applicant — would you consider me competitive for this studentship, or is there another funding route you'd suggest? I've attached my CV, and I'd be glad to have a short call at your convenience.

Kind regards,
${name}
[LinkedIn URL] · [phone]`;
  if (kind === 'followup') return `Subject: Re: ${x.title}

Dear Dr [Surname],

I hope you're well. I wanted to follow up on my email of [date] about ${x.title}. I'm still very keen, and happy to send anything else that would help — a short proposal, or a writing sample.

Thank you for your time,
${name}`;
  if (kind === 'cover') return `Dear Hiring Manager,

Paragraph 1 — Why this role at ${x.org || '[company]'}: name one specific thing about their products/pipeline and connect it to your background in pharmacy and pharmaceutical biotechnology.

Paragraph 2 — Proof: pick the advert's top 3 requirements. For each, one sentence of evidence (technique, result, number). E.g. "During my MSc I developed and validated an HPLC method for…"

Paragraph 3 — Practicalities, stated confidently: "I'm based in London and available immediately. I will require Skilled Worker sponsorship, and I note ${x.org || '[company]'} is a licensed sponsor."

Kind regards,
${name}`;
  return `I'm applying for this role/studentship: "${x.title}" at ${x.org || '[organisation]'}.
Advert: ${x.link || '[paste the advert text here]'}

Here is my CV:
[paste your CV]

Please (1) list the 5 most important requirements in the advert, (2) show which lines of my CV prove each one and where I have gaps, (3) rewrite my CV summary and top 6 bullet points to match the advert's language without inventing anything, and (4) suggest one question I could ask at interview.`;
}

function addOppModal(onDone, toTracker) {
  modal(`<div class="row between"><h2 style="margin:0">Add an opportunity</h2><button class="btn sm ghost" data-close>Close</button></div>
  <label class="f">Title</label><input type="text" id="aT" placeholder="e.g. PhD in nanoparticle drug delivery">
  <label class="f">Organisation</label><input type="text" id="aO">
  <label class="f">Link</label><input type="url" id="aL" placeholder="https://">
  <div class="grid g2"><div><label class="f">Type</label><select id="aY"><option value="phd">PhD / studentship</option><option value="job">Job</option></select></div>
  <div><label class="f">Deadline</label><input type="date" id="aD"></div></div>
  <label class="f">Notes / pasted description (optional — used for scoring)</label><textarea id="aS" rows="3"></textarea>
  <div class="spacer"></div><button class="btn" id="aGo">Add</button>`, (m, close) => {
    $('#aGo', m).onclick = () => {
      const o = { id: uid(), title: $('#aT', m).value.trim(), org: $('#aO', m).value.trim(), link: $('#aL', m).value.trim(), type: $('#aY', m).value, deadline: $('#aD', m).value, summary: $('#aS', m).value, source: 'Added by you' };
      if (!o.title) return toast('Give it a title');
      S().customOpps.push(o); save(); cache = null;
      if (toTracker) trackOpp(scoreItem(o));
      close(); onDone(); toast('Added');
    };
  });
}
