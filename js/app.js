import { S, save, esc, $, $$, toast, streakAlive, today, download, replaceState, resetState, fmtDate, daysLeft } from './util.js';
import { renderRadar, topOpportunities, nextTrackerSteps } from './radar.js';
import { renderLearn, renderLesson, nextLesson, renderSetup, reviewCount } from './learn.js';
import { renderRead, paperOfDay } from './read.js';
import { jokeOfDay, randomJoke } from './jokes.js';

const app = document.getElementById('app');

function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const [page, ...rest] = hash.split('/');
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === page || (page === 'lesson' && a.dataset.nav === 'learn') || (page === 'setup' && a.dataset.nav === 'learn')));
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

  $('#jokeBtn', el).onclick = () => { $('#joke', el).textContent = randomJoke(); };
  $$('[data-energy]', el).forEach(b => b.onclick = () => { S().energy = b.dataset.energy; save(); renderHome(el); });

  topOpportunities(low ? 1 : 3).then(list => {
    const box = $('#homeOpps', el); if (!box) return;
    box.innerHTML = list.length ? list.map(o => `
      <div class="opp"><div><h3><a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.title)}</a></h3>
      <div class="meta">${esc(o.org || o.source || '')} ${o.deadline ? '· closes ' + fmtDate(o.deadline) : ''}</div>
      <div class="why">${(o.tags || []).slice(0, 4).map(t => `<span class="chip ${t.cls || ''}">${esc(t.label)}</span>`).join(' ')}</div></div>
      <div class="acts"><span class="score" title="Match score">${o.score}</span></div></div>`).join('')
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
      <h3>About Cornelieur</h3>
      <p class="muted" style="font-size:13.5px">Built for Ocha by Ejak (with Claude). Opportunity data is compiled daily by a GitHub robot from public feeds and the Home Office sponsor register. Papers come from Europe PMC. R and Python run inside the browser (webR and Pyodide), so nothing needs installing to start.</p>
    </section>
  </div>`;
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

route();
