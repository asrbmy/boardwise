import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/core/store.js';
import { makers } from '../src/core/model.js';
import { hitTest, objectsInRect, resolveConnector, boundsOf, contentBounds, objectsInsideFrame } from '../src/core/hit.js';

const mk = () => new BoardStore();

describe('hit-testing', () => {
  it('hits the topmost filled shape', () => {
    const s = mk();
    const a = makers.shape('rect', 0, 0, 100, 100), b = makers.shape('rect', 50, 50, 100, 100);
    s.add([a, b]);
    expect(hitTest(s, { x: 75, y: 75 }).id).toBe(b.id);
    expect(hitTest(s, { x: 10, y: 10 }).id).toBe(a.id);
    expect(hitTest(s, { x: 500, y: 500 })).toBeNull();
  });
  it('unfilled shapes are hit only on the outline', () => {
    const s = mk();
    const a = makers.shape('rect', 0, 0, 200, 200, { fill: 'transparent' });
    s.add(a);
    expect(hitTest(s, { x: 100, y: 100 })).toBeNull();
    expect(hitTest(s, { x: 1, y: 100 }).id).toBe(a.id);
  });
  it('respects rotation', () => {
    const s = mk();
    const a = makers.shape('rect', 0, 0, 200, 20);
    a.rotation = Math.PI / 2; // now vertical around centre (100,10)
    s.add(a);
    expect(hitTest(s, { x: 100, y: 90 })?.id).toBe(a.id);
    expect(hitTest(s, { x: 180, y: 10 })).toBeNull();
  });
  it('ellipse corners are outside', () => {
    const s = mk();
    s.add(makers.shape('ellipse', 0, 0, 100, 100));
    expect(hitTest(s, { x: 3, y: 3 })).toBeNull();
    expect(hitTest(s, { x: 50, y: 50 })).not.toBeNull();
  });
  it('skips locked when asked', () => {
    const s = mk();
    const a = makers.shape('rect', 0, 0, 50, 50, {}); a.locked = true;
    s.add(a);
    expect(hitTest(s, { x: 25, y: 25 }, 1, { skipLocked: true })).toBeNull();
    expect(hitTest(s, { x: 25, y: 25 }, 1)).not.toBeNull();
  });
  it('hits pen strokes near the line only', () => {
    const s = mk();
    const p = makers.pen([{ x: 0, y: 0 }, { x: 100, y: 0 }], { color: '#000', width: 4 });
    s.add(p);
    expect(hitTest(s, { x: 50, y: 2 })?.id).toBe(p.id);
    expect(hitTest(s, { x: 50, y: 40 })).toBeNull();
  });
  it('frames are hit on border/title, not interior', () => {
    const s = mk();
    const f = makers.frame(0, 0, 400, 300);
    s.add(f);
    expect(hitTest(s, { x: 200, y: 150 })).toBeNull();
    expect(hitTest(s, { x: 50, y: -10 })?.id).toBe(f.id);
  });
  it('marquee selects intersecting and skips locked', () => {
    const s = mk();
    const a = makers.shape('rect', 0, 0, 50, 50), b = makers.shape('rect', 200, 200, 50, 50);
    const c = makers.shape('rect', 10, 10, 20, 20); c.locked = true;
    s.add([a, b, c]);
    const ids = objectsInRect(s, { x: -10, y: -10, w: 100, h: 100 }).map((o) => o.id);
    expect(ids).toEqual([a.id]);
  });
});

describe('connectors', () => {
  it('stay attached when shapes move', () => {
    const s = mk();
    const a = makers.shape('rect', 0, 0, 100, 100), b = makers.shape('rect', 300, 0, 100, 100);
    const c = makers.connector({ id: a.id, side: 'auto', x: 0, y: 0 }, { id: b.id, side: 'auto', x: 0, y: 0 }, { route: 'straight' });
    s.add([a, b, c]);
    let r = resolveConnector(s.get(c.id), s.objects);
    expect(r.a).toEqual({ x: 100, y: 50 }); expect(r.b).toEqual({ x: 300, y: 50 });
    s.update(b.id, { x: 500, y: 200 });
    r = resolveConnector(s.get(c.id), s.objects);
    expect(r.b.x).toBe(500);
  });
  it('free ends use stored coordinates', () => {
    const s = mk();
    const c = makers.connector({ x: 0, y: 0 }, { x: 40, y: 80 }, { route: 'straight' });
    s.add(c);
    expect(resolveConnector(c, s.objects).pts).toEqual([{ x: 0, y: 0 }, { x: 40, y: 80 }]);
  });
  it('degrades to free end if target deleted', () => {
    const s = mk();
    const a = makers.shape('rect', 0, 0, 100, 100);
    const c = makers.connector({ id: a.id, side: 'right', x: 100, y: 50 }, { x: 300, y: 50 }, { route: 'straight' });
    s.add([a, c]);
    s.remove([a.id]);
    const r = resolveConnector(s.get(c.id), s.objects);
    expect(r.a).toEqual({ x: 100, y: 50 });
  });
  it('connector hit-testing follows the route', () => {
    const s = mk();
    const c = makers.connector({ x: 0, y: 0 }, { x: 200, y: 0 }, { route: 'straight' });
    s.add(c);
    expect(hitTest(s, { x: 100, y: 3 })?.id).toBe(c.id);
    expect(hitTest(s, { x: 100, y: 50 })).toBeNull();
  });
});

describe('bounds', () => {
  it('contentBounds unions everything', () => {
    const s = mk();
    s.add([makers.shape('rect', 0, 0, 10, 10), makers.shape('rect', 100, 100, 10, 10)]);
    expect(contentBounds(s)).toEqual({ x: 0, y: 0, w: 110, h: 110 });
    expect(contentBounds(mk())).toBeNull();
  });
  it('objectsInsideFrame', () => {
    const s = mk();
    const f = makers.frame(0, 0, 300, 300), a = makers.sticky(10, 10), b = makers.sticky(400, 400);
    s.add([f, a, b]);
    expect(objectsInsideFrame(s, f).map((o) => o.id)).toEqual([a.id]);
    expect(boundsOf(a, s.objects).w).toBe(180);
  });
});
