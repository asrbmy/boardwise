// Serialisation + strict validation of anything read from disk, the clipboard or a peer.
// Every field is rebuilt from an allow-list, so unknown or hostile properties never survive.

import { SCHEMA_VERSION, SHAPE_KINDS, TYPES, emptyBoard, uid } from './model.js';
import { ImportError, LIMITS, cleanText, isSafeImageDataUrl } from './sanitize.js';

export const FORMAT = 1;
const COORD = 1e7;

const num = (v, d = 0, lo = -COORD, hi = COORD) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v, d = '', max = 2000) => (typeof v === 'string' ? cleanText(v, max) : d);
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const color = (v, d) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i.test(v.trim()) ? v.trim() : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
/** Ids become object keys everywhere, so reject names that would collide with Object.prototype ("__proto__", "constructor", …). */
export const isSafeId = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v) && !v.startsWith('__') && !(v in Object.prototype);
const id = (v) => (isSafeId(v) ? v : null);

function endpoint(e) {
  if (!e || typeof e !== 'object') return { x: 0, y: 0 };
  const out = { x: num(e.x), y: num(e.y) };
  if (id(e.id)) {
    out.id = e.id;
    out.side = oneOf(e.side, ['auto', 'top', 'right', 'bottom', 'left'], 'auto');
  }
  return out;
}

function votesOf(v) {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v).slice(0, 200)) if (id(k) && Number.isFinite(n) && n > 0) out[k] = Math.min(99, Math.round(n));
  }
  return out;
}

const textStyle = (o) => ({
  fontSize: num(o.fontSize, 18, 6, 400),
  bold: bool(o.bold),
  italic: bool(o.italic),
  align: oneOf(o.align, ['left', 'center', 'right'], 'left'),
});

export function normaliseObject(o) {
  if (!o || typeof o !== 'object' || !TYPES.includes(o.type)) return null;
  const oid = id(o.id);
  if (!oid) return null;
  const common = {
    id: oid,
    type: o.type,
    x: num(o.x), y: num(o.y),
    w: num(o.w, 100, 0, COORD), h: num(o.h, 100, 0, COORD),
    rotation: num(o.rotation, 0, -100, 100),
    locked: bool(o.locked),
    groupId: id(o.groupId),
  };
  switch (o.type) {
    case 'pen': {
      if (!Array.isArray(o.pts)) return null;
      const pts = [];
      for (const p of o.pts.slice(0, LIMITS.maxPenPoints)) {
        if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([num(p[0]), num(p[1]), num(p[2], 0.5, 0, 1)]);
      }
      if (!pts.length) return null;
      return { ...common, pts, color: color(o.color, '#1b1b1f'), width: num(o.width, 3, 0.5, 200), opacity: num(o.opacity, 1, 0.05, 1), highlighter: bool(o.highlighter) };
    }
    case 'shape':
      return {
        ...common, kind: oneOf(o.kind, SHAPE_KINDS, 'rect'),
        fill: color(o.fill, '#ffffff'), stroke: color(o.stroke, '#1b1b1f'), strokeWidth: num(o.strokeWidth, 2, 0, 60),
        opacity: num(o.opacity, 1, 0.05, 1), dash: oneOf(o.dash, ['solid', 'dashed', 'dotted'], 'solid'),
        text: str(o.text, '', LIMITS.maxText), color: color(o.color, '#1b1b1f'), ...textStyle(o),
        flipX: bool(o.flipX), flipY: bool(o.flipY),
      };
    case 'text':
      return { ...common, text: str(o.text, '', LIMITS.maxText), color: color(o.color, '#1b1b1f'), autoSize: bool(o.autoSize, true), ...textStyle({ fontSize: 24, ...o }) };
    case 'sticky':
      return { ...common, text: str(o.text, '', 5000), color: oneOf(o.color, ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'grey'], 'yellow'), votes: votesOf(o.votes), ...textStyle(o) };
    case 'image': {
      if (!isSafeImageDataUrl(o.src) || o.src.length > LIMITS.storedImageBytes * 1.4 + 2000) return null;
      return { ...common, src: o.src, alt: str(o.alt, '', 500), opacity: num(o.opacity, 1, 0.05, 1) };
    }
    case 'frame':
      return { ...common, title: str(o.title, 'Frame', 200), fill: color(o.fill, 'transparent'), stroke: color(o.stroke, '#6b7280') };
    case 'table': {
      const rows = Math.round(num(o.rows, 1, 1, 100)), cols = Math.round(num(o.cols, 1, 1, 50));
      const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => str(o.cells?.[r]?.[c], '', 2000)));
      return { ...common, rows, cols, cells, header: bool(o.header, true), fontSize: num(o.fontSize, 16, 6, 100), stroke: color(o.stroke, '#6b7280'), fill: color(o.fill, '#ffffff'), color: color(o.color, '#1b1b1f') };
    }
    case 'checklist': {
      const items = (Array.isArray(o.items) ? o.items : []).slice(0, 500).map((i) => ({ text: str(i?.text, '', 500), done: bool(i?.done) }));
      return { ...common, title: str(o.title, 'Checklist', 200), items, fontSize: num(o.fontSize, 16, 6, 100), color: color(o.color, '#1b1b1f'), fill: color(o.fill, '#ffffff'), stroke: color(o.stroke, '#6b7280') };
    }
    case 'stamp':
      return { ...common, emoji: str(o.emoji, '⭐', 8) };
    case 'connector':
      return {
        ...common, from: endpoint(o.from), to: endpoint(o.to),
        route: oneOf(o.route, ['elbow', 'straight', 'curve'], 'elbow'),
        arrowStart: bool(o.arrowStart), arrowEnd: bool(o.arrowEnd, true),
        stroke: color(o.stroke, '#1b1b1f'), strokeWidth: num(o.strokeWidth, 2, 0.5, 40),
        dash: oneOf(o.dash, ['solid', 'dashed', 'dotted'], 'solid'), opacity: num(o.opacity, 1, 0.05, 1), label: str(o.label, '', 500),
      };
    default:
      return null;
  }
}

