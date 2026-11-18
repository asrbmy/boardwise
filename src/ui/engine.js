// The interaction engine for one open board: viewport, render loop, pointer/keyboard handling,
// tools, selection handles and in-place text editing. It is plain JS (no React) so the hot paths
// (pan/zoom/draw/drag) never go through a React render. React subscribes via engine.subscribe().

import { makers, MIN_ZOOM, MAX_ZOOM, STICKY_COLORS, FONT } from '../core/model.js';
import {
  aabb, center, clamp, dist, normRect, rotatePoint, simplify, smoothPoints, snap as snapV, toLocal, unionRects, inflate, pointInRect,
} from '../core/geometry.js';
import { boundsOf, contentBounds, handlePoints, hitTest, isConnectable, lineEnds, objectsInRect, objectsInsideFrame, resolveConnector } from '../core/hit.js';
import { toWorld, toScreen, zoomAt, panBy, fitRect, visibleRect, setZoomAt, stepZoom } from '../core/viewport.js';
import {
  THEMES, drawBackground, drawObject, drawObjects, setImageLoadHandler, textBoxHeight, fontFor, fitFontSize, layoutText, LINE_H, isRTL, themed,
} from '../core/render.js';
import {
  alignObjects, arrangeNotes, cloneObjects, detachConnectors, distributeObjects, expandGroups, groupIds, moveObjects, reorder, rotateObjects, scaleObject,
} from '../core/ops.js';
import { packObjects, unpackObjects, memoryClipboard, isBoardwiseClip } from '../core/clipboard.js';
import { htmlToText, textToNotes, ImportError } from '../core/sanitize.js';
import { fileToImage } from './images.js';
import { recognizeShape } from '../core/recognize.js';

