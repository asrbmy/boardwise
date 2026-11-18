// Pure operations on lists of objects. Each returns a patch map {id: changes} or new objects,
// so the engine/UI can apply them in one undoable step and the logic stays unit-testable.

import { boundsOf, resolveConnector } from './hit.js';
import { center, rotatePoint, unionRects } from './geometry.js';
import { uid } from './model.js';

// ---- clone / paste ----
/**
 * Clone objects with fresh ids. Group ids are remapped, and connector ends that point at
 * objects outside the cloned set are frozen to their current coordinates (so a paste never
 * secretly re-attaches to the original board's shapes).
 */
export function cloneObjects(objs, allObjects, dx = 0, dy = 0) {
  const idMap = new Map(objs.map((o) => [o.id, uid()]));
  const groupMap = new Map();
  return objs.map((o) => {
    const n = structuredClone(o);
    n.id = idMap.get(o.id);
    if (o.groupId) { if (!groupMap.has(o.groupId)) groupMap.set(o.groupId, uid()); n.groupId = groupMap.get(o.groupId); }
    if (o.type === 'connector') {
      const r = allObjects ? resolveConnector(o, allObjects) : null;
      for (const [key, pt] of [['from', r?.a], ['to', r?.b]]) {
        const e = o[key];
        if (e.id && idMap.has(e.id)) n[key] = { ...e, id: idMap.get(e.id), x: (pt?.x ?? e.x) + dx, y: (pt?.y ?? e.y) + dy };
        else n[key] = { x: (pt?.x ?? e.x) + dx, y: (pt?.y ?? e.y) + dy };
      }
      n.x += dx; n.y += dy;
    } else { n.x += dx; n.y += dy; }
    return n;
  });
}

// ---- moving ----
/** Patch to translate objects. Connectors keep attached ends; free ends move with the selection. */
export function moveObjects(objs, dx, dy, allObjects, selectedIds) {
  const patch = {};
  for (const o of objs) {
    if (o.type === 'connector') {
      const r = resolveConnector(o, allObjects);
      const freeze = (e, pt) => (e.id && selectedIds.has(e.id) && allObjects[e.id]) ? e : { x: pt.x + dx, y: pt.y + dy };
      patch[o.id] = { ...o, from: freeze(o.from, r.a), to: freeze(o.to, r.b) };
    } else patch[o.id] = { ...o, x: o.x + dx, y: o.y + dy };
  }
  return patch;
}

// ---- align & distribute ----
export function alignObjects(objs, how, allObjects) {
  const items = objs.filter((o) => o.type !== 'connector');
  if (items.length < 2) return {};
  const bs = items.map((o) => boundsOf(o, allObjects));
  const u = unionRects(bs);
  const patch = {};
  items.forEach((o, i) => {
    const b = bs[i];
    let dx = 0, dy = 0;
    if (how === 'left') dx = u.x - b.x;
    if (how === 'right') dx = u.x + u.w - (b.x + b.w);
    if (how === 'hcenter') dx = u.x + u.w / 2 - (b.x + b.w / 2);
    if (how === 'top') dy = u.y - b.y;
    if (how === 'bottom') dy = u.y + u.h - (b.y + b.h);
    if (how === 'vcenter') dy = u.y + u.h / 2 - (b.y + b.h / 2);
    if (dx || dy) patch[o.id] = { ...o, x: o.x + dx, y: o.y + dy };
  });
  return patch;
}

export function distributeObjects(objs, axis, allObjects) {
  const items = objs.filter((o) => o.type !== 'connector');
  if (items.length < 3) return {};
  const key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
  const withB = items.map((o) => ({ o, b: boundsOf(o, allObjects) })).sort((a, b) => a.b[key] - b.b[key]);
  const first = withB[0].b, last = withB[withB.length - 1].b;
  const total = last[key] + last[size] - first[key];
  const used = withB.reduce((s, i) => s + i.b[size], 0);
  const gap = (total - used) / (withB.length - 1);
  const patch = {};
  let pos = first[key] + first[size] + gap;
  for (let i = 1; i < withB.length - 1; i++) {
    const { o, b } = withB[i];
    const d = pos - b[key];
    if (Math.abs(d) > 1e-6) patch[o.id] = { ...o, [key]: o[key] + d };
    pos += b[size] + gap;
  }
  return patch;
}

