// In-browser R (webR) and Python (Pyodide). Loaded only when a code exercise needs it.
import { loadScript } from './util.js';

const WEBR_URL = 'https://webr.r-wasm.org/v0.6.1/webr.mjs';
const WEBR_FALLBACK = 'https://webr.r-wasm.org/latest/webr.mjs';
const PYODIDE_VERSIONS = ['v0.29.5', 'v0.27.8'];

let webR = null, webRReady = null;
let pyodide = null, pyReady = null;

export function rStatus() { return webR ? 'ready' : webRReady ? 'loading' : 'idle'; }
export function pyStatus() { return pyodide ? 'ready' : pyReady ? 'loading' : 'idle'; }

export function initR(onMsg = () => {}) {
  if (webRReady) return webRReady;
  webRReady = (async () => {
    onMsg('Downloading R for your browser (about 30 MB, first time only)…');
    let mod;
    try { mod = await import(WEBR_URL); } catch (e) { mod = await import(WEBR_FALLBACK); }
    const w = new mod.WebR();
    await w.init();
    webR = w;
    onMsg('R is ready.');
    return w;
  })().catch(e => { webRReady = null; throw e; });
  return webRReady;
}

const installed = new Set();
export async function rInstall(pkgs, onMsg = () => {}) {
  const w = await initR(onMsg);
  const need = pkgs.filter(p => !installed.has(p));
  if (!need.length) return;
  onMsg(`Installing ${need.join(', ')} (one-time)…`);
  await w.installPackages(need, { quiet: true });
  need.forEach(p => installed.add(p));
}

/** Run R code. Returns {out: [{type,text}], images: [ImageBitmap], error} */
export async function runR(code, { onMsg, packages = [] } = {}) {
  const w = await initR(onMsg);
  if (packages.length) await rInstall(packages, onMsg);
  const shelter = await new w.Shelter();
  try {
    const res = await shelter.captureR(code, {
      withAutoprint: true, captureStreams: true, captureConditions: false,
      captureGraphics: { width: 560, height: 360 },
    });
    return { out: res.output.map(o => ({ type: o.type, text: String(o.data) })), images: res.images || [] };
  } catch (e) {
    return { out: [], images: [], error: cleanErr(e.message) };
  } finally { shelter.purge(); }
}
export async function checkR(expr) {
  const w = await initR();
  try { return await w.evalRBoolean(`isTRUE(tryCatch({${expr}}, error=function(e) FALSE))`); } catch (e) { return false; }
}
export async function resetR() { if (webR) { try { await webR.evalRVoid('rm(list = ls(envir = globalenv()), envir = globalenv())'); } catch (_) { } } }

export function initPy(onMsg = () => {}) {
  if (pyReady) return pyReady;
  pyReady = (async () => {
    onMsg('Downloading Python for your browser (about 10 MB, first time only)…');
    let lastErr;
    for (const v of PYODIDE_VERSIONS) {
      try {
        const base = `https://cdn.jsdelivr.net/pyodide/${v}/full/`;
        await loadScript(base + 'pyodide.js');
        pyodide = await window.loadPyodide({ indexURL: base });
        onMsg('Python is ready.');
        return pyodide;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  })().catch(e => { pyReady = null; throw e; });
  return pyReady;
}

export async function runPy(code, { onMsg, packages = [] } = {}) {
  const py = await initPy(onMsg);
  if (packages.length) { onMsg?.(`Loading ${packages.join(', ')} (one-time)…`); await py.loadPackage(packages); }
  const out = [];
  py.setStdout({ batched: s => out.push({ type: 'stdout', text: s }) });
  py.setStderr({ batched: s => out.push({ type: 'stderr', text: s }) });
  try {
    const r = await py.runPythonAsync(code);
    if (r !== undefined && r !== null) {
      const txt = typeof r === 'object' && r.toString ? r.toString() : String(r);
      out.push({ type: 'stdout', text: txt });
      if (r.destroy) r.destroy();
    }
    return { out, images: [] };
  } catch (e) {
    return { out, images: [], error: cleanErr(e.message) };
  }
}
export async function checkPy(expr) {
  const py = await initPy();
  try { const r = await py.runPythonAsync(`bool(${expr})`); return r === true; } catch (e) { return false; }
}
export async function resetPy() {
  if (pyodide) { try { await pyodide.runPythonAsync("for _n in [k for k in list(globals()) if not k.startswith('_')]:\n    del globals()[_n]"); } catch (_) { } }
}

function cleanErr(m = '') {
  // Python tracebacks: keep the last line, which is what a learner needs
  const lines = m.trim().split('\n');
  if (/Traceback/.test(m)) return lines.slice(-1)[0];
  return m.replace(/^Error in .*?: /, 'Error: ');
}

/** Render result into a console element */
export function paint(consoleEl, res) {
  consoleEl.innerHTML = '';
  const add = (txt, cls) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = txt; consoleEl.appendChild(s); };
  for (const o of res.out) add(o.text + '\n', o.type === 'stderr' ? 'err' : '');
  for (const img of res.images || []) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0); consoleEl.appendChild(c);
  }
  if (res.error) add('⚠ ' + res.error + '\n', 'err');
  if (!res.out.length && !res.images?.length && !res.error) add('(ran — no output)', 'muted');
}
