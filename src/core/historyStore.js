// Persisting undo/redo across reloads. Images are de-duplicated into a side table (a 1 MB image
// referenced by 50 history steps is stored once), and every restored object is re-validated.
import { History } from './history.js';
import { normaliseObject } from './serialize.js';

export const PERSIST_LIMIT = 1000; // steps kept on disk per direction; in-memory history is unbounded

export function packHistory(history, limit = PERSIST_LIMIT) {
  const images = {};
  const keyOf = new Map();
  const tok = (src) => {
    if (typeof src !== 'string' || src.length < 512) return src;
    if (!keyOf.has(src)) { const k = `\u0001img${keyOf.size}`; keyOf.set(src, k); images[k] = src; }
    return keyOf.get(src);
  };
  const packObj = (o) => (o && o.type === 'image' ? { ...o, src: tok(o.src) } : o);
  const packTx = (tx) => ({
    ...tx,
    changes: Object.fromEntries(Object.entries(tx.changes).map(([id, [a, b]]) => [id, [packObj(a) ?? null, packObj(b) ?? null]])),
  });
  return {
    v: 1,
    undo: history.undoStack.slice(-limit).map(packTx),
    redo: history.redoStack.slice(-limit).map(packTx),
    images,
  };
}

export function unpackHistory(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.undo) || !Array.isArray(data.redo)) return new History();
  const images = data.images && typeof data.images === 'object' ? data.images : {};
  const fix = (v) => {
    if (v === null || v === undefined) return undefined;
    const o = v.type === 'image' && images[v.src] ? { ...v, src: images[v.src] } : v;
    return normaliseObject(o) || null;
  };
  const rebuild = (tx) => {
    if (!tx || typeof tx.changes !== 'object') return null;
    const changes = {};
    for (const [id, pair] of Object.entries(tx.changes)) {
      if (!Array.isArray(pair)) return null;
      const a = fix(pair[0]), b = fix(pair[1]);
      if (a === null || b === null) return null; // a present-but-invalid object invalidates the step
      changes[id] = [a, b];
    }
    return { label: String(tx.label || 'Edit').slice(0, 60), time: Number(tx.time) || 0, changes, orderBefore: Array.isArray(tx.orderBefore) ? tx.orderBefore : undefined, orderAfter: Array.isArray(tx.orderAfter) ? tx.orderAfter : undefined };
  };
  // History is a chain: keep only the newest unbroken run, so a bad step invalidates older ones, never newer.
  const chain = (list) => { const out = []; for (let i = list.length - 1; i >= 0; i--) { const r = rebuild(list[i]); if (!r) break; out.unshift(r); } return out; };
  const h = new History();
  h.undoStack = chain(data.undo);
  h.redoStack = chain(data.redo);
  return h;
}

/** Only reuse saved history if it still matches the board it was saved with. */
export function historyMatches(history, board) {
  const top = history.undoStack[history.undoStack.length - 1];
  if (!top) return history.redoStack.length > 0 || history.undoStack.length === 0;
  for (const [id, [, after]] of Object.entries(top.changes)) {
    const cur = board.objects[id];
    if (after === undefined ? !!cur : !cur) return false;
  }
  return true;
}
