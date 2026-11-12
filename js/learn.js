import { S, save, esc, $, $$, toast, addXP, today } from './util.js';
import { UNITS, ALL_LESSONS } from './lessons.js';
import * as CR from './coderunner.js';
import { randomJoke } from './jokes.js';

/* ---------------- progress helpers ---------------- */
const isDone = id => !!S().lessons[id]?.done;
function isOpen(lesson) {
  const u = UNITS.find(u => u.lessons.some(l => l.id === lesson.id));
  const i = u.lessons.findIndex(l => l.id === lesson.id);
  return i === 0 || isDone(u.lessons[i - 1].id) || isDone(lesson.id);
}
export function nextLesson() {
  for (const u of UNITS) for (const l of u.lessons) if (!isDone(l.id) && isOpen(l)) return { unit: u, lesson: l, started: !!S().lessons[l.id] };
  return null;
}
export function reviewCount() { return S().review.length; }

/* ---------------- path view ---------------- */
export function renderLearn(el) {
  const total = ALL_LESSONS.length, done = ALL_LESSONS.filter(l => isDone(l.id)).length;
  const rc = reviewCount();
  el.innerHTML = `
  <div class="eyebrow">Learn</div><h1>From pharmacy to data science, one small step at a time</h1>
  <p class="lede">Each lesson takes about 5 minutes. R and Python run right inside these pages — you can start without installing anything. Every unit's first lesson is open, so jump straight to R or Python if you like.</p>
  <div class="grid g3">
    <div class="card"><div class="eyebrow">Your path</div><b style="font-family:var(--serif);font-size:26px;color:var(--forest)">${done}/${total}</b> lessons
      <div class="progress" style="margin-top:8px"><i style="width:${done / total * 100}%"></i></div></div>
    <a class="card water" href="#/setup" style="text-decoration:none;color:inherit"><div class="eyebrow">Ready for the real thing?</div><b style="color:var(--forest)">Set up R, Python or jamovi on your laptop →</b><br><small class="muted">Easiest options first, with official download links.</small></a>
    ${rc ? `<a class="card dew" href="#/lesson/review" style="text-decoration:none;color:inherit"><div class="eyebrow">Spaced review</div><b style="color:var(--forest)">${rc} question${rc > 1 ? 's' : ''} to revisit →</b><br><small class="muted">Things you missed come back until they stick.</small></a>`
      : `<div class="card dew"><div class="eyebrow">Spaced review</div><b style="color:var(--forest)">Nothing to review</b><br><small class="muted">Questions you miss will collect here.</small></div>`}
  </div>
  <div class="path">${UNITS.map(u => `
    <div class="unit"><div class="row between"><h2>${u.icon} ${esc(u.title)}</h2><small>${u.lessons.filter(l => isDone(l.id)).length}/${u.lessons.length}</small></div><small>${esc(u.blurb)}</small></div>
    <div class="nodes">${u.lessons.map(l => {
      const cls = isDone(l.id) ? 'done' : isOpen(l) ? 'open' : 'locked';
      const ic = cls === 'done' ? '✓' : cls === 'locked' ? '🔒' : l.steps.some(s => s.t === 'code') ? '⌨' : '★';
      return `<a class="node ${cls}" href="#/lesson/${l.id}"><span class="disc">${ic}</span><span><b>${esc(l.title)}</b><small class="muted">${esc(l.blurb || '')}${S().lessons[l.id]?.best != null ? ` · best ${S().lessons[l.id].best}%` : ''}</small></span></a>`;
    }).join('')}</div>`).join('')}
  </div>
  <div class="spacer"></div>
  <section class="card"><h2>Keep going beyond Cornelieur</h2><p class="muted">Free, high-quality next steps once the path feels easy:</p>
  <div class="linkgrid">
    ${[['R for Data Science (2e)', 'The friendliest real R book — free online.', 'https://r4ds.hadley.nz/'],
      ['Software Carpentry: R for reproducible science', 'Lessons written for scientists.', 'https://swcarpentry.github.io/r-novice-gapminder/'],
      ['Kaggle Learn', 'Short Python, pandas and ML courses with in-browser notebooks.', 'https://www.kaggle.com/learn'],
      ['Bioconductor', 'R packages and courses for omics data.', 'https://www.bioconductor.org/help/course-materials/'],
      ['PHUSE', 'Community for clinical data science and R in pharma.', 'https://phuse.global/'],
      ['R/Pharma', 'Conference talks on R in the pharmaceutical industry (free videos).', 'https://rinpharma.com/']]
      .map(([t, d, u]) => `<a class="linkcard" href="${u}" target="_blank" rel="noopener"><b>${t} ↗</b><small class="muted">${d}</small></a>`).join('')}
  </div></section>`;
}

