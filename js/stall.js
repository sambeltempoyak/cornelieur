// stall.js — Ocha's watercolour flower stall as the Today stage.
// 3D (three.js, loaded lazily) or 2D (a still of the same model), with the same tags, taps and focus in both.
// The model is the low-poly build of her painting (assets/stall/stall-lite.glb, ~6k triangles, one WebP atlas).
// Rendering is on demand: frames run only while something moves, and stop when the stall is off-screen.

const ASSET = 'assets/stall/';
const GLB = new URL('../assets/stall/stall-lite.glb?v=1', import.meta.url).href;
export const POSTER = ASSET + 'stall-poster.webp?v=1';
const PREF_KEY = 'cornelieur.stall';          // 'auto' | '3d' | '2d'
const SLOW_KEY = 'cornelieur.stall.slow';     // set when this device struggled with 3D

/* ---- painting <-> model (same numbers as the build: painting px, model units, 10° projection) ---- */
const XC = 565, YB = 1232, SC = 475, PHI = 10 * Math.PI / 180, CP = Math.cos(PHI), SP = Math.sin(PHI);
const FRAME = { cx: 552, cy: 760, w: 1030, h: 1040 };   // painting window the stage shows in the front view
const toPaint = (x, y, z) => [XC + x * SC, YB - (y * CP - z * SP) * SC];

/* slots: the five pots (pot_k + bouquet_k) and the awning; boxes in model units (from the build) */
export const SLOTS = [
  { id: 'opps',  k: 1, flower: 'Orange blossoms', lo: [-0.994, 0.256, -0.439], hi: [-0.484, 0.988, 0.03],  x: -0.696 },
  { id: 'apply', k: 2, flower: 'Red tulips',      lo: [-0.487, 0.256, -0.531], hi: [-0.16, 1.098, -0.126], x: -0.324 },
  { id: 'learn', k: 3, flower: 'The succulent',   lo: [-0.188, 0.256, -0.555], hi: [0.279, 0.973, -0.063], x: 0.046 },
  { id: 'paper', k: 4, flower: 'Pink spray',      lo: [0.117, 0.256, -0.562],  hi: [0.608, 1.216, -0.097], x: 0.388 },
  { id: 'relief',k: 5, flower: 'Hydrangea',       lo: [0.523, 0.256, -0.503],  hi: [0.891, 0.821, -0.103], x: 0.687 },
  { id: 'week',  k: 0, flower: 'The awning',      lo: [-0.954, 1.0, -1.064],   hi: [0.941, 1.86, -0.572],  x: 0 },
];
const slotById = id => SLOTS.find(s => s.id === id);
const TAG_Y = 0.128;                                   // tags hang on the crate front (y 0…0.256, z 0)

/* ---------------------------------------------------------------- which mode for this device */
export const stallPref = () => localStorage.getItem(PREF_KEY) || 'auto';
export function setStallPref(v) { localStorage.setItem(PREF_KEY, v); if (v === '3d') localStorage.removeItem(SLOW_KEY); }
function webgl2() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (_) { return false; } }
export function stallMode() {
  const p = stallPref();
  if (p === '2d' || p === '3d') return p === '3d' && !webgl2() ? '2d' : p;
  if (localStorage.getItem(SLOW_KEY)) return '2d';
  const c = navigator.connection;
  if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return '2d';
  if (navigator.deviceMemory && navigator.deviceMemory < 2) return '2d';
  return webgl2() ? '3d' : '2d';
}
const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------------------------------------------------------------- small helpers */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now();
class Spring {           // critically-damped-ish spring around a target
  constructor(k = 70, d = 9) { this.k = k; this.d = d; this.x = 0; this.v = 0; this.to = 0; }
  kick(v) { this.v += v; }
  step(dt) { const a = this.k * (this.to - this.x) - this.d * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
  get calm() { return Math.abs(this.v) < 1e-3 && Math.abs(this.to - this.x) < 1e-3; }
}
const ease = (cur, to, dt, rate = 7) => cur + (to - cur) * (1 - Math.exp(-dt * rate));

/* ================================================================ the controller (one per page load) */
let STALL = null;
export function getStall() { return STALL || (STALL = new Stall()); }

class Stall {
  constructor() {
    this.view = null; this.mode = '2d'; this.three = null; this.loading = null;
    this.sel = null; this.hover = null; this.tags = {}; this.today = new Set();
    this.onSelect = () => {}; this.onHover = () => {};
    // view state shared by 2D and 3D: focus point (model units), zoom, yaw/pitch (3D only)
    this.cam = { fx: (FRAME.cx - XC) / SC, fy: 0.95, fz: -0.35, zoom: 1, yaw: 0, pitch: PHI };
    this.camTo = { ...this.cam };
    this.cam0 = { ...this.cam };
    this.raf = 0; this.visible = true; this.last = 0; this.live = false;
  }

