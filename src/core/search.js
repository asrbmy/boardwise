// Board text search. Pure, so it is unit-tested. Matches are case- and accent-insensitive.
import { textOf } from './model.js';

export const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Returns [{ id, text, index, length }] in reading order (top to bottom, left to right). */
export function searchBoard(store, query, { limit = 200 } = {}) {
  const q = fold(query.trim());
  if (!q) return [];
  const out = [];
  for (const o of store.list()) {
    const text = textOf(o);
    if (!text) continue;
    const i = fold(text).indexOf(q);
    if (i >= 0) out.push({ id: o.id, text, index: i, length: q.length, y: o.y, x: o.x });
    if (out.length >= limit * 3) break;
  }
  out.sort((a, b) => (Math.abs(a.y - b.y) < 60 ? a.x - b.x : a.y - b.y));
  return out.slice(0, limit);
}

/** A short snippet around the match, with the match position inside it. */
export function snippet(text, index, length, radius = 36) {
  const flat = text.replace(/\s+/g, ' ');
  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + length + radius);
  return { before: (start > 0 ? '…' : '') + flat.slice(start, index), match: flat.slice(index, index + length), after: flat.slice(index + length, end) + (end < flat.length ? '…' : '') };
}