/* ---------------- lesson runner ---------------- */
export async function renderLesson(el, id) {
  let lesson, isReview = id === 'review';
  if (isReview) {
    const items = S().review.slice(0, 8).map(r => {
      const l = ALL_LESSONS.find(x => x.id === r.lesson); const st = l?.steps[r.idx];
      return st ? { ...st, _ref: r } : null;
    }).filter(Boolean);
    if (!items.length) { location.hash = '#/learn'; return; }
    lesson = { id: 'review', title: 'Spaced review', steps: items };
  } else {
    lesson = ALL_LESSONS.find(l => l.id === id);
    if (!lesson) { el.innerHTML = '<div class="empty">Lesson not found. <a href="#/learn">Back to path</a></div>'; return; }
  }
  // fresh environments so earlier exercises don't leak
  if (CR.rStatus() === 'ready') await CR.resetR();
  if (CR.pyStatus() === 'ready') await CR.resetPy();

  const queue = lesson.steps.map((_, i) => i);
  const firstTry = {}; const retried = new Set();
  let pos = 0;
  const questions = lesson.steps.filter(s => s.t !== 'learn').length;

  el.innerHTML = `<div class="lesson">
    <div class="lesson-top"><a href="#/learn" title="Leave lesson">✕</a><div class="progress"><i id="lp" style="width:0%"></i></div><span class="muted" id="lcount"></span></div>
    <div id="stepBox"></div>
    <div class="lesson-foot"><button class="btn ghost" id="skipBtn">Skip</button><button class="btn big" id="mainBtn">Continue</button></div>
  </div>`;
  const box = $('#stepBox', el), main = $('#mainBtn', el), skip = $('#skipBtn', el);

  const finish = () => {
    const correct = Object.values(firstTry).filter(Boolean).length;
    const pct = questions ? Math.round(correct / questions * 100) : 100;
    const xp = 10 + correct * 2;
    addXP(xp);
    if (!isReview) {
      const prev = S().lessons[lesson.id];
      S().lessons[lesson.id] = { done: true, best: Math.max(pct, prev?.best || 0), at: today() };
      // add missed (non-code) questions to spaced review
      lesson.steps.forEach((s, i) => {
        if (s.t !== 'learn' && s.t !== 'code' && firstTry[i] === false && !S().review.some(r => r.lesson === lesson.id && r.idx === i))
          S().review.push({ lesson: lesson.id, idx: i });
      });
    }
    save();
    window.dispatchEvent(new Event('compass:stats'));
    const nl = nextLesson();
    el.innerHTML = `<div class="lesson"><div class="card celebrate">
      <div class="big">${pct >= 80 ? '🌟' : pct >= 50 ? '🌱' : '💪'}</div>
      <h2>${isReview ? 'Review done' : 'Lesson complete'}</h2>
      <div class="xp">+${xp} XP</div>
      <p class="muted">${questions ? `${correct} of ${questions} right first time (${pct}%).` : ''} ${pct < 60 ? 'Missed questions will come back in review — that is how it sticks.' : 'Lovely work.'}</p>
      <p class="muted" style="font-style:italic">💊 ${esc(randomJoke())}</p>
      <div class="row" style="justify-content:center">${nl ? `<a class="btn big" href="#/lesson/${nl.lesson.id}">Next: ${esc(nl.lesson.title)} →</a>` : ''}<a class="btn ghost" href="#/learn">Back to path</a></div>
    </div></div>`;
  };

  const show = () => {
    if (pos >= queue.length) return finish();
    const i = queue[pos], st = lesson.steps[i];
    $('#lp', el).style.width = (pos / queue.length * 100) + '%';
    $('#lcount', el).textContent = `${pos + 1}/${queue.length}`;
    skip.style.visibility = st.t === 'learn' ? 'hidden' : 'visible';
    box.innerHTML = '';
    const step = document.createElement('div'); step.className = 'step'; box.appendChild(step);
    const done = (ok) => {
      if (st.t !== 'learn' && !(i in firstTry)) firstTry[i] = ok;
      if (isReview && ok && st._ref) { S().review = S().review.filter(r => !(r.lesson === st._ref.lesson && r.idx === st._ref.idx)); save(); }
      if (!ok && !retried.has(i) && st.t !== 'code') { retried.add(i); queue.push(i); }
      main.textContent = 'Continue'; main.disabled = false;
      main.onclick = () => { pos++; show(); };
    };
    skip.onclick = () => { if (!(i in firstTry)) firstTry[i] = false; pos++; show(); };
    STEP[st.t](step, st, main, done, i);
  };
  show();
}

