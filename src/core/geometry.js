// Pure geometry helpers. No DOM access so everything here is unit-testable.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => a + (b - a) * t;

export const rectOf = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
export const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function normRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function rectContains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function unionRects(rects) {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    if (r.x < x1) x1 = r.x;
    if (r.y < y1) y1 = r.y;
    if (r.x + r.w > x2) x2 = r.x + r.w;
    if (r.y + r.h > y2) y2 = r.y + r.h;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function inflate(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function rotatePoint(p, c, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Four corners of a (possibly rotated) object, clockwise from top-left. */
export function corners(o) {
  const c = center(o);
  const pts = [
    { x: o.x, y: o.y },
    { x: o.x + o.w, y: o.y },
    { x: o.x + o.w, y: o.y + o.h },
    { x: o.x, y: o.y + o.h },
  ];
  if (!o.rotation) return pts;
  return pts.map((p) => rotatePoint(p, c, o.rotation));
}

/** Axis-aligned bounding box of an object including rotation. */
export function aabb(o) {
  if (!o.rotation) return { x: o.x, y: o.y, w: o.w, h: o.h };
  const cs = corners(o);
  const xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
  const x1 = Math.min(...xs), y1 = Math.min(...ys);
  return { x: x1, y: y1, w: Math.max(...xs) - x1, h: Math.max(...ys) - y1 };
}

/** Convert a world point into an object's local, unrotated frame. */
export function toLocal(o, p) {
  if (!o.rotation) return p;
  return rotatePoint(p, center(o), -o.rotation);
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p, pts) {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return dist(p, pts[0]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(p, pts[i - 1], pts[i]);
    if (d < best) best = d;
  }
  return best;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function snap(v, grid) {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

/** Points of a regular star (n points) inside a w×h box. */
export function starPoints(x, y, w, h, n = 5, inner = 0.45) {
  const cx = x + w / 2, cy = y + h / 2;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push({ x: cx + Math.cos(a) * (w / 2) * r, y: cy + Math.sin(a) * (h / 2) * r });
  }
  return pts;
}

/** Polygon outline (local, unrotated) for polygonal shape kinds. */
export function shapePolygon(kind, x, y, w, h) {
  switch (kind) {
    case 'triangle':
      return [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    case 'diamond':
      return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }];
    case 'star':
      return starPoints(x, y, w, h);
    default:
      return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  }
}

/**
 * Point on the border of a shape (in world coords) toward `target`, used to
 * attach connector ends. Works for rotated rects/ellipses/polygons.
 */
export function anchorToward(o, target) {
  const c = center(o);
  const local = toLocal(o, target);
  const dx = local.x - c.x, dy = local.y - c.y;
  if (dx === 0 && dy === 0) return c;
  let hit;
  if (o.kind === 'ellipse') {
    const rx = o.w / 2, ry = o.h / 2;
    const k = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    hit = { x: c.x + dx * k, y: c.y + dy * k };
  } else if (o.kind === 'triangle' || o.kind === 'diamond' || o.kind === 'star') {
    const poly = shapePolygon(o.kind, o.x, o.y, o.w, o.h);
    hit = rayPolygon(c, { x: dx, y: dy }, poly) || c;
  } else {
    const sx = o.w / 2 / Math.abs(dx || 1e-9), sy = o.h / 2 / Math.abs(dy || 1e-9);
    const k = Math.min(sx, sy);
    hit = { x: c.x + dx * k, y: c.y + dy * k };
  }
  return o.rotation ? rotatePoint(hit, c, o.rotation) : hit;
}

function rayPolygon(origin, dir, poly) {
  let best = null, bestT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / denom;
    const u = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom;
    if (t > 0 && u >= 0 && u <= 1 && t < bestT) {
      bestT = t;
      best = { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
    }
  }
  return best;
}

/** The 4 side midpoints used as fixed connection sites. */
export function sidePoint(o, side) {
  const c = center(o);
  const map = {
    top: { x: c.x, y: o.y },
    right: { x: o.x + o.w, y: c.y },
    bottom: { x: c.x, y: o.y + o.h },
    left: { x: o.x, y: c.y },
  };
  const p = map[side] || c;
  return o.rotation ? rotatePoint(p, c, o.rotation) : p;
}

/** Elbow (orthogonal) route between two points; returns a polyline. */
export function elbowRoute(a, b, aSide, bSide) {
  const horizA = aSide ? aSide === 'left' || aSide === 'right' : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const horizB = bSide ? bSide === 'left' || bSide === 'right' : horizA;
  if (horizA && horizB) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (!horizA && !horizB) {
    const my = (a.y + b.y) / 2;
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  }
  if (horizA) return [a, { x: b.x, y: a.y }, b];
  return [a, { x: a.x, y: b.y }, b];
}

/** Control points for a smooth cubic curve between two points. */
export function curveControls(a, b, aSide, bSide) {
  const d = Math.max(40, dist(a, b) / 2.5);
  const vec = (side, fallback) =>
    ({ left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } }[side] || fallback);
  const dir = { x: Math.sign(b.x - a.x) || 1, y: 0 };
  const va = vec(aSide, dir), vb = vec(bSide, { x: -dir.x, y: 0 });
  return [
    { x: a.x + va.x * d, y: a.y + va.y * d },
    { x: b.x + vb.x * d, y: b.y + vb.y * d },
  ];
}

export function cubicAt(a, c1, c2, b, t) {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

export function flattenCubic(a, c1, c2, b, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(cubicAt(a, c1, c2, b, i / steps));
  return pts;
}

/** Moving-average + Chaikin-style smoothing for freehand strokes. */
export function smoothPoints(pts, passes = 1) {
  let out = pts;
  for (let k = 0; k < passes; k++) {
    if (out.length < 3) return out;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const p = out[i], q = out[i + 1];
      next.push(
        { x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y, p: ((p.p ?? 0.5) * 0.75 + (q.p ?? 0.5) * 0.25) },
        { x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y, p: ((p.p ?? 0.5) * 0.25 + (q.p ?? 0.5) * 0.75) }
      );
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification to keep stored strokes small. */
export function simplify(pts, tol = 0.6) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > -1) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function polylineBounds(pts) {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) {
    if (p.x < x1) x1 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x;
    if (p.y > y2) y2 = p.y;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Does the segment p-q intersect the rectangle r (inclusive)? */
export function segmentIntersectsRect(p, q, r) {
  if (pointInRect(p, r) || pointInRect(q, r)) return true;
  const edges = [
    [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }],
    [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }],
    [{ x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
    [{ x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }],
  ];
  return edges.some(([a, b]) => segmentsIntersect(p, q, a, b));
}

function ccw(a, b, c) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}
export function segmentsIntersect(a, b, c, d) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}
