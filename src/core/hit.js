// Bounds, connector routing and hit-testing. Pure functions over the object map.

import {
  aabb, center, curveControls, distToPolyline, elbowRoute, flattenCubic, inflate,
  pointInPolygon, polylineBounds, rectsIntersect, shapePolygon, sidePoint, toLocal,
  segmentIntersectsRect, distToSegment, pointInRect, rotatePoint,
} from './geometry.js';

const CONNECTABLE = new Set(['shape', 'sticky', 'text', 'image', 'table', 'checklist', 'frame']);
export const isConnectable = (o) => !!o && CONNECTABLE.has(o.type) && !(o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow'));

function autoSide(o, toward) {
  const c = center(o);
  const local = toLocal(o, toward);
  const dx = (local.x - c.x) / (o.w || 1), dy = (local.y - c.y) / (o.h || 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

function endpoint(end, objects, otherPoint) {
  if (end && end.id && objects[end.id] && isConnectable(objects[end.id])) {
    const o = objects[end.id];
    const side = end.side && end.side !== 'auto' ? end.side : autoSide(o, otherPoint);
    return { p: sidePoint(o, side), side };
  }
  return { p: { x: end.x, y: end.y }, side: null };
}

/** Resolve a connector into concrete geometry. Returns { pts, kind, ctrl? } with world coords. */
export function resolveConnector(c, objects) {
  const fromObj = c.from?.id && objects[c.from.id];
  const toObj = c.to?.id && objects[c.to.id];
  const rough = (end, obj) => (obj ? center(obj) : { x: end.x, y: end.y });
  const a = endpoint(c.from, objects, rough(c.to, toObj));
  const b = endpoint(c.to, objects, rough(c.from, fromObj));
  if (c.route === 'curve') {
    const [c1, c2] = curveControls(a.p, b.p, a.side, b.side);
    return { pts: flattenCubic(a.p, c1, c2, b.p), kind: 'curve', ctrl: [c1, c2], a: a.p, b: b.p };
  }
  if (c.route === 'straight') return { pts: [a.p, b.p], kind: 'straight', a: a.p, b: b.p };
  return { pts: elbowRoute(a.p, b.p, a.side, b.side), kind: 'elbow', a: a.p, b: b.p };
}

const boundsCache = new WeakMap();

export function boundsOf(o, objects) {
  if (o.type === 'connector') {
    // depends on other objects, so not cached on the connector itself
    const r = resolveConnector(o, objects || {});
    return inflate(polylineBounds(r.pts), 4);
  }
  let b = boundsCache.get(o);
  if (!b) {
    b = aabb(o);
    boundsCache.set(o, b);
  }
  return b;
}

export function contentBounds(store) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const o of store.list()) {
    const b = boundsOf(o, store.objects);
    if (b.x < x1) x1 = b.x;
    if (b.y < y1) y1 = b.y;
    if (b.x + b.w > x2) x2 = b.x + b.w;
    if (b.y + b.h > y2) y2 = b.y + b.h;
  }
  if (x1 === Infinity) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Does a world point land on this object? `tol` is in world units. */
export function hitObject(o, p, tol, objects) {
  if (o.type === 'connector') {
    const r = resolveConnector(o, objects);
    return distToPolyline(p, r.pts) <= tol + (o.strokeWidth || 2) / 2 + 3;
  }
  if (o.type === 'pen') {
    const local = toLocal(o, p);
    const pts = o.pts.map(([x, y]) => ({ x: o.x + x, y: o.y + y }));
    return distToPolyline(local, pts) <= tol + o.width / 2 + (o.highlighter ? 2 : 0);
  }
  const local = toLocal(o, p);
  if (o.type === 'frame') {
    // Frames are hit on their title bar or border only so content inside stays selectable.
    const titleBar = { x: o.x, y: o.y - 28, w: Math.min(o.w, 220), h: 28 };
    if (pointInRect(local, titleBar)) return true;
    const inner = { x: o.x + tol, y: o.y + tol, w: o.w - 2 * tol, h: o.h - 2 * tol };
    return pointInRect(local, inflate({ x: o.x, y: o.y, w: o.w, h: o.h }, tol)) && !pointInRect(local, inner);
  }
  if (o.type === 'shape') {
    if (o.kind === 'line' || o.kind === 'arrow') {
      const [s, e] = lineEnds(o);
      return distToSegment(local, s, e) <= tol + o.strokeWidth / 2 + 3;
    }
    const filled = o.fill && o.fill !== 'transparent';
    if (o.kind === 'ellipse') {
      const c = center(o);
      const rx = o.w / 2 + tol, ry = o.h / 2 + tol;
      const nx = (local.x - c.x) / rx, ny = (local.y - c.y) / ry;
      const inside = nx * nx + ny * ny <= 1;
      if (filled || o.text) return inside;
      const rx2 = Math.max(1, o.w / 2 - tol - o.strokeWidth), ry2 = Math.max(1, o.h / 2 - tol - o.strokeWidth);
      const mx = (local.x - c.x) / rx2, my = (local.y - c.y) / ry2;
      return inside && mx * mx + my * my >= 1;
    }
    if (o.kind === 'triangle' || o.kind === 'diamond' || o.kind === 'star') {
      const poly = shapePolygon(o.kind, o.x, o.y, o.w, o.h);
      if (pointInPolygon(local, poly)) return filled || !!o.text || nearPolyEdge(local, poly, tol + o.strokeWidth);
      return nearPolyEdge(local, poly, tol);
    }
    // rect / round
    const outer = inflate({ x: o.x, y: o.y, w: o.w, h: o.h }, tol);
    if (!pointInRect(local, outer)) return false;
    if (filled || o.text) return true;
    const t = tol + o.strokeWidth + 2;
    return !pointInRect(local, { x: o.x + t, y: o.y + t, w: o.w - 2 * t, h: o.h - 2 * t });
  }
  return pointInRect(local, inflate({ x: o.x, y: o.y, w: o.w, h: o.h }, tol));
}

function nearPolyEdge(p, poly, tol) {
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  }
  return false;
}

/** Start/end of a line or arrow shape in unrotated local coords, honouring flips. */
export function lineEnds(o) {
  const x1 = o.flipX ? o.x + o.w : o.x, x2 = o.flipX ? o.x : o.x + o.w;
  const y1 = o.flipY ? o.y + o.h : o.y, y2 = o.flipY ? o.y : o.y + o.h;
  return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
}

/** Topmost object under a point. Skips locked objects when `skipLocked`. */
export function hitTest(store, p, zoom = 1, { skipLocked = false, ignore } = {}) {
  const tol = 6 / zoom;
  const order = store.order;
  for (let i = order.length - 1; i >= 0; i--) {
    const o = store.objects[order[i]];
    if (!o || (ignore && ignore.has(o.id))) continue;
    if (skipLocked && o.locked) continue;
    const b = boundsOf(o, store.objects);
    if (o.type !== 'frame' && (p.x < b.x - tol || p.y < b.y - tol || p.x > b.x + b.w + tol || p.y > b.y + b.h + tol)) continue;
    if (hitObject(o, p, tol, store.objects)) return o;
  }
  return null;
}

/** Objects whose geometry intersects a world-space rectangle (marquee select). */
export function objectsInRect(store, rect, { contain = false } = {}) {
  const out = [];
  for (const id of store.order) {
    const o = store.objects[id];
    if (!o || o.locked) continue;
    const b = boundsOf(o, store.objects);
    if (contain) {
      if (b.x >= rect.x && b.y >= rect.y && b.x + b.w <= rect.x + rect.w && b.y + b.h <= rect.y + rect.h) out.push(o);
      continue;
    }
    if (!rectsIntersect(b, rect)) continue;
    if (o.type === 'pen') {
      const pts = o.pts.map(([x, y]) => ({ x: o.x + x, y: o.y + y }));
      let hit = pts.length === 1 && pointInRect(pts[0], rect);
      for (let i = 1; i < pts.length && !hit; i++) hit = segmentIntersectsRect(pts[i - 1], pts[i], rect);
      if (hit) out.push(o);
    } else if (o.type === 'connector') {
      const r = resolveConnector(o, store.objects);
      let hit = false;
      for (let i = 1; i < r.pts.length && !hit; i++) hit = segmentIntersectsRect(r.pts[i - 1], r.pts[i], rect);
      if (hit) out.push(o);
    } else out.push(o);
  }
  return out;
}

/** Frames, in z-order, that fully contain the given bounds (used to move content with a frame). */
export function objectsInsideFrame(store, frame) {
  const r = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  const out = [];
  for (const id of store.order) {
    const o = store.objects[id];
    if (!o || o.id === frame.id || o.type === 'frame') continue;
    const b = boundsOf(o, store.objects);
    if (b.x >= r.x - 1 && b.y >= r.y - 1 && b.x + b.w <= r.x + r.w + 1 && b.y + b.h <= r.y + r.h + 1) out.push(o);
  }
  return out;
}

/** Handle positions (world coords) for a single selected object. */
export function handlePoints(o) {
  const c = center(o);
  const pts = {
    nw: { x: o.x, y: o.y }, n: { x: o.x + o.w / 2, y: o.y }, ne: { x: o.x + o.w, y: o.y },
    e: { x: o.x + o.w, y: o.y + o.h / 2 }, se: { x: o.x + o.w, y: o.y + o.h },
    s: { x: o.x + o.w / 2, y: o.y + o.h }, sw: { x: o.x, y: o.y + o.h }, w: { x: o.x, y: o.y + o.h / 2 },
  };
  if (o.rotation) for (const k of Object.keys(pts)) pts[k] = rotatePoint(pts[k], c, o.rotation);
  return pts;
}
