/**
 * Cornelieur — Google Drive server (Google Apps Script)
 * -----------------------------------------------------
 * This tiny script lets the Cornelieur web app save and read files in ONE Drive folder
 * (the ROOT_ID below), and fetch advert pages for analysis. It runs in the Google account
 * that owns the folder. Setup steps are in README.md ("Part 2").
 *
 * 1) Change PASSCODE below to a long private phrase (letters/numbers, 16+ characters).
 * 2) Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone.
 * 3) Copy the Web app URL. Put URL + PASSCODE in Cornelieur > Settings > Google Drive.
 *
 * If you ever change this file, you must do Deploy > Manage deployments > pencil icon >
 * Version: "New version" > Deploy. (The URL stays the same.)
 */
const ROOT_ID = 'PASTE-YOUR-DRIVE-FOLDER-ID-HERE';   // the Drive folder that is the "server" (the long code at the end of the folder's link)
const PASSCODE = 'CHANGE-THIS-TO-A-LONG-PRIVATE-PHRASE';
const MAX_FETCH_CHARS = 700000;                            // advert pages are cut to this size
const VERSION = 2;

function doGet(e) { return handle_((e && e.parameter) || {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request body' }); }
  return handle_(body);
}

function handle_(req) {
  try {
    if (PASSCODE === 'CHANGE-THIS-TO-A-LONG-PRIVATE-PHRASE') return out_({ ok: false, error: 'Passcode not set in Code.gs' });
    if (!req.key || req.key !== PASSCODE) return out_({ ok: false, error: 'Wrong passcode' });
    switch (req.action) {
      case 'ping': return out_({ ok: true, version: VERSION, root: DriveApp.getFolderById(ROOT_ID).getName() });
      case 'list': return out_({ ok: true, files: list_(req.path || '') });
      case 'put': return out_(put_(req));
      case 'get': return out_(get_(req));
      case 'del': return out_(del_(req.path));
      case 'move': return out_(move_(req.from, req.to));
      case 'fetch': return out_(fetch_(req.url));
      default: return out_({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- path helpers ---------- */
function parts_(path) {
  return String(path || '').split('/').map(function (s) { return s.replace(/[\\<>:"|?*\u0000-\u001f]/g, ' ').trim(); })
    .filter(function (s) { return s && s !== '.' && s !== '..'; });
}
function child_(folder, name, create) {
  var it = folder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return create ? folder.createFolder(name) : null;
}
function folderAt_(segs, create) {
  var f = DriveApp.getFolderById(ROOT_ID);
  for (var i = 0; i < segs.length; i++) {
    f = child_(f, segs[i], create);
    if (!f) return null;
  }
  return f;
}
function fileAt_(path) {
  var segs = parts_(path); if (!segs.length) return null;
  var name = segs.pop(); var f = folderAt_(segs, false); if (!f) return null;
  var it = f.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
function info_(file, prefix) {
  return { path: prefix + file.getName(), name: file.getName(), id: file.getId(), mime: file.getMimeType(),
           size: file.getSize(), updated: file.getLastUpdated().toISOString(), url: file.getUrl() };
}

/* ---------- actions ---------- */
function list_(path) {
  var segs = parts_(path); var base = folderAt_(segs, false); var res = [];
  if (!base) return res;
  (function walk(folder, prefix) {
    var files = folder.getFiles();
    while (files.hasNext() && res.length < 3000) res.push(info_(files.next(), prefix));
    var subs = folder.getFolders();
    while (subs.hasNext() && res.length < 3000) { var s = subs.next(); walk(s, prefix + s.getName() + '/'); }
  })(base, segs.length ? segs.join('/') + '/' : '');
  return res;
}

function put_(req) {
  var segs = parts_(req.path); if (!segs.length) return { ok: false, error: 'Missing path' };
  var name = segs.pop(); var folder = folderAt_(segs, true);
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);     // overwrite = replace
  var file;
  if (req.b64 != null) {
    var bytes = Utilities.base64Decode(req.b64);
    file = folder.createFile(Utilities.newBlob(bytes, req.mime || 'application/octet-stream', name));
  } else {
    file = folder.createFile(name, req.text == null ? '' : String(req.text), req.mime || MimeType.PLAIN_TEXT);
  }
  return { ok: true, file: info_(file, segs.length ? segs.join('/') + '/' : '') };
}

function get_(req) {
  var file = fileAt_(req.path);
  if (!file) return { ok: false, error: 'Not found', notFound: true };
  if (req.as === 'b64') {
    if (file.getSize() > 25 * 1024 * 1024) return { ok: false, error: 'File too large to send (25 MB limit)' };
    return { ok: true, b64: Utilities.base64Encode(file.getBlob().getBytes()), mime: file.getMimeType(), name: file.getName() };
  }
  return { ok: true, text: file.getBlob().getDataAsString('UTF-8'), updated: file.getLastUpdated().toISOString(), url: file.getUrl() };
}

function del_(path) {
  var file = fileAt_(path);
  if (file) { file.setTrashed(true); return { ok: true, deleted: 1 }; }
  var segs = parts_(path);
  if (segs.length) {                       // allow trashing a whole (sub)folder, never the root
    var folder = folderAt_(segs, false);
    if (folder) { folder.setTrashed(true); return { ok: true, deleted: 1 }; }
  }
  return { ok: true, deleted: 0 };
}

function move_(from, to) {
  var file = fileAt_(from); if (!file) return { ok: false, error: 'Source not found' };
  var segs = parts_(to); var name = segs.pop(); var folder = folderAt_(segs, true);
  var clash = folder.getFilesByName(name);
  while (clash.hasNext()) { var c = clash.next(); if (c.getId() !== file.getId()) c.setTrashed(true); }
  file.moveTo(folder); file.setName(name);
  return { ok: true, file: info_(file, segs.length ? segs.join('/') + '/' : '') };
}

function fetch_(url) {
  if (!/^https?:\/\//i.test(url || '')) return { ok: false, error: 'Only http(s) links' };
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cornelieur/2.0; personal job-advert reader)', 'Accept-Language': 'en-GB,en;q=0.8' }
  });
  var type = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
  var text = /pdf|octet|image|zip/i.test(type) ? '' : res.getContentText();
  return { ok: true, status: res.getResponseCode(), contentType: type, text: text.slice(0, MAX_FETCH_CHARS) };
}

/** Run this once from the editor (Run > authorizeOnce) so Google asks for Drive + web access. */
function authorizeOnce() {
  Logger.log('Root folder: ' + DriveApp.getFolderById(ROOT_ID).getName());
  UrlFetchApp.fetch('https://www.gov.uk/', { muteHttpExceptions: true });
  Logger.log('OK — now deploy as a Web app.');
}
