// "Ink to shape": a small, fully local recogniser (no network, no model). Off by default.
// It only fires when the stroke is clearly a line, triangle, rectangle, diamond or ellipse;
// otherwise the original ink is kept untouched.
import { dist, polylineBounds, simplify } from './geometry.js';

const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);
function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

export function recognizeShape(raw) {
  if (!raw || raw.length < 6) return null;
  const pts = raw.map((p) => ({ x: p.x, y: p.y }));
  const b = polylineBounds(pts);
  const diag = Math.hypot(b.w, b.h);
  if (diag < 24) return null;
  const len = pathLength(pts);
  const first = pts[0], last = pts[pts.length - 1];
  const gap = dist(first, last);

  // Straight line
  if (gap / len > 0.9) {
    return { kind: 'line', x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), w: Math.abs(last.x - first.x), h: Math.abs(last.y - first.y), flipX: first.x > last.x, flipY: first.y > last.y };
  }
  // Closed outline?
  if (gap > diag * 0.22) return null;
  const closed = [...pts, first];
  const poly = simplify(closed, diag * 0.07);
  poly.pop(); // last duplicates first
  const corners = poly.length;
  const circ = (4 * Math.PI * area(pts)) / (len * len);
  if (corners === 3) return { kind: 'triangle', x: b.x, y: b.y, w: b.w, h: b.h };
  if (corners === 4) {
    // diamond: vertices sit near the middle of each bbox side
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < diag * 0.18;
    const mids = [{ x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h }, { x: b.x, y: b.y + b.h / 2 }];
    const diamond = mids.every((m) => poly.some((p) => near(p, m)));
    return { kind: diamond ? 'diamond' : 'rect', x: b.x, y: b.y, w: b.w, h: b.h };
  }
  if (circ > 0.8) return { kind: 'ellipse', x: b.x, y: b.y, w: b.w, h: b.h };
  return null;
}
