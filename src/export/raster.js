// Offscreen rendering for PNG export, PDF pages and board thumbnails.
import { drawObjects, preloadImages, THEMES } from '../core/render.js';
import { boundsOf, contentBounds, objectsInsideFrame } from '../core/hit.js';
import { inflate, unionRects } from '../core/geometry.js';

export const MAX_SIDE = 8192;
export const MAX_PIXELS = 36e6;

/** A read-only view of a store restricted to some object ids (keeps z-order). */
export function subsetOf(store, ids) {
  const set = new Set(ids);
  return { objects: store.objects, order: store.order.filter((id) => set.has(id)), list() { return this.order.map((id) => this.objects[id]); } };
}

/** What to export: { rect, ids } for the whole board, a selection or one frame. */
export function exportTarget(store, { kind = 'board', ids = [], frameId = null, padding = 24 } = {}) {
  if (kind === 'frame' && frameId && store.get(frameId)) {
    const f = store.get(frameId);
    const inside = objectsInsideFrame(store, f).map((o) => o.id);
    return { rect: { x: f.x, y: f.y, w: f.w, h: f.h }, ids: [f.id, ...inside], clip: true };
  }
  if (kind === 'selection' && ids.length) {
    const rect = unionRects(ids.map((id) => boundsOf(store.get(id), store.objects)));
    return { rect: inflate(rect, padding), ids };
  }
  const rect = contentBounds(store);
  return { rect: rect ? inflate(rect, padding) : null, ids: store.order };
}

export function clampScale(rect, scale) {
  let s = scale;
  if (rect.w * s > MAX_SIDE) s = MAX_SIDE / rect.w;
  if (rect.h * s > MAX_SIDE) s = Math.min(s, MAX_SIDE / rect.h);
  if (rect.w * s * rect.h * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (rect.w * rect.h));
  return s;
}

export async function renderToCanvas(store, { rect, ids, scale = 1, theme = 'light', transparent = false, clip = false }) {
  if (!rect || rect.w <= 0 || rect.h <= 0) throw new Error('Nothing to export');
  const sub = subsetOf(store, ids);
  await preloadImages(sub.list());
  const s = clampScale(rect, scale);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(rect.w * s));
  c.height = Math.max(1, Math.floor(rect.h * s));
  const ctx = c.getContext('2d');
  if (!transparent) { ctx.fillStyle = THEMES[theme].bg; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.setTransform(s, 0, 0, s, -rect.x * s, -rect.y * s);
  if (clip) { ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip(); }
  drawObjects(ctx, sub, null, { theme, view: { zoom: 1 } });
  return { canvas: c, scale: s };
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality));
}

/** Small JPEG for the board list. Returns undefined for empty boards. */
export async function makeThumbnail(store, w = 320, h = 200) {
  const rect = contentBounds(store);
  if (!rect) return undefined;
  const r = inflate(rect, 40);
  const scale = Math.min(w / r.w, h / r.h, 1);
  const { canvas } = await renderToCanvas(store, { rect: r, ids: store.order, scale });
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.fillStyle = THEMES.light.bg; ctx.fillRect(0, 0, w, h);
  const dw = canvas.width, dh = canvas.height;
  ctx.drawImage(canvas, (w - dw) / 2, (h - dh) / 2);
  return out.toDataURL('image/jpeg', 0.72);
}
