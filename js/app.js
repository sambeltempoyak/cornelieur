import { S, save, esc, $, $$, toast, streakAlive, today, download, replaceState, resetState, fmtDate, daysLeft, copyText } from './util.js';
import { renderRadar, topOpportunities, nextTrackerSteps } from './radar.js';
import { renderLearn, renderLesson, nextLesson, renderSetup, reviewCount } from './learn.js';
import { renderRead, paperOfDay } from './read.js';
import { jokeOfDay, randomJoke } from './jokes.js';
import { renderFiles } from './files.js';
import { driveCfg, setDriveCfg, connected, ping, initSync, pushState, pullState } from './drive.js';
import { VERDICT } from './analyze.js';
import { getStall, SLOTS, stallMode, setStallPref, POSTER } from './stall.js';

/* ---- theme: light / dark / follow the phone ---- */
const THEME_KEY = 'cornelieur.theme';
export const themePref = () => localStorage.getItem(THEME_KEY) || 'auto';
export function applyTheme() {
  const p = themePref();
  const dark = p === 'dark' || (p === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#151D1F' : '#5E7F69';
}
function cycleTheme() {
  const next = { auto: 'dark', dark: 'light', light: 'auto' }[themePref()];
  localStorage.setItem(THEME_KEY, next); applyTheme();
  toast({ auto: 'Theme: follows your phone', dark: 'Night mode on', light: 'Light mode on' }[next]);
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.textContent = themeIcon());
}
const themeIcon = () => ({ auto: '🌗', dark: '🌙', light: '☀️' }[themePref()]);
applyTheme();
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);


const app = document.getElementById('app');

function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const [page, ...rest] = hash.split('/');
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === page || (page === 'lesson' && a.dataset.nav === 'learn') || (page === 'setup' && a.dataset.nav === 'learn') || (page === 'connect' && a.dataset.nav === 'settings')));
  getStall().detach();
  app.innerHTML = '';
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  window.scrollTo(0, 0);
  const sub = rest.map(decodeURIComponent);
  try {
    switch (page) {
      case 'home': renderHome(app); break;
      case 'radar': renderRadar(app, sub); break;
      case 'learn': renderLearn(app); break;
      case 'lesson': renderLesson(app, sub[0]); break;
      case 'setup': renderSetup(app, sub[0]); break;
      case 'read': renderRead(app, sub); break;
      case 'files': renderFiles(app, sub); break;
      case 'connect': connectLink(sub[0]); break;
      case 'settings': renderSettings(app); break;
      default: renderHome(app);
    }
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/home">Back to Today</a></div>`;
  }
  sideStats();
  app.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
window.addEventListener('compass:stats', sideStats);

