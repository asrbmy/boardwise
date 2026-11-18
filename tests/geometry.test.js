import { describe, it, expect } from 'vitest';
import * as g from '../src/core/geometry.js';

describe('geometry', () => {
  it('normRect orders corners', () => {
    expect(g.normRect(10, 20, 0, 5)).toEqual({ x: 0, y: 5, w: 10, h: 15 });
  });
  it('rect intersection and containment', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(g.rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(g.rectsIntersect(a, { x: 11, y: 0, w: 2, h: 2 })).toBe(false);
    expect(g.rectContains(a, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(g.rectContains(a, { x: 9, y: 9, w: 5, h: 5 })).toBe(false);
  });
  it('union of rects', () => {
    expect(g.unionRects([{ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 5, w: 1, h: 1 }])).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    expect(g.unionRects([])).toBeNull();
  });
  it('rotates points', () => {
    const p = g.rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(1);
  });
  it('aabb of rotated square grows by sqrt2', () => {
    const b = g.aabb({ x: 0, y: 0, w: 100, h: 100, rotation: Math.PI / 4 });
    expect(b.w).toBeCloseTo(141.42, 1); expect(b.h).toBeCloseTo(141.42, 1);
    expect(b.x + b.w / 2).toBeCloseTo(50);
  });
  it('toLocal undoes rotation', () => {
    const o = { x: 0, y: 0, w: 100, h: 50, rotation: Math.PI / 3 };
    const world = g.rotatePoint({ x: 80, y: 10 }, g.center(o), o.rotation);
    const l = g.toLocal(o, world);
    expect(l.x).toBeCloseTo(80); expect(l.y).toBeCloseTo(10);
  });
  it('distance to segment and polyline', () => {
    expect(g.distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(g.distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(g.distToPolyline({ x: 5, y: 2 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(2);
  });
  it('point in polygon', () => {
    const tri = g.shapePolygon('triangle', 0, 0, 10, 10);
    expect(g.pointInPolygon({ x: 5, y: 7 }, tri)).toBe(true);
    expect(g.pointInPolygon({ x: 1, y: 1 }, tri)).toBe(false);
  });
  it('snap', () => {
    expect(g.snap(13, 10)).toBe(10); expect(g.snap(16, 10)).toBe(20); expect(g.snap(13, 0)).toBe(13);
  });
  it('anchorToward lands on the border', () => {
    const rect = { x: 0, y: 0, w: 100, h: 50, rotation: 0, kind: 'rect' };
    const p = g.anchorToward(rect, { x: 300, y: 25 });
    expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(25);
    const el = { x: 0, y: 0, w: 100, h: 100, rotation: 0, kind: 'ellipse' };
    const q = g.anchorToward(el, { x: 200, y: 50 });
    expect(q.x).toBeCloseTo(100); expect(q.y).toBeCloseTo(50);
  });
  it('elbow route is orthogonal', () => {
    const r = g.elbowRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, 'right', 'left');
    for (let i = 1; i < r.length; i++) expect(r[i].x === r[i - 1].x || r[i].y === r[i - 1].y).toBe(true);
    expect(r[0]).toEqual({ x: 0, y: 0 }); expect(r.at(-1)).toEqual({ x: 100, y: 60 });
  });
  it('cubic endpoints', () => {
    const a = { x: 0, y: 0 }, b = { x: 10, y: 10 };
    const [c1, c2] = g.curveControls(a, b, 'right', 'left');
    expect(g.cubicAt(a, c1, c2, b, 0)).toEqual(a);
    expect(g.cubicAt(a, c1, c2, b, 1)).toEqual(b);
  });
  it('simplify keeps endpoints and drops collinear points', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    const s = g.simplify(pts, 0.5);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual(pts[0]); expect(s[1]).toEqual(pts.at(-1));
  });
  it('smoothing preserves ends', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    const s = g.smoothPoints(pts, 2);
    expect(s[0]).toEqual(pts[0]); expect(s.at(-1)).toEqual(pts.at(-1));
    expect(s.length).toBeGreaterThan(pts.length);
  });
  it('segment/rect intersection', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(g.segmentIntersectsRect({ x: -5, y: 5 }, { x: 15, y: 5 }, r)).toBe(true);
    expect(g.segmentIntersectsRect({ x: -5, y: -5 }, { x: -1, y: 20 }, r)).toBe(false);
  });
  it('star has 10 vertices', () => { expect(g.starPoints(0, 0, 10, 10)).toHaveLength(10); });
});
