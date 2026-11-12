import { S, save, esc, $, $$, toast, streakAlive, today, download, replaceState, resetState, fmtDate, daysLeft, copyText } from './util.js';
import { renderRadar, topOpportunities, nextTrackerSteps } from './radar.js';
import { renderLearn, renderLesson, nextLesson, renderSetup, reviewCount } from './learn.js';
import { renderRead, paperOfDay } from './read.js';
import { jokeOfDay, randomJoke } from './jokes.js';
import { renderFiles } from './files.js';
import { driveCfg, setDriveCfg, connected, ping, initSync, pushState, pullState } from './drive.js';
import { VERDICT } from './analyze.js';

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

async function renderHome(el) {
  const s = S();
  const low = s.energy === 'low';
  const nl = nextLesson();
  const rc = reviewCount();
  const steps = nextTrackerSteps(low ? 1 : 3);
  el.innerHTML = `
  <div class="hello">
    <div>
      <div class="eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>${greeting()}, ${esc(s.profile.name)}.</h1>
      <p class="muted" style="margin:0">${low ? 'Very-lieur mode: just one tiny thing from each corner today. That still counts.' : 'Three small moves today: one opportunity, one lesson, one paper.'}</p>
    </div>
    <div class="row">
      <button class="theme-btn" data-theme-btn type="button" aria-label="Switch light / night mode">${themeIcon()}</button>
      <div class="energy" role="group" aria-label="Energy today">
        <button data-energy="low" class="${low ? 'on' : ''}">🌙 Very lieur</button>
        <button data-energy="normal" class="${!low ? 'on' : ''}">☀ Less lieur</button>
      </div>
    </div>
  </div>
  <section class="card joke" style="margin-bottom:16px">
    <div class="joke-ico">💊</div>
    <div style="flex:1"><div class="eyebrow">Today's dose of lieur relief</div><p id="joke" style="margin:0;font-family:var(--serif);font-size:17px">${esc(jokeOfDay())}</p></div>
    <button class="btn sm soft" id="jokeBtn" type="button">Another dose</button>
  </section>
  <div class="statline" style="margin-bottom:20px">
    <div class="stat"><b>🔥 ${streakAlive()}</b><small>day streak</small></div>
    <div class="stat"><b>${s.xp}</b><small>XP total</small></div>
    <div class="stat"><b>${Object.values(s.lessons).filter(l => l.done).length}</b><small>lessons done</small></div>
    <div class="stat"><b>${s.tracker.length}</b><small>applications tracked</small></div>
    <div class="stat"><b>${s.papers.filter(p => p.status === 'done').length}</b><small>papers digested</small></div>
  </div>
  <div class="grid g2">
    <section class="card dark">
      <div class="eyebrow" style="color:var(--dew)">Learn · 5 minutes</div>
      ${nl ? `<h2>${esc(nl.lesson.title)}</h2><p class="muted">${esc(nl.unit.title)} — ${esc(nl.lesson.blurb || '')}</p>
      <div class="row"><a class="btn dew big" href="#/lesson/${nl.lesson.id}">${nl.started ? 'Continue' : 'Start'} lesson →</a>${rc ? `<a class="btn ghost" style="color:#fff;border-color:#fff" href="#/lesson/review">Review ${rc} missed</a>` : ''}</div>`
      : `<h2>Path complete 🎉</h2><p class="muted">You've finished every lesson. Replay any unit to keep it fresh.</p><a class="btn dew" href="#/learn">Open path</a>`}
    </section>
    <section class="card">
      <div class="row between"><div class="eyebrow">Next steps on your applications</div><a href="#/radar/tracker" class="btn sm ghost">Tracker</a></div>
      ${steps.length ? `<div>${steps.map(st => `<div class="check"><span class="pill-n">${st.days == null ? '•' : st.days < 0 ? '!' : st.days}</span><div><b style="color:var(--forest)">${esc(st.step)}</b><br><small>${esc(st.title)}${st.deadline ? ' · deadline ' + fmtDate(st.deadline) : ''}</small></div></div>`).join('')}</div>`
      : `<div class="empty">Nothing tracked yet. Save an opportunity from the radar and Cornelieur will break it into small steps.</div>`}
    </section>
  </div>
  <div class="spacer"></div>
  <section class="card">
    <div class="row between"><div><div class="eyebrow">Opportunity radar</div><h2 style="margin:0">Best matches right now</h2></div><div class="row"><a class="btn soft" href="#/radar/digest">5-minute digest</a><a class="btn ghost" href="#/radar">All</a></div></div>
    <div id="homeOpps"><p class="muted">Loading…</p></div>
  </section>
  <div class="spacer"></div>
  <section class="card dew">
    <div class="eyebrow">Paper of the day</div>
    <div id="homePaper"><p class="muted">Finding one open-access review in your interests…</p></div>
  </section>`;

  $('[data-theme-btn]', el).onclick = cycleTheme;
  $('#jokeBtn', el).onclick = () => { $('#joke', el).textContent = randomJoke(); };
  $$('[data-energy]', el).forEach(b => b.onclick = () => { S().energy = b.dataset.energy; save(); renderHome(el); });

  topOpportunities(low ? 1 : 3).then(list => {
    const box = $('#homeOpps', el); if (!box) return;
    box.innerHTML = list.length ? list.map((o, i) => { const V = VERDICT[o.an.verdict]; return `
      <a class="opp" href="#/radar/item/${encodeURIComponent(o.id)}" style="text-decoration:none;color:inherit"><div class="opp-main"><h3>${esc(o.title)}</h3>
      <div class="meta">${esc(o.org || o.source || '')} ${o.an.deadline ? '· closes ' + fmtDate(o.an.deadline) : ''}</div>
      <div class="why"><span class="chip v ${V.cls}">${V.icon} ${V.label}</span> ${esc((o.an.verdictText || '').slice(0, 120))}</div></div>
      <div class="acts"><span class="pri ${o.priority >= 68 ? 'p-top' : o.priority >= 50 ? 'p-good' : o.priority >= 34 ? 'p-maybe' : 'p-low'}" title="Priority for you, out of 99">${o.priority}</span></div></a>`; }).join('')
      : `<div class="empty">No compiled opportunities yet. Once the daily robot runs on GitHub, matches appear here. Meanwhile, use <a href="#/radar/search">one-tap searches</a>.</div>`;
  });
  paperOfDay().then(p => {
    const box = $('#homePaper', el); if (!box) return;
    if (!p) { box.innerHTML = `<p>Couldn't reach Europe PMC right now. <a href="#/read">Open the reading room</a>.</p>`; return; }
    box.innerHTML = `<h3 style="margin:2px 0 4px">${esc(p.title)}</h3><p class="muted" style="margin:0 0 10px">${esc(p.journal || '')} · ${esc(p.year || '')} · open access review</p>
    <div class="row"><a class="btn" href="#/read/paper/${encodeURIComponent(p.key)}">Read the digest</a></div>`;
  });
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
      <h3>About Cornelieur <small class="muted">v2.0 · 12 Nov 2026</small></h3>
      <p class="muted" style="font-size:13.5px">Built for Ocha by Ejak (with Claude). Opportunity data is compiled daily by a GitHub robot from public feeds and the Home Office sponsor register. Papers come from Europe PMC. R and Python run inside the browser (webR and Pyodide), so nothing needs installing to start.</p>
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