function sideStats() {
  const s = S();
  const el = document.getElementById('sideStats');
  if (el) el.innerHTML = `<div>🔥 <b>${streakAlive()}</b> day streak</div><div>✦ <b>${s.xp}</b> XP</div><div style="margin-top:8px;opacity:.75">Data stays in this browser. Back it up in Settings.</div>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/* ---- Today: Ocha's flower stall (her watercolour, in 3D) + the cards ---- */
const SLOT_INFO = {
  opps:   { title: 'Fresh picks', where: 'Opportunity radar', quip: 'Picked fresh this morning by the robot.', card: 'card-opps', p: 1, short: 'Picks' },
  apply:  { title: 'Your applications', where: 'Tracker', quip: 'Tulips need tending. So do applications.', card: 'card-apply', p: 2, short: 'Applications' },
  learn:  { title: 'Learn · 5 minutes', where: 'Learn', quip: 'Succulents grow slowly. That is the whole point.', card: 'card-learn', p: 3, short: 'Lesson' },
  paper:  { title: 'Paper of the day', where: 'Read', quip: 'One paper, standing tall in its vase.', card: 'card-paper', p: 4, short: 'Paper' },
  relief: { title: 'Lieur relief', where: 'Joke of the day', quip: 'Hydrangeas, but make it pharmacology.', card: 'card-relief', p: 5, short: 'Joke' },
  week:   { title: 'Your week', where: 'The awning', quip: 'The awning keeps score, so you don’t have to.', card: 'card-week', p: 0, short: 'Your week' },
};
const SLOT_ORDER = ['opps', 'apply', 'learn', 'paper', 'relief', 'week'];
const pot = (id, cls = '') => `<i class="pot p${SLOT_INFO[id].p} ${cls}" aria-hidden="true"></i>`;
const flowerOf = id => SLOTS.find(x => x.id === id).flower;

function todayMoves(H) {
  if (!H.low) return ['opps', 'learn', 'paper'];
  const st = H.steps[0];
  if (st && st.days != null && st.days >= 0 && st.days <= 14) return ['apply'];
  return H.nl ? ['learn'] : ['opps'];
}
function stallTags(H) {
  const t = {};
  if (H.opps == null) t.opps = { big: '…', small: 'picks', label: 'loading the radar' };
  else {
    const shown = H.opps.slice(0, H.low ? 1 : 3), n = shown.length;
    const soon = shown.map(o => daysLeft(o.an.deadline || o.deadline)).filter(d => d != null && d >= 0 && d <= 7);
    t.opps = { big: String(n), small: n === 1 ? 'pick' : 'picks', urgent: soon.length > 0, label: `${n} fresh ${n === 1 ? 'pick' : 'picks'}${soon.length ? ', one closes within a week' : ''}` };
  }
  const all = nextTrackerSteps(99), d = all.length ? all[0].days : null;
  if (d != null && d >= 0 && d <= 7) t.apply = { big: String(d), small: d === 1 ? 'day' : 'days', urgent: true, label: `next deadline in ${d} ${d === 1 ? 'day' : 'days'}` };
  else t.apply = { big: String(all.length), small: all.length === 1 ? 'step' : 'steps', label: `${all.length} next ${all.length === 1 ? 'step' : 'steps'} on your applications` };
  t.learn = H.rc ? { big: String(H.rc), small: 'to review', label: `${H.rc} questions to review` } : H.nl ? { big: '5', small: 'min', label: 'a five-minute lesson' } : { big: '✓', small: 'done', label: 'every lesson done' };
  t.paper = H.paper === undefined ? { big: '…', small: 'paper', label: 'finding a paper' } : H.paper ? { big: '1', small: 'paper', label: 'one paper of the day' } : { big: '–', small: 'offline', label: 'paper not reachable right now' };
  t.relief = { big: '1', small: 'joke', label: 'joke of the day' };
  return t;
}
function slotLine(id, H) {          // one line for the overview rows
  switch (id) {
    case 'opps': return H.opps == null ? 'Reading the radar…' : H.opps.length ? `${esc(H.opps[0].title.slice(0, 70))}${H.opps[0].title.length > 70 ? '…' : ''}` : 'No fresh matches today. The robot is still looking.';
    case 'apply': return H.steps.length ? `${esc(H.steps[0].step)}${H.steps[0].days != null && H.steps[0].days >= 0 ? ` · ${H.steps[0].days} ${H.steps[0].days === 1 ? 'day' : 'days'} left` : ''}` : 'Nothing tracked yet. Save an opportunity to plant one.';
    case 'learn': return H.nl ? `${esc(H.nl.lesson.title)}${H.rc ? ` · ${H.rc} to review` : ''}` : 'Path complete. Replay any unit to keep it fresh.';
    case 'paper': return H.paper === undefined ? 'Finding one open-access review…' : H.paper ? esc(H.paper.title.slice(0, 80)) + (H.paper.title.length > 80 ? '…' : '') : 'Europe PMC is not answering right now.';
    case 'relief': return esc(H.joke.length > 76 ? H.joke.slice(0, 74) + '…' : H.joke);
    case 'week': return `🔥 ${streakAlive()} day streak · ${H.s.xp} XP · ${H.lessonsDone} lessons`;
  }
}
function slotBody(id, H) {
  switch (id) {
    case 'opps': {
      if (H.opps == null) return `<p class="muted">Reading the radar…</p>`;
      const list = H.opps.slice(0, H.low ? 1 : 3);
      return (list.length ? `<div class="sc-opps">${list.map(o => { const V = VERDICT[o.an.verdict]; return `
        <a class="sc-opp" href="#/radar/item/${encodeURIComponent(o.id)}"><span class="pri ${o.priority >= 68 ? 'p-top' : o.priority >= 50 ? 'p-good' : o.priority >= 34 ? 'p-maybe' : 'p-low'}" title="Priority for you, out of 99">${o.priority}</span>
        <span><b>${esc(o.title)}</b><small>${esc(o.org || o.source || '')}${o.an.deadline ? ' · closes ' + fmtDate(o.an.deadline) : ''}</small><span class="chip v ${V.cls}">${V.icon} ${V.label}</span></span></a>`; }).join('')}</div>`
        : `<p class="muted">No compiled matches yet. Meanwhile, the one-tap searches still work.</p>`) +
        `<div class="row sc-acts"><a class="btn" href="#/radar">Open the radar</a><a class="btn soft" href="#/radar/digest">5-minute digest</a></div>`;
    }
    case 'apply':
      return (H.steps.length ? `<div>${H.steps.map(st => `<div class="check"><span class="pill-n">${st.days == null ? '•' : st.days < 0 ? '!' : st.days}</span><div><b class="sc-strong">${esc(st.step)}</b><br><small>${esc(st.title)}${st.deadline ? ' · deadline ' + fmtDate(st.deadline) : ''}</small></div></div>`).join('')}</div>`
        : `<p class="muted">Nothing tracked yet. Save an opportunity from the radar and Cornelieur breaks it into small steps, like bulbs waiting for spring.</p>`) +
        `<div class="row sc-acts"><a class="btn" href="#/radar/tracker">Open the tracker</a>${H.steps.length ? '' : '<a class="btn soft" href="#/radar">Find one to save</a>'}</div>`;
    case 'learn':
      return H.nl ? `<h3 class="sc-h">${esc(H.nl.lesson.title)}</h3><p class="muted">${esc(H.nl.unit.title)}${H.nl.lesson.blurb ? ' — ' + esc(H.nl.lesson.blurb) : ''}</p>
        <div class="row sc-acts"><a class="btn" href="#/lesson/${H.nl.lesson.id}">${H.nl.started ? 'Continue' : 'Start'} lesson →</a>${H.rc ? `<a class="btn soft" href="#/lesson/review">Review ${H.rc} missed</a>` : ''}</div>
        <p class="sc-note">🔥 ${streakAlive()} day streak · ${H.s.xp} XP so far</p>`
        : `<h3 class="sc-h">Path complete 🎉</h3><p class="muted">You've finished every lesson. Replay any unit to keep it fresh.</p><div class="row sc-acts"><a class="btn" href="#/learn">Open the path</a></div>`;
    case 'paper':
      if (H.paper === undefined) return `<p class="muted">Finding one open-access review in your interests…</p>`;
      if (!H.paper) return `<p class="muted">Couldn't reach Europe PMC right now.</p><div class="row sc-acts"><a class="btn" href="#/read">Open the reading room</a></div>`;
      return `<h3 class="sc-h">${esc(H.paper.title)}</h3><p class="muted">${esc(H.paper.journal || '')} · ${esc(H.paper.year || '')} · open access review</p>
        <div class="row sc-acts"><a class="btn" href="#/read/paper/${encodeURIComponent(H.paper.key)}">Read the digest</a><a class="btn ghost" href="#/read">Reading room</a></div>`;
    case 'relief':
      return `<p class="sc-joke" id="scJoke">${esc(H.joke)}</p><div class="row sc-acts"><button class="btn soft" type="button" data-act="joke">Another dose</button></div>`;
    case 'week':
      return `<div class="sc-stats">
        <div><b>🔥 ${streakAlive()}</b><small>day streak</small></div><div><b>${H.s.xp}</b><small>XP total</small></div>
        <div><b>${H.lessonsDone}</b><small>lessons done</small></div><div><b>${H.s.tracker.length}</b><small>applications tracked</small></div>
        <div><b>${H.s.papers.filter(p => p.status === 'done').length}</b><small>papers digested</small></div></div>`;
  }
}
function stallCardHTML(H, sel) {
  if (!sel) {
    const moves = todayMoves(H), rest = SLOT_ORDER.filter(id => !moves.includes(id));
    return `<div class="sc-over">
      <div class="eyebrow">${H.low ? 'Very lieur · one pot today' : 'Today at your stall'}</div>
      <h2 class="sc-title">${H.low ? 'Just this one. It still counts.' : 'Three small moves'}</h2>
      <div class="sc-moves">${moves.map(id => `<button type="button" class="sc-row" data-slot="${id}">${pot(id)}<span><b>${SLOT_INFO[id].title}</b><small>${slotLine(id, H)}</small></span><em aria-hidden="true">›</em></button>`).join('')}</div>
      <div class="sc-also"><span class="sc-also-l">Also at the stall</span>${rest.map(id => `<button type="button" class="sc-chip" data-slot="${id}">${pot(id, 'sm')}${SLOT_INFO[id].short}</button>`).join('')}</div>
    </div>`;
  }
  const I = SLOT_INFO[sel], i = SLOT_ORDER.indexOf(sel);
  const prev = SLOT_ORDER[(i + SLOT_ORDER.length - 1) % SLOT_ORDER.length], next = SLOT_ORDER[(i + 1) % SLOT_ORDER.length];
  return `<div class="sc-detail" data-current="${sel}">
    <div class="sc-top">${pot(sel, 'big')}<div class="sc-top-t"><div class="eyebrow">${flowerOf(sel)} · ${I.where}</div><h2 class="sc-title">${I.title}</h2><p class="sc-quip">${I.quip}</p></div>
      <button type="button" class="sc-x" data-act="close" aria-label="Back to the whole stall">×</button></div>
    <div class="sc-body">${slotBody(sel, H)}</div>
    <div class="sc-foot"><button type="button" class="sc-nav" data-slot="${prev}" aria-label="Previous: ${flowerOf(prev)}">‹ ${SLOT_INFO[prev].short}</button>
      <a class="sc-card-link" href="#${I.card}" data-act="card">See the card ↓</a>
      <button type="button" class="sc-nav" data-slot="${next}" aria-label="Next: ${flowerOf(next)}">${SLOT_INFO[next].short} ›</button></div>
  </div>`;
}