function feedback(step, ok, why, extra = '') {
  const f = document.createElement('div');
  f.className = 'feedback ' + (ok ? 'ok' : 'no');
  f.innerHTML = `<b>${ok ? pick(['Nice!', 'Exactly.', 'Spot on.', 'Yes!', 'Great.']) : 'Not quite.'}</b>${why || ''}${extra}`;
  step.appendChild(f);
  f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const STEP = {
  mcq(step, st, main, done) {
    const order = shuffle(st.options.map((o, k) => k));
    step.innerHTML = `<div class="prompt">${st.q}</div><div class="opts">${order.map(k => `<button class="opt" data-k="${k}">${st.options[k]}</button>`).join('')}</div>`;
    let sel = null;
    main.textContent = 'Check'; main.disabled = true;
    $$('.opt', step).forEach(b => b.onclick = () => { if (main.textContent !== 'Check') return; $$('.opt', step).forEach(x => x.classList.remove('sel')); b.classList.add('sel'); sel = +b.dataset.k; main.disabled = false; });
    main.onclick = () => {
      const ok = sel === st.a;
      $$('.opt', step).forEach(b => { if (+b.dataset.k === st.a) b.classList.add('right'); else if (+b.dataset.k === sel) b.classList.add('wrong'); });
      feedback(step, ok, st.why ? ' ' + st.why : ''); done(ok);
    };
  },
  fill(step, st, main, done) {
    step.innerHTML = `<div class="prompt">${st.q}</div><input type="text" id="fillIn" placeholder="Type your answer" autocomplete="off">`;
    const inp = $('#fillIn', step); inp.focus();
    main.textContent = 'Check'; main.disabled = true;
    inp.oninput = () => main.disabled = !inp.value.trim();
    const check = () => {
      const v = inp.value.trim().toLowerCase().replace(/[.\s]+$/, '');
      const ok = st.answers.some(a => a.toLowerCase() === v);
      inp.disabled = true;
      feedback(step, ok, ' ' + (ok ? '' : `Answer: <b>${esc(st.answers[0])}</b>. `) + (st.why || '')); done(ok);
    };
    inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim() && !inp.disabled) check(); };
    main.onclick = check;
  },
  order(step, st, main, done) {
    const pool = shuffle(st.items.map((t, k) => k));
    const ans = [];
    step.innerHTML = `<div class="prompt">${st.q}</div><div class="order-ans" id="oa"></div><div class="order-pool" id="op"></div><small class="muted">Tap items in order. Tap a placed item to send it back.</small>`;
    const draw = () => {
      $('#oa', step).innerHTML = ans.map(k => `<button class="opt" data-k="${k}">${esc(st.items[k])}</button>`).join('') || '<span class="muted" style="padding:6px">…</span>';
      $('#op', step).innerHTML = pool.filter(k => !ans.includes(k)).map(k => `<button class="opt" data-k="${k}">${esc(st.items[k])}</button>`).join('');
      $$('#oa .opt', step).forEach(b => b.onclick = () => { if (main.textContent !== 'Check') return; ans.splice(ans.indexOf(+b.dataset.k), 1); draw(); });
      $$('#op .opt', step).forEach(b => b.onclick = () => { ans.push(+b.dataset.k); draw(); });
      main.disabled = ans.length !== st.items.length;
    };
    main.textContent = 'Check'; draw();
    main.onclick = () => {
      const ok = ans.every((k, idx) => k === idx);
      $$('#oa .opt', step).forEach((b, idx) => b.classList.add(+b.dataset.k === idx ? 'right' : 'wrong'));
      feedback(step, ok, ' ' + (ok ? '' : `Correct order: ${st.items.map(esc).join(' → ')}. `) + (st.why || '')); done(ok);
    };
  },
  code(step, st, main, done) {
    const isR = st.lang === 'r';
    step.innerHTML = `
      <div class="prompt" style="font-size:18px">${st.task}</div>
      <div class="editor"><div class="editor-head"><span>${isR ? 'R' : 'Python'} · runs in your browser</span><span><button class="btn sm soft" id="run">▶ Run</button></span></div>
      <textarea id="code" spellcheck="false" aria-label="Code editor">${esc(st.starter || '')}</textarea></div>
      <div class="row" style="margin-top:8px"><button class="btn sm ghost" id="hint">💡 Hint</button><button class="btn sm ghost" id="sol">Show solution</button><button class="btn sm ghost" id="resetCode">Reset code</button><span class="muted" id="status" style="font-size:13px"></span></div>
      <div class="console" id="out"><span class="muted">Output appears here. Shortcut: Ctrl/⌘ + Enter runs the code.</span></div>`;
    const ta = $('#code', step), out = $('#out', step), status = $('#status', step);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); main.click(); }
    });
    $('#hint', step).onclick = () => toast(st.hint || 'Read the task again — the starter code shows the shape.');
    $('#sol', step).onclick = () => { ta.value = st.solution || ta.value; };
    $('#resetCode', step).onclick = () => { ta.value = st.starter || ''; };
    const msg = m => status.textContent = m;
    let finished = false;
    const run = async (andCheck) => {
      main.disabled = true; $('#run', step).disabled = true;
      out.innerHTML = '<span class="muted">Running…</span>';
      try {
        const runner = isR ? CR.runR : CR.runPy;
        const opts = { onMsg: msg, packages: st.packages || [] };
        if (st.setup) { const r0 = await runner(st.setup, opts); if (r0.error) throw new Error('Setup failed: ' + r0.error); }
        const res = await runner(ta.value, opts);
        CR.paint(out, res); msg('');
        if (andCheck && !finished) {
          let ok = !res.error;
          if (ok && st.check) ok = isR ? await CR.checkR(st.check) : await CR.checkPy(st.check);
          if (ok) { finished = true; feedback(step, true, ' Your code works.'); done(true); return; }
          feedback(step, false, res.error ? ' There is an error above — read the last line, it usually says what is wrong.' : ' It ran, but the result isn\'t quite what the task asks. Try the hint.');
          setTimeout(() => step.querySelector('.feedback.no')?.remove(), 6000);
        }
      } catch (e) {
        out.innerHTML = `<span class="err">Couldn't start ${isR ? 'R' : 'Python'}: ${esc(e.message)}</span>\n<span class="muted">This needs an internet connection the first time (and a recent Chrome, Edge, Safari or Firefox). You can press Skip and come back later.</span>`;
        msg('');
      }
      $('#run', step).disabled = false; if (!finished) main.disabled = false;
    };
    $('#run', step).onclick = () => run(false);
    main.textContent = 'Run & check'; main.disabled = false;
    main.onclick = () => run(true);
  },
};
// learn steps: 'Got it' marks done, then advances
STEP.learn = (step, st, main, done) => {
  step.innerHTML = `<div class="card"><h2>${st.title}</h2><div class="learn-body">${st.body}</div></div>`;
  main.textContent = 'Got it →'; main.disabled = false;
  main.onclick = () => { done(true); main.click(); };
};