const HANDLE = 9;          // px half-size hit area
const ROTATE_OFFSET = 28;  // px above the top edge
const DRAW_TOOLS = new Set(['pen', 'highlighter', 'eraser']);
const CREATE_TOOLS = new Set(['shape', 'text', 'sticky', 'frame', 'table', 'checklist', 'stamp']);
export const TOOLS = ['select', 'hand', 'pen', 'highlighter', 'eraser', 'shape', 'connector', 'text', 'sticky', 'frame', 'table', 'checklist', 'stamp', 'laser', 'comment'];

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Engine {
  constructor(store, { prefs, announce = () => {}, notify = () => {}, t = (k) => k, voterId = 'local' } = {}) {
    this.store = store;
    this.prefs = prefs;
    this.announce = announce;
    this.notify = notify;
    this.t = t;
    this.voterId = voterId;
    this.view = { ...(store.meta.view || { x: 0, y: 0, zoom: 1 }) };
    this.size = { w: 800, h: 600 };
    this.theme = 'light';
    this.tool = 'select';
    this.opts = {
      shapeKind: 'rect', connectorRoute: 'elbow', stamp: '👍', stickyColor: prefs.stickyColor || 'yellow',
      penColor: prefs.penColor, penWidth: prefs.penWidth, hlColor: prefs.highlighterColor, hlWidth: 18, smoothing: 1,
      fill: prefs.shapeFill, stroke: prefs.shapeStroke, inkToShape: false, voting: false, votesPerPerson: 5,
    };
    this.gesture = null;
    this.pointers = new Map();
    this.spaceDown = false;
    this.listeners = new Set();
    this.uiVersion = 0;
    this.draft = null;      // in-progress pen stroke / shape preview
    this.laser = [];        // fading laser trail
    this.remote = new Map(); // peerId -> {x,y,name,color,t}
    this.highlight = null;  // {id, until} search pulse
    this.hover = null;
    this.editor = null;
    this.dirtyFrame = true;
    this.frameCount = 0;
    this.lastDraw = 0;
    this.stats = { drawn: 0 };
    this._uiDirty = false;
    this._lastUi = 0;
    this._unsub = store.subscribe(() => { this.dirtyFrame = true; this._uiDirty = true; this._schedule(); });
    setImageLoadHandler(() => this.requestRender());
  }

  // ---------------- lifecycle ----------------
  attach(container, canvas) {
    this.container = container;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); (this._off ||= []).push(() => el.removeEventListener(ev, fn, o)); };
    on(canvas, 'pointerdown', (e) => this.onPointerDown(e));
    on(canvas, 'pointermove', (e) => this.onPointerMove(e));
    on(canvas, 'pointerup', (e) => this.onPointerUp(e));
    on(canvas, 'pointercancel', (e) => this.onPointerUp(e, true));
    on(canvas, 'pointerleave', () => { this.hover = null; });
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'dblclick', (e) => this.onDoubleClick(e));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; this._cursor(); } });
    on(window, 'blur', () => { this.spaceDown = false; });
    on(document, 'paste', (e) => this.onPaste(e));
    on(document, 'copy', (e) => this.onCopyCut(e, false));
    on(document, 'cut', (e) => this.onCopyCut(e, true));
    on(container, 'dragover', (e) => { e.preventDefault(); });
    on(container, 'drop', (e) => this.onDrop(e));
    this.requestRender();
  }

  detach() {
    this._off?.forEach((f) => f());
    this._off = [];
    this.ro?.disconnect();
    this._unsub?.();
    this.closeEditor(true);
    cancelAnimationFrame(this.raf);
  }

  resize() {
    if (!this.container) return;
    const r = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.size = { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
    this.canvas.width = Math.round(this.size.w * dpr);
    this.canvas.height = Math.round(this.size.h * dpr);
    this.canvas.style.width = this.size.w + 'px';
    this.canvas.style.height = this.size.h + 'px';
    this.dpr = dpr;
    this.requestRender();
    this._emit();
  }

  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getVersion = () => this.uiVersion;
  _emit() { this.uiVersion++; for (const f of this.listeners) f(); }

  requestRender() { this.dirtyFrame = true; this._schedule(); }
  _schedule() { if (!this.raf && this.canvas) this.raf = requestAnimationFrame((t) => { this.raf = 0; this.draw(t); }); }

  setTheme(theme) { this.theme = theme; this.requestRender(); }

  // ---------------- view ----------------
  setView(v, emit = true) {
    this.view = { x: v.x, y: v.y, zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM) };
    this.requestRender();
    this._viewChanged = true;
    if (emit) this._emit();
    clearTimeout(this._viewT);
    this._viewT = setTimeout(() => this.store.setMeta({ view: { ...this.view } }), 600);
    this.positionEditor();
  }
  zoomBy(factor, sx = this.size.w / 2, sy = this.size.h / 2) { this.setView(zoomAt(this.view, factor, sx, sy)); }
  zoomStep(dir) { const z = stepZoom(this.view.zoom, dir); this.setView(setZoomAt(this.view, z, this.size.w / 2, this.size.h / 2)); }
  zoomTo(z) { this.setView(setZoomAt(this.view, z, this.size.w / 2, this.size.h / 2)); }
  resetView() { this.setView({ x: -this.size.w / 2, y: -this.size.h / 2, zoom: 1 }); }
  fitContent(ids) {
    const rect = ids?.length
      ? unionRects(ids.map((id) => boundsOf(this.store.get(id), this.store.objects)))
      : contentBounds(this.store);
    if (!rect) return this.resetView();
    this.setView(fitRect(rect, this.size.w, this.size.h));
  }
  /** Center the view on a world rect, keeping zoom unless it would be off-screen. */
  focusRect(rect, { minZoom = 0.5 } = {}) {
    const zoom = clamp(Math.max(this.view.zoom, minZoom), MIN_ZOOM, MAX_ZOOM);
    this.setView({ zoom, x: rect.x + rect.w / 2 - this.size.w / 2 / zoom, y: rect.y + rect.h / 2 - this.size.h / 2 / zoom });
  }
  pulse(id) { this.highlight = { id, until: performance.now() + (reducedMotion() ? 2500 : 1600) }; this.requestRender(); }
  screenToWorld(sx, sy) { return toWorld(this.view, sx, sy); }
  worldToScreen(wx, wy) { return toScreen(this.view, wx, wy); }
  _local(e) { const r = this.canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }

  // ---------------- tools & options ----------------
  setTool(tool, extra) {
    if (this.editor) this.closeEditor();
    if (this.gesture) this.cancelGesture();
    this.tool = tool;
    if (extra) Object.assign(this.opts, extra);
    if (tool !== 'select' && tool !== 'hand') { /* keep selection visible for context panel */ }
    this.laser = [];
    this._cursor();
    this.announce(this.t('announce.tool', { tool: this.t('tool.' + tool) }));
    this._emit();
    this.requestRender();
  }
  setOpt(k, v) { this.opts[k] = v; this._emit(); }

  _cursor() {
    if (!this.canvas) return;
    let c = 'default';
    if (this.spaceDown || this.tool === 'hand') c = this.gesture?.type === 'pan' ? 'grabbing' : 'grab';
    else if (DRAW_TOOLS.has(this.tool) || this.tool === 'laser') c = 'crosshair';
    else if (CREATE_TOOLS.has(this.tool) || this.tool === 'connector' || this.tool === 'comment') c = 'crosshair';
    this.canvas.style.cursor = c;
  }

  // ---------------- selection ----------------
  get selection() { return this.store.selection; }
  selected() { return [...this.store.selection].map((id) => this.store.get(id)).filter(Boolean); }
  select(ids, { add = false } = {}) {
    const next = add ? new Set([...this.store.selection, ...ids]) : new Set(ids);
    this.store.selection = expandGroups(this.store, next);
    this._announceSelection();
    this._emit(); this.requestRender();
  }
  clearSelection() { if (this.store.selection.size) { this.store.selection = new Set(); this._emit(); this.requestRender(); } }
  toggleSelect(id) {
    const s = new Set(this.store.selection);
    const grp = expandGroups(this.store, [id]);
    const on = s.has(id);
    for (const g of grp) on ? s.delete(g) : s.add(g);
    this.store.selection = s; this._announceSelection(); this._emit(); this.requestRender();
  }
  selectAll() { this.select(this.store.order.filter((id) => !this.store.get(id).locked)); }
  describe(o) {
    const n = this.t('type.' + (o.type === 'shape' ? 'shape.' + o.kind : o.type));
    const txt = o.type === 'image' ? o.alt : (o.text || o.title || o.label || '');
    return txt ? `${n}: ${txt.slice(0, 80)}` : n;
  }
  _announceSelection() {
    const s = this.selected();
    if (s.length === 1) this.announce(this.t('announce.selected', { what: this.describe(s[0]) }));
    else if (s.length > 1) this.announce(this.t('announce.selectedN', { n: s.length }));
    else this.announce(this.t('announce.deselected'));
  }
  selectionBounds() {
    const sel = this.selected();
    if (!sel.length) return null;
    if (sel.length === 1 && sel[0].type !== 'connector') return null; // single objects use their own frame
    return unionRects(sel.map((o) => boundsOf(o, this.store.objects)));
  }

  // ---------------- hit helpers ----------------
  _tolWorld(px = 6) { return px / this.view.zoom; }
  _snap(v) { return this.store.meta.settings?.snap ? snapV(v, this.store.meta.settings.gridSize || 24) : v; }

  /** Which selection handle (if any) is under the screen point? */
  _handleAt(sx, sy) {
    const sel = this.selected();
    if (!sel.length) return null;
    const hs = this._handles();
    for (const h of hs) {
      const p = toScreen(this.view, h.x, h.y);
      if (Math.abs(p.x - sx) <= HANDLE && Math.abs(p.y - sy) <= HANDLE) return h;
    }
    return null;
  }

  /** Handles for the current selection, in world coords. */
  _handles() {
    const sel = this.selected();
    if (!sel.length || sel.some((o) => o.locked) && sel.length === 1) return [];
    if (sel.length === 1) {
      const o = sel[0];
      if (o.locked) return [];
      if (o.type === 'connector') {
        const r = resolveConnector(o, this.store.objects);
        return [{ name: 'from', x: r.a.x, y: r.a.y, kind: 'endpoint' }, { name: 'to', x: r.b.x, y: r.b.y, kind: 'endpoint' }];
      }
      if (o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow')) {
        const [s, e] = lineEnds(o);
        const c = center(o);
        const ps = o.rotation ? rotatePoint(s, c, o.rotation) : s, pe = o.rotation ? rotatePoint(e, c, o.rotation) : e;
        return [{ name: 'from', x: ps.x, y: ps.y, kind: 'endpoint' }, { name: 'to', x: pe.x, y: pe.y, kind: 'endpoint' }];
      }
      const pts = handlePoints(o);
      const out = Object.entries(pts).map(([name, p]) => ({ name, ...p, kind: 'resize' }));
      if (o.type === 'text') return out.filter((h) => ['e', 'w', 'se', 'sw', 'ne', 'nw'].includes(h.name)).map((h) => h).concat(this._rotateHandle(o));
      return out.concat(this._rotateHandle(o));
    }
    const b = unionRects(sel.map((o) => boundsOf(o, this.store.objects)));
    const box = { x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0 };
    const pts = handlePoints(box);
    const rot = { name: 'rotate', x: b.x + b.w / 2, y: b.y - ROTATE_OFFSET / this.view.zoom, kind: 'rotate' };
    return Object.entries(pts).map(([name, p]) => ({ name, ...p, kind: 'resize' })).concat(sel.some((o) => o.locked) ? [] : [rot]);
  }
  _rotateHandle(o) {
    const c = center(o);
    const top = { x: c.x, y: o.y - ROTATE_OFFSET / this.view.zoom };
    const p = o.rotation ? rotatePoint(top, c, o.rotation) : top;
    return [{ name: 'rotate', x: p.x, y: p.y, kind: 'rotate' }];
  }

  // ---------------- pointer events ----------------
  onPointerDown(e) {
    if (this.editor) this.closeEditor();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture?.(e.pointerId);
    const { sx, sy } = this._local(e);
    this.pointers.set(e.pointerId, { sx, sy, type: e.pointerType });
    // Two touch pointers => pinch/pan gesture, abandoning whatever the first finger started.
    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (touches.length >= 2) {
      if (this.gesture && this.gesture.type !== 'pinch') this.cancelGesture();
      const [a, b] = touches;
      this.gesture = { type: 'pinch', d0: dist({ x: a.sx, y: a.sy }, { x: b.sx, y: b.sy }), view0: { ...this.view }, mid0: { x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 } };
      return;
    }
    if (this.gesture) return;
    const world = toWorld(this.view, sx, sy);
    const middle = e.button === 1;
    if (middle || this.spaceDown || this.tool === 'hand' || e.button === 2) {
      this.gesture = { type: 'pan', last: { sx, sy } };
      this._cursor();
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    switch (this.tool) {
      case 'select': return this._downSelect(e, sx, sy, world);
      case 'pen': case 'highlighter': return this._downDraw(e, world);
      case 'eraser': return this._downErase(e, world);
      case 'laser': this.gesture = { type: 'laser' }; this._laserPoint(world); return;
      case 'connector': return this._downConnector(world);
      case 'comment': this.notify('comment-request', { x: world.x, y: world.y }); return;
      default:
        if (CREATE_TOOLS.has(this.tool)) return this._downCreate(e, world);
    }
  }

  onPointerMove(e) {
    const { sx, sy } = this._local(e);
    if (this.pointers.has(e.pointerId)) { const p = this.pointers.get(e.pointerId); p.sx = sx; p.sy = sy; }
    const world = toWorld(this.view, sx, sy);
    this.cursorWorld = world;
    this.notify('cursor', world);
    const g = this.gesture;
    if (!g) { this._hover(sx, sy, world); return; }
    switch (g.type) {
      case 'pinch': return this._movePinch();
      case 'pan': { this.setView(panBy(this.view, sx - g.last.sx, sy - g.last.sy)); g.last = { sx, sy }; return; }
      case 'move': return this._moveMove(e, world);
      case 'resize': return this._moveResize(e, world);
      case 'rotate': return this._moveRotate(e, world);
      case 'endpoint': return this._moveEndpoint(world);
      case 'marquee': return this._moveMarquee(e, sx, sy, world);
      case 'draw': return this._moveDraw(e, world);
      case 'erase': return this._moveErase(world);
      case 'laser': this._laserPoint(world); return;
      case 'create': return this._moveCreate(e, world);
      case 'connect': return this._moveConnect(world);
      default: break;
    }
  }

  onPointerUp(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch') { if ([...this.pointers.values()].filter((p) => p.type === 'touch').length < 2) this.gesture = null; return; }
    const { sx, sy } = this._local(e);
    const world = toWorld(this.view, sx, sy);
    switch (g.type) {
      case 'pan': this.gesture = null; this._cursor(); break;
      case 'move': this._upMove(e, cancelled); break;
      case 'resize': case 'rotate': case 'endpoint':
        this.store.commit(g.type === 'resize' ? 'Resize' : g.type === 'rotate' ? 'Rotate' : 'Edit line'); this.gesture = null; break;
      case 'marquee': this._upMarquee(e); break;
      case 'draw': this._upDraw(cancelled); break;
      case 'erase': this.store.commit('Erase'); this.gesture = null; this.draft = null; this.requestRender(); break;
      case 'laser': this.gesture = null; this.requestRender(); break;
      case 'create': this._upCreate(world, cancelled); break;
      case 'connect': this._upConnect(world, cancelled); break;
      default: this.gesture = null;
    }
    this._emit();
  }

  cancelGesture() {
    if (!this.gesture) return;
    if (this.store.base) this.store.cancel();
    this.gesture = null; this.draft = null; this.requestRender(); this._emit();
  }

  _hover(sx, sy, world) {
    const h = this.tool === 'select' ? this._handleAt(sx, sy) : null;
    let cursor = null;
    if (h) cursor = h.kind === 'rotate' ? 'grab' : h.kind === 'endpoint' ? 'move' : ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h.name]);
    else if (this.tool === 'select') {
      const o = hitTest(this.store, world, this.view.zoom);
      this.hover = o ? o.id : null;
      cursor = o ? (o.locked ? 'not-allowed' : 'move') : 'default';
    } else if (this.tool === 'connector') {
      const o = hitTest(this.store, world, this.view.zoom);
      const id = o && isConnectable(o) ? o.id : null;
      if (id !== this.hover) { this.hover = id; this.requestRender(); }
    }
    if (cursor && this.canvas.style.cursor !== cursor && !this.spaceDown) this.canvas.style.cursor = cursor;
    else if (!cursor && this.tool === 'select') this.canvas.style.cursor = 'default';
    if (this.tool === 'select') this.requestRender();
  }

  onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this._local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.size.h : 1;
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * unit * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025));
      this.setView(zoomAt(this.view, f, sx, sy));
    } else {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      this.setView(panBy(this.view, -dx * unit, -dy * unit));
    }
  }

  _movePinch() {
    const g = this.gesture;
    const ts = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (ts.length < 2) return;
    const [a, b] = ts;
    const d = dist({ x: a.sx, y: a.sy }, { x: b.sx, y: b.sy });
    const mid = { x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 };
    const zoom = clamp(g.view0.zoom * (d / g.d0), MIN_ZOOM, MAX_ZOOM);
    const wMid = toWorld(g.view0, g.mid0.x, g.mid0.y);
    this.setView({ zoom, x: wMid.x - mid.x / zoom, y: wMid.y - mid.y / zoom });
  }

  // ---------------- select tool ----------------
  _downSelect(e, sx, sy, world) {
    const h = this._handleAt(sx, sy);
    const sel = this.selected();
    if (h) {
      if (h.kind === 'resize') return this._startResize(h, world, e);
      if (h.kind === 'rotate') return this._startRotate(world);
      if (h.kind === 'endpoint') { this.store.begin(); this.gesture = { type: 'endpoint', which: h.name, id: sel[0].id }; return; }
    }
    const hit = hitTest(this.store, world, this.view.zoom);
    if (hit) {
      // Voting: click a sticky adds one of this person's dots.
      if (this.opts.voting && hit.type === 'sticky') { this.vote(hit.id, e.shiftKey ? -1 : 1); return; }
      // Checklist checkbox
      if (hit.type === 'checklist' && !hit.locked) {
        const i = this._checklistIndexAt(hit, world);
        if (i >= 0 && world.x - hit.x < 34) { this.toggleChecklist(hit.id, i); return; }
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) { this.toggleSelect(hit.id); return; }
      if (!this.store.selection.has(hit.id)) this.select([hit.id]);
      if (hit.locked) { this.announce(this.t('announce.locked')); this.gesture = { type: 'noop' }; return; }
      this._startMove(e, world);
      return;
    }
    // empty space
    if (!(e.shiftKey)) this.clearSelection();
    if (e.pointerType === 'touch') { this.gesture = { type: 'pan', last: { sx, sy } }; return; }
    this.gesture = { type: 'marquee', start: world, cur: world, base: e.shiftKey ? new Set(this.store.selection) : new Set() };
  }

  _startMove(e, world) {
    let sel = this.selected().filter((o) => !o.locked);
    if (!sel.length) return;
    this.store.begin();
    let dup = false;
    if (e.altKey) {
      const clones = cloneObjects(sel, this.store.objects, 0, 0);
      this.store.apply({ set: Object.fromEntries(clones.map((c) => [c.id, c])) });
      this.store.selection = new Set(clones.map((c) => c.id));
      sel = clones; dup = true;
    }
    const ids = new Set(sel.map((o) => o.id));
    // moving a frame carries what's inside it
    const extra = [];
    for (const o of sel) if (o.type === 'frame') for (const c of objectsInsideFrame(this.store, o)) if (!ids.has(c.id) && !c.locked) { extra.push(c); ids.add(c.id); }
    const all = [...sel, ...extra];
    this.gesture = { type: 'move', start: world, orig: Object.fromEntries(all.map((o) => [o.id, o])), ids, moved: false, dup, bounds0: unionRects(all.map((o) => boundsOf(o, this.store.objects))) };
  }

  _moveMove(e, world) {
    const g = this.gesture;
    let dx = world.x - g.start.x, dy = world.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) * this.view.zoom < 3) return;
    g.moved = true;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (this.store.meta.settings?.snap) {
      dx = this._snap(g.bounds0.x + dx) - g.bounds0.x;
      dy = this._snap(g.bounds0.y + dy) - g.bounds0.y;
    }
    const origs = Object.values(g.orig);
    const patch = moveObjects(origs, dx, dy, { ...this.store.objects, ...g.orig }, g.ids);
    this.store.apply({ set: patch });
    this.notify('moved', null);
  }

  _upMove(e, cancelled) {
    const g = this.gesture;
    this.gesture = null;
    if (cancelled) { this.store.cancel(); return; }
    if (!g.moved && !g.dup) {
      this.store.cancel();
      return;
    }
    this.store.commit(g.dup ? 'Duplicate' : 'Move');
    if (g.dup) this.announce(this.t('announce.duplicated'));
  }

  _startResize(h, world, e) {
    const sel = this.selected();
    this.store.begin();
    const single = sel.length === 1 ? sel[0] : null;
    const b = single ? null : unionRects(sel.map((o) => boundsOf(o, this.store.objects)));
    this.gesture = { type: 'resize', handle: h.name, orig: Object.fromEntries(sel.map((o) => [o.id, o])), single: single && single.id, bounds0: b };
  }

  _moveResize(e, world) {
    const g = this.gesture;
    const name = g.handle;
    const keepAspect = e.shiftKey;
    if (g.single) {
      const o = g.orig[g.single];
      const c0 = center(o);
      const p = toLocal(o, world);
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      const snapped = (v) => this._snap(v);
      if (name.includes('w')) x1 = Math.min(snapped(p.x), x2 - 8);
      if (name.includes('e')) x2 = Math.max(snapped(p.x), x1 + 8);
      if (name.includes('n')) y1 = Math.min(snapped(p.y), y2 - 8);
      if (name.includes('s')) y2 = Math.max(snapped(p.y), y1 + 8);
      const lockRatio = (keepAspect || o.type === 'image') && name.length === 2;
      if (lockRatio) {
        const ratio = o.w / (o.h || 1);
        let w = x2 - x1, h = y2 - y1;
        if (w / h > ratio) w = h * ratio; else h = w / ratio;
        if (name.includes('w')) x1 = x2 - w; else x2 = x1 + w;
        if (name.includes('n')) y1 = y2 - h; else y2 = y1 + h;
      }
      let nw = x2 - x1, nh = y2 - y1;
      const next = { ...o };
      if (o.type === 'text') {
        if (name.length === 2) next.fontSize = clamp(Math.round(o.fontSize * (nw / o.w)), 8, 400);
        next.w = Math.max(40, nw);
        next.h = textBoxHeight({ ...next }, next.text, next.w);
        // keep the anchored edge fixed; height is derived
        const nc = { x: x1 + next.w / 2, y: (name.includes('n') ? y2 - next.h : y1) + next.h / 2 };
        const ncw = rotatePoint(nc, c0, o.rotation || 0);
        next.x = ncw.x - next.w / 2; next.y = ncw.y - next.h / 2;
        this.store.apply({ set: { [o.id]: next } });
        return;
      }
      const nc = { x: x1 + nw / 2, y: y1 + nh / 2 };
      const ncw = o.rotation ? rotatePoint(nc, c0, o.rotation) : nc;
      next.w = nw; next.h = nh; next.x = ncw.x - nw / 2; next.y = ncw.y - nh / 2;
      if (o.type === 'pen') {
        const sx = nw / (o.w || 1), sy = nh / (o.h || 1);
        next.pts = o.pts.map(([px, py, pr]) => [px * sx, py * sy, pr]);
      }
      if (o.type === 'table') { next.w = Math.max(o.cols * 40, nw); next.h = Math.max(o.rows * 24, nh); }
      this.store.apply({ set: { [o.id]: next } });
      return;
    }
    // multi-resize: scale about the opposite corner/edge of the union bounds
    const b = g.bounds0;
    const ox = name.includes('w') ? b.x + b.w : name.includes('e') ? b.x : b.x + b.w / 2;
    const oy = name.includes('n') ? b.y + b.h : name.includes('s') ? b.y : b.y + b.h / 2;
    let sx = name.includes('w') || name.includes('e') ? (world.x - ox) / ((name.includes('w') ? b.x : b.x + b.w) - ox || 1) : 1;
    let sy = name.includes('n') || name.includes('s') ? (world.y - oy) / ((name.includes('n') ? b.y : b.y + b.h) - oy || 1) : 1;
    sx = clamp(sx, 0.05, 50); sy = clamp(sy, 0.05, 50);
    if (keepAspect || name.length === 2) { const s = Math.max(sx, sy); if (name.length === 2) { sx = sy = s; } }
    const set = {};
    for (const o of Object.values(g.orig)) {
      const n = scaleObject(o, sx, sy, ox, oy);
      if (n.type === 'text') { n.fontSize = clamp(Math.round(o.fontSize * sx), 8, 400); n.h = textBoxHeight(n, n.text, n.w); }
      set[o.id] = n;
    }
    this.store.apply({ set });
  }

  _startRotate(world) {
    const sel = this.selected();
    this.store.begin();
    const b = sel.length === 1 ? { ...center(sel[0]) } : (() => { const u = unionRects(sel.map((o) => boundsOf(o, this.store.objects))); return { x: u.x + u.w / 2, y: u.y + u.h / 2 }; })();
    this.gesture = { type: 'rotate', c: b, a0: Math.atan2(world.y - b.y, world.x - b.x), orig: Object.fromEntries(sel.map((o) => [o.id, o])) };
  }

  _moveRotate(e, world) {
    const g = this.gesture;
    let d = Math.atan2(world.y - g.c.y, world.x - g.c.x) - g.a0;
    if (e.shiftKey) d = Math.round(d / (Math.PI / 12)) * (Math.PI / 12);
    this.store.apply({ set: rotateObjects(Object.values(g.orig), d, g.c) });
  }

  _moveEndpoint(world) {
    const g = this.gesture;
    const o = this.store.get(g.id);
    if (!o) return;
    if (o.type === 'connector') {
      const target = hitTest(this.store, world, this.view.zoom, { ignore: new Set([o.id]) });
      this.hover = target && isConnectable(target) ? target.id : null;
      const end = this.hover ? { id: this.hover, side: 'auto', x: world.x, y: world.y } : { x: this._snap(world.x), y: this._snap(world.y) };
      this.store.apply({ set: { [o.id]: { ...o, [g.which]: end } } });
    } else {
      // line / arrow shape: move one end, rebuild box + flips
      const [s, e] = lineEnds({ ...o, rotation: 0 });
      const c = center(o);
      const ps = o.rotation ? rotatePoint(s, c, o.rotation) : s, pe = o.rotation ? rotatePoint(e, c, o.rotation) : e;
      const w = { x: this._snap(world.x), y: this._snap(world.y) };
      const A = g.which === 'from' ? w : ps, B = g.which === 'to' ? w : pe;
      this.store.apply({ set: { [o.id]: { ...o, rotation: 0, x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), w: Math.abs(B.x - A.x), h: Math.abs(B.y - A.y), flipX: A.x > B.x, flipY: A.y > B.y } } });
    }
  }

  _moveMarquee(e, sx, sy, world) {
    const g = this.gesture;
    g.cur = world;
    const r = normRect(g.start.x, g.start.y, world.x, world.y);
    const hits = objectsInRect(this.store, r, { contain: e.altKey }).filter((o) => o.type !== 'frame' || (r.w > o.w * 0.9 && r.h > o.h * 0.9));
    this.store.selection = expandGroups(this.store, new Set([...g.base, ...hits.map((o) => o.id)]));
    this.requestRender();
  }
  _upMarquee() { this.gesture = null; this._announceSelection(); this.requestRender(); }

  // ---------------- drawing ----------------
  _downDraw(e, world) {
    const hl = this.tool === 'highlighter';
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
    this.gesture = { type: 'draw', hl, pts: [{ x: world.x, y: world.y, p: pressure }], pen: e.pointerType === 'pen' };
    this.draft = null;
    this._updateDraft();
  }
  _moveDraw(e, world) {
    const g = this.gesture;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const min = 0.8 / this.view.zoom;
    for (const ev of (events.length ? events : [e])) {
      const { sx, sy } = this._local(ev);
      const w = toWorld(this.view, sx, sy);
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(w.x - last.x, w.y - last.y) < min) continue;
      g.pts.push({ x: w.x, y: w.y, p: g.pen ? ev.pressure || 0.5 : 0.5 });
    }
    this._updateDraft();
  }
  _updateDraft() {
    const g = this.gesture;
    const o = this.opts;
    this.draft = makers.pen(g.pts.length === 1 ? [g.pts[0], { ...g.pts[0], x: g.pts[0].x + 0.01 }] : g.pts, {
      color: g.hl ? o.hlColor : o.penColor, width: g.hl ? o.hlWidth : o.penWidth, highlighter: g.hl,
    });
    this.requestRender();
  }
  _upDraw(cancelled) {
    const g = this.gesture;
    this.gesture = null;
    const draft = this.draft;
    this.draft = null;
    if (cancelled || !draft) { this.requestRender(); return; }
    let pts = g.pts;
    if (this.opts.smoothing > 0 && pts.length > 2) pts = smoothPoints(pts, this.opts.smoothing);
    pts = simplify(pts, 0.35 / this.view.zoom);
    // Optional local "ink to shape": runs entirely on-device.
    if (this.opts.inkToShape && !g.hl && pts.length > 8) {
      const rec = recognizeShape(pts);
      if (rec) {
        const style = { stroke: this.opts.penColor, strokeWidth: Math.max(2, this.opts.penWidth), fill: 'transparent' };
        const shape = rec.kind === 'line' || rec.kind === 'arrow'
          ? makers.shape(rec.kind, rec.x, rec.y, rec.w, rec.h, { ...style, flipX: rec.flipX, flipY: rec.flipY })
          : makers.shape(rec.kind, rec.x, rec.y, rec.w, rec.h, style);
        this.store.add(shape, 'Ink to shape');
        this.announce(this.t('announce.inkToShape', { shape: this.t('type.shape.' + rec.kind) }));
        return;
      }
    }
    const pen = makers.pen(pts, { color: draft.color, width: draft.width, highlighter: g.hl });
    this.store.add(pen, g.hl ? 'Highlight' : 'Draw');
    this.requestRender();
  }

  _downErase(e, world) {
    this.store.begin();
    this.gesture = { type: 'erase' };
    this._eraseAt(world);
    this.draft = null;
  }
  _moveErase(world) { this._eraseAt(world); this.eraserPos = world; this.requestRender(); }
  _eraseAt(world) {
    this.eraserPos = world;
    const r = Math.max(6, 10 / this.view.zoom);
    const hit = [];
    for (const id of this.store.order) {
      const o = this.store.get(id);
      if (o.type !== 'pen' || o.locked) continue;
      const b = boundsOf(o, this.store.objects);
      if (world.x < b.x - r - o.width || world.x > b.x + b.w + r + o.width || world.y < b.y - r - o.width || world.y > b.y + b.h + r + o.width) continue;
      const pts = o.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = { x: o.x + pts[i][0], y: o.y + pts[i][1] };
        const nb = i + 1 < pts.length ? { x: o.x + pts[i + 1][0], y: o.y + pts[i + 1][1] } : a;
        if (distSeg(world, a, nb) <= r + o.width / 2) { hit.push(id); break; }
      }
    }
    if (hit.length) { this.store.apply({ remove: hit }); this._emit(); }
  }

  _laserPoint(world) {
    this.laser.push({ x: world.x, y: world.y, t: performance.now() });
    this.notify('laser', world);
    this.requestRender();
    this._laserLoop();
  }
  _laserLoop() {
    if (this._laserRaf) return;
    const tick = () => {
      this._laserRaf = 0;
      const now = performance.now();
      const life = reducedMotion() ? 0 : 1200;
      this.laser = this.gesture?.type === 'laser' && reducedMotion() ? this.laser.slice(-1) : this.laser.filter((p) => now - p.t < life + 1);
      this.requestRender();
      if (this.laser.length && !reducedMotion()) this._laserRaf = requestAnimationFrame(tick);
    };
    this._laserRaf = requestAnimationFrame(tick);
  }

  // ---------------- creating objects ----------------
  _defaultCreate(world) {
    const o = this.opts;
    const x = this._snap(world.x), y = this._snap(world.y);
    switch (this.tool) {
      case 'shape': {
        const line = o.shapeKind === 'line' || o.shapeKind === 'arrow';
        const w = line ? 160 : 160, h = line ? 0 : o.shapeKind === 'ellipse' || o.shapeKind === 'star' ? 120 : 100;
        return makers.shape(o.shapeKind, x - w / 2, y - h / 2, w, h, line ? { stroke: o.stroke } : { fill: o.fill, stroke: o.stroke });
      }
      case 'text': return makers.text(x, y - 18, 240, 40);
      case 'sticky': return makers.sticky(x - 90, y - 90, o.stickyColor);
      case 'frame': return makers.frame(x - 240, y - 160, 480, 320, this.t('frame.defaultTitle', { n: this.store.list().filter((q) => q.type === 'frame').length + 1 }));
      case 'table': return makers.table(x - 180, y - 60, 3, 3);
      case 'checklist': return makers.checklist(x - 130, y - 70, [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }]);
      case 'stamp': return makers.stamp(x - 28, y - 28, o.emoji || o.stamp);
      default: return null;
    }
  }

  _downCreate(e, world) {
    if (this.tool === 'stamp') {
      const s = makers.stamp(world.x - 28, world.y - 28, this.opts.stamp);
      this.store.add(s, 'Stamp');
      this.announce(this.t('announce.added', { what: this.t('type.stamp') }));
      return;
    }
    this.store.begin();
    this.gesture = { type: 'create', start: { x: this._snap(world.x), y: this._snap(world.y) }, obj: null, dragged: false };
  }

  _moveCreate(e, world) {
    const g = this.gesture;
    const dx = world.x - g.start.x, dy = world.y - g.start.y;
    if (!g.dragged && Math.hypot(dx, dy) * this.view.zoom < 6) return;
    g.dragged = true;
    const isLine = this.tool === 'shape' && (this.opts.shapeKind === 'line' || this.opts.shapeKind === 'arrow');
    let x2 = this._snap(world.x), y2 = this._snap(world.y);
    if (e.shiftKey) {
      if (isLine) { const a = Math.round(Math.atan2(y2 - g.start.y, x2 - g.start.x) / (Math.PI / 4)) * (Math.PI / 4); const d = Math.hypot(x2 - g.start.x, y2 - g.start.y); x2 = g.start.x + Math.cos(a) * d; y2 = g.start.y + Math.sin(a) * d; }
      else { const s = Math.max(Math.abs(x2 - g.start.x), Math.abs(y2 - g.start.y)); x2 = g.start.x + Math.sign(x2 - g.start.x || 1) * s; y2 = g.start.y + Math.sign(y2 - g.start.y || 1) * s; }
    }
    const r = normRect(g.start.x, g.start.y, x2, y2);
    if (!g.obj) { g.obj = this._defaultCreate({ x: 0, y: 0 }); this.store.apply({ set: { [g.obj.id]: g.obj } }); }
    const o = this.store.get(g.obj.id);
    const min = isLine ? 0 : 20;
    const next = { ...o, x: r.x, y: r.y, w: Math.max(r.w, min), h: Math.max(r.h, min) };
    if (isLine) { next.flipX = x2 < g.start.x; next.flipY = y2 < g.start.y; next.h = r.h; }
    if (o.type === 'text') { next.h = textBoxHeight(next, next.text, next.w); }
    if (o.type === 'table') { next.w = Math.max(o.cols * 40, r.w); next.h = Math.max(o.rows * 24, r.h); }
    if (o.type === 'checklist') { next.w = Math.max(160, r.w); next.h = o.h; }
    this.store.apply({ set: { [o.id]: next } });
  }

  _upCreate(world, cancelled) {
    const g = this.gesture;
    this.gesture = null;
    if (cancelled) { this.store.cancel(); return; }
    let obj = g.obj ? this.store.get(g.obj.id) : null;
    if (!obj) { obj = this._defaultCreate(g.start); this.store.apply({ set: { [obj.id]: obj } }); }
    this.store.selection = new Set([obj.id]);
    const label = this.t('type.' + (obj.type === 'shape' ? 'shape.' + obj.kind : obj.type));
    this.announce(this.t('announce.added', { what: label }));
    const editable = ['text', 'sticky', 'frame'].includes(obj.type) || (obj.type === 'shape' && !['line', 'arrow'].includes(obj.kind));
    if (obj.type === 'text' || obj.type === 'sticky') {
      this.tool = 'select'; this._cursor();
      this.startEdit(obj.id, { isNew: true });   // creation + typing form a single undo step
    } else {
      this.store.commit('Add ' + label);
      this.tool = 'select'; this._cursor();
      if (obj.type === 'frame' || (editable && false)) this.startEdit(obj.id);
    }
    this._emit();
  }

  // ---------------- connectors ----------------
  _downConnector(world) {
    const target = hitTest(this.store, world, this.view.zoom);
    const attach = target && isConnectable(target) ? target : null;
    this.store.begin();
    const from = attach ? { id: attach.id, side: 'auto', x: world.x, y: world.y } : { x: this._snap(world.x), y: this._snap(world.y) };
    const c = makers.connector(from, { x: world.x, y: world.y }, { route: this.opts.connectorRoute, arrowEnd: true, stroke: this.opts.stroke === '#ffffff' ? '#1b1b1f' : this.opts.stroke });
    this.store.apply({ set: { [c.id]: c } });
    this.gesture = { type: 'connect', id: c.id, moved: false };
  }
  _moveConnect(world) {
    const g = this.gesture;
    const c = this.store.get(g.id);
    const target = hitTest(this.store, world, this.view.zoom, { ignore: new Set([c.id]) });
    const attach = target && isConnectable(target) ? target : null;
    this.hover = attach ? attach.id : null;
    g.moved = true;
    const to = attach ? { id: attach.id, side: 'auto', x: world.x, y: world.y } : { x: this._snap(world.x), y: this._snap(world.y) };
    this.store.apply({ set: { [c.id]: { ...c, to } } });
  }
  _upConnect(world, cancelled) {
    const g = this.gesture;
    this.gesture = null; this.hover = null;
    const c = this.store.get(g.id);
    const r = c && resolveConnector(c, this.store.objects);
    if (cancelled || !g.moved || !r || Math.hypot(r.a.x - r.b.x, r.a.y - r.b.y) < 8) { this.store.cancel(); return; }
    this.store.commit('Connector');
    this.store.selection = new Set([g.id]);
    this.announce(this.t('announce.added', { what: this.t('type.connector') }));
    this.tool = 'select'; this._cursor();
  }

  // ---------------- double click / text editing ----------------
  onDoubleClick(e) {
    if (this.tool !== 'select') return;
    const { sx, sy } = this._local(e);
    const world = toWorld(this.view, sx, sy);
    const hit = hitTest(this.store, world, this.view.zoom);
    if (!hit) {
      // double-click empty space: quick sticky note
      const o = makers.sticky(world.x - 90, world.y - 90, this.opts.stickyColor);
      this.store.begin(); this.store.apply({ set: { [o.id]: o } });
      this.store.selection = new Set([o.id]);
      this.startEdit(o.id, { isNew: true });
      return;
    }
    if (hit.locked) return;
    this.editObject(hit, world);
  }

  editObject(o, world) {
    this.select([o.id]);
    if (o.type === 'table') {
      const r = Math.min(o.rows - 1, Math.max(0, Math.floor(((world?.y ?? o.y) - o.y) / (o.h / o.rows))));
      const c = Math.min(o.cols - 1, Math.max(0, Math.floor(((world?.x ?? o.x) - o.x) / (o.w / o.cols))));
      this.startEdit(o.id, { cell: [r, c] });
    } else if (o.type === 'checklist') {
      const i = world ? this._checklistIndexAt(o, world) : 0;
      this.startEdit(o.id, { item: i });
    } else if (['text', 'sticky', 'shape', 'frame', 'connector', 'image'].includes(o.type)) {
      if (o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow')) return;
      this.startEdit(o.id, {});
    }
  }

  _checklistIndexAt(o, world) {
    const y = world.y - o.y;
    if (y < 44) return -1;
    return Math.min(o.items.length - 1, Math.floor((y - 44) / 32));
  }

  toggleChecklist(id, i) {
    const o = this.store.get(id);
    const items = o.items.map((it, k) => (k === i ? { ...it, done: !it.done } : it));
    this.store.update(id, { items }, 'Toggle item');
    this.announce(this.t(items[i].done ? 'announce.itemDone' : 'announce.itemUndone', { text: items[i].text }));
  }

  /** Create the DOM editor over an object's text field. */
  startEdit(id, sub = {}) {
    const o = this.store.get(id);
    if (!o) return;
    this.closeEditor();
    const standalone = !this.store.base;
    if (standalone) this.store.begin();
    const el = document.createElement('textarea');
    el.className = 'bw-editor';
    el.setAttribute('aria-label', this.t('editor.label', { what: this.describe(o) }));
    el.spellcheck = true;
    this.container.appendChild(el);
    const field = this._fieldFor(o, sub);
    el.value = field.get();
    this.editor = { id, sub, el, field, isNew: !!sub.isNew, standalone: standalone || !!sub.isNew, orig: o };
    el.addEventListener('input', () => this._onEditorInput());
    el.addEventListener('keydown', (ev) => this._onEditorKey(ev));
    el.addEventListener('blur', () => { if (this.editor?.el === el) this.closeEditor(); });
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    this.positionEditor();
    this._emit();
    this.requestRender();
    el.focus({ preventScroll: true }); el.select();
    requestAnimationFrame(() => { if (this.editor?.el === el && document.activeElement !== el) { el.focus({ preventScroll: true }); el.select(); } });
  }

  _fieldFor(o, sub) {
    const set = (changes) => { const cur = this.store.get(o.id); if (cur) this.store.apply({ set: { [o.id]: { ...cur, ...changes } } }); };
    switch (o.type) {
      case 'text': return { get: () => o.text, set: (v) => { const cur = this.store.get(o.id); set({ text: v, h: textBoxHeight(cur, v, cur.w) }); } };
      case 'sticky': case 'shape': return { get: () => o.text, set: (v) => set({ text: v }) };
      case 'frame': return { get: () => o.title, set: (v) => set({ title: v }) };
      case 'connector': return { get: () => o.label, set: (v) => set({ label: v }) };
      case 'image': return { get: () => o.alt, set: (v) => set({ alt: v }) };
      case 'table': { const [r, c] = sub.cell; return { get: () => o.cells[r][c], set: (v) => { const cur = this.store.get(o.id); set({ cells: cur.cells.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? v : cell))) }); } }; }
      case 'checklist': {
        const i = sub.item ?? 0;
        if (i < 0) return { get: () => o.title, set: (v) => set({ title: v }) };
        return { get: () => o.items[i]?.text || '', set: (v) => { const cur = this.store.get(o.id); set({ items: cur.items.map((it, k) => (k === i ? { ...it, text: v } : it)) }); } };
      }
      default: return { get: () => '', set: () => {} };
    }
  }

  _onEditorInput() {
    const ed = this.editor;
    if (!ed) return;
    ed.field.set(ed.el.value);
    this.positionEditor();
  }

  _onEditorKey(ev) {
    const ed = this.editor;
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); this.closeEditor(); this.canvas.focus(); return; }
    const o = this.store.get(ed.id);
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.closeEditor(); this.canvas.focus(); return; }
    if (o?.type === 'checklist' && ed.sub.item >= 0 && ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const i = ed.sub.item ?? 0;
      const items = [...o.items.slice(0, i + 1), { text: '', done: false }, ...o.items.slice(i + 1)];
      this._flushChecklist(o.id, items, i + 1);
      return;
    }
    if (o?.type === 'checklist' && ev.key === 'Backspace' && ed.el.value === '' && o.items.length > 1 && ed.sub.item > 0) {
      ev.preventDefault();
      const i = ed.sub.item;
      this._flushChecklist(o.id, o.items.filter((_, k) => k !== i), i - 1);
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey && (o?.type === 'frame' || o?.type === 'connector' || o?.type === 'table' || o?.type === 'image')) { ev.preventDefault(); this.closeEditor(); this.canvas.focus(); return; }
    if (ev.key === 'Tab' && o?.type === 'table') {
      ev.preventDefault();
      let [r, c] = ed.sub.cell;
      c += ev.shiftKey ? -1 : 1;
      if (c >= o.cols) { c = 0; r++; } if (c < 0) { c = o.cols - 1; r--; }
      if (r >= 0 && r < o.rows) { const id = o.id; this.closeEditor(); this.startEdit(id, { cell: [r, c] }); }
    }
  }

  _flushChecklist(id, items, focusIndex) {
    const cur = this.store.get(id);
    this.store.apply({ set: { [id]: { ...cur, items, h: 44 + items.length * 32 } } });
    const wasStandalone = this.editor?.standalone;
    if (this.editor) { this.editor.el.remove(); this.editor = null; }
    this.startEdit(id, { item: focusIndex });
    if (this.editor) this.editor.standalone = wasStandalone;
  }

  closeEditor(silent = false) {
    const ed = this.editor;
    if (!ed) return;
    this.editor = null;
    ed.el.remove();
    const o = this.store.get(ed.id);
    const empty = !ed.el.value.trim();
    if (ed.isNew && empty && (o?.type === 'text' || o?.type === 'sticky') && this.store.base) {
      this.store.cancel(); // creation + nothing typed: discard entirely, no history entry
      this.clearSelection();
    } else if (this.store.base) {
      if (o?.type === 'checklist') this.store.apply({ set: { [o.id]: { ...o, h: 44 + o.items.length * 32 } } });
      this.store.commit(ed.isNew ? 'Add ' + this.t('type.' + o.type) : 'Edit text');
    }
    if (!silent) { this._emit(); this.requestRender(); }
  }

  /** Position/scale the textarea over the object being edited. */
  positionEditor() {
    const ed = this.editor;
    if (!ed) return;
    const o = this.store.get(ed.id);
    if (!o) return;
    const z = this.view.zoom;
    const el = ed.el;
    let box = { x: o.x, y: o.y, w: o.w, h: o.h };
    let size = o.fontSize || 16, align = o.align || 'left', color = '#1b1b1f', weight = o.bold ? 700 : 400, italic = o.italic, padding = 6, vMid = false, bg = 'transparent';
    if (o.type === 'sticky') { size = fitFontSize(o, el.value || ' ', o.w, o.h); padding = 12; const col = STICKY_COLORS.find((c) => c.id === o.color); bg = col?.fill; }
    else if (o.type === 'shape') { vMid = true; const m = o.kind === 'ellipse' ? 0.1 : ['triangle', 'diamond', 'star'].includes(o.kind) ? 0.2 : 0; box = { x: o.x + o.w * m, y: o.y + o.h * m, w: o.w * (1 - 2 * m), h: o.h * (1 - 2 * m) }; color = themed(o.color, this.theme); }
    else if (o.type === 'text') { color = themed(o.color, this.theme); }
    else if (o.type === 'frame') { box = { x: o.x, y: o.y - 30, w: Math.max(160, Math.min(o.w, 320)), h: 28 }; size = 14; weight = 600; padding = 0; color = THEMES[this.theme].ink; bg = THEMES[this.theme].bg; }
    else if (o.type === 'connector') { const r = resolveConnector(o, this.store.objects); const m = r.pts[Math.floor(r.pts.length / 2)]; box = { x: m.x - 70, y: m.y - 14, w: 140, h: 28 }; size = 15; align = 'center'; bg = THEMES[this.theme].bg; color = THEMES[this.theme].ink; }
    else if (o.type === 'image') { box = { x: o.x, y: o.y + o.h + 6, w: Math.max(220, o.w), h: 30 }; size = 14; bg = THEMES[this.theme].surface; color = THEMES[this.theme].ink; }
    else if (o.type === 'table') { const [r, c] = ed.sub.cell; const cw = o.w / o.cols, rh = o.h / o.rows; box = { x: o.x + c * cw, y: o.y + r * rh, w: cw, h: rh }; vMid = true; weight = o.header && r === 0 ? 700 : 400; bg = themed(o.fill, this.theme); color = themed(o.color, this.theme); }
    else if (o.type === 'checklist') { const i = ed.sub.item; box = i < 0 ? { x: o.x + 8, y: o.y + 6, w: o.w - 16, h: 32 } : { x: o.x + 36, y: o.y + 44 + i * 32, w: o.w - 48, h: 32 }; size = i < 0 ? o.fontSize + 2 : o.fontSize; weight = i < 0 ? 700 : 400; vMid = true; bg = themed(o.fill, this.theme); color = themed(o.color, this.theme); }
    const sp = toScreen(this.view, box.x, box.y);
    const lh = size * LINE_H * z;
    el.style.cssText = `position:absolute;left:0;top:0;width:${box.w * z}px;height:${box.h * z}px;transform-origin:${(box.w * z) / 2}px ${(box.h * z) / 2}px;` +
      `transform:translate(${sp.x}px,${sp.y}px)${o.rotation && !['frame', 'connector', 'image'].includes(o.type) ? ` rotate(${o.rotation}rad)` : ''};` +
      `font:${italic ? 'italic ' : ''}${weight} ${size * z}px/${lh}px ${FONT};text-align:${align};color:${color};background:${bg};` +
      `padding:${padding * z}px;border:2px solid ${THEMES[this.theme].selection};border-radius:${o.type === 'sticky' ? 6 * z : 3}px;resize:none;overflow:hidden;outline:none;box-sizing:border-box;z-index:5;direction:${isRTL(el.value) ? 'rtl' : 'ltr'};`;
    if (vMid) {
      const lines = Math.max(1, layoutText(o, el.value || ' ', box.w - padding * 2, size).length);
      const pad = Math.max(0, (box.h * z - lines * lh) / 2);
      el.style.paddingTop = pad + 'px';
    }
    if (o.type === 'text') { el.style.height = Math.max(box.h * z, lh + padding * 2 * z) + 'px'; }
  }

  // ---------------- commands on selection ----------------
  _selWritable() { return this.selected().filter((o) => !o.locked); }

  deleteSelection() {
    const sel = this._selWritable();
    if (!sel.length) return;
    const ids = new Set(sel.map((o) => o.id));
    this.store.apply({ set: detachConnectors(this.store.objects, ids), remove: [...ids] }, 'Delete');
    this.announce(this.t('announce.deleted', { n: sel.length }));
    this._emit();
  }

  duplicateSelection() {
    const sel = this.selected();
    if (!sel.length) return;
    const clones = cloneObjects(sel, this.store.objects, 24, 24);
    this.store.add(clones, 'Duplicate');
    this.store.selection = new Set(clones.map((c) => c.id));
    this.announce(this.t('announce.duplicated'));
    this._emit();
  }

  nudge(dx, dy) {
    const sel = this._selWritable();
    if (!sel.length) return;
    const patch = moveObjects(sel, dx, dy, this.store.objects, new Set(sel.map((o) => o.id)));
    // Coalesce rapid arrow-key nudges into one undo step.
    const now = performance.now();
    if (this._nudgeT && now - this._nudgeT < 600 && this._nudgeOpen) this.store.apply({ set: patch });
    else { if (this._nudgeOpen) this.store.commit('Nudge'); this.store.begin(); this._nudgeOpen = true; this.store.apply({ set: patch }); }
    this._nudgeT = now;
    clearTimeout(this._nudgeC);
    this._nudgeC = setTimeout(() => { if (this._nudgeOpen) { this.store.commit('Nudge'); this._nudgeOpen = false; this._emit(); } }, 650);
  }

  group() {
    const sel = this._selWritable();
    if (sel.length < 2) return;
    this.store.updateMany(Object.fromEntries(Object.entries(groupIds(sel.map((o) => o.id))).map(([id, g]) => [id, { groupId: g }])), 'Group');
    this.announce(this.t('announce.grouped', { n: sel.length })); this._emit();
  }
  ungroup() {
    const sel = this._selWritable().filter((o) => o.groupId);
    if (!sel.length) return;
    const groups = new Set(sel.map((o) => o.groupId));
    const all = this.store.list().filter((o) => groups.has(o.groupId));
    this.store.updateMany(Object.fromEntries(all.map((o) => [o.id, { groupId: null }])), 'Ungroup');
    this.announce(this.t('announce.ungrouped')); this._emit();
  }
  setLocked(locked) {
    const sel = this.selected();
    if (!sel.length) return;
    this.store.updateMany(Object.fromEntries(sel.map((o) => [o.id, { locked }])), locked ? 'Lock' : 'Unlock');
    this.announce(this.t(locked ? 'announce.lockedN' : 'announce.unlockedN', { n: sel.length })); this._emit();
  }
  order(how) {
    const sel = this._selWritable();
    if (!sel.length) return;
    const next = reorder(this.store.order, sel.map((o) => o.id), how);
    this.store.apply({ order: next }, 'Reorder');
    this.announce(this.t('announce.order.' + how)); this._emit();
  }
  align(how) { const p = alignObjects(this._selWritable(), how, this.store.objects); if (Object.keys(p).length) this.store.apply({ set: p }, 'Align'); this.announce(this.t('announce.aligned')); }
  distribute(axis) { const p = distributeObjects(this._selWritable(), axis, this.store.objects); if (Object.keys(p).length) this.store.apply({ set: p }, 'Distribute'); this.announce(this.t('announce.distributed')); }

  /** Apply style changes to selection (or to the object being edited). */
  setStyle(changes) {
    const sel = this._selWritable();
    const targets = sel.length ? sel : [];
    const set = {};
    for (const o of targets) {
      const ch = {};
      for (const [k, v] of Object.entries(changes)) {
        if (k === 'color' && o.type === 'sticky') continue;
        if (k in o || ['color', 'fill', 'stroke', 'strokeWidth', 'opacity', 'fontSize', 'bold', 'italic', 'align', 'dash'].includes(k)) {
          if (o.type === 'pen' && !['color', 'opacity'].includes(k) && k !== 'strokeWidth') continue;
          if (o.type === 'pen' && k === 'strokeWidth') ch.width = v; else if (o.type === 'pen' && k === 'stroke') ch.color = v;
          else if (k === 'stroke' && o.type === 'pen') continue; else ch[k] = v;
        }
      }
      if (o.type === 'text' && ('fontSize' in ch || 'bold' in ch || 'italic' in ch)) { const n = { ...o, ...ch }; ch.h = textBoxHeight(n, n.text, n.w); }
      if (Object.keys(ch).length) set[o.id] = ch;
    }
    if (Object.keys(set).length) { this.store.updateMany(set, 'Style'); }
    // remember defaults for new objects
    if ('fill' in changes) { this.opts.fill = changes.fill; this.prefs.shapeFill = changes.fill; }
    if ('stroke' in changes) { this.opts.stroke = changes.stroke; this.prefs.shapeStroke = changes.stroke; }
    this._emit();
  }
  setStickyColor(color) {
    this.opts.stickyColor = color;
    const set = {};
    for (const o of this._selWritable()) if (o.type === 'sticky') set[o.id] = { color };
    if (Object.keys(set).length) this.store.updateMany(set, 'Colour');
    this._emit();
  }

  // ---------------- voting ----------------
  myVotes() { let n = 0; for (const o of this.store.list()) if (o.type === 'sticky') n += o.votes?.[this.voterId] || 0; return n; }
  vote(id, delta) {
    const o = this.store.get(id);
    if (!o || o.type !== 'sticky') return;
    const mine = o.votes?.[this.voterId] || 0;
    if (delta > 0 && this.myVotes() >= this.opts.votesPerPerson) { this.announce(this.t('vote.noneLeft')); this.notify('toast', { msg: this.t('vote.noneLeft') }); return; }
    if (delta < 0 && mine <= 0) return;
    const votes = { ...(o.votes || {}) };
    if (mine + delta <= 0) delete votes[this.voterId]; else votes[this.voterId] = mine + delta;
    this.store.update(id, { votes }, 'Vote');
    this.announce(this.t('vote.cast', { left: Math.max(0, this.opts.votesPerPerson - this.myVotes()) }));
    this._emit();
  }
  clearVotes() {
    const set = {};
    for (const o of this.store.list()) if (o.type === 'sticky' && o.votes && Object.keys(o.votes).length) set[o.id] = { votes: {} };
    if (Object.keys(set).length) this.store.updateMany(set, 'Clear votes');
    this._emit();
  }

  arrangeNotes(opts = {}) {
    const sel = this.selected().filter((o) => o.type === 'sticky' && !o.locked);
    const notes = sel.length > 1 ? sel : this.store.list().filter((o) => o.type === 'sticky' && !o.locked);
    if (notes.length < 2) return;
    const b = unionRects(notes.map((n) => boundsOf(n, this.store.objects)));
    this.store.apply({ set: arrangeNotes(notes, { x0: b.x, y0: b.y, ...opts }) }, 'Arrange notes');
    this.announce(this.t('announce.arranged')); this._emit();
  }

  // ---------------- clipboard ----------------
  copySelection() {
    const sel = this.selected();
    if (!sel.length) return null;
    // include connectors whose both ends are inside the copied set
    const payload = packObjects(sel);
    return payload;
  }

  onCopyCut(e, cut) {
    if (this.editor || this._typing(e)) return;
    const payload = this.copySelection();
    if (!payload) return;
    e.clipboardData?.setData('text/plain', payload);
    e.preventDefault();
    if (cut) this.deleteSelection();
    this.announce(this.t(cut ? 'announce.cut' : 'announce.copied', { n: this.selected().length }));
  }

  _typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }

  async onPaste(e) {
    if (this.editor || this._typing(e)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const at = this._pasteAnchor();
    const files = [...(cd.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { for (const f of files) await this.insertImageFile(f, at); return; }
    const text = cd.getData('text/plain');
    if (isBoardwiseClip(text)) return this.pasteObjects(unpackObjects(text));
    const html = cd.getData('text/html');
    const plain = text || (html ? htmlToText(html) : '');
    if (!plain.trim()) { const mem = memoryClipboard(); if (mem) this.pasteObjects(unpackObjects(mem)); return; }
    this.pasteText(htmlToText(html && !text ? html : plain) || plain, at);
  }

  _pasteAnchor() {
    return this.cursorWorld || toWorld(this.view, this.size.w / 2, this.size.h / 2);
  }

  pasteObjects(objs, at = this._pasteAnchor()) {
    if (!objs?.length) return;
    const b = unionRects(objs.map((o) => aabb(o)));
    const dx = at.x - (b.x + b.w / 2), dy = at.y - (b.y + b.h / 2);
    // paste in place if the originals are still visible there; else centre on the cursor
    const clones = cloneObjects(objs, Object.fromEntries(objs.map((o) => [o.id, o])), dx, dy);
    this.store.add(clones, 'Paste');
    this.store.selection = new Set(clones.map((c) => c.id));
    this.announce(this.t('announce.pasted', { n: clones.length }));
    this._emit();
  }

  pasteText(text, at = this._pasteAnchor()) {
    const notes = textToNotes(text);
    if (!notes.length) return;
    if (notes.length === 1 && notes[0].length < 120) {
      const o = makers.text(at.x, at.y, 280, 40, { text: notes[0] });
      o.h = textBoxHeight(o, o.text, o.w);
      this.store.add(o, 'Paste text'); this.store.selection = new Set([o.id]);
    } else {
      const cols = Math.min(5, Math.ceil(Math.sqrt(notes.length)));
      const objs = notes.map((s, i) => makers.sticky(at.x + (i % cols) * 204, at.y + Math.floor(i / cols) * 204, STICKY_COLORS[0].id, { text: s }));
      this.store.add(objs, 'Paste notes'); this.store.selection = new Set(objs.map((o) => o.id));
    }
    this.announce(this.t('announce.pastedNotes', { n: notes.length }));
    this._emit();
  }

  async insertImageFile(file, at = this._pasteAnchor()) {
    try {
      const { src, w, h } = await fileToImage(file);
      const maxW = 480;
      const s = Math.min(1, maxW / w, 480 / h);
      const o = makers.image(at.x - (w * s) / 2, at.y - (h * s) / 2, w * s, h * s, src, file.name ? file.name.replace(/\.[^.]+$/, '') : '');
      this.store.add(o, 'Add image');
      this.store.selection = new Set([o.id]);
      this.announce(this.t('announce.added', { what: this.t('type.image') }));
      this._emit();
      return o;
    } catch (err) {
      this.notify('toast', { msg: err instanceof ImportError ? err.message : this.t('error.image'), kind: 'error' });
      return null;
    }
  }

  async onDrop(e) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    const { sx, sy } = this._local(e);
    const at = toWorld(this.view, sx, sy);
    for (const f of files) {
      if (f.type.startsWith('image/')) await this.insertImageFile(f, at);
      else if (/\.json$/i.test(f.name) || f.type === 'application/json') this.notify('import-file', f);
      else if (f.type.startsWith('text/') || /\.(csv|tsv|txt|md)$/i.test(f.name)) { if (f.size < 2e6) this.pasteText(await f.text(), at); else this.notify('toast', { msg: this.t('error.tooLarge'), kind: 'error' }); }
      else this.notify('toast', { msg: this.t('error.unsupported', { name: f.name }), kind: 'error' });
    }
    const txt = e.dataTransfer?.getData('text/plain');
    if (!files.length && txt) this.pasteText(txt, at);
  }

  // ---------------- keyboard ----------------
  onKeyDown(e) {
    // The editor normally has focus and handles its own keys; if focus has not reached it yet, Escape must still close it.
    if (this.editor && e.key === 'Escape' && e.target !== this.editor.el) { e.preventDefault(); this.closeEditor(); this.canvas.focus({ preventScroll: true }); return; }
    if (this.editor || e.defaultPrevented) return;
    // Shortcuts work from anywhere on the board page, except while typing or inside dialogs/menus.
    const el = e.target;
    if (el?.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"]')) return;
    if (el?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;       // let buttons activate normally
    const onCanvas = el === this.canvas || el === document.body || el === this.container || el?.id === 'main';
    if (e.key === 'Tab' && !onCanvas) return;                                            // keep the normal tab order outside the canvas
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (e.code === 'Space' && !mod) { e.preventDefault(); if (!this.spaceDown) { this.spaceDown = true; this._cursor(); } return; }
    if (this.notify('key', e)) return; // app-level (command palette etc.)
    if (mod && !e.shiftKey && k.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
    if (mod && ((e.shiftKey && k.toLowerCase() === 'z') || k.toLowerCase() === 'y')) { e.preventDefault(); this.redo(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); this.selectAll(); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
    if (mod && k.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? this.ungroup() : this.group(); return; }
    if (mod && e.shiftKey && k.toLowerCase() === 'l') { e.preventDefault(); const sel = this.selected(); this.setLocked(!sel.every((o) => o.locked)); return; }
    if (mod && k === ']') { e.preventDefault(); this.order('front'); return; }
    if (mod && k === '[') { e.preventDefault(); this.order('back'); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); this.zoomStep(1); return; }
    if (mod && k === '-') { e.preventDefault(); this.zoomStep(-1); return; }
    if (mod && k === '0') { e.preventDefault(); this.zoomTo(1); return; }
    if (mod) return;
    if (k === 'Escape') { if (this.gesture) this.cancelGesture(); else if (this.store.selection.size) this.clearSelection(); else if (this.tool !== 'select') this.setTool('select'); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }
    if (k === 'Enter') { const s = this.selected(); if (s.length === 1 && !s[0].locked) { e.preventDefault(); this.editObject(s[0], null); } return; }
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      const grid = this.store.meta.settings?.snap ? this.store.meta.settings.gridSize || 24 : 1;
      const step = (e.shiftKey ? 10 : 1) * grid;
      if (this.selected().length) this.nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
      else this.setView(panBy(this.view, k === 'ArrowLeft' ? 60 : k === 'ArrowRight' ? -60 : 0, k === 'ArrowUp' ? 60 : k === 'ArrowDown' ? -60 : 0));
      return;
    }
    if (k === 'Tab') { e.preventDefault(); this.cycleSelection(e.shiftKey ? -1 : 1); return; }
    if (k === '+' || k === '=') { this.zoomStep(1); return; }
    if (k === '-') { this.zoomStep(-1); return; }
    if (k === '0') { this.zoomTo(1); return; }
    if (k === '1' && e.shiftKey || k === '!') { this.fitContent(); return; }
    if (k === '2' && e.shiftKey || k === '@') { if (this.store.selection.size) this.fitContent([...this.store.selection]); return; }
    if (k === ']') { this.order('forward'); return; }
    if (k === '[') { this.order('backward'); return; }
    const toolKeys = { v: ['select'], h: ['hand'], p: ['pen'], l: ['highlighter'], e: ['eraser'], r: ['shape', { shapeKind: 'rect' }], o: ['shape', { shapeKind: 'ellipse' }], d: ['shape', { shapeKind: 'diamond' }], a: ['shape', { shapeKind: 'arrow' }], t: ['text'], n: ['sticky'], f: ['frame'], c: ['connector'], b: ['table'], k: ['checklist'], s: ['stamp'], z: ['laser'], m: ['comment'] };
    const tk = toolKeys[k.toLowerCase()];
    if (tk && !e.altKey) { this.setTool(tk[0], tk[1]); return; }
    if (k.toLowerCase() === 'i') { this.notify('open-image', null); }
  }

  cycleSelection(dir) {
    const ids = this.store.order.filter((id) => !this.store.get(id).locked || true);
    if (!ids.length) return;
    const sel = [...this.store.selection];
    const cur = sel.length ? ids.indexOf(sel[sel.length - 1]) : -1;
    const next = ids[(cur + dir + ids.length) % ids.length];
    this.select([next]);
    const o = this.store.get(next);
    const b = boundsOf(o, this.store.objects);
    const vr = visibleRect(this.view, this.size.w, this.size.h);
    if (b.x < vr.x || b.y < vr.y || b.x + b.w > vr.x + vr.w || b.y + b.h > vr.y + vr.h) this.focusRect(b, { minZoom: this.view.zoom });
    this.announce(this.t('announce.itemOf', { what: this.describe(o), i: ids.indexOf(next) + 1, n: ids.length }));
  }

  undo() { const tx = this.store.undo(); this.announce(tx ? this.t('announce.undo', { what: tx.label }) : this.t('announce.nothingUndo')); this._emit(); }
  redo() { const tx = this.store.redo(); this.announce(tx ? this.t('announce.redo', { what: tx.label }) : this.t('announce.nothingRedo')); this._emit(); }

  // ---------------- rendering ----------------
  draw(now = performance.now()) {
    if (!this.ctx) return;
    const t0 = performance.now();
    const ctx = this.ctx, dpr = this.dpr || 1, { w, h } = this.size, view = this.view;
    const theme = this.theme, T = THEMES[theme];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(ctx, view, w, h, this.store.meta.settings?.background || 'dots', theme, this.store.meta.settings?.gridSize || 24);
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, -view.x * view.zoom * dpr, -view.y * view.zoom * dpr);
    const vis = visibleRect(view, w, h);
    this.stats.drawn = drawObjects(ctx, this.store, vis, { theme, editingId: this.editor?.id, view });
    if (this.draft) drawObject(ctx, this.draft, { theme, objects: this.store.objects });
    this._drawOverlay(ctx, T, now);
    this.stats.ms = performance.now() - t0;
    this.frameCount++;
    this.dirtyFrame = false;
    // Chrome (inspector, minimap, status) follows the model, but at most ~8 times a second during a gesture.
    if (this._uiDirty) {
      const wait = this.gesture ? 120 : 0;
      if (now - this._lastUi >= wait) { this._uiDirty = false; this._lastUi = now; this._emit(); }
      else if (!this._uiT) this._uiT = setTimeout(() => { this._uiT = 0; this.requestRender(); }, wait);
    }
    if (this.highlight && now < this.highlight.until) this.requestRender(); else this.highlight = null;
  }

  _drawOverlay(ctx, T, now) {
    const z = this.view.zoom;
    const lw = 1.5 / z;
    // hover outline
    if (this.hover && this.tool === 'select' && !this.gesture) {
      const o = this.store.get(this.hover);
      if (o && !this.store.selection.has(o.id)) this._outline(ctx, o, T.selection, 1 / z, 0.55);
    }
    // connector target highlight + connection sites
    if (this.tool === 'connector' || this.gesture?.type === 'connect' || this.gesture?.type === 'endpoint') {
      const o = this.hover && this.store.get(this.hover);
      if (o) {
        this._outline(ctx, o, T.selection, 2 / z, 0.9);
        ctx.fillStyle = T.selection;
        for (const s of ['top', 'right', 'bottom', 'left']) {
          const p = sitePoint(o, s);
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 / z, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // selection
    const sel = this.selected();
    if (sel.length && !this.editor) {
      ctx.save();
      ctx.strokeStyle = T.selection; ctx.lineWidth = lw; ctx.setLineDash([]);
      for (const o of sel) if (sel.length > 1 || o.type === 'connector') this._outline(ctx, o, T.selection, lw, 0.7);
      if (sel.length === 1 && sel[0].type !== 'connector') this._outline(ctx, sel[0], T.selection, lw, 1, true);
      if (sel.length > 1) {
        const b = unionRects(sel.map((o) => boundsOf(o, this.store.objects)));
        ctx.setLineDash([6 / z, 4 / z]); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]);
      }
      for (const hnd of this._handles()) {
        const s = 5 / z;
        ctx.fillStyle = hnd.kind === 'rotate' ? T.selection : T.surface;
        ctx.strokeStyle = T.selection; ctx.lineWidth = 1.5 / z;
        ctx.beginPath();
        if (hnd.kind === 'resize') ctx.rect(hnd.x - s, hnd.y - s, s * 2, s * 2);
        else ctx.arc(hnd.x, hnd.y, s * 1.1, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // marquee
    const g = this.gesture;
    if (g?.type === 'marquee') {
      const r = normRect(g.start.x, g.start.y, g.cur.x, g.cur.y);
      ctx.save(); ctx.fillStyle = hexA(T.selection, 0.1); ctx.strokeStyle = T.selection; ctx.lineWidth = 1 / z;
      ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore();
    }
    // eraser ring
    if (g?.type === 'erase' && this.eraserPos) {
      ctx.save(); ctx.strokeStyle = T.muted; ctx.lineWidth = 1 / z; ctx.beginPath(); ctx.arc(this.eraserPos.x, this.eraserPos.y, Math.max(6, 10 / z), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // search pulse
    if (this.highlight) {
      const o = this.store.get(this.highlight.id);
      if (o) {
        const b = boundsOf(o, this.store.objects);
        const k = reducedMotion() ? 1 : (Math.sin(now / 140) + 1) / 2;
        ctx.save(); ctx.strokeStyle = '#e0a800'; ctx.lineWidth = (3 + k * 3) / z; ctx.strokeRect(b.x - 6 / z, b.y - 6 / z, b.w + 12 / z, b.h + 12 / z); ctx.restore();
      }
    }
    // laser
    if (this.laser.length) {
      const life = reducedMotion() ? 1e9 : 1200;
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < this.laser.length; i++) {
        const a = this.laser[i - 1], b = this.laser[i];
        const k = clamp(1 - (now - b.t) / life, 0, 1);
        if (k <= 0) continue;
        ctx.strokeStyle = `rgba(255,40,60,${k})`; ctx.lineWidth = (2 + 6 * k) / z;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const last = this.laser[this.laser.length - 1];
      ctx.fillStyle = 'rgba(255,40,60,.95)'; ctx.beginPath(); ctx.arc(last.x, last.y, 7 / z, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // remote cursors
    for (const [, r] of this.remote) {
      ctx.save(); ctx.fillStyle = r.color; ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + 4 / z, r.y + 16 / z); ctx.lineTo(r.x + 10 / z, r.y + 11 / z); ctx.closePath(); ctx.fill();
      ctx.font = `600 ${12 / z}px ${FONT}`; ctx.textBaseline = 'top'; ctx.fillText(r.name || '', r.x + 12 / z, r.y + 12 / z); ctx.restore();
      if (r.laser) { ctx.save(); ctx.fillStyle = 'rgba(255,40,60,.9)'; ctx.beginPath(); ctx.arc(r.x, r.y, 7 / z, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    }
  }

  _outline(ctx, o, color, lw, alpha = 1, rotated = false) {
    ctx.save();
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = lw;
    if (o.type === 'connector') {
      const r = resolveConnector(o, this.store.objects);
      ctx.lineWidth = lw * 2; ctx.globalAlpha = alpha * 0.45;
      ctx.beginPath(); r.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    } else if (o.rotation) {
      const c = center(o);
      ctx.translate(c.x, c.y); ctx.rotate(o.rotation); ctx.translate(-c.x, -c.y);
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    } else if (o.type === 'frame') { ctx.strokeRect(o.x, o.y - 28 / this.view.zoom, o.w, o.h + 28 / this.view.zoom); }
    else ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.restore();
    void rotated;
  }

  // ---------------- exposed helpers for UI ----------------
  visible() { return visibleRect(this.view, this.size.w, this.size.h); }
  jumpTo(id) {
    const o = this.store.get(id);
    if (!o) return;
    this.select([id]);
    this.focusRect(boundsOf(o, this.store.objects), { minZoom: 0.6 });
    this.pulse(id);
  }
  frames() {
    return this.store.list().filter((o) => o.type === 'frame').sort((a, b) => (Math.abs(a.y - b.y) < 80 ? a.x - b.x : a.y - b.y));
  }
  addAt(obj, label = 'Add') { this.store.add(obj, label); this.store.selection = new Set([obj.id]); this._emit(); }
  viewCenter() { return toWorld(this.view, this.size.w / 2, this.size.h / 2); }
  insertStamp(emoji) {
    const sel = this.selected()[0];
    const at = sel ? { x: boundsOf(sel, this.store.objects).x + boundsOf(sel, this.store.objects).w, y: boundsOf(sel, this.store.objects).y } : this.viewCenter();
    const s = makers.stamp(at.x - 20, at.y - 20, emoji);
    this.store.add(s, 'Reaction'); this.announce(this.t('announce.reaction', { emoji })); this._emit();
  }
}

function distSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  if (!l2) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function sitePoint(o, side) {
  const c = center(o);
  const m = { top: { x: c.x, y: o.y }, right: { x: o.x + o.w, y: c.y }, bottom: { x: c.x, y: o.y + o.h }, left: { x: o.x, y: c.y } }[side];
  return o.rotation ? rotatePoint(m, c, o.rotation) : m;
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

void inflate; void pointInRect; void fontFor;