async function renderHome(el) {
  const s = S();
  const low = s.energy === 'low';
  const nl = nextLesson();
  const rc = reviewCount();
  const steps = nextTrackerSteps(low ? 1 : 3);
  const H = { s, low, nl, rc, steps, joke: jokeOfDay(), opps: null, paper: undefined, lessonsDone: Object.values(s.lessons).filter(l => l.done).length };
  const stall = getStall();
  const mode = stallMode();
  el.innerHTML = `
  <div class="hello">
    <div>
      <div class="eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>${greeting()}, ${esc(s.profile.name)}.</h1>
      <p class="muted" style="margin:0">${low ? 'Very-lieur mode: one pot on the stall today. That still counts.' : 'Three small moves today: one opportunity, one lesson, one paper.'}</p>
    </div>
    <div class="row">
      <button class="theme-btn" data-theme-btn type="button" aria-label="Switch light / night mode">${themeIcon()}</button>
      <div class="energy" role="group" aria-label="Energy today">
        <button data-energy="low" class="${low ? 'on' : ''}">🌙 Very lieur</button>
        <button data-energy="normal" class="${!low ? 'on' : ''}">☀ Less lieur</button>
      </div>
    </div>
  </div>
  <section class="stall" aria-label="Your flower stall">
    <div class="stall-view" id="stallView" tabindex="0" data-mode="${mode}" aria-label="Your flower stall: each pot holds one part of today. Use the tags, or the arrow keys to browse.">
      <img class="stall-poster" src="${POSTER}" alt="Your watercolour flower stall: a striped awning over five pots of flowers on a wooden crate" draggable="false">
      <div class="stall-tags" id="stallTags"></div>
      <button type="button" class="stall-chip stall-back" data-act="close">‹ Whole stall</button>
      <button type="button" class="stall-chip stall-mode" id="stallMode" title="Switch between the 3D stall and the flat painting">${mode === '3d' ? 'Painting' : '3D'}</button>
      <p class="stall-hint ${localStorage.getItem('cornelieur.stall.hinted') ? 'gone' : ''}">${mode === '3d' ? 'Tap a pot · drag to walk round' : 'Tap a pot to look inside'}</p>
      <span class="stall-sign">painted by you</span>
    </div>
    <div class="stall-card" id="stallCard" aria-live="polite"></div>
  </section>
  <section class="card joke" id="card-relief" style="margin-bottom:16px">
    <div class="joke-ico">💊</div>
    <div style="flex:1"><div class="eyebrow">${pot('relief', 'xs')}Today's dose of lieur relief</div><p id="joke" style="margin:0;font-family:var(--serif);font-size:17px">${esc(H.joke)}</p></div>
    <button class="btn sm soft" id="jokeBtn" type="button">Another dose</button>
  </section>
  <div class="statline" id="card-week" style="margin-bottom:20px">
    <div class="stat"><b>🔥 ${streakAlive()}</b><small>day streak</small></div>
    <div class="stat"><b>${s.xp}</b><small>XP total</small></div>
    <div class="stat"><b>${H.lessonsDone}</b><small>lessons done</small></div>
    <div class="stat"><b>${s.tracker.length}</b><small>applications tracked</small></div>
    <div class="stat"><b>${s.papers.filter(p => p.status === 'done').length}</b><small>papers digested</small></div>
  </div>
  <div class="grid g2">
    <section class="card dark" id="card-learn">
      <div class="eyebrow" style="color:var(--dew)">${pot('learn', 'xs')}Learn · 5 minutes</div>
      ${nl ? `<h2>${esc(nl.lesson.title)}</h2><p class="muted">${esc(nl.unit.title)} — ${esc(nl.lesson.blurb || '')}</p>
      <div class="row"><a class="btn dew big" href="#/lesson/${nl.lesson.id}">${nl.started ? 'Continue' : 'Start'} lesson →</a>${rc ? `<a class="btn ghost" style="color:#fff;border-color:#fff" href="#/lesson/review">Review ${rc} missed</a>` : ''}</div>`
      : `<h2>Path complete 🎉</h2><p class="muted">You've finished every lesson. Replay any unit to keep it fresh.</p><a class="btn dew" href="#/learn">Open path</a>`}
    </section>
    <section class="card" id="card-apply">
      <div class="row between"><div class="eyebrow">${pot('apply', 'xs')}Next steps on your applications</div><a href="#/radar/tracker" class="btn sm ghost">Tracker</a></div>
      ${steps.length ? `<div>${steps.map(st => `<div class="check"><span class="pill-n">${st.days == null ? '•' : st.days < 0 ? '!' : st.days}</span><div><b style="color:var(--forest)">${esc(st.step)}</b><br><small>${esc(st.title)}${st.deadline ? ' · deadline ' + fmtDate(st.deadline) : ''}</small></div></div>`).join('')}</div>`
      : `<div class="empty">Nothing tracked yet. Save an opportunity from the radar and Cornelieur will break it into small steps.</div>`}
    </section>
  </div>
  <div class="spacer"></div>
  <section class="card" id="card-opps">
    <div class="row between"><div><div class="eyebrow">${pot('opps', 'xs')}Opportunity radar</div><h2 style="margin:0">Best matches right now</h2></div><div class="row"><a class="btn soft" href="#/radar/digest">5-minute digest</a><a class="btn ghost" href="#/radar">All</a></div></div>
    <div id="homeOpps"><p class="muted">Loading…</p></div>
  </section>
  <div class="spacer"></div>
  <section class="card dew" id="card-paper">
    <div class="eyebrow">${pot('paper', 'xs')}Paper of the day</div>
    <div id="homePaper"><p class="muted">Finding one open-access review in your interests…</p></div>
  </section>`;

  $('[data-theme-btn]', el).onclick = cycleTheme;
  const newJoke = () => { H.joke = randomJoke(); $('#joke', el).textContent = H.joke; const sj = $('#scJoke', el); if (sj) sj.textContent = H.joke; stall.hearts('relief', 5); };
  $('#jokeBtn', el).onclick = newJoke;
  $$('[data-energy]', el).forEach(b => b.onclick = () => { S().energy = b.dataset.energy; save(); renderHome(el); });

  /* ---- the stall ---- */
  const card = $('#stallCard', el), view = $('#stallView', el);
  const paint = () => {
    card.innerHTML = stallCardHTML(H, stall.sel);
    card.dataset.sel = stall.sel || '';
    $$("button[data-slot]", card).forEach(b => b.onclick = () => stall.select(b.dataset.slot));
  };
  const lit = id => { $$('.lit', el).forEach(x => x.classList.remove('lit')); if (id) { const c = document.getElementById(SLOT_INFO[id].card); if (c) c.classList.add('lit'); } };
  card.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'close') stall.select(null);
    else if (a.dataset.act === 'joke') newJoke();
    else if (a.dataset.act === 'card') { e.preventDefault(); const c = document.getElementById(SLOT_INFO[stall.sel].card); if (c) { c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); c.classList.remove('flash-lit'); void c.offsetWidth; c.classList.add('flash-lit'); } }
  });
  view.querySelector('.stall-back').onclick = () => stall.select(null);
  $('#stallMode', el).onclick = () => { const m = stallMode() === '3d' ? '2d' : '3d'; setStallPref(m); renderHome(el); toast(m === '3d' ? 'The stall is 3D again: drag to walk round it' : 'Showing the painting: lighter on the battery'); };
  view.addEventListener('stall:slow', () => { const b = $('#stallMode', el); if (b) b.textContent = '3D'; toast('Switched to the painting so your phone stays cool. Tap 3D to try again.'); });
  stall.attach(view, {
    onSelect: id => { paint(); lit(id); },
    onHover: id => { $$('.sc-row,.sc-chip', card).forEach(b => b.classList.toggle('hov', b.dataset.slot === id)); },
  });
  const tags = () => stall.setTags(stallTags(H), todayMoves(H));
  tags(); paint(); lit(stall.sel);

  topOpportunities(20).then(list => {
    H.opps = list; tags(); if (!stall.sel || stall.sel === 'opps') paint();
    const box = $('#homeOpps', el); if (!box) return;
    list = list.slice(0, low ? 1 : 3);
    box.innerHTML = list.length ? list.map((o, i) => { const V = VERDICT[o.an.verdict]; return `
      <a class="opp" href="#/radar/item/${encodeURIComponent(o.id)}" style="text-decoration:none;color:inherit"><div class="opp-main"><h3>${esc(o.title)}</h3>
      <div class="meta">${esc(o.org || o.source || '')} ${o.an.deadline ? '· closes ' + fmtDate(o.an.deadline) : ''}</div>
      <div class="why"><span class="chip v ${V.cls}">${V.icon} ${V.label}</span> ${esc((o.an.verdictText || '').slice(0, 120))}</div></div>
      <div class="acts"><span class="pri ${o.priority >= 68 ? 'p-top' : o.priority >= 50 ? 'p-good' : o.priority >= 34 ? 'p-maybe' : 'p-low'}" title="Priority for you, out of 99">${o.priority}</span></div></a>`; }).join('')
      : `<div class="empty">No compiled opportunities yet. Once the daily robot runs on GitHub, matches appear here. Meanwhile, use <a href="#/radar/search">one-tap searches</a>.</div>`;
  }).catch(() => { H.opps = []; tags(); paint(); });
  paperOfDay().then(p => {
    H.paper = p || null; tags(); if (!stall.sel || stall.sel === 'paper') paint();
    const box = $('#homePaper', el); if (!box) return;
    if (!p) { box.innerHTML = `<p>Couldn't reach Europe PMC right now. <a href="#/read">Open the reading room</a>.</p>`; return; }
    box.innerHTML = `<h3 style="margin:2px 0 4px">${esc(p.title)}</h3><p class="muted" style="margin:0 0 10px">${esc(p.journal || '')} · ${esc(p.year || '')} · open access review</p>
    <div class="row"><a class="btn" href="#/read/paper/${encodeURIComponent(p.key)}">Read the digest</a></div>`;
  }).catch(() => { H.paper = null; tags(); paint(); });
}

