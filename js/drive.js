// Google Drive "server" client. Talks to the Apps Script web app (apps-script/Code.gs).
import { S, replaceState, toast, modal } from './util.js';
import { DIR_MAP } from './folders.js';

const CFG_KEY = 'cornelieur.drive';

/* ---- Folder design (everything lives under the Drive root folder) ---- */
export const DIR = DIR_MAP;
export const FILE_INDEX = DIR.sys + '/files-index.json';
export const STATE_FILE = DIR.sys + '/progress.json';

/* ---- connection settings (kept only in this browser, never in the GitHub repo) ---- */
export const driveCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (_) { return null; } };
export const setDriveCfg = c => { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); };
export const connected = () => !!(driveCfg() && driveCfg().url && driveCfg().key);

export async function call(action, payload = {}) {
  const c = driveCfg();
  if (!c || !c.url) throw new Error('Google Drive is not connected yet (Settings → Google Drive).');
  let r;
  try {
    // No custom headers on purpose: keeps this a "simple" request so the browser does not need a CORS pre-flight.
    r = await fetch(c.url, { method: 'POST', body: JSON.stringify({ key: c.key, action, ...payload }) });
  } catch (e) { throw new Error('Could not reach your Drive script (offline, or the URL is wrong).'); }
  let j;
  try { j = await r.json(); } catch (_) { throw new Error('The Drive script answered with something unexpected. Check the Web app URL and that access is set to "Anyone".'); }
  if (!j.ok) { const err = new Error(j.error || 'Drive error'); err.notFound = !!j.notFound; throw err; }
  return j;
}

export const ping = () => call('ping');
export const list = path => call('list', { path: path || '' }).then(j => j.files);
export const putText = (path, text, mime = 'text/plain') => call('put', { path, text, mime }).then(j => j.file);
export const getText = async path => { try { return (await call('get', { path })).text; } catch (e) { if (e.notFound) return null; throw e; } };
export const del = path => call('del', { path });
export const move = (from, to) => call('move', { from, to }).then(j => j.file);
export const fetchPage = url => call('fetch', { url });

export function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
export async function putFile(path, blob, mime) {
  return call('put', { path, b64: await blobToB64(blob), mime: mime || blob.type || 'application/octet-stream' }).then(j => j.file);
}
export async function getBlob(path, mime) {
  const j = await call('get', { path, as: 'b64' });
  const bin = atob(j.b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime || j.mime });
}

/* ---- JSON helpers ---- */
export async function getJSONFile(path, fallback = null) {
  const t = await getText(path); if (t == null) return fallback;
  try { return JSON.parse(t); } catch (_) { return fallback; }
}
export const putJSONFile = (path, obj) => putText(path, JSON.stringify(obj), 'application/json');

/* ---- progress sync (so phone and laptop share the same progress) ---- */
let pushTimer = null, syncing = false, lastPushed = 0;
export function autoSyncOn() { const c = driveCfg(); return !!(c && c.url && c.sync !== false); }

export async function pushState(manual) {
  if (!connected()) return;
  syncing = true;
  try {
    const st = S();
    await putJSONFile(STATE_FILE, { app: 'cornelieur', updatedAt: st.updatedAt || Date.now(), state: st });
    lastPushed = Date.now();
    if (manual) toast('Progress saved to your Drive');
  } catch (e) { if (manual) toast(e.message); }
  finally { syncing = false; }
}
export async function pullState() {
  const j = await getJSONFile(STATE_FILE, null);
  if (!j || !j.state) return null;
  return j;
}
window.addEventListener('cornelieur:saved', () => {
  if (!autoSyncOn() || syncing) return;
  clearTimeout(pushTimer); pushTimer = setTimeout(() => pushState(false), 9000);
});

/** On app start: if Drive holds newer progress than this device, offer to load it. */
export async function initSync() {
  if (!autoSyncOn()) return;
  try {
    const remote = await pullState();
    const mine = S().updatedAt || 0;
    if (!remote) { if (mine) pushState(false); return; }
    if (remote.updatedAt > mine + 2000) {
      modal(`<h2>Newer progress found on Drive</h2>
        <p class="muted">Your Drive has progress saved on ${new Date(remote.updatedAt).toLocaleString('en-GB')} (another device, maybe your phone).</p>
        <div class="row"><button class="btn" id="dLoad">Load it on this device</button><button class="btn ghost" data-close>Keep this device's</button></div>`, (m, close) => {
        m.querySelector('#dLoad').onclick = () => { replaceState(remote.state); close(); toast('Progress loaded from Drive'); location.reload(); };
      });
    } else if (mine > remote.updatedAt + 2000) pushState(false);
  } catch (e) { /* offline or not reachable: stay silent */ }
}

/* ---- file index (what has been filed where) ---- */
let indexMem = null;
export async function loadIndex(force) {
  if (indexMem && !force) return indexMem;
  indexMem = (await getJSONFile(FILE_INDEX, { files: [] })) || { files: [] };
  if (!Array.isArray(indexMem.files)) indexMem.files = [];
  return indexMem;
}
export async function saveIndex(idx) { indexMem = idx; await putJSONFile(FILE_INDEX, idx); }

export const safeName = s => String(s || 'untitled').replace(/[\\/<>:"|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'untitled';