// ---- z-order ----
export function reorder(order, ids, how) {
  const sel = new Set(ids);
  const picked = order.filter((id) => sel.has(id));
  const rest = order.filter((id) => !sel.has(id));
  if (how === 'front') return [...rest, ...picked];
  if (how === 'back') return [...picked, ...rest];
  const out = [...order];
  if (how === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) if (sel.has(out[i]) && !sel.has(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  } else if (how === 'backward') {
    for (let i = 1; i < out.length; i++) if (sel.has(out[i]) && !sel.has(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]];
  }
  return out;
}

// ---- scale / rotate ----
/** Scale an object about an origin by (sx, sy). Pen strokes scale their points. */
export function scaleObject(o, sx, sy, ox, oy) {
  if (o.type === 'connector') {
    const f = (e) => (e.id ? e : { ...e, x: ox + (e.x - ox) * sx, y: oy + (e.y - oy) * sy });
    return { ...o, from: f(o.from), to: f(o.to) };
  }
  const x = ox + (o.x - ox) * sx, y = oy + (o.y - oy) * sy;
  const w = o.w * Math.abs(sx), h = o.h * Math.abs(sy);
  const nx = sx < 0 ? x - w : x, ny = sy < 0 ? y - h : y;
  if (o.type === 'pen') {
    const ax = Math.abs(sx), ay = Math.abs(sy);
    const pts = o.pts.map(([px, py, pr]) => [sx < 0 ? o.w * ax - px * ax : px * ax, sy < 0 ? o.h * ay - py * ay : py * ay, pr]);
    return { ...o, x: nx, y: ny, w, h, pts };
  }
  const out = { ...o, x: nx, y: ny, w, h };
  if (o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow')) {
    if (sx < 0) out.flipX = !o.flipX;
    if (sy < 0) out.flipY = !o.flipY;
  }
  return out;
}

/** Rotate objects by `delta` radians about `c`. */
export function rotateObjects(objs, delta, c) {
  const patch = {};
  for (const o of objs) {
    if (o.type === 'connector') {
      const f = (e) => (e.id ? e : { ...e, ...rotatePoint(e, c, delta) });
      patch[o.id] = { ...o, from: f(o.from), to: f(o.to) };
      continue;
    }
    const oc = center(o);
    const nc = rotatePoint(oc, c, delta);
    patch[o.id] = { ...o, x: nc.x - o.w / 2, y: nc.y - o.h / 2, rotation: (o.rotation || 0) + delta };
  }
  return patch;
}

// ---- grouping ----
export function groupIds(ids) { const g = uid(); return Object.fromEntries(ids.map((id) => [id, g])); }

/** Expand a set of ids to include everyone sharing a group. */
export function expandGroups(store, ids) {
  const groups = new Set();
  for (const id of ids) { const o = store.objects[id]; if (o?.groupId) groups.add(o.groupId); }
  if (!groups.size) return new Set(ids);
  const out = new Set(ids);
  for (const o of store.list()) if (o.groupId && groups.has(o.groupId)) out.add(o.id);
  return out;
}

// ---- sticky-note grid ----
const COLOR_ORDER = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'grey'];
export function sortNotes(notes, by = 'colour') {
  const arr = [...notes];
  if (by === 'colour') arr.sort((a, b) => COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color) || (a.text || '').localeCompare(b.text || ''));
  else if (by === 'votes') arr.sort((a, b) => votesSum(b) - votesSum(a) || (a.text || '').localeCompare(b.text || ''));
  else if (by === 'text') arr.sort((a, b) => (a.text || '').localeCompare(b.text || ''));
  return arr;
}
const votesSum = (o) => Object.values(o.votes || {}).reduce((s, v) => s + v, 0);

/** Lay stickies out in a grid at (x0,y0). `group` puts each colour in its own column block. */
export function arrangeNotes(notes, { by = 'colour', group = true, x0 = 0, y0 = 0, perRow = 5, gap = 24 } = {}) {
  const patch = {};
  const sorted = sortNotes(notes, by);
  if (group && by === 'colour') {
    let x = x0;
    for (const colour of COLOR_ORDER) {
      const list = sorted.filter((n) => n.color === colour);
      if (!list.length) continue;
      const cols = Math.min(2, Math.max(1, Math.ceil(Math.sqrt(list.length / 2))));
      list.forEach((n, i) => {
        patch[n.id] = { ...n, x: x + (i % cols) * (n.w + gap), y: y0 + Math.floor(i / cols) * (n.h + gap) };
      });
      x += cols * (list[0].w + gap) + gap;
    }
  } else {
    sorted.forEach((n, i) => { patch[n.id] = { ...n, x: x0 + (i % perRow) * (n.w + gap), y: y0 + Math.floor(i / perRow) * (n.h + gap) }; });
  }
  return patch;
}

/**
 * When objects are deleted, connectors attached to them keep their ends exactly where they were drawn
 * (instead of jumping to stale coordinates). Returns a patch map for the surviving connectors.
 */
export function detachConnectors(objects, removedIds) {
  const removed = removedIds instanceof Set ? removedIds : new Set(removedIds);
  const patch = {};
  for (const o of Object.values(objects)) {
    if (o.type !== 'connector' || removed.has(o.id)) continue;
    const hitsFrom = o.from.id && removed.has(o.from.id), hitsTo = o.to.id && removed.has(o.to.id);
    if (!hitsFrom && !hitsTo) continue;
    const r = resolveConnector(o, objects);
    patch[o.id] = { ...o, from: hitsFrom ? { x: r.a.x, y: r.a.y } : o.from, to: hitsTo ? { x: r.b.x, y: r.b.y } : o.to };
  }
  return patch;
}