  /** put the stall into a container (re-used across Today re-renders) */
  attach(view, { onSelect, onHover } = {}) {
    this.detach();
    this.view = view; this.onSelect = onSelect || this.onSelect; this.onHover = onHover || this.onHover;
    this.poster = view.querySelector('.stall-poster');
    this.tagBox = view.querySelector('.stall-tags');
    this.mode = stallMode();
    view.dataset.mode = this.mode;
    this._bind();
    this.ro = new ResizeObserver(() => this._resize()); this.ro.observe(view);
    this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; if (this.visible) this.kick(400); }, { threshold: 0.05 });
    this.io.observe(view);
    this._vis = () => { if (!document.hidden) this.kick(200); };
    document.addEventListener('visibilitychange', this._vis);
    this._resize();
    if (this.mode === '3d') this._start3D();
    if (this.sel) this.select(this.sel, { silent: true, instant: true });
  }
  detach() {
    if (!this.view) return;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.ro && this.ro.disconnect(); this.io && this.io.disconnect();
    document.removeEventListener('visibilitychange', this._vis);
    if (this._unbind) this._unbind();
    if (this.three && this.three.canvas.parentNode) this.three.canvas.remove();
    clearTimeout(this._bt); clearTimeout(this._back); this.live = false;
    this.view.classList.remove('live', 'focused', 'hovering', 'dragging');
    this.view = null;
  }

  /** tags: {slotId: {big, small, label, urgent}}; today: slot ids to highlight */
  setTags(tags, today = []) {
    this.tags = { ...this.tags, ...tags }; this.today = new Set(today);
    if (!this.tagBox) return;
    this.tagBox.innerHTML = SLOTS.filter(s => s.k).map(s => {
      const t = this.tags[s.id] || { big: '·', small: '' };
      const cls = ['ptag', this.today.has(s.id) ? 'today' : '', t.urgent ? 'urgent' : '', this.sel === s.id ? 'on' : ''].join(' ');
      return `<button type="button" class="${cls}" data-slot="${s.id}" aria-label="${s.flower}: ${t.label || t.small}"><b>${t.big}</b><span>${t.small}</span></button>`;
    }).join('');
    this._placeTags();
  }

  setMode(m) { setStallPref(m); if (this.view) this.attach(this.view, {}); }

  select(id, { silent = false, instant = false } = {}) {
    const s = id ? slotById(id) : null;
    this.sel = s ? s.id : null;
    if (this.view) this.view.classList.toggle('focused', !!s);
    if (s) {
      // frame the pot with its bouquet and the crate front under it (where its tag hangs)
      const lo = s.k ? [s.lo[0], 0, s.lo[2]] : s.lo, hi = s.k ? [s.hi[0], s.hi[1], 0.03] : s.hi;
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const hPx = ((hi[1] - lo[1]) * CP + (hi[2] - lo[2]) * SP) * SC;     // painting px tall
      const wPx = (hi[0] - lo[0]) * SC;
      const z = clamp(Math.min(0.9 * FRAME.h / hPx, 0.8 * FRAME.w / wPx), 1.15, s.k ? 1.7 : 1.3);
      Object.assign(this.camTo, { fx: c[0], fy: c[1], fz: c[2], zoom: z, yaw: s.k ? clamp(s.x * 0.3, -0.22, 0.22) : 0, pitch: PHI });
    } else Object.assign(this.camTo, this.cam0);
    if (instant || reducedMotion()) Object.assign(this.cam, this.camTo);
    if (this.tagBox) this.tagBox.querySelectorAll('.ptag').forEach(b => b.classList.toggle('on', b.dataset.slot === this.sel));
    if (this.three) this.three.focus(s);
    if (!silent) this.onSelect(this.sel);
    this.kick(1600);
  }
  step(dir) {      // browse along the stall: pots left→right, then the awning
    const order = SLOTS.map(s => s.id); const i = order.indexOf(this.sel);
    this.select(order[(i + dir + order.length) % order.length] || order[0]);
  }

  /* ---------------------------------------------------------------- layout + projection */
  _resize() {
    if (!this.view) return;
    const r = this.view.getBoundingClientRect(); this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.s0 = Math.min(this.W / FRAME.w, this.H / FRAME.h);
    if (this.three && this.live) this.three.resize(this.W, this.H);
    this._paint2D();
    this.kick(100);
  }
  /** model point -> stage px (2D: front view; 3D: the live camera) */
  _project(x, y, z) {
    if (this.mode === '3d' && this.live) return this.three.project(x, y, z);
    const [X, Y] = toPaint(x, y, z), [FX, FY] = toPaint(this.cam.fx, this.cam.fy, this.cam.fz);
    const k = this.s0 * this.cam.zoom;
    return [(X - FX) * k + this.W / 2, (Y - FY) * k + this.H / 2];
  }
  _rect(s) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const x of [s.lo[0], s.hi[0]]) for (const y of [s.lo[1], s.hi[1]]) for (const z of [s.lo[2], s.hi[2]]) {
      const [a, b] = this._project(x, y, z); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
    }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2 };
  }
  _hit(px, py) {
    let best = null, bd = 1e9;
    for (const s of SLOTS) {
      const r = this._rect(s);
      const pad = s.k ? 4 : 0;
      if (px < r.x0 - pad || px > r.x1 + pad || py < r.y0 - pad || py > r.y1 + pad) continue;
      // overlapping bouquets: the pot whose centre column is nearest wins; the awning only where no pot is
      const d = s.k ? Math.abs(px - r.cx) : 5e8;
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) {     // the crate front under a pot counts as that pot (that's where its tag hangs)
      const [, cy0] = this._project(0, 0.256, 0), [, cy1] = this._project(0, 0, 0);
      if (py >= cy0 - 2 && py <= cy1 + 2) {
        for (const s of SLOTS.filter(s => s.k)) { const [tx] = this._project(s.x, TAG_Y, 0); const d = Math.abs(px - tx); if (d < bd && d < 60) { bd = d; best = s; } }
      }
    }
    return best;
  }
  _placeTags() {
    if (!this.tagBox || !this.W) return;
    for (const b of this.tagBox.children) {
      const s = slotById(b.dataset.slot); const [x, y] = this._project(s.x, TAG_Y, 0.002);
      b.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    }
  }
  _paint2D() {
    if (!this.poster || !this.W) return;
    // the poster is a render of the front view covering exactly FRAME; place it like the camera would
    const k = this.s0 * this.cam.zoom; const [FX, FY] = toPaint(this.cam.fx, this.cam.fy, this.cam.fz);
    const left = (FRAME.cx - FRAME.w / 2 - FX) * k + this.W / 2, top = (FRAME.cy - FRAME.h / 2 - FY) * k + this.H / 2;
    Object.assign(this.poster.style, { width: FRAME.w * k + 'px', height: FRAME.h * k + 'px', transform: `translate(${left}px,${top}px)` });
    this._placeTags();
  }

  /* ---------------------------------------------------------------- input */
  _bind() {
    const v = this.view; let down = null, drag = false;
    const pos = e => { const r = v.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pd = e => {
      if (e.target.closest('button,a')) return;
      down = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch, id: e.pointerId, t: now() }; drag = false;
    };
    const pm = e => {
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!drag && this.mode === '3d' && Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy)) { drag = true; try { v.setPointerCapture(e.pointerId); } catch (_) { } v.classList.add('dragging'); this._hideHint(); }
        if (drag) {
          this.camTo.yaw = this.cam.yaw = clamp(down.yaw - dx * 0.0065, -0.66, 0.66);
          if (e.pointerType === 'mouse') this.camTo.pitch = this.cam.pitch = clamp(down.pitch + dy * 0.004, 0.03, 0.5);
          this.kick(300);
          clearTimeout(this._back); this._back = setTimeout(() => { if (!this.sel) this.camTo.yaw = 0; this.camTo.pitch = PHI; this.kick(1500); }, 4500);
        }
        return;
      }
      if (e.pointerType !== 'mouse') return;
      const [px, py] = pos(e); const s = e.target.closest('.ptag') ? slotById(e.target.closest('.ptag').dataset.slot) : this._hit(px, py);
      this._setHover(s ? s.id : null);
    };
    const pu = e => {
      if (!down || e.pointerId !== down.id) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (!drag && moved < 9) {
        const [px, py] = pos(e); const s = this._hit(px, py);
        if (s) { this.select(s.id); this._hideHint(); }
        else if (this.sel) this.select(null);
      }
      down = null; drag = false; v.classList.remove('dragging');
    };
    const pc = () => { down = null; drag = false; v.classList.remove('dragging'); };
    const pl = () => this._setHover(null);
    const tagClick = e => { const b = e.target.closest('.ptag'); if (!b) return; this.select(this.sel === b.dataset.slot ? null : b.dataset.slot); this._hideHint(); };
    const tagHover = e => { const b = e.target.closest('.ptag'); this._setHover(b ? b.dataset.slot : null); };
    const key = e => {
      if (e.key === 'ArrowRight') { this.step(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.step(-1); e.preventDefault(); }
      else if (e.key === 'Escape' && this.sel) { this.select(null); }
    };
    v.addEventListener('pointerdown', pd); v.addEventListener('pointermove', pm); v.addEventListener('pointerup', pu);
    v.addEventListener('pointercancel', pc); v.addEventListener('pointerleave', pl);
    this.tagBox.addEventListener('click', tagClick); this.tagBox.addEventListener('focusin', tagHover);
    v.addEventListener('keydown', key);
    this._unbind = () => {
      v.removeEventListener('pointerdown', pd); v.removeEventListener('pointermove', pm); v.removeEventListener('pointerup', pu);
      v.removeEventListener('pointercancel', pc); v.removeEventListener('pointerleave', pl); v.removeEventListener('keydown', key);
      this.tagBox && this.tagBox.removeEventListener('click', tagClick); this.tagBox && this.tagBox.removeEventListener('focusin', tagHover);
    };
  }
  _setHover(id) {
    if (id === this.hover) return;
    this.hover = id; if (this.view) this.view.classList.toggle('hovering', !!id);
    if (this.tagBox) this.tagBox.querySelectorAll('.ptag').forEach(b => b.classList.toggle('hov', b.dataset.slot === id));
    if (this.three) this.three.hoverSlot(id ? slotById(id) : null);
    this.onHover(id); this.kick(500);
  }
  _hideHint() { const h = this.view && this.view.querySelector('.stall-hint'); if (h) h.classList.add('gone'); try { localStorage.setItem('cornelieur.stall.hinted', '1'); } catch (_) { } }

  /* ---------------------------------------------------------------- frame loop (on demand) */
  kick(ms = 300) {
    this.until = Math.max(this.until || 0, now() + ms);
    if (!this.raf && this.view) { this.last = now(); this.raf = requestAnimationFrame(t => this._frame(t)); }
  }
  _frame(t) {
    this.raf = 0; if (!this.view) return;
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0.016); this.last = t;
    // camera tween
    const c = this.cam, g = this.camTo; let moving = false;
    for (const k of ['fx', 'fy', 'fz', 'zoom', 'yaw', 'pitch']) {
      const nv = ease(c[k], g[k], dt, k === 'zoom' ? 6 : 7);
      if (Math.abs(nv - g[k]) > 1e-4) moving = true; c[k] = Math.abs(nv - g[k]) < 1e-4 ? g[k] : nv;
    }
    let busy = moving;
    if (this.mode === '3d' && this.live) { busy = this.three.frame(dt, c) || busy; this.three.gov(dt); }
    else this._paint2D();
    this._placeTags();
    if ((busy || now() < this.until) && this.visible && !document.hidden) this.raf = requestAnimationFrame(tt => this._frame(tt));
  }

  /* ---------------------------------------------------------------- 3D */
  async _start3D() {
    const view = this.view;
    try {
      if (!this.three) {
        this.loading = this.loading || load3D();
        const lib = await this.loading;
        this.three = new Three3D(lib, { reduced: reducedMotion(), onSlow: () => this._slow() });
        await this.three.init();
      }
      if (this.view !== view || this.mode !== '3d') return;
      this.three.attach(view, this.W, this.H); this.live = true;
      this.three.focus(this.sel ? slotById(this.sel) : null);
      requestAnimationFrame(() => { if (this.view === view) { view.classList.add('live'); this.three.breeze(0.9); this.kick(2600); this._breezeLater(); } });
    } catch (e) {
      console.warn('stall 3D unavailable, showing the painting', e);
      this.mode = '2d'; if (this.view) { this.view.dataset.mode = '2d'; this._paint2D(); }
    }
  }
  _breezeLater() {
    clearTimeout(this._bt);
    if (!this.three || this.three.reduced) return;
    this._bt = setTimeout(() => {
      if (this.view && this.mode === '3d' && this.visible && !document.hidden && !this.view.classList.contains('dragging')) { this.three.breeze(0.55); this.kick(2200); }
      this._breezeLater();
    }, 16000 + Math.random() * 9000);
  }
  _slow() {
    try { localStorage.setItem(SLOW_KEY, '1'); } catch (_) { }
    this.mode = '2d'; this.live = false; if (!this.view) return;
    this.view.dataset.mode = '2d'; this.view.classList.remove('live');
    if (this.three.canvas.parentNode) this.three.canvas.remove();
    this._paint2D();
    this.view.dispatchEvent(new CustomEvent('stall:slow', { bubbles: true }));
  }
  /** a puff of hearts (when she saves or finishes something) */
  hearts(from = 'apply', n = 7) { if (this.three && this.mode === '3d') { this.three.hearts(slotById(from), n); this.kick(3500); } }
}

