import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/core/store.js';
import { makers } from '../src/core/model.js';
import { History, makeTx, applyTx } from '../src/core/history.js';

describe('undo/redo', () => {
  it('undoes and redoes add/update/delete', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10);
    s.add(a);
    s.update(a.id, { x: 50 });
    s.remove([a.id]);
    expect(s.size).toBe(0);
    s.undo(); expect(s.get(a.id).x).toBe(50);
    s.undo(); expect(s.get(a.id).x).toBe(0);
    s.undo(); expect(s.size).toBe(0);
    s.redo(); s.redo(); s.redo();
    expect(s.size).toBe(0);
    expect(s.history.canRedo).toBe(false);
  });
  it('collapses a gesture into one step', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10);
    s.add(a);
    s.begin();
    for (let i = 1; i <= 20; i++) s.update(a.id, { x: i });
    s.commit('Move');
    expect(s.history.undoStack).toHaveLength(2);
    s.undo();
    expect(s.get(a.id).x).toBe(0);
  });
  it('cancel restores state and records nothing', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10);
    s.add(a);
    s.begin(); s.update(a.id, { x: 99 }); s.cancel();
    expect(s.get(a.id).x).toBe(0);
    expect(s.history.undoStack).toHaveLength(1);
  });
  it('a new edit clears redo', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10);
    s.add(a); s.update(a.id, { x: 1 }); s.undo();
    expect(s.history.canRedo).toBe(true);
    s.update(a.id, { x: 2 });
    expect(s.history.canRedo).toBe(false);
  });
  it('restores z-order', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10), b = makers.shape('rect', 0, 0, 10, 10);
    s.add([a, b]);
    s.apply({ order: [b.id, a.id] }, 'Reorder');
    expect(s.order).toEqual([b.id, a.id]);
    s.undo();
    expect(s.order).toEqual([a.id, b.id]);
    s.redo();
    expect(s.order).toEqual([b.id, a.id]);
  });
  it('no-op edits create no history', () => {
    const s = new BoardStore();
    s.begin(); s.commit('nothing');
    expect(s.history.undoStack).toHaveLength(0);
  });
  it('is unlimited (thousands of steps) and survives JSON round-trip', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10);
    s.add(a);
    for (let i = 1; i <= 3000; i++) s.update(a.id, { x: i });
    expect(s.history.undoStack).toHaveLength(3001);
    const h = History.fromJSON(JSON.parse(JSON.stringify(s.history.toJSON())));
    const r = h.undo(s.state());
    expect(r.state.objects[a.id].x).toBe(2999);
  });
  it('selection is pruned when undo removes objects', () => {
    const s = new BoardStore();
    const a = makers.shape('rect', 0, 0, 10, 10);
    s.add(a); s.selection.add(a.id); s.undo();
    expect(s.selection.size).toBe(0);
  });
  it('applyTx guards against inconsistent order', () => {
    const state = { objects: { a: { id: 'a' } }, order: ['a'] };
    const tx = { changes: { b: [undefined, { id: 'b' }] } };
    const next = applyTx(state, tx, 'redo');
    expect(next.order.sort()).toEqual(['a', 'b']);
  });
  it('makeTx returns null when nothing changed', () => {
    const st = { objects: {}, order: [] };
    expect(makeTx('x', st, st)).toBeNull();
  });
});
