// "My files": one place to drop anything (CV, transcripts, drafts, papers). Cornelieur reads it, works out what it is,
// files it in the right Google Drive folder, makes a phone-friendly Markdown copy, and lists it.
import { S, esc, $, $$, toast, today, loadScript, modal, fmtDate } from './util.js';
import { connected, call, putFile, putText, getText, getBlob, del, move, loadIndex, saveIndex, safeName, list as driveList } from './drive.js';
import { classify, niceTitle, CATS } from './classify.js';
import { pdfToMarkdown } from './pdf2md.js';
import { fmQuote, parseFrontMatter } from './md.js';
import { openReader } from './reader.js';
import { DIR_MAP } from './folders.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
let pdfjs = null;
async function getPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(PDFJS + 'pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; return pdfjs;
}
const MAX_ORIGINAL = 12 * 1024 * 1024;
const EXT = f => (f.name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const mimeOf = f => f.type || ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown' }[EXT(f)] || 'application/octet-stream');

/* ---------- reading a file into Markdown ---------- */
export async function fileToMarkdown(file, onStatus = () => {}) {
  const ext = EXT(file);
  if (ext === 'pdf') {
    onStatus('Reading the PDF…');
    const lib = await getPdfjs();
    const r = await pdfToMarkdown(lib, await file.arrayBuffer(), { onProgress: (p, n) => onStatus(`Reading page ${p} of ${n}…`) });
    if (r.scanned) throw new Error('This PDF looks like a scan (pictures of pages, no text). It needs OCR first: try Google Drive "Open with → Google Docs", or the Pindai app.');
    return { md: r.md, title: r.title, text: r.text, pages: r.pages };
  }
  if (ext === 'docx') {
    onStatus('Reading the Word file…');
    await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
    const r = await window.mammoth.convertToMarkdown({ arrayBuffer: await file.arrayBuffer() });
    const md = r.value.replace(/\\([.\-()#*_>])/g, '$1').replace(/__([^_]+)__/g, '**$1**').trim();
    return { md, title: (/^#\s+(.+)$/m.exec(md) || [])[1] || '', text: md, pages: Math.max(1, Math.round(md.length / 3000)) };
  }
  if (['txt', 'md', 'markdown'].includes(ext)) {
    const t = await file.text();
    return { md: t, title: (/^#\s+(.+)$/m.exec(t) || [])[1] || '', text: t, pages: Math.max(1, Math.round(t.length / 3000)) };
  }
  throw new Error(`I can read PDF, Word (.docx), .txt and .md files. "${file.name}" is a .${ext || '?'} file. Tip: save it as PDF first.`);
}

function buildDoc({ file, conv, cls, title }) {
  const front = ['---', 'type: document', `title: ${fmQuote(title)}`, `category: ${CATS[cls.cat].label}`, cls.topic ? `topic: ${fmQuote(cls.topic)}` : null,
    `source-file: ${fmQuote(file.name)}`, `pages: ${conv.pages}`, `filed: ${today()}`, '---', ''].filter(x => x !== null).join('\n');
  let body = conv.md.trim();
  if (!/^#\s/.test(body)) body = `# ${title}\n\n${body}`;
  return front + '\n' + body + '\n';
}
const snippetOf = md => { const { body } = parseFrontMatter(md); const t = body.replace(/^#.*$/gm, '').replace(/[*_`>|-]+/g, ' ').replace(/\s+/g, ' ').trim(); return t.slice(0, 170); };

/** Full pipeline for one file. Returns {entry|null, md, title, cls, saved:boolean, duplicate?:true} */
export async function ingestFile(file, { onStatus = () => {}, forceCat } = {}) {
  const conv = await fileToMarkdown(file, onStatus);
  onStatus('Working out what this is…');
  let cls = classify(file.name, conv.text, conv.pages);
  if (forceCat && CATS[forceCat]) cls = { ...cls, cat: forceCat, topic: forceCat === 'paper' ? cls.topic || 'General' : '', folder: forceCat === 'paper' ? `${DIR_MAP.papers}/${cls.topic || 'General'}` : DIR_MAP[forceCat], reasons: 'chosen by you' };
  const title = niceTitle(file.name, conv.title, cls.cat);
  const md = buildDoc({ file, conv, cls, title });
  if (!connected()) return { entry: null, md, title, cls, saved: false };
  const idx = await loadIndex();
  const dup = idx.files.find(f => f.orig === file.name && f.size === file.size);
  if (dup) return { entry: dup, md, title, cls: { ...cls, cat: dup.cat }, saved: true, duplicate: true };
  const base = `${today()} ${safeName(cls.cat === 'paper' ? title : file.name.replace(/\.[a-z0-9]+$/i, ''))}`.slice(0, 100);
  const ext = EXT(file);
  const fPath = `${cls.folder}/${base}.${ext}`, mPath = `${cls.folder}/${base}.md`;
  onStatus('Saving to your Drive…');
  const entry = { id: Math.random().toString(36).slice(2, 10), title, cat: cls.cat, topic: cls.topic, folder: cls.folder, file: fPath, md: mPath, orig: file.name, size: file.size, pages: conv.pages, added: today(), snippet: snippetOf(md), why: cls.reasons };
  if (file.size <= MAX_ORIGINAL) { const info = await putFile(fPath, file, mimeOf(file)); entry.url = info.url; } else entry.file = '';
  const mi = await putText(mPath, md, 'text/markdown'); entry.mdUrl = mi.url;
  idx.files.unshift(entry); idx.updated = Date.now(); await saveIndex(idx);
  return { entry, md, title, cls, saved: true, tooBig: file.size > MAX_ORIGINAL };
}

/* ---------- small offline cache of recently read Markdown (so a phone can reopen without signal) ---------- */
const MDC = 'cornelieur.mdcache';
function cacheGet(path) { try { return (JSON.parse(localStorage.getItem(MDC) || '{}')[path] || {}).md || null; } catch (_) { return null; } }
function cachePut(path, md) {
  try {
    const o = JSON.parse(localStorage.getItem(MDC) || '{}'); o[path] = { md, t: Date.now() };
    let keys = Object.keys(o).sort((a, b) => o[b].t - o[a].t); let total = 0;
    const keep = {}; for (const k of keys) { total += o[k].md.length; if (Object.keys(keep).length < 10 && total < 1500000) keep[k] = o[k]; }
    localStorage.setItem(MDC, JSON.stringify(keep));
  } catch (_) {}
}
export async function readEntry(entry) {
  let md = null;
  try { md = await getText(entry.md); if (md) cachePut(entry.md, md); } catch (e) { md = cacheGet(entry.md); if (!md) throw e; toast('Offline: showing the saved copy'); }
  if (md == null) md = cacheGet(entry.md);
  if (md == null) throw new Error('Could not find the Markdown copy in Drive.');
  openReader({ title: entry.title, md, key: entry.md, filename: entry.md.split('/').pop(), openUrl: entry.url || entry.mdUrl, subtitle: CATS[entry.cat]?.label });
}

/* ---------- the page ---------- */
export async function renderFiles(el, sub) {
  let idx = { files: [] }, loadErr = '';
  const state = { cat: 'all', q: '' };
  el.innerHTML = `
    <div class="eyebrow">My files</div>
    <h1>Drop it here. I'll file it.</h1>
    <p class="lede">CVs, transcripts, drafts, journal papers: upload anything, once. Cornelieur works out what it is, files it in the right folder in your Google Drive, and makes an easy-to-read copy for your phone.</p>
    <div id="fStatus"></div>
    <label class="dropzone" id="fdz"><input type="file" id="ff" multiple accept=".pdf,.docx,.txt,.md,.markdown" hidden>
      <span class="dz-ico">📥</span><b>Drop files here, or tap to choose</b><small class="muted">PDF · Word (.docx) · text · Markdown</small></label>
    <div id="fLog" class="stack" style="margin-top:12px"></div>
    <div class="row between" style="margin:22px 0 8px"><h2 style="margin:0">Everything I've filed</h2><span class="muted" id="fCount"></span></div>
    <div class="searchbar"><input type="search" id="fSearch" placeholder="Search by title or topic…"></div>
    <div class="row" id="fChips" style="margin:10px 0"></div>
    <div id="fList"></div>`;
  const status = $('#fStatus', el), log = $('#fLog', el);

  const drawStatus = () => {
    status.innerHTML = connected() ? '' : `<div class="notice dew" style="margin-bottom:14px"><b>Drive isn't connected on this device yet.</b> Files can still be converted and read here, but they won't be saved. <a href="#/settings">Connect Google Drive</a> (one-time, takes a minute).</div>`;
  };
  const chips = () => {
    const counts = {}; idx.files.forEach(f => { counts[f.cat] = (counts[f.cat] || 0) + 1; });
    $('#fChips', el).innerHTML = [['all', 'Everything', idx.files.length], ...Object.entries(CATS).map(([k, v]) => [k, v.icon + ' ' + v.label, counts[k] || 0])].filter(([k, , n]) => k === 'all' || n)
      .map(([k, l, n]) => `<button class="chip ${state.cat === k ? 'on' : ''}" data-cat="${k}">${esc(l)} · ${n}</button>`).join('');
    $$('[data-cat]', el).forEach(b => b.onclick = () => { state.cat = b.dataset.cat; chips(); drawList(); });
  };
  const drawList = () => {
    const q = state.q.toLowerCase();
    const rows = idx.files.filter(f => (state.cat === 'all' || f.cat === state.cat) && (!q || (f.title + ' ' + (f.topic || '') + ' ' + f.orig + ' ' + (f.snippet || '')).toLowerCase().includes(q)));
    $('#fCount', el).textContent = idx.files.length ? `${idx.files.length} file${idx.files.length === 1 ? '' : 's'}` : '';
    $('#fList', el).innerHTML = loadErr ? `<div class="notice dew">${esc(loadErr)}</div>` : rows.length ? rows.map(f => `
      <div class="filecard" data-id="${f.id}">
        <div class="fc-ico">${CATS[f.cat]?.icon || '📎'}</div>
        <div class="fc-main"><b>${esc(f.title)}</b>
          <div class="muted fc-meta">${esc(CATS[f.cat]?.label || '')}${f.topic ? ' · ' + esc(f.topic) : ''} · ${fmtDate(f.added)}${f.pages ? ' · ' + f.pages + ' p' : ''}</div>
          <div class="fc-snip">${esc(f.snippet || '')}</div></div>
        <div class="fc-acts"><button class="btn sm" data-a="read">Read</button><button class="btn sm ghost" data-a="more" aria-label="More">⋯</button></div>
      </div>`).join('') : `<div class="empty">${idx.files.length ? 'Nothing matches.' : connected() ? 'Nothing filed yet. Drop your first file above.' : 'Files you drop above will be listed here once Drive is connected.'}</div>`;
    $$('.filecard', el).forEach(c => {
      const f = idx.files.find(x => x.id === c.dataset.id);
      c.onclick = async e => {
        const a = e.target.closest('[data-a]'); if (a && a.dataset.a === 'more') return more(f);
        try { toast('Opening…'); await readEntry(f); } catch (err) { toast(err.message); }
      };
    });
  };
  const more = f => modal(`<h2 style="font-size:18px">${esc(f.title)}</h2>
    <label class="f">Filed as</label>
    <select id="mvCat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === f.cat ? 'selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('')}</select>
    <p class="muted" style="font-size:13px">Drive folder: ${esc(f.folder)}<br>${esc(f.why || '')}</p>
    <div class="row"><button class="btn" id="mvGo">Move</button>${f.url ? `<a class="btn ghost" href="${esc(f.url)}" target="_blank" rel="noopener">Open original ↗</a>` : ''}<button class="btn ghost" id="rmGo" style="color:var(--bad);border-color:var(--bad)">Delete</button></div>`, (m, close) => {
    $('#mvGo', m).onclick = async () => { close(); await moveEntry(f, $('#mvCat', m).value); drawList(); chips(); };
    $('#rmGo', m).onclick = async () => {
      if (!confirm('Delete this file and its Markdown copy from your Drive? (It goes to the Drive bin.)')) return;
      close();
      try { if (f.file) await del(f.file); await del(f.md); idx.files = idx.files.filter(x => x.id !== f.id); await saveIndex(idx); toast('Deleted'); } catch (e) { toast(e.message); }
      drawList(); chips();
    };
  });
  async function moveEntry(f, cat) {
    if (cat === f.cat) return;
    const topic = cat === 'paper' ? (f.topic || 'General') : '';
    const folder = cat === 'paper' ? `${DIR_MAP.papers}/${topic}` : DIR_MAP[cat];
    try {
      toast('Moving…');
      const nf = f.file ? await move(f.file, `${folder}/${f.file.split('/').pop()}`) : null;
      const nm = await move(f.md, `${folder}/${f.md.split('/').pop()}`);
      Object.assign(f, { cat, topic, folder, file: nf ? nf.path : '', md: nm.path, url: nf ? nf.url : f.url, mdUrl: nm.url, why: 'moved by you' });
      await saveIndex(idx); toast('Moved to ' + CATS[cat].label);
    } catch (e) { toast(e.message); }
  }

  async function handle(files) {
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'card logrow'; row.innerHTML = `<b>${esc(file.name)}</b><div class="muted" data-s>Starting…</div>`; log.prepend(row);
      const s = row.querySelector('[data-s]');
      try {
        const r = await ingestFile(file, { onStatus: t => { s.textContent = t; } });
        if (r.saved) {
          idx = await loadIndex(); chips(); drawList();
          s.innerHTML = r.duplicate ? `Already filed earlier as <b>${esc(CATS[r.entry.cat].label)}</b>.` : `Filed under <b>${esc(CATS[r.cls.cat].icon + ' ' + CATS[r.cls.cat].label)}</b>${r.cls.topic ? ' → ' + esc(r.cls.topic) : ''}. <span class="muted">(${esc(r.cls.reasons)})</span>${r.tooBig ? ' <span class="muted">Original was too big for Drive upload; the readable copy is saved.</span>' : ''} <a href="#" data-open>Read now</a>`;
        } else {
          s.innerHTML = `Converted, but <b>not saved</b> (Drive not connected). <a href="#" data-open>Read now</a>`;
        }
        const o = row.querySelector('[data-open]'); if (o) o.onclick = e => { e.preventDefault(); openReader({ title: r.title, md: r.md, subtitle: CATS[r.cls.cat].label, key: r.entry ? r.entry.md : 'local:' + r.title }); };
      } catch (e) { s.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
    }
  }
  const dz = $('#fdz', el), inp = $('#ff', el);
  inp.onchange = () => { handle([...inp.files]); inp.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('hover'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('hover'); }));
  dz.addEventListener('drop', e => handle([...e.dataTransfer.files]));
  $('#fSearch', el).oninput = e => { state.q = e.target.value; drawList(); };

  drawStatus(); chips(); drawList();
  if (connected()) {
    try { idx = await loadIndex(true); } catch (e) { loadErr = e.message; }
    chips(); drawList();
  }
}
