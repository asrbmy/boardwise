import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/core/store.js';
import { makers } from '../src/core/model.js';
import { packHistory, unpackHistory, historyMatches } from '../src/core/historyStore.js';

describe('history persistence', () => {
  it('round-trips undo/redo and still undoes correctly', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10); s.add(a);
    s.update(a.id, { x: 5 }); s.update(a.id, { x: 9 }); s.undo();
    const packed = JSON.parse(JSON.stringify(packHistory(s.history)));
    const h = unpackHistory(packed);
    expect(h.undoStack).toHaveLength(2); expect(h.redoStack).toHaveLength(1);
    s.history = h; s.undo();
    expect(s.get(a.id).x).toBe(0);
    s.redo(); s.redo();
    expect(s.get(a.id).x).toBe(9);
  });
  it('stores a repeated large image once', () => {
    const s = new BoardStore();
    const img = makers.image(0, 0, 10, 10, 'data:image/png;base64,' + 'A'.repeat(5000));
    s.add(img);
    for (let i = 0; i < 20; i++) s.update(img.id, { x: i });
    const packed = packHistory(s.history);
    expect(Object.keys(packed.images)).toHaveLength(1);
    expect(JSON.stringify(packed).length).toBeLessThan(5000 * 3);
    const h = unpackHistory(JSON.parse(JSON.stringify(packed)));
    expect(h.undoStack[0].changes[img.id][1].src.length).toBeGreaterThan(5000);
  });
  it('caps persisted steps but keeps the newest', () => {
    const s = new BoardStore(); const a = makers.shape('rect', 0, 0, 1, 1); s.add(a);
    for (let i = 1; i <= 50; i++) s.update(a.id, { x: i });
    const p = packHistory(s.history, 10);
    expect(p.undo).toHaveLength(10);
    expect(unpackHistory(p).undoStack.at(-1).changes[a.id][1].x).toBe(50);
  });
  it('rejects hostile or corrupt data safely', () => {
    expect(unpackHistory(null).undoStack).toEqual([]);
    expect(unpackHistory({ v: 1, undo: 'x', redo: [] }).undoStack).toEqual([]);
    const bad = { v: 1, redo: [], undo: [{ changes: { a: [null, { id: 'a', type: 'script' }] } }, { changes: { b: [null, { id: 'b', type: 'stamp', emoji: 'x' }] } }] };
    expect(unpackHistory(bad).undoStack).toHaveLength(1); // newest valid kept; broken older step dropped
  });
  it('detects history that no longer matches the board', () => {
    const s = new BoardStore(); const a = makers.shape('rect', 0, 0, 1, 1); s.add(a);
    const h = unpackHistory(JSON.parse(JSON.stringify(packHistory(s.history))));
    expect(historyMatches(h, s.snapshot())).toBe(true);
    expect(historyMatches(h, { objects: {} })).toBe(false);
  });
});
