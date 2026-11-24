import { S, save, esc, $, $$, toast, fmtDate, daysLeft, uid, getJSON, modal, copyText, addXP, today } from './util.js';
import { analyse, toMarkdown, VERDICT, explainPriority } from './analyze.js';
import { connected, fetchPage, putText, del, list as driveList, getJSONFile, putJSONFile, safeName, DIR } from './drive.js';
import { openReader } from './reader.js';

/* ---------------- data loading & scoring ---------------- */
let cache = null;
async function loadOpps() {
  if (cache) return cache;
  const [robot, agent, people] = await Promise.all([
    getJSON('data/opportunities.json', { items: [], sources: [], updated: null }),
    getJSON('data/agent-radar.json', { items: [], updated: null }),
    getJSON('data/people.json', { items: {}, universities: {} }),
  ]);
  const items = [];
  const seenIds = new Set();
  for (const it of [...(agent.items || []).map(x => ({ ...x, curated: true })), ...(robot.items || []), ...S().customOpps]) {
    const id = it.id || hash(it.link || it.title);
    if (seenIds.has(id)) continue; seenIds.add(id);
    items.push({ ...it, id });
  }
  const enrich = agent.enrich || {};
  for (const it of items) { const r = enrich[it.id] || enrich[it.link]; if (r && !it.research) it.research = r; const au = (people.items || {})[it.id]; if (au && (au.people || []).length) it.auto = au; }
  items.forEach(scoreItem);
  items.forEach(applyAnalysis);
  items.sort((a, b) => b.priority - a.priority);
  pruneFlags(items);
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
  return items.filter(o => !S().seen[o.id] && !isFlagged(o) && o.an.verdict !== 'skip' && (daysLeft(o.an.deadline || o.deadline) ?? 1) >= 0).slice(0, n);
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
    <p class="lede">A robot checks public feeds every morning and the Home Office sponsor register every week. Cornelieur reads each advert, pulls out the deadline and requirements, flags anything that rules you out, and ranks what is left. Tap a card for the breakdown.</p>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/radar${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="radarBody"></div>`;
  const body = $('#radarBody', el);
  if (tab === 'item') return detail(body, sub[1]);
  (({ '': feed, digest, search, sponsors, routes, tracker })[tab] || feed)(body, sub.slice(1));
}

/* ---------------- Reading the adverts (analysis + cache) ---------------- */
const AK = 'cornelieur.analysis';
let AN = (() => { try { return JSON.parse(localStorage.getItem(AK) || '{}'); } catch (_) { return {}; } })();
const saveAN = () => { try { localStorage.setItem(AK, JSON.stringify(AN)); } catch (_) {} };
const INDEX_PATH = DIR.cache + '/_index.json';
const tried = new Set();            // adverts we already tried to read this session (so a failure does not loop)
let indexSynced = false, pushTimer = null;

function applyAnalysis(o) {
  let a = AN[o.id];
  if (a && o.curated && o.intl === true && a.blockers.some(b => b.id === 'home-only')) { delete AN[o.id]; a = null; } // stale read from before scout-verified eligibility
  o.an = a && a.source === 'page' ? { ...a, hits: a.hits } : analyse(o, { profile: S().profile });
  if (o.an.source !== 'page') o.an.source = 'feed';
  o.priority = o.an.priority;
  return o;
}
export const isFlagged = o => !!(S().flags[o.id] || S().seen[o.id] === 'skip');
function pruneFlags(items) {
  if (!items.length) return;                       // feed failed to load: never prune on an empty list
  const ids = new Set(items.map(o => o.id)); let changed = false;
  for (const id of Object.keys(S().flags)) if (!ids.has(id)) { delete S().flags[id]; changed = true; }
  for (const id of Object.keys(S().seen)) if (!ids.has(id) && !S().tracker.some(t => t.oppId === id)) { delete S().seen[id]; changed = true; }
  if (changed) save();
}
function schedulePush() {
  if (!connected()) return; clearTimeout(pushTimer);
  pushTimer = setTimeout(() => putJSONFile(INDEX_PATH, { updated: Date.now(), byId: AN }).catch(() => {}), 4000);
}
async function syncIndexFromDrive() {
  if (indexSynced || !connected()) return; indexSynced = true;
  try {
    const j = await getJSONFile(INDEX_PATH, null);
    if (j && j.byId) { for (const [id, a] of Object.entries(j.byId)) if (!AN[id] || (a.analysedAt || '') > (AN[id].analysedAt || '')) AN[id] = a; saveAN(); }
  } catch (_) {}
}
/** Delete cached analyses (and their .md files in Drive) for adverts that left the feed or are past their date. Once a day. */
async function pruneCache(items) {
  if (!connected() || !items.length) return;
  const k = 'cornelieur.prune'; if (localStorage.getItem(k) === today()) return; localStorage.setItem(k, today());
  const ids = new Set(items.map(o => o.id)); const tracked = new Set(S().tracker.map(t => t.oppId));
  const dead = id => !ids.has(id) || (AN[id] && AN[id].expires < today() && !tracked.has(id));
  let removed = 0;
  try {
    const files = await driveList(DIR.cache);
    for (const f of files) { const m = /^(.+)\.md$/.exec(f.name); if (m && dead(m[1])) { await del(f.path); removed++; } }
  } catch (_) {}
  for (const id of Object.keys(AN)) if (dead(id)) { delete AN[id]; removed++; }
  saveAN(); if (removed) { schedulePush(); }
}
async function deepRead(o) {
  const r = await fetchPage(o.link);
  if (r.status >= 400 || !r.text || r.text.length < 400) throw new Error(`The advert page could not be read (status ${r.status || '?'}).`);
  const a = analyse(o, { html: r.text, profile: S().profile });
  if (a.source !== 'page') throw new Error('The page had too little text to analyse (it may need JavaScript).');
  AN[o.id] = a; saveAN(); o.an = a; o.priority = a.priority;
  putText(`${DIR.cache}/${o.id}.md`, toMarkdown(a) + researchMd(o), 'text/markdown').catch(() => {});
  schedulePush();
  return a;
}
let queueRunning = false;
async function readTopAdverts(items, onProgress, limit = 12) {
  if (!connected() || queueRunning) return 0;
  const todo = items.filter(o => o.an.source !== 'page' && !isFlagged(o) && /^https?:/.test(o.link || '') && !/\.pdf($|\?)/i.test(o.link) && o.an.verdict !== 'skip' && (o.an.daysLeft ?? 1) >= 0 && !tried.has(o.id)).slice(0, limit);
  if (!todo.length) return 0;
  queueRunning = true; let done = 0;
  try {
    for (const o of todo) {
      tried.add(o.id); onProgress(done, todo.length);
      try { await deepRead(o); } catch (_) { /* leave the quick read in place */ }
      done++;
    }
    onProgress(done, todo.length);
  } finally { queueRunning = false; }
  return done;
}
function rankList(items) { return items.filter(o => !isFlagged(o) && o.an.verdict !== 'skip' && (o.an.daysLeft ?? 1) >= 0); }

/* ---------------- Flag as not relevant ---------------- */
const FLAG_REASONS = [['own-students', "Only for that university's own students/staff"], ['home-only', 'UK / home students only'], ['no-sponsor', "Can't sponsor a visa"], ['field', 'Wrong field'], ['level', 'Wrong level (too senior / needs a PhD)'], ['registration', "Needs registration or experience I don't have"], ['closed', 'Already closed'], ['other', 'Something else']];
function flagModal(o, done) {
  const sug = (o.an.blockers.find(b => b.sev === 'high') || {}).id;
  const pre = FLAG_REASONS.some(([k]) => k === sug) ? sug : 'field';
  modal(`<h2 style="font-size:19px">Not relevant? Tell me why.</h2>
    <p class="muted" style="margin-top:0;font-size:13.5px">${esc(o.title)}</p>
    <div class="stack" style="gap:6px">${FLAG_REASONS.map(([k, l]) => `<label class="radio"><input type="radio" name="fr" value="${k}" ${k === pre ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    <input type="text" id="frNote" placeholder="Optional note" style="margin-top:10px">
    <div class="row" style="margin-top:14px"><button class="btn" id="frGo">🚩 Flag and hide it</button><button class="btn ghost" data-close>Cancel</button></div>`, (m, close) => {
    $('#frGo', m).onclick = () => {
      const reason = (m.querySelector('input[name=fr]:checked') || {}).value || 'other';
      S().flags[o.id] = { reason, note: $('#frNote', m).value.trim(), at: today(), title: o.title };
      save(); close(); toast('Flagged. It is hidden from your list.'); done && done();
    };
  });
}
function unflag(o) { delete S().flags[o.id]; if (S().seen[o.id] === 'skip') delete S().seen[o.id]; save(); }

/* ---------------- Feed ---------------- */
const chipHtml = (t) => `<span class="chip ${t.cls || ''}">${esc(t.label)}</span>`;
function oppChips(o) {
  const a = o.an, V = VERDICT[a.verdict], out = [{ label: `${V.icon} ${V.label}`, cls: 'v ' + V.cls }];
  out.push({ label: o.type === 'phd' || /PhD/.test(a.level) ? '🎓 PhD' : o.type === 'job' ? '💼 Job' : '✦ ' + (o.type || 'Opportunity') });
  if (a.daysLeft != null) out.push(a.daysLeft < 0 ? { label: 'Closed', cls: 'bad' } : { label: a.daysLeft <= 14 ? `⏳ ${a.daysLeft}d left` : `Closes ${fmtDate(a.deadline)}`, cls: a.daysLeft <= 14 ? 'warn' : '' });
  const hi = a.blockers.find(b => b.sev === 'high'); const me = a.blockers.find(b => b.sev === 'med');
  if (hi) out.push({ label: '🚩 ' + shorten(hi.text, 46), cls: 'bad' }); else if (me) out.push({ label: '⚠ ' + shorten(me.text, 46), cls: 'warn' });
  if (a.positives.some(p => p.id === 'intl' || p.id === 'sponsor')) out.push({ label: '🌍 International OK', cls: 'good' });
  if (a.funded === 'full') out.push({ label: 'Funded', cls: 'water' });
  if (o.curated) out.push({ label: '✦ AI-curated', cls: 'water' });
  return out;
}
const pri = n => n >= 68 ? 'p-top' : n >= 50 ? 'p-good' : n >= 34 ? 'p-maybe' : 'p-low';

async function feed(el) {
  el.innerHTML = '<p class="muted">Loading compiled opportunities…</p>';
  await loadOpps(); await syncIndexFromDrive();
  let { items, robot, agent } = await loadOpps();
  items.forEach(applyAnalysis); items.sort((a, b) => b.priority - a.priority);
  const filter = { type: 'all', intl: false, q: '', showFlagged: false };
  const draw = () => {
    const ranked = rankList(items); const rankOf = new Map(ranked.map((o, i) => [o.id, i + 1]));
    const flaggedN = items.filter(isFlagged).length;
    const list = items.filter(o => (filter.showFlagged ? isFlagged(o) : !isFlagged(o)) &&
      (filter.type === 'all' || o.type === filter.type) && (!filter.intl || o.an.positives.some(p => p.id === 'intl' || p.id === 'sponsor')) &&
      (!filter.q || (o.title + ' ' + (o.summary || '') + ' ' + (o.org || '')).toLowerCase().includes(filter.q.toLowerCase())));
    const top = !filter.showFlagged && !filter.q && filter.type === 'all' ? ranked.filter(o => o.an.verdict === 'top' || o.an.verdict === 'good').slice(0, 3) : [];
    $('#startHere', el).innerHTML = top.length ? `<section class="card starthere"><div class="eyebrow">Start here: your top ${top.length}</div>${top.map((o, i) => `
      <a class="sh-item" href="#/radar/item/${encodeURIComponent(o.id)}"><span class="sh-n">${i + 1}</span><div><b>${esc(o.title)}</b><div class="muted" style="font-size:13px">${esc(o.org || o.source || '')}${o.an.deadline ? ' · closes ' + fmtDate(o.an.deadline) : ''}</div><div style="font-size:13.5px;margin-top:2px">${esc(shorten(o.an.verdictText, 140))}</div></div><span class="pri ${pri(o.priority)}">${o.priority}</span></a>`).join('')}</section>` : '';
    $('#feedList', el).innerHTML = list.length ? list.slice(0, 80).map(o => oppRow(o, rankOf.get(o.id), filter.showFlagged)).join('') :
      `<div class="empty">${filter.showFlagged ? 'Nothing flagged.' : items.length ? 'Nothing matches these filters.' : 'No compiled opportunities yet. The GitHub robot fills this list after its first run. Until then, try <a href="#/radar/search">one-tap searches</a>.'}</div>`;
    $('#fFlag', el).textContent = `🚩 Flagged (${flaggedN})`; $('#fFlag', el).classList.toggle('on', filter.showFlagged);
    $('#fFlag', el).style.display = flaggedN || filter.showFlagged ? '' : 'none';
    bindOppActions(el, draw, items);
  };
  const srcInfo = (robot.sources || []).map(s => `${esc(s.name)} (${s.count})`).join(' · ');
  el.innerHTML = `
    <div class="row between" style="margin-bottom:10px">
      <div class="row">
        ${['all', 'phd', 'job'].map(t => `<button class="chip ${t === 'all' ? 'on' : ''}" data-type="${t}">${{ all: 'Everything', phd: '🎓 PhDs', job: '💼 Jobs' }[t]}</button>`).join('')}
        <button class="chip" id="fIntl">🌍 International-friendly only</button>
        <button class="chip" id="fFlag" style="display:none"></button>
      </div>
      <button class="btn sm ghost" id="addOpp">+ Add one I found</button>
    </div>
    <div class="searchbar" style="margin-bottom:6px"><input type="search" id="fq" placeholder="Filter by word, e.g. formulation, KCL, Imperial…"></div>
    <p class="muted" style="font-size:12.5px">${robot.updated ? `Robot last ran ${fmtDate(robot.updated)}${srcInfo ? ' · ' + srcInfo : ''}` : 'Robot has not run yet.'}${agent.updated ? ` · AI scout ran ${fmtDate(agent.updated)}` : ''} · ${items.length} item${items.length === 1 ? '' : 's'}</p>
    <div id="readStatus"></div>
    <div id="startHere"></div>
    <div class="card"><div id="feedList"></div></div>`;
  $$('[data-type]', el).forEach(b => b.onclick = () => { $$('[data-type]', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); filter.type = b.dataset.type; draw(); });
  $('#fIntl', el).onclick = e => { filter.intl = !filter.intl; e.target.classList.toggle('on', filter.intl); draw(); };
  $('#fFlag', el).onclick = () => { filter.showFlagged = !filter.showFlagged; draw(); };
  $('#fq', el).oninput = e => { filter.q = e.target.value; draw(); };
  $('#addOpp', el).onclick = () => addOppModal(() => { cache = null; feed(el); });
  draw();
  const rs = $('#readStatus', el);
  if (!connected()) rs.innerHTML = `<div class="notice" style="margin:8px 0">These are <b>quick reads</b> from each advert's short summary. <a href="#/settings">Connect Google Drive</a> and Cornelieur will open each top advert, pull out the deadline and requirements, and re-rank them.</div>`;
  else {
    pruneCache(items);
    const n = await readTopAdverts(items, (d, tot) => { if (document.body.contains(rs)) rs.innerHTML = `<div class="notice" style="margin:8px 0">📖 Reading the full adverts… ${d} of ${tot}</div>`; });
    if (document.body.contains(rs)) { rs.innerHTML = n ? `<p class="muted" style="font-size:12.5px">📖 Read ${n} advert${n === 1 ? '' : 's'} in full and re-ranked the list.</p>` : ''; if (n) { items.sort((a, b) => b.priority - a.priority); draw(); } }
  }
}

/* ---------------- Explain the number ---------------- */
const PLAIN = {
  fit: (e) => e.hits.length ? `It mentions ${listWords(e.hits)}${e.titleHits ? ` (${e.titleHits === 1 ? 'one of them is' : 'some are'} right in the title)` : ''}, which sit in your field.` : 'It touches your field.',
  intl: () => 'It says international applicants can apply, which matters because you need a UK visa route.',
  sponsor: () => 'It mentions visa sponsorship, which you need.',
  funded: (e) => e.isPhd ? 'It is a funded PhD, your first goal, so you would not have to find the fees yourself.' : 'It mentions funding.',
  pay: () => 'It states the pay or stipend, so you know what you would live on.',
  time: (e, a) => a.daysLeft > 75 ? 'The deadline is far off, so there is no rush, but it is not urgent either.' : `The deadline is ${a.daysLeft} days away: enough time to write a good application.`,
  london: () => 'It is in or near London, where you already live.',
  phd: () => 'It is a PhD, the route you want most.',
  curated: () => 'The weekly AI scout picked it by hand after reading it against your profile.',
};
const listWords = arr => { const q = arr.map(w => `“${w}”`); return q.length < 2 ? q.join('') : q.slice(0, -1).join(', ') + ' and ' + q[q.length - 1]; };
const ptsOf = (e, key) => (e.parts.find(p => p.key === key) || {}).pts || 0;
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

function compareLine(me, other, otherRank, above) {
  const eo = explainPriority(other.an, other), em = explainPriority(me.an, me);
  const keys = new Set([...em.parts, ...eo.parts].map(p => p.key)); keys.delete('base');
  const diffs = [...keys].map(k => { const p = em.parts.find(x => x.key === k) || eo.parts.find(x => x.key === k); return { k, d: ptsOf(eo, k) - ptsOf(em, k), label: p.label }; })
    .filter(x => above ? x.d > 0 : x.d < 0).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 2);
  const name = `<a href="#/radar/item/${encodeURIComponent(other.id)}">#${otherRank} ${esc(shorten(other.title, 60))}</a> (${other.priority})`;
  const UP = { fit: 'matches your field more closely', intl: 'says international applicants are welcome', sponsor: 'mentions visa sponsorship', funded: 'is fully funded', pay: 'states its pay or stipend', time: 'has a more comfortable deadline', london: 'is in or near London', phd: 'is a PhD', curated: 'was hand-picked by the AI scout', high: 'has fewer problems to check', med: 'has fewer problems to check' };
  const DOWN = { fit: 'matches your field less closely', intl: "doesn't say international applicants are welcome", sponsor: "doesn't mention visa sponsorship", funded: "isn't fully funded", pay: "doesn't state its pay", time: 'has a less comfortable deadline', london: "isn't in London", phd: "isn't a PhD", curated: "wasn't hand-picked by the AI scout", high: 'has more problems to check', med: 'has more problems to check' };
  const reason = x => (above ? UP : DOWN)[x.k] || x.label.toLowerCase();
  if (other.priority === me.priority) return `${above ? 'Above' : 'Below'} it: ${name}, with the same score. They are tied; the order between them is arbitrary.`;
  if (!diffs.length) return `${above ? 'Above' : 'Below'} it: ${name}.`;
  return above ? `Above it: ${name}. It ranks higher mainly because it ${[...new Set(diffs.map(reason))].join(' and ')}.`
               : `Below it: ${name}. That one sits lower because it ${[...new Set(diffs.map(reason))].join(' and ')}.`;
}

function explainHtml(o, items) {
  const a = o.an, e = explainPriority(a, o);
  const ranked = rankList(items); const i = ranked.findIndex(x => x.id === o.id); const rk = i + 1;
  const ups = e.parts.filter(p => p.key !== 'base' && p.pts > 0), downs = e.parts.filter(p => p.pts < 0);
  const why = ups.filter(p => !(p.key === 'phd' && ups.some(q => q.key === 'funded'))).map(p => `<li>${PLAIN[p.key] ? PLAIN[p.key](e, a) : esc(p.label)}</li>`);
  const hold = a.blockers.map(b => `<li>${b.sev === 'high' ? '🚩' : '⚠️'} ${esc(b.text)}</li>`);
  if (!ptsOf(e, 'fit')) hold.push('<li>None of your field words (pharmaceutics, drug delivery, formulation…) appear in it, so it may be off-topic.</li>');
  else if (ptsOf(e, 'fit') < 12) hold.push('<li>Your field words only appear in passing, not in the title.</li>');
  if (!ups.some(p => p.key === 'intl' || p.key === 'sponsor')) hold.push('<li>It does not say whether international applicants can apply. Check this before spending time on it.</li>');
  const band = a.priority >= 68 ? 'Strong match (68 and above)' : a.priority >= 50 ? 'Worth a look (50–67)' : a.priority >= 34 ? 'Long shot (34–49)' : 'Low priority (below 34)';
  const place = rk ? `It is <b>#${rk} of ${ranked.length}</b> in your list. ${band}.` : a.verdict === 'skip' ? 'It is left out of your ranked list because of a hard blocker, whatever its score.' : 'It is not in your ranked list right now (flagged or closed).';
  const nb = rk ? [i > 0 ? compareLine(o, ranked[i - 1], rk - 1, true) : 'Nothing ranks above it: this is your top pick right now.', i < ranked.length - 1 ? compareLine(o, ranked[i + 1], rk + 1, false) : ''].filter(Boolean) : [];
  return `<div class="ex">
    <p class="ex-lead"><b>${a.priority} out of 99.</b> ${place}</p>
    ${why.length ? `<h4>Why it is relevant to you</h4><ul>${why.join('')}</ul>` : ''}
    ${hold.length ? `<h4>What holds it back</h4><ul>${hold.join('')}</ul>` : ''}
    ${nb.length ? `<h4>Compared with its neighbours</h4>${nb.map(t => `<p>${t}</p>`).join('')}` : ''}
    <details class="ex-pts"><summary>See the points</summary><table>
      ${e.parts.map(p => `<tr><td>${esc(p.label)}</td><td class="${p.pts < 0 ? 'neg' : ''}">${p.key === 'base' ? p.pts : signed(p.pts)}</td></tr>`).join('')}
      <tr class="tot"><td>Total${e.raw !== e.pr ? ` (${e.raw}, kept between 1 and 99)` : ''}</td><td>${e.pr}</td></tr></table></details>
    <p class="ex-foot">${a.source === 'page' ? 'Worked out from the full advert.' : 'Worked out from the short feed summary only. Once the full advert is read, the number may change.'} It is a guide for sorting, not a judgement of your chances.</p>
  </div>`;
}

function oppRow(o, rank, flaggedView) {
  const fl = S().flags[o.id];
  return `<div class="opp ${flaggedView ? 'is-flagged' : ''}" data-id="${esc(o.id)}" tabindex="0" role="link" aria-label="Open details: ${esc(o.title)}">
    <div class="opp-main"><div class="row" style="gap:8px;align-items:flex-start">${rank && !flaggedView ? `<span class="rank">#${rank}</span>` : ''}<h3>${esc(o.title)}</h3></div>
      <div class="meta">${esc(o.org || '')}${o.org && o.source ? ' · ' : ''}${esc(o.source || '')}${o.an.pay ? ' · ' + esc(shorten(o.an.pay, 40)) : o.salary ? ' · ' + esc(o.salary) : ''}</div>
      <div class="why row" style="gap:5px;margin-top:6px">${oppChips(o).map(chipHtml).join('')}</div>
      ${flaggedView && fl ? `<div class="why muted">Flagged: ${esc((FLAG_REASONS.find(r => r[0] === fl.reason) || [, fl.reason])[1])}${fl.note ? ' · ' + esc(fl.note) : ''}</div>` : `<div class="why">${esc(shorten(o.why || o.an.verdictText, 150))}</div>`}
    </div>
    <div class="acts"><span class="pri ${pri(o.priority)}" title="Priority for you, out of 99">${o.priority}</span>
      ${flaggedView ? `<button class="btn sm" data-act="restore">Restore</button>` : `<button class="btn sm" data-act="track">${S().tracker.some(t => t.oppId === o.id) ? '✓ Tracking' : 'Track + plan'}</button>
      <button class="btn sm ghost" data-act="flag">🚩 Not relevant</button>`}
    </div></div>`;
}
function bindOppActions(el, redraw, items) {
  $$('.opp', el).forEach(card => {
    const id = card.dataset.id; const go = () => { location.hash = '#/radar/item/' + encodeURIComponent(id); };
    card.onclick = e => { if (e.target.closest('[data-act]') || e.target.closest('a')) return; go(); };
    card.onkeydown = e => { if (e.key === 'Enter' && e.target === card) go(); };
  });
  $$('.opp [data-act]', el).forEach(b => b.onclick = e => {
    e.stopPropagation();
    const o = items.find(x => x.id === b.closest('.opp').dataset.id);
    if (b.dataset.act === 'flag') return flagModal(o, redraw);
    if (b.dataset.act === 'restore') { unflag(o); toast('Restored'); }
    if (b.dataset.act === 'track') trackOpp(o);
    redraw();
  });
}

/* ---------------- Supervisors & reading (filled by the weekly scout) ---------------- */
const link = (u, t) => /^https?:\/\//.test(u || '') ? `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : t;
function autoHtml(au, nested) {
  const since = new Date().getFullYear() - 5;
  const ppl = au.people.map(x => `<li>${link(x.orcid || x.openalex, `<b>${esc(x.name)}</b>`)} <span class="muted">· ${esc(x.institution || '')}${x.n ? ` · ${x.n} papers on your topics since ${since}` : ''}${x.senior_hint ? ' · often last author, may lead a group' : ''}</span>${(x.papers || []).slice(0, 2).map(pp => `<div class="ex-why">${link(pp.link, esc(pp.title))} (${esc([pp.venue, pp.year].filter(Boolean).join(', '))})</div>`).join('')}</li>`).join('');
  const rd = (au.reading || []).map(x => `<li>${link(x.link, `<b>${esc(x.title)}</b>`)} <span class="muted">(${esc([x.authors, x.year].filter(Boolean).join(', '))})</span><div class="ex-why">${esc(x.why || '')}</div></li>`).join('');
  const body = `<p class="ex-lead">${nested ? '' : '<b>Found automatically.</b> '}People at ${esc(au.institutions.join(' and ') || 'this university')} with recent papers on ${esc(au.topics.slice(0, 3).join(', '))}. This shows who publishes in your field, not who takes PhD students: check their staff page and the project list.</p>
    <h4>People publishing in your field here</h4><ul>${ppl}</ul>${rd ? `<h4>Read first</h4><ul>${rd}</ul>` : ''}
    <p class="ex-foot">From open publication records (OpenAlex), updated ${fmtDate(au.checked)} by the daily robot.</p>`;
  return nested ? `<details class="ex-pts"><summary>More people publishing in your field here (automatic)</summary><div style="margin-top:6px">${body}</div></details>` : body;
}
function researchHtml(o) {
  const r = o.research; const isPhd = o.type === 'phd' || /^PhD/.test(o.an.level || '');
  if (!isPhd) return '';
  if (!r && o.auto) return `<details class="ex-detail"><summary>Supervisors & what to read</summary><div class="ex">${autoHtml(o.auto)}<p class="ex-foot">The Thursday AI scout will check the staff pages and pick the best fits.</p></div></details>`;
  if (!r) return `<details class="ex-detail"><summary>Supervisors & what to read</summary><div class="ex"><p class="ex-lead">Not researched yet. The daily robot and the Thursday AI scout look up supervisors, their recent papers and a short reading list for the PhDs in your list. This one will be filled in soon.</p></div></details>`;
  const sup = r.supervisors || [], pubs = r.publications || [], read = r.reading || [];
  const start = read.filter(x => x.level !== 'deeper'), deeper = read.filter(x => x.level === 'deeper');
  const readLi = x => `<li>${link(x.link, `<b>${esc(x.title)}</b>`)}${x.authors || x.year ? ` <span class="muted">(${esc([x.authors, x.year].filter(Boolean).join(', '))})</span>` : ''}${x.why ? `<div class="ex-why">${esc(x.why)}</div>` : ''}</li>`;
  return `<details class="ex-detail"><summary>Supervisors & what to read${sup.length ? ` (${sup.length})` : ''}</summary><div class="ex">
    ${r.angle ? `<p class="ex-lead"><b>Your angle:</b> ${esc(r.angle)}</p>` : ''}
    ${sup.length ? `<h4>Who you would work with</h4><ul>${sup.map(x => `<li>${link(x.profile, `<b>${esc(x.name)}</b>`)}${x.role || x.dept ? ` <span class="muted">· ${esc([x.role, x.dept].filter(Boolean).join(', '))}</span>` : ''}${x.focus ? `<div class="ex-why">${esc(x.focus)}</div>` : ''}</li>`).join('')}</ul>` : ''}
    ${pubs.length ? `<h4>Their recent papers</h4><ul>${pubs.map(x => `<li>${link(x.link, esc(x.title))} <span class="muted">(${esc([x.by, x.venue, x.year].filter(Boolean).join(', '))})</span></li>`).join('')}</ul>` : ''}
    ${start.length ? `<h4>Read first</h4><ul>${start.map(readLi).join('')}</ul>` : ''}
    ${deeper.length ? `<h4>Go deeper</h4><ul>${deeper.map(readLi).join('')}</ul>` : ''}
    <p class="ex-foot">Checked by the weekly AI scout${r.checked ? ' on ' + fmtDate(r.checked) : ''}. Check names and papers on the university page before you email anyone.</p>
    ${o.auto ? autoHtml(o.auto, true) : ''}
  </div></details>`;
}
function researchMd(o) {
  const r = o.research;
  if (!r && o.auto) { const au = o.auto; const L = ['', '## People publishing in your field here (automatic, OpenAlex)', '', `_Who publishes on ${au.topics.slice(0, 3).join(', ')} at ${au.institutions.join(' and ')}. Not a list of who takes PhD students: check staff pages._`, ''];
    for (const x of au.people) { L.push(`- ${x.orcid || x.openalex ? `[${x.name}](${x.orcid || x.openalex})` : x.name} · ${x.institution || ''} · ${x.n} papers`); for (const pp of (x.papers || []).slice(0, 2)) L.push(`  - ${pp.link ? `[${pp.title}](${pp.link})` : pp.title} (${[pp.venue, pp.year].filter(Boolean).join(', ')})`); }
    if ((au.reading || []).length) { L.push('', '### Read first'); for (const x of au.reading) L.push(`- ${x.link ? `[${x.title}](${x.link})` : x.title} (${[x.authors, x.year].filter(Boolean).join(', ')})`); }
    return L.join('\n'); }
  if (!r) return '';
  const L = ['', '## Supervisors & reading (weekly scout)', ''];
  if (r.angle) L.push(`**Your angle:** ${r.angle}`, '');
  if ((r.supervisors || []).length) { L.push('### Supervisors'); for (const x of r.supervisors) L.push(`- ${x.profile ? `[${x.name}](${x.profile})` : x.name}${x.role || x.dept ? ` · ${[x.role, x.dept].filter(Boolean).join(', ')}` : ''}${x.focus ? `: ${x.focus}` : ''}`); L.push(''); }
  if ((r.publications || []).length) { L.push('### Their recent papers'); for (const x of r.publications) L.push(`- ${x.link ? `[${x.title}](${x.link})` : x.title} (${[x.by, x.venue, x.year].filter(Boolean).join(', ')})`); L.push(''); }
  if ((r.reading || []).length) { L.push('### Reading list'); for (const x of r.reading) L.push(`- ${x.level === 'deeper' ? '(deeper) ' : ''}${x.link ? `[${x.title}](${x.link})` : x.title}${x.authors || x.year ? ` (${[x.authors, x.year].filter(Boolean).join(', ')})` : ''}${x.why ? ` — ${x.why}` : ''}`); L.push(''); }
  L.push(`_Found by the AI scout${r.checked ? ' on ' + r.checked : ''}. Check before emailing._`);
  return L.join('\n');
}

/* ---------------- Detail view: what the advert actually says ---------------- */
async function detail(el, id) {
  const { items } = await loadOpps();
  const o = items.find(x => x.id === id);
  if (!o) { el.innerHTML = `<div class="card"><h2>That advert is no longer in the list</h2><p class="muted">It probably closed and was cleared away.</p><a class="btn" href="#/radar">Back to the list</a></div>`; return; }
  let note = '';
  const draw = () => {
    const a = o.an, V = VERDICT[a.verdict]; const ranked = rankList(items); const rk = ranked.findIndex(x => x.id === o.id) + 1;
    const fl = S().flags[o.id]; const R = a.requirements;
    const reqBlocks = [['Degree & qualifications', R.degree], ['Skills & experience', R.skills], ['English', R.english], ['Eligibility', R.eligibility]].filter(([, v]) => v && v.length);
    const fact = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
    el.innerHTML = `
      <a href="#/radar" class="back">← Back to the list</a>
      <div class="verdict ${V.cls}"><div class="v-ico">${V.icon}</div><div><div class="v-label">${V.label} · priority ${a.priority}/99${rk ? ` · #${rk} of ${ranked.length} for you` : ''}</div><div class="v-text">${esc(a.verdictText)}</div></div></div>
      <details class="ex-detail"><summary>Explain the number (${a.priority})</summary>${explainHtml(o, items)}</details>
      <h1 class="d-title">${esc(o.title)}</h1>
      <div class="muted" style="margin-bottom:12px">${esc(o.org || '')}${o.org && o.source ? ' · ' : ''}${esc(o.source || '')}</div>
      ${researchHtml(o)}
      ${fl ? `<div class="notice dew" style="margin-bottom:12px">🚩 You flagged this as not relevant (${esc((FLAG_REASONS.find(r => r[0] === fl.reason) || [, fl.reason])[1])}). <button class="btn sm" id="dRestore">Restore</button></div>` : ''}
      ${a.blockers.length ? `<section class="card warn-card"><h2>Check before you apply</h2>${a.blockers.map(b => `<div class="flagrow ${b.sev}"><span>${b.sev === 'high' ? '🚩' : '⚠️'}</span><div><b>${esc(b.text)}</b>${b.quote ? `<div class="muted quote">“${esc(b.quote)}”</div>` : ''}</div></div>`).join('')}</section>` : ''}
      <section class="card"><h2>Key facts</h2><dl class="facts">
        ${fact('Deadline', a.deadline ? `<b>${fmtDate(a.deadline)}</b>${a.daysLeft != null ? ` <span class="chip ${a.daysLeft < 0 ? 'bad' : a.daysLeft <= 14 ? 'warn' : ''}">${a.daysLeft < 0 ? 'passed' : a.daysLeft + ' days left'}</span>` : ''}` : '<span class="muted">Not found: check the advert</span>')}
        ${fact('Starts', esc(a.start))}${fact('Type', esc(a.level))}${fact('Pay / stipend', esc(a.pay))}${fact('Fees', esc(a.fees))}
        ${fact('Funding', { full: 'Funded', none: 'Not funded', unknown: '' }[a.funded])}${fact('Location', esc(a.location))}
        ${fact('Contact', a.contacts.map(c => `<a href="mailto:${esc(c)}">${esc(c)}</a>`).join(', '))}
      </dl></section>
      ${a.positives.length ? `<section class="card"><h2>In your favour</h2>${a.positives.map(p => `<div class="flagrow good"><span>✅</span><div>${esc(p.text)}</div></div>`).join('')}</section>` : ''}
      ${reqBlocks.length ? `<section class="card"><h2>What they ask for</h2>${reqBlocks.map(([k, v]) => `<h3 style="margin-top:10px">${k}</h3><ul class="plain">${v.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}${a.notes.map(n => `<p class="muted" style="margin:6px 0 0">• ${esc(n)}</p>`).join('')}</section>` : ''}
      ${a.howToApply.length ? `<section class="card"><h2>How to apply</h2><ul class="plain">${a.howToApply.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
      <section class="card"><p style="margin-top:0"><b>Next step:</b> ${esc(a.nextStep)}</p>
        <div class="row">
          <button class="btn" id="dTrack">${S().tracker.some(t => t.oppId === o.id) ? '✓ In your tracker' : 'Track + step-by-step plan'}</button>
          ${fl ? '' : '<button class="btn ghost" id="dFlag">🚩 Not relevant</button>'}
          <button class="btn ghost" id="dMd">📖 Read as Markdown</button>
          <a class="btn ghost" href="${esc(o.link)}" target="_blank" rel="noopener">Open the original advert ↗</a>
        </div>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0" id="dNote">${note || (a.source === 'page' ? `Read from the full advert on ${fmtDate(a.analysedAt)}.` : 'Quick read from the short feed summary only.')} Always confirm dates and eligibility on the advert itself.</p>
      </section>`;
    $('#dTrack', el).onclick = () => { trackOpp(o); draw(); };
    $('#dMd', el).onclick = () => openReader({ title: o.title, md: toMarkdown(a) + researchMd(o), key: 'an:' + o.id, subtitle: 'Advert summary', filename: safeName(o.title) + ' (summary).md' });
    const f = $('#dFlag', el); if (f) f.onclick = () => flagModal(o, () => { draw(); });
    const r = $('#dRestore', el); if (r) r.onclick = () => { unflag(o); draw(); };
  };
  draw();
  if (o.an.source !== 'page') {
    if (!connected()) { note = 'Quick read only. Connect Google Drive (Settings) so Cornelieur can open the full advert.'; draw(); }
    else {
      const n = $('#dNote', el); if (n) n.textContent = '📖 Opening the full advert to read it properly…';
      try { await deepRead(o); note = ''; items.sort((a, b) => b.priority - a.priority); }
      catch (e) { note = e.message + ' Showing the quick read instead.'; }
      if (document.body.contains(el)) draw();
    }
  }
}

/* ---------------- Digest (low-load triage) ---------------- */
async function digest(el) {
  const { items } = await loadOpps();
  const queue = rankList(items).filter(o => !S().seen[o.id]).slice(0, 5);
  let i = 0;
  const show = () => {
    if (i >= queue.length) {
      el.innerHTML = `<div class="card celebrate"><div class="big">🌿</div><h2>Digest done</h2><p class="muted">${queue.length ? `You triaged ${queue.length} opportunities. That's the job-hunting for today. Well done.` : 'Nothing new to triage right now. Check back after the next robot run.'}</p><a class="btn" href="#/radar/tracker">See my tracker</a></div>`;
      if (queue.length) addXP(5);
      return;
    }
    const o = queue[i], a = o.an;
    el.innerHTML = `<div class="digest-card">
      <div class="row between"><span class="muted">${i + 1} of ${queue.length}</span><span class="pri ${pri(o.priority)}">${o.priority}</span></div>
      <div class="progress" style="margin:8px 0 16px"><i style="width:${(i / queue.length) * 100}%"></i></div>
      <div class="card">
        <div class="row" style="gap:5px">${oppChips(o).map(chipHtml).join('')}</div>
        <div class="big-title">${esc(o.title)}</div>
        <div class="muted">${esc(o.org || o.source || '')}${a.deadline ? ' · closes ' + fmtDate(a.deadline) : ''}${a.pay ? ' · ' + esc(shorten(a.pay, 40)) : ''}</div>
        <p style="margin:10px 0 4px"><b>${esc(a.verdictText)}</b></p>
        ${o.why ? `<p><b>Why it fits:</b> ${esc(o.why)}</p>` : ''}
        <a href="#/radar/item/${encodeURIComponent(o.id)}">See the full breakdown →</a>
      </div>
      <div class="triage">
        <button class="btn ghost" data-t="skip">🚩 Not for me</button>
        <button class="btn soft" data-t="later">🕓 Later</button>
        <button class="btn" data-t="saved">⭐ Track it</button>
      </div>
      <p class="muted" style="text-align:center;font-size:12.5px;margin-top:10px">Keys: <span class="kbd">←</span> skip · <span class="kbd">↓</span> later · <span class="kbd">→</span> track</p>
    </div>`;
    $$('[data-t]', el).forEach(b => b.onclick = () => decide(b.dataset.t));
  };
  const decide = t => {
    const o = queue[i];
    if (t === 'skip') S().flags[o.id] = { reason: 'other', note: 'skipped in digest', at: today(), title: o.title }; else S().seen[o.id] = t;
    save();
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
const shorten = (s, n) => (s || '').length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : (s || '');

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
  if (connected() && o.an) putText(`${DIR.apps}/${safeName((o.org ? o.org + ' - ' : '') + o.title)}/Advert summary.md`, toMarkdown(o.an), 'text/markdown').catch(() => {});
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