function renderSettings(el) {
  const s = S();
  el.innerHTML = `
  <div class="eyebrow">Settings</div><h1>Your profile &amp; data</h1>
  <p class="lede">Cornelieur uses these words to score opportunities and pick papers. Nothing is sent anywhere — it all lives in this browser.</p>
  <div class="grid g2">
    <section class="card">
      <h2>Profile</h2>
      <label class="f">Name</label><input type="text" id="pName" value="${esc(s.profile.name)}">
      <label class="f">Keywords that describe what you want (comma separated)</label>
      <textarea id="pKw" rows="5">${esc(s.profile.keywords.join(', '))}</textarea>
      <label class="f">Words that make an opportunity NOT for you</label>
      <input type="text" id="pAvoid" value="${esc(s.profile.avoid.join(', '))}">
      <label class="f">Reading interests (used for paper of the day — Europe PMC search syntax)</label>
      <input type="text" id="pRead" value="${esc(s.profile.readingInterests)}">
      <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pIndo" ${s.profile.indonesian ? 'checked' : ''}> Show Indonesian-citizen routes (LPDP and similar)</label>
      <div class="spacer"></div><button class="btn" id="saveProfile">Save profile</button>
    </section>
    <section class="card" id="driveCard">
      <h2>Google Drive</h2>
      <div id="driveBody"></div>
    </section>
    <section class="card">
      <h2>Appearance</h2>
      <p class="muted" style="margin-top:0">Night mode is easier on the eyes in the evening.</p>
      <div class="seg" id="themeSeg" style="--rd-line:var(--line);--rd-fg:var(--ink);--rd-acc:var(--indigo)">${[['auto', '🌗 Follow phone'], ['light', '☀️ Light'], ['dark', '🌙 Night']].map(([v, l]) => `<button data-v="${v}" class="${themePref() === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h2>Back up &amp; move devices</h2>
      <p class="muted">Your progress is saved in this browser only. Download a backup now and then, and load it on another laptop or phone.</p>
      <div class="row"><button class="btn soft" id="exp">Download backup</button>
      <label class="btn ghost" style="cursor:pointer">Load backup<input type="file" id="imp" accept=".json" hidden></label></div>
      <hr>
      <h3>Start over</h3>
      <p class="muted">Clears lessons, XP, tracker and saved papers in this browser.</p>
      <button class="btn ghost" id="reset" style="color:var(--bad);border-color:var(--bad)">Reset everything</button>
      <hr>
      <h3>About Cornelieur <small class="muted">v2.1 · 27 Nov 2026</small></h3>
      <p class="muted" style="font-size:13.5px">Built for Ocha by Ejak (with Claude). Opportunity data is compiled daily by a GitHub robot from public feeds and the Home Office sponsor register. Papers come from Europe PMC. R and Python run inside the browser (webR and Pyodide), so nothing needs installing to start. The flower stall on Today is your own watercolour, rebuilt in 3D.</p>
    </section>
  </div>`;
  $$('#themeSeg button').forEach(b => b.onclick = () => { localStorage.setItem(THEME_KEY, b.dataset.v); applyTheme(); $$('#themeSeg button').forEach(x => x.classList.toggle('on', x === b)); });
  driveCard();
  $('#saveProfile').onclick = () => {
    const split = v => v.split(',').map(x => x.trim()).filter(Boolean);
    s.profile.name = $('#pName').value.trim() || 'Ocha';
    s.profile.keywords = split($('#pKw').value);
    s.profile.avoid = split($('#pAvoid').value);
    s.profile.readingInterests = $('#pRead').value.trim();
    s.profile.indonesian = $('#pIndo').checked;
    save(); toast('Profile saved');
  };
  $('#exp').onclick = () => download(`cornelieur-backup-${today()}.json`, JSON.stringify(S(), null, 1));
  $('#imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { replaceState(JSON.parse(await f.text())); toast('Backup loaded'); route(); } catch (_) { toast('That file is not a Cornelieur backup'); }
  };
  $('#reset').onclick = () => { if (confirm('Reset all Cornelieur data in this browser?')) { resetState(); toast('Reset done'); route(); } };
}

/* ---- Google Drive card in Settings + one-tap connect link ---- */
function driveCard() {
  const box = $('#driveBody'); if (!box) return;
  const c = driveCfg();
  box.innerHTML = `<p class="muted" style="margin-top:0">Your Drive folder is where everything you upload and everything Cornelieur writes is kept, so it is the same on your phone and laptop.</p>
    <div class="drive-state" id="dState"><span class="dot ${c ? '' : 'bad'}"></span>${c ? 'Checking the connection…' : 'Not connected yet'}</div>
    <label class="f">Web app URL (from the Apps Script)</label><input type="text" id="dUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c ? c.url : '')}">
    <label class="f">Passcode</label><input type="text" id="dKey" placeholder="the passcode you chose in the script" value="${esc(c ? c.key : '')}" autocomplete="off">
    <label class="f" style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="dSync" ${!c || c.sync !== false ? 'checked' : ''}> Keep my progress in sync between devices</label>
    <div class="row" style="margin-top:10px"><button class="btn" id="dSave">Save &amp; test</button>
      ${c ? '<button class="btn soft" id="dPush">Save progress to Drive now</button><button class="btn ghost" id="dPull">Load progress from Drive</button><button class="btn ghost" id="dOff" style="color:var(--bad);border-color:var(--bad)">Disconnect</button>' : ''}</div>
    ${c ? `<p class="muted" style="font-size:12.5px;margin:12px 0 0">Setting up another device? Open this link there once: <button class="btn sm ghost" id="dLink">Copy connect link</button><br>Anyone with the link can use your Drive folder through Cornelieur, so only send it to yourself.</p>` : ''}`;
  const state = $('#dState');
  if (c) ping().then(r => { state.innerHTML = `<span class="dot ok"></span>Connected to “${esc(r.root)}”`; }).catch(e => { state.innerHTML = `<span class="dot bad"></span>${esc(e.message)}`; });
  $('#dSave').onclick = async () => {
    const url = $('#dUrl').value.trim(), key = $('#dKey').value.trim();
    if (!/^https:\/\/script\.google\.com\//.test(url) || !key) return toast('Paste the Web app URL (starts with https://script.google.com) and the passcode');
    setDriveCfg({ url, key, sync: $('#dSync').checked });
    try { const r = await ping(); toast('Connected to ' + r.root); } catch (e) { setDriveCfg(null); toast(e.message); }
    renderSettings(app);
  };
  const off = $('#dOff'); if (off) off.onclick = () => { if (confirm('Disconnect Drive on this device? Nothing is deleted from Drive.')) { setDriveCfg(null); renderSettings(app); } };
  const push = $('#dPush'); if (push) push.onclick = () => pushState(true);
  const pull = $('#dPull'); if (pull) pull.onclick = async () => {
    try { const j = await pullState(); if (!j) return toast('Nothing saved in Drive yet'); if (confirm('Replace this device\'s progress with the version saved on ' + new Date(j.updatedAt).toLocaleString('en-GB') + '?')) { replaceState(j.state); toast('Loaded'); location.reload(); } } catch (e) { toast(e.message); }
  };
  const lk = $('#dLink'); if (lk) lk.onclick = () => copyText(location.origin + location.pathname + '#/connect/' + btoa(unescape(encodeURIComponent(JSON.stringify({ u: c.url, k: c.key })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}
function connectLink(code) {
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(String(code || '').replace(/-/g, '+').replace(/_/g, '/')))));
    if (!/^https:\/\/script\.google\.com\//.test(j.u) || !j.k) throw new Error('bad');
    setDriveCfg({ url: j.u, key: j.k, sync: true });
    history.replaceState(null, '', location.pathname + '#/settings');
    toast('Google Drive connected on this device'); route(); initSync();
  } catch (_) { location.hash = '#/settings'; toast('That connect link did not work. Paste the URL and passcode in Settings.'); }
}

route();
initSync();