/* ================================================================ three.js part */
async function load3D() {
  const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]);
  return { THREE, GLTFLoader, MeshoptDecoder };
}

class Three3D {
  constructor(lib, { reduced, onSlow }) {
    Object.assign(this, lib); this.reduced = reduced; this.onSlow = onSlow; this.ready = false;
    this.t = 0; this.gust = 0; this.flying = []; this.frames = []; this.pr = 0; this.govDone = false;
  }
  async init() {
    const { THREE } = this;
    const dpr = window.devicePixelRatio || 1;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', stencil: false });
    this.pr = Math.min(dpr, 2); r.setPixelRatio(this.pr);
    r.setClearColor(0x000000, 0); r.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = r.domElement; this.canvas.className = 'stall-canvas'; this.canvas.setAttribute('aria-hidden', 'true');
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
    const loader = new this.GLTFLoader(); loader.setMeshoptDecoder(this.MeshoptDecoder);
    const gltf = await loader.loadAsync(GLB);
    const root = this.root = gltf.scene; this.scene.add(root);
    root.updateMatrixWorld(true);
    // paper look: unlit, the painting as is, with a soft baked light so pots still read round
    const L = new THREE.Vector3(-0.35, 0.55, 0.9).normalize(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    const mats = {};
    const matFor = src => {
      const cut = src.alphaTest > 0 || src.alphaMode === 'MASK' || src.side === THREE.DoubleSide;
      const key = cut ? 'cut' : 'paint';
      if (!mats[key]) mats[key] = new THREE.MeshBasicMaterial({ map: src.map, vertexColors: true, toneMapped: false, side: cut ? THREE.DoubleSide : THREE.FrontSide, alphaTest: cut ? 0.5 : 0, alphaToCoverage: cut });
      return mats[key];
    };
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.material.map) { o.material.map.anisotropy = Math.min(4, r.capabilities.getMaxAnisotropy()); }
      o.material = matFor(o.material);
      const g = o.geometry, N = g.attributes.normal, cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
      nm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < cnt; i++) {
        let c = 0.93;
        if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); c = clamp(0.8 + 0.24 * n.dot(L), 0.6, 1.0); }
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    });
    // soft contact shadow under the crate (a tiny canvas texture, no shadow maps)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(52,71,74,.5)'); gr.addColorStop(0.5, 'rgba(52,71,74,.2)'); gr.addColorStop(0.92, 'rgba(52,71,74,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const st = new THREE.CanvasTexture(cv); st.colorSpace = THREE.SRGBColorSpace;
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 1.15), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, toneMapped: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.001, -0.36); sh.renderOrder = -1; this.scene.add(sh);
    // nodes the stall moves
    this.nodes = {}; root.traverse(o => { if (o.name) this.nodes[o.name] = o; });
    this.base = {}; Object.values(this.nodes).forEach(o => this.base[o.name] = { y: o.position.y, rz: o.rotation.z, rx: o.rotation.x });
    this.sway = {}; this.lift = {};
    for (let k = 1; k <= 5; k++) { this.sway[k] = new Spring(60, 4); this.lift[k] = new Spring(90, 14); }
    this.heartSrc = ['hearts_a', 'hearts_b', 'hearts_c'].map(n => this.nodes[n]).filter(Boolean);
    this.ready = true;
  }
  attach(view, W, H) { view.insertBefore(this.canvas, view.querySelector('.stall-tags')); this.resize(W, H); }
  resize(W, H) {
    if (!this.renderer) return;
    this.W = W; this.H = H; this.renderer.setSize(W, H, false);
    this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
    const s0 = Math.min(W / FRAME.w, H / FRAME.h) * SC;     // px per model unit at zoom 1
    const c = this.camera; c.left = -W / 2 / s0; c.right = W / 2 / s0; c.top = H / 2 / s0; c.bottom = -H / 2 / s0; c.updateProjectionMatrix();
  }
  placeCamera(c) {
    const cam = this.camera, cp = Math.cos(c.pitch);
    cam.position.set(c.fx + Math.sin(c.yaw) * cp * 12, c.fy + Math.sin(c.pitch) * 12, c.fz + Math.cos(c.yaw) * cp * 12);
    cam.lookAt(c.fx, c.fy, c.fz);
    if (cam.zoom !== c.zoom) { cam.zoom = c.zoom; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
  project(x, y, z) {
    const v = this._v || (this._v = new this.THREE.Vector3()); v.set(x, y, z).project(this.camera);
    return [(v.x + 1) / 2 * this.W, (1 - v.y) / 2 * this.H];
  }
  focus(s) { this.selK = s ? s.k : 0; for (let k = 1; k <= 5; k++) this.lift[k].to = k === this.selK ? 0.03 : (k === this.hovK ? 0.016 : 0); if (s && s.k) { this.sway[s.k].kick(1.3); if (s.k === 2) this.hearts(s, 6); } if (s && !s.k) this.breeze(1); }
  hoverSlot(s) { this.hovK = s ? s.k : 0; for (let k = 1; k <= 5; k++) this.lift[k].to = k === this.selK ? 0.03 : (k === this.hovK ? 0.016 : 0); if (s && s.k) this.sway[s.k].kick(0.6); }
  breeze(s = 1) { this.gust = Math.max(this.gust, s); for (let k = 1; k <= 5; k++) this.sway[k].kick((0.4 + Math.random() * 0.7) * 0.35 * s); }
  hearts(s, n = 7) {
    const { THREE } = this; if (!this.heartSrc.length || this.reduced) return;
    const meshes = []; this.heartSrc.forEach(g => g.traverse(o => { if (o.isMesh) meshes.push(o); }));
    const src = this.nodes['bouquet_' + (s && s.k ? s.k : 2)]; const origin = new THREE.Vector3(); src.getWorldPosition(origin);
    for (let i = 0; i < n; i++) {
      const m = meshes[i % meshes.length].clone(); m.updateMatrix();
      const bb = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).applyMatrix4(m.matrix);
      m.position.sub(bb.getCenter(new THREE.Vector3()));
      const h = new THREE.Group(); h.add(m); this.root.add(h); this.root.worldToLocal(h.position.copy(origin));
      h.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.14 + Math.random() * 0.15, (Math.random() - 0.2) * 0.2));
      h.scale.setScalar(0.001);
      this.flying.push({ h, t: -i * 0.12, life: 2.3 + Math.random() * 0.8, s0: 1 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 0.18, vy: 0.3 + Math.random() * 0.16, spin: (Math.random() - 0.5) * 2 });
    }
  }
  frame(dt, cam) {
    const t = (this.t += dt), amp = this.reduced ? 0.3 : 1; this.gust *= Math.exp(-dt * 0.9);
    let busy = this.gust > 0.04 || this.flying.length > 0;
    for (let k = 1; k <= 5; k++) {
      const s = this.sway[k].step(dt), l = this.lift[k].step(dt); if (!this.sway[k].calm || !this.lift[k].calm) busy = true;
      const b = this.nodes['bouquet_' + k], p = this.nodes['pot_' + k];
      if (b) { b.rotation.z = this.base[b.name].rz + (this.gust * Math.sin(t * 2.3 + k) * 0.05 + Math.sin(t * 0.9 + k * 1.3) * 0.01 * this.gust) * amp + s * 0.06; b.rotation.x = this.base[b.name].rx + s * 0.02; b.position.y = this.base[b.name].y + l; }
      if (p) p.position.y = this.base[p.name].y + l;
    }
    ['hearts_a', 'hearts_b', 'hearts_c'].forEach((n, i) => { const o = this.nodes[n]; if (o) { o.position.y = this.base[n].y + Math.sin(t * 1.4 + i * 1.7) * 0.02 * amp; o.rotation.z = Math.sin(t * 1.1 + i) * 0.08 * amp; } });
    const aw = this.nodes.awning; if (aw) aw.rotation.x = this.base.awning.rx + this.gust * Math.sin(t * 3.1) * 0.012 * amp;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i]; f.t += dt; if (f.t < 0) continue;
      const u = f.t / f.life, h = f.h;
      h.position.x += (f.vx + Math.sin(f.t * 3 + i) * 0.12) * dt; h.position.y += f.vy * dt;
      h.rotation.z = Math.sin(f.t * 2.5) * 0.4 + f.spin * f.t * 0.3;
      h.scale.setScalar(Math.max(f.s0 * Math.min(1, u * 6) * (1 - Math.max(0, (u - 0.65) / 0.35)), 0.001));
      if (u >= 1) { this.root.remove(h); this.flying.splice(i, 1); }
    }
    this.placeCamera(cam);
    this.renderer.render(this.scene, this.camera);
    return busy;
  }
  /** performance governor: if frames are slow, lower the resolution; if still slow, hand over to the painting */
  gov(dt) {
    if (this.govDone) return;
    if ((this.warm = (this.warm || 0) + 1) < 12) return;          // skip shader compile / upload frames
    this.frames.push(dt); if (this.frames.length < 24) return;
    const m = this.frames.sort((a, b) => a - b)[12]; this.frames = [];
    if (m > 0.042 && this.pr > 1) { this.pr = Math.max(1, this.pr - 0.5); this.renderer.setPixelRatio(this.pr); this.resize(this.W, this.H); }
    else if (m > 0.07 && this.pr <= 1) { this.govDone = true; this.onSlow(); }
    else if (m <= 0.042) this.govDone = true;
  }
}