/* ---------------- laptop setup guides ---------------- */
const GUIDES = [
  {
    id: 'browser', level: 'Start here', title: 'No install at all', time: '0 minutes',
    why: 'Perfect while learning. Cornelieur already runs R and Python in the browser; these two give you a full environment online with a free account.',
    items: [
      { name: 'Posit Cloud (RStudio in your browser)', url: 'https://posit.cloud/', steps: ['Sign up free (Google login works).', 'Click New Project → New RStudio Project.', 'Type code in the Console at the bottom left.'] },
      { name: 'Google Colab (Python notebooks)', url: 'https://colab.research.google.com/', steps: ['Sign in with your Google account.', 'File → New notebook.', 'Type Python in a cell and press Shift + Enter. pandas and scikit-learn are already installed.'] },
    ],
  },
  {
    id: 'jamovi', level: 'Level 1', title: 'jamovi — SPSS-style statistics, free', time: '5 minutes',
    why: 'Point-and-click t-tests, ANOVA, regression and charts, with a spreadsheet view — like SPSS but free and built on R. It can even show the R code behind each analysis.',
    items: [{
      name: 'jamovi desktop', url: 'https://www.jamovi.org/download.html',
      mac: ['Open the download page and choose the macOS version (pick "Apple Silicon" for M1/M2/M3/M4 Macs, "Intel" for older).', 'Open the downloaded .dmg and drag jamovi into Applications.', 'First launch: right-click jamovi → Open, then confirm (macOS asks once for apps from the internet).'],
      win: ['Open the download page and choose the Windows installer.', 'Run the .exe and accept the defaults.', 'Start jamovi from the Start menu.'],
    }],
  },
  {
    id: 'r', level: 'Level 2', title: 'R + RStudio — the standard setup', time: '10 minutes',
    why: 'What most labs and many pharma statisticians use. Install R first (the engine), then RStudio (the friendly window around it).',
    items: [
      {
        name: '1 · R (the language)', url: 'https://cran.r-project.org/',
        mac: ['Go to cran.r-project.org → Download R for macOS.', 'Choose the .pkg for your chip: "arm64" for Apple Silicon (M-series), "x86_64" for Intel. (Apple menu → About This Mac tells you.)', 'Open the .pkg and click through the installer.'],
        win: ['Go to cran.r-project.org → Download R for Windows → base → Download R for Windows.', 'Run the .exe with default options.'],
        direct: { mac: 'https://cran.r-project.org/bin/macosx/', win: 'https://cran.r-project.org/bin/windows/base/' },
      },
      {
        name: '2 · RStudio Desktop (the editor)', url: 'https://posit.co/download/rstudio-desktop/',
        mac: ['On the Posit page the button already offers the macOS .dmg.', 'Open the .dmg and drag RStudio to Applications.', 'Open RStudio — it finds R automatically.'],
        win: ['On the Posit page the button already offers the Windows installer.', 'Run it with default options, then open RStudio.'],
      },
      {
        name: '3 · Your first packages', url: 'https://r4ds.hadley.nz/intro.html#prerequisites',
        mac: ['In the RStudio Console paste:  install.packages(c("tidyverse", "drc", "PKNCA"))', 'Wait for "DONE". Then library(tidyverse) loads it.'],
        win: ['In the RStudio Console paste:  install.packages(c("tidyverse", "drc", "PKNCA"))', 'Wait for "DONE". Then library(tidyverse) loads it.'],
      },
    ],
  },
  {
    id: 'python', level: 'Level 3', title: 'Python for data science & ML', time: '15 minutes',
    why: 'Anaconda bundles Python with Jupyter, pandas and scikit-learn, so beginners avoid installing pieces one by one.',
    items: [
      {
        name: 'Anaconda Distribution', url: 'https://www.anaconda.com/download',
        mac: ['On the download page you can skip the registration (look for the "skip registration" link) and choose the macOS Apple Silicon or Intel installer.', 'Open the .pkg and install for "Just me".', 'Open "Anaconda Navigator" from Applications → launch JupyterLab.'],
        win: ['Choose the Windows 64-bit installer on the download page (registration can be skipped).', 'Install for "Just me"; keep recommended options.', 'Open "Anaconda Navigator" from the Start menu → launch JupyterLab.'],
      },
      {
        name: 'Optional · VS Code or Positron (code editors)', url: 'https://code.visualstudio.com/download',
        mac: ['VS Code: download the macOS Universal build, unzip, drag to Applications. Add the "Python" and "Jupyter" extensions.', 'Positron (by the RStudio team, handles both R and Python): positron.posit.co.'],
        win: ['VS Code: download the Windows User Installer and run it. Add the "Python" and "Jupyter" extensions.', 'Positron (by the RStudio team, handles both R and Python): positron.posit.co.'],
      },
    ],
  },
];