export function normaliseBoard(raw, { keepId = true } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ImportError('Board data is not an object.');
  if (raw.objects && typeof raw.objects !== 'object') throw new ImportError('Board objects are malformed.');
  const rawObjects = Array.isArray(raw.objects) ? raw.objects : Object.values(raw.objects || {});
  if (rawObjects.length > LIMITS.maxObjects) throw new ImportError(`Board has too many objects (limit ${LIMITS.maxObjects}).`, 'too-large');
  const board = emptyBoard(str(raw.name, 'Imported board', 200) || 'Imported board');
  board.id = keepId && id(raw.id) ? raw.id : uid();
  board.createdAt = num(raw.createdAt, Date.now(), 0, 4e12);
  board.updatedAt = num(raw.updatedAt, Date.now(), 0, 4e12);
  board.lastOpened = num(raw.lastOpened, board.updatedAt, 0, 4e12);
  board.folder = str(raw.folder, '', 80);
  board.favourite = bool(raw.favourite);
  const s = raw.settings || {};
  board.settings = {
    background: oneOf(s.background, ['plain', 'dots', 'grid', 'lines'], 'dots'),
    snap: bool(s.snap), gridSize: num(s.gridSize, 24, 4, 200),
  };
  const v = raw.view || {};
  board.view = { x: num(v.x), y: num(v.y), zoom: num(v.zoom, 1, 0.1, 4) };
  let dropped = 0;
  for (const ro of rawObjects) {
    const o = normaliseObject(ro);
    if (!o || board.objects[o.id]) { dropped++; continue; }
    board.objects[o.id] = o;
  }
  const given = Array.isArray(raw.order) ? raw.order.filter((x) => typeof x === 'string' && board.objects[x]) : [];
  const seen = new Set(given);
  board.order = [...given.filter((x, i) => given.indexOf(x) === i)];
  for (const k of Object.keys(board.objects)) if (!seen.has(k)) board.order.push(k);
  board.comments = (Array.isArray(raw.comments) ? raw.comments : []).slice(0, 2000).map((c) => ({
    id: id(c?.id) || uid(), x: num(c?.x), y: num(c?.y), text: str(c?.text, '', 2000),
    author: str(c?.author, '', 60), time: num(c?.time, Date.now(), 0, 4e12), resolved: bool(c?.resolved),
  })).filter((c) => c.text);
  board.dropped = dropped;
  return board;
}

export function exportBoardJSON(board) {
  const { dropped, ...b } = board;
  void dropped;
  return JSON.stringify({ app: 'boardwise', format: FORMAT, schema: SCHEMA_VERSION, exportedAt: Date.now(), kind: 'board', board: b });
}

export function exportBackupJSON(boards) {
  return JSON.stringify({
    app: 'boardwise', format: FORMAT, schema: SCHEMA_VERSION, exportedAt: Date.now(), kind: 'backup',
    boards: boards.map(({ dropped, ...b }) => (void dropped, b)),
  });
}

/** Parse + validate a JSON text. Returns { kind, boards[] }. Throws ImportError with a clear message. */
export function parseImport(text, { maxBytes = LIMITS.jsonBytes } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new ImportError('The file is empty.');
  if (text.length > maxBytes) throw new ImportError(`File is too large (limit ${Math.round(maxBytes / 1048576)} MB).`, 'too-large');
  let data;
  try { data = JSON.parse(text); } catch { throw new ImportError('This file is not valid JSON.'); }
  if (!data || typeof data !== 'object' || data.app !== 'boardwise') throw new ImportError('This is not a Boardwise file.');
  if (typeof data.format !== 'number' || data.format > FORMAT) throw new ImportError('This file was made by a newer version of Boardwise.');
  if (data.kind === 'backup') {
    if (!Array.isArray(data.boards)) throw new ImportError('Backup file has no boards.');
    if (data.boards.length > LIMITS.maxBoards) throw new ImportError('Backup has too many boards.', 'too-large');
    return { kind: 'backup', boards: data.boards.map((b) => normaliseBoard(b)) };
  }
  if (!data.board) throw new ImportError('File has no board in it.');
  return { kind: 'board', boards: [normaliseBoard(data.board)] };
}
