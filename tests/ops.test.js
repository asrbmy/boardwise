import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/core/store.js';
import { makers } from '../src/core/model.js';
import * as ops from '../src/core/ops.js';
import { resolveConnector } from '../src/core/hit.js';

const sq = (x, y, w = 50, h = 50) => makers.shape('rect', x, y, w, h);

describe('ops', () => {
  it('align left/right/center', () => {
    const s = new BoardStore(); const a = sq(0, 0), b = sq(100, 20), c = sq(300, 40);
    s.add([a, b, c]);
    const l = ops.alignObjects([a, b, c], 'left', s.objects);
    expect(l[b.id].x).toBe(0); expect(l[c.id].x).toBe(0); expect(l[a.id]).toBeUndefined();
    const r = ops.alignObjects([a, b, c], 'right', s.objects);
    expect(r[a.id].x).toBe(300);
    const h = ops.alignObjects([a, b, c], 'hcenter', s.objects);
    expect(h[a.id].x + 25).toBeCloseTo(175);
  });
  it('distribute gives equal gaps', () => {
    const s = new BoardStore(); const a = sq(0, 0), b = sq(60, 0), c = sq(300, 0);
    s.add([a, b, c]);
    const p = ops.distributeObjects([a, b, c], 'h', s.objects);
    expect(p[b.id].x).toBe(150);
    expect(ops.distributeObjects([a, b], 'h', s.objects)).toEqual({});
  });
  it('z-order operations', () => {
    const o = ['a', 'b', 'c', 'd'];
    expect(ops.reorder(o, ['b'], 'front')).toEqual(['a', 'c', 'd', 'b']);
    expect(ops.reorder(o, ['c'], 'back')).toEqual(['c', 'a', 'b', 'd']);
    expect(ops.reorder(o, ['b'], 'forward')).toEqual(['a', 'c', 'b', 'd']);
    expect(ops.reorder(o, ['c'], 'backward')).toEqual(['a', 'c', 'b', 'd']);
    expect(ops.reorder(o, ['d'], 'forward')).toEqual(o);
    expect(ops.reorder(o, ['b', 'c'], 'forward')).toEqual(['a', 'd', 'b', 'c']);
  });
  it('clone gives new ids, remaps groups and attached connectors', () => {
    const s = new BoardStore(); const a = sq(0, 0), b = sq(200, 0);
    a.groupId = b.groupId = 'g1';
    const c = makers.connector({ id: a.id, side: 'auto', x: 0, y: 0 }, { id: b.id, side: 'auto', x: 0, y: 0 }, { route: 'straight' });
    s.add([a, b, c]);
    const clones = ops.cloneObjects([a, b, c], s.objects, 10, 10);
    const ids = new Set(clones.map((x) => x.id));
    expect(ids.size).toBe(3);
    for (const o of [a, b, c]) expect(ids.has(o.id)).toBe(false);
    expect(clones[0].groupId).toBe(clones[1].groupId); expect(clones[0].groupId).not.toBe('g1');
    expect(clones[2].from.id).toBe(clones[0].id); expect(clones[2].to.id).toBe(clones[1].id);
    expect(clones[0].x).toBe(10);
  });
  it('clone detaches connector ends whose target is not copied', () => {
    const s = new BoardStore(); const a = sq(0, 0);
    const c = makers.connector({ id: a.id, side: 'right', x: 50, y: 25 }, { x: 300, y: 25 }, { route: 'straight' });
    s.add([a, c]);
    const [cc] = ops.cloneObjects([c], s.objects, 0, 100);
    expect(cc.from.id).toBeUndefined(); expect(cc.from).toEqual({ x: 50, y: 125 });
  });
  it('moving only a connector detaches it; moving with its shapes keeps attachment', () => {
    const s = new BoardStore(); const a = sq(0, 0), b = sq(200, 0);
    const c = makers.connector({ id: a.id, side: 'right', x: 0, y: 0 }, { id: b.id, side: 'left', x: 0, y: 0 }, { route: 'straight' });
    s.add([a, b, c]);
    const alone = ops.moveObjects([c], 0, 40, s.objects, new Set([c.id]));
    expect(alone[c.id].from.id).toBeUndefined(); expect(alone[c.id].from.y).toBe(65);
    const all = ops.moveObjects([a, b, c], 0, 40, s.objects, new Set([a.id, b.id, c.id]));
    expect(all[c.id].from.id).toBe(a.id);
    s.applyRemote({ set: all });
    expect(resolveConnector(s.get(c.id), s.objects).a.y).toBe(65);
  });
  it('scale handles flips for lines and scales pen points', () => {
    const l = makers.shape('line', 0, 0, 100, 50);
    const f = ops.scaleObject(l, -1, 1, 0, 0);
    expect(f.flipX).toBe(true); expect(f.x).toBe(-100); expect(f.w).toBe(100);
    const p = makers.pen([{ x: 0, y: 0 }, { x: 100, y: 50 }], { color: '#000', width: 2 });
    const sp = ops.scaleObject(p, 2, 2, 0, 0);
    expect(sp.w).toBe(200); expect(sp.pts[1][0]).toBe(200); expect(sp.pts[1][1]).toBe(100);
  });
  it('rotates a group about its centre', () => {
    const a = sq(0, 0, 10, 10), b = sq(90, 0, 10, 10);
    const p = ops.rotateObjects([a, b], Math.PI, { x: 50, y: 5 });
    expect(p[a.id].x).toBeCloseTo(90); expect(p[b.id].x).toBeCloseTo(0);
    expect(p[a.id].rotation).toBeCloseTo(Math.PI);
  });
  it('expands groups', () => {
    const s = new BoardStore(); const a = sq(0, 0), b = sq(5, 5), c = sq(9, 9);
    a.groupId = b.groupId = 'g'; s.add([a, b, c]);
    expect([...ops.expandGroups(s, [a.id])].sort()).toEqual([a.id, b.id].sort());
  });
  it('sorts and arranges notes by colour', () => {
    const n = [makers.sticky(0, 0, 'blue'), makers.sticky(0, 0, 'yellow'), makers.sticky(0, 0, 'blue')];
    expect(ops.sortNotes(n, 'colour').map((x) => x.color)).toEqual(['yellow', 'blue', 'blue']);
    const p = ops.arrangeNotes(n, { by: 'colour', group: true });
    expect(p[n[1].id].x).toBeLessThan(p[n[0].id].x);
    expect(Object.keys(p)).toHaveLength(3);
  });
  it('deleting a shape freezes attached connector ends where they were drawn', () => {
    const s = new BoardStore(); const a = sq(0, 0), b = sq(200, 0);
    const c = makers.connector({ id: a.id, side: 'auto', x: 9, y: 9 }, { id: b.id, side: 'auto', x: 9, y: 9 }, { route: 'straight' });
    s.add([a, b, c]);
    const before = resolveConnector(c, s.objects);
    s.apply({ set: ops.detachConnectors(s.objects, new Set([b.id])), remove: [b.id] }, 'Delete');
    const after = resolveConnector(s.get(c.id), s.objects);
    expect(after.b).toEqual(before.b); expect(after.a).toEqual(before.a);
    expect(s.get(c.id).to.id).toBeUndefined(); expect(s.get(c.id).from.id).toBe(a.id);
    s.undo();
    expect(s.get(b.id)).toBeDefined(); expect(s.get(c.id).to.id).toBe(b.id); // one undo restores both
  });
});