export function renderSetup(el) {
  let os = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? 'mac' : 'win';
  const draw = () => {
    el.innerHTML = `
    <a href="#/learn" class="muted" style="text-decoration:none">← Learn</a>
    <div class="eyebrow" style="margin-top:10px">Laptop setup</div><h1>Install only what you need, easiest first</h1>
    <p class="lede">Links go to the official download pages, which always carry the latest version (direct file links break whenever a new version comes out). You can stay on "Start here" for weeks — move up when a lesson or job asks for it.</p>
    <div class="row" style="margin-bottom:16px"><span class="muted">I'm on:</span><div class="os-switch"><button data-os="mac" class="${os === 'mac' ? 'on' : ''}"> Mac</button><button data-os="win" class="${os === 'win' ? 'on' : ''}">⊞ Windows</button></div></div>
    ${GUIDES.map(g => `
      <section class="card" style="margin-bottom:14px">
        <div class="row between"><div><div class="eyebrow">${g.level} · ${g.time}</div><h2 style="margin:0">${g.title}</h2></div></div>
        <p class="muted">${g.why}</p>
        ${g.items.map(it => {
          const steps = it.steps || it[os] || [];
          const direct = it.direct?.[os];
          return `<details ${g.id === 'browser' || g.id === 'jamovi' ? 'open' : ''}><summary>${it.name}</summary>
            <ol class="steps" style="margin-top:8px">${steps.map(s => `<li style="font-size:14.5px">${esc(s)}</li>`).join('')}</ol>
            <div class="row" style="margin-top:6px"><a class="btn sm" href="${it.url}" target="_blank" rel="noopener">Open official page ↗</a>${direct ? `<a class="btn sm ghost" href="${direct}" target="_blank" rel="noopener">${os === 'mac' ? 'macOS' : 'Windows'} downloads ↗</a>` : ''}</div>
          </details>`;
        }).join('')}
      </section>`).join('')}
    <div class="card dew"><h3>If something goes wrong</h3><ul>
      <li><b>Mac says the app "can't be opened"</b> — right-click the app → Open → Open. Or System Settings → Privacy &amp; Security → "Open Anyway".</li>
      <li><b>Not sure if your Mac is Apple Silicon or Intel</b> — Apple menu → About This Mac → "Chip" (Apple M…) or "Processor" (Intel).</li>
      <li><b>RStudio can't find R</b> — install R first, then reopen RStudio.</li>
      <li><b>install.packages fails</b> — check Wi-Fi, then try again; choose any CRAN mirror if asked.</li>
      <li><b>University laptop?</b> SPSS, Stata or Prism may be available free through your university's software portal.</li>
    </ul></div>`;
    $$('[data-os]', el).forEach(b => b.onclick = () => { os = b.dataset.os; draw(); });
  };
  draw();
}
