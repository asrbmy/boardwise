import { describe, it, expect } from 'vitest';
import { emptyBoard, makers } from '../src/core/model.js';
import { exportBoardJSON, exportBackupJSON, parseImport, normaliseBoard, normaliseObject } from '../src/core/serialize.js';
import { ImportError } from '../src/core/sanitize.js';

function sample() {
  const b = emptyBoard('Sample');
  const objs = [
    makers.shape('ellipse', 1, 2, 30, 40, { text: 'hi' }), makers.sticky(5, 5, 'pink', { text: 'note' }),
    makers.pen([{ x: 0, y: 0 }, { x: 10, y: 10 }], { color: '#123456', width: 3 }),
    makers.text(0, 0), makers.table(0, 0, 2, 2), makers.checklist(0, 0, [{ text: 'a', done: true }]),
    makers.stamp(0, 0, '🎉'), makers.frame(0, 0, 100, 100, 'F'),
  ];
  for (const o of objs) { b.objects[o.id] = o; b.order.push(o.id); }
  return b;
}

describe('serialisation', () => {
  it('round-trips a board', () => {
    const b = sample();
    const { boards } = parseImport(exportBoardJSON(b));
    const r = boards[0];
    expect(r.id).toBe(b.id); expect(r.name).toBe('Sample');
    expect(r.order).toEqual(b.order);
    for (const id of b.order) expect(r.objects[id]).toEqual(b.objects[id]);
  });
  it('round-trips a backup of several boards', () => {
    const { kind, boards } = parseImport(exportBackupJSON([sample(), sample()]));
    expect(kind).toBe('backup'); expect(boards).toHaveLength(2);
  });
  it('rejects non-JSON, foreign JSON, empty and newer formats with clear messages', () => {
    expect(() => parseImport('')).toThrow(/empty/i);
    expect(() => parseImport('{nope')).toThrow(/valid JSON/i);
    expect(() => parseImport('{"a":1}')).toThrow(/not a Boardwise file/i);
    expect(() => parseImport(JSON.stringify({ app: 'boardwise', format: 99, kind: 'board', board: {} }))).toThrow(/newer version/i);
    expect(() => parseImport(JSON.stringify({ app: 'boardwise', format: 1, kind: 'backup' }))).toThrow(/no boards/i);
  });
  it('rejects oversized input', () => {
    expect(() => parseImport('x'.repeat(100), { maxBytes: 10 })).toThrow(ImportError);
  });
  it('rejects boards with too many objects', () => {
    const objects = Array.from({ length: 20001 }, (_, i) => ({ id: 'o' + i, type: 'stamp', x: 0, y: 0, w: 1, h: 1, emoji: 'x' }));
    expect(() => normaliseBoard({ objects })).toThrow(/too many/i);
  });
  it('drops malformed objects and unknown types, and counts them', () => {
    const b = normaliseBoard({ objects: [
      { id: 'ok', type: 'stamp', x: 1, y: 1, w: 5, h: 5, emoji: 'a' },
      { id: 'bad type', type: 'stamp' }, { id: 'x', type: 'script' }, null, 5,
      { id: 'dup', type: 'stamp' }, { id: 'dup', type: 'stamp' },
    ] });
    expect(Object.keys(b.objects).sort()).toEqual(['dup', 'ok']);
    expect(b.dropped).toBe(5);
  });
  it('strips unknown / hostile properties and clamps numbers', () => {
    const o = normaliseObject({ id: 'a', type: 'shape', x: 1e99, y: NaN, w: -5, h: 10, __proto__: { evil: 1 }, onclick: 'x', kind: 'nope', fill: 'url(javascript:alert(1))', text: 'a\u0000b' });
    expect(o.x).toBe(1e7); expect(o.y).toBe(0); expect(o.w).toBe(0);
    expect(o.kind).toBe('rect'); expect(o.fill).toBe('#ffffff'); expect(o.text).toBe('ab');
    expect(o.onclick).toBeUndefined();
  });
  it('rejects non-image data URLs on images', () => {
    expect(normaliseObject({ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'https://evil.example/x.png' })).toBeNull();
    expect(normaliseObject({ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:text/html;base64,AAAA' })).toBeNull();
    expect(normaliseObject({ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:image/png;base64,AAAA' })).not.toBeNull();
  });
  it('repairs order: missing ids appended, unknown ids dropped', () => {
    const b = normaliseBoard({ objects: [{ id: 'a', type: 'stamp' }, { id: 'b', type: 'stamp' }], order: ['b', 'zzz', 'b'] });
    expect(b.order).toEqual(['b', 'a']);
  });
  it('does not pollute prototypes', () => {
    parseImport(JSON.stringify({ app: 'boardwise', format: 1, kind: 'board', board: JSON.parse('{"__proto__":{"polluted":true},"objects":[]}') }));
    expect({}.polluted).toBeUndefined();
  });
});

describe('reserved ids', () => {
  it('rejects ids that collide with Object.prototype, in objects, groups, connectors and votes', async () => {
    const { normaliseObject, isSafeId } = await import('../src/core/serialize.js');
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '__x']) expect(isSafeId(bad)).toBe(false);
    expect(isSafeId('abc-123_X')).toBe(true);
    expect(normaliseObject({ id: '__proto__', type: 'sticky', x: 0, y: 0 })).toBeNull();
    const s = normaliseObject({ id: 'ok', type: 'sticky', x: 0, y: 0, votes: { constructor: 3, __proto__: 4, fine: 2 } });
    expect(Object.keys(s.votes)).toEqual(['fine']);
    expect(Object.getPrototypeOf(s.votes)).toBe(Object.prototype);
  });
});
