// Board data model: constants, id generation and object factories.

export const SCHEMA_VERSION = 1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const GRID = 24;

export const PALETTE = [
  '#1b1b1f', '#6b7280', '#d62839', '#f26a1b', '#e0a800', '#1f9d55',
  '#0b8ea0', '#1f4fd8', '#7c3aed', '#c026a3', '#ffffff',
];

export const FILLS = [
  'transparent', '#ffffff', '#ffe08a', '#ffc9c9', '#ffd8a8', '#b2f2bb',
  '#a5d8ff', '#d0bfff', '#fcc2d7', '#e9ecef', '#1b1b1f',
];

export const STICKY_COLORS = [
  { id: 'yellow', fill: '#fff176', name: 'Yellow' },
  { id: 'pink', fill: '#ff9ec7', name: 'Pink' },
  { id: 'blue', fill: '#8ecbff', name: 'Blue' },
  { id: 'green', fill: '#a5e8a0', name: 'Green' },
  { id: 'orange', fill: '#ffbf80', name: 'Orange' },
  { id: 'purple', fill: '#cdb4ff', name: 'Purple' },
  { id: 'grey', fill: '#dfe3e8', name: 'Grey' },
];

export const SHAPE_KINDS = ['rect', 'round', 'ellipse', 'triangle', 'diamond', 'star', 'arrow', 'line'];
export const STAMPS = ['👍', '👎', '❤️', '🎉', '😂', '😮', '🤔', '✅', '❌', '⭐', '🔥', '💡', '❓', '⚠️'];
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Arabic", "Noto Sans Hebrew", sans-serif';

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1e6;
  const rnd = (crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 4e9, Math.random() * 4e9]);
  return (
    Date.now().toString(36) +
    counter.toString(36).padStart(2, '0') +
    Number(rnd[0]).toString(36).slice(0, 5) +
    Number(rnd[1]).toString(36).slice(0, 3)
  );
}

const base = (type, x, y, w, h, extra = {}) => ({
  id: uid(), type, x, y, w, h, rotation: 0, locked: false, groupId: null, ...extra,
});

export const makers = {
  pen(points, { color, width, opacity = 1, highlighter = false }) {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return base('pen', x, y, Math.max(...xs) - x, Math.max(...ys) - y, {
      pts: points.map((p) => [round(p.x - x), round(p.y - y), round2(p.p ?? 0.5)]),
      color, width, opacity, highlighter,
    });
  },
  shape(kind, x, y, w, h, style = {}) {
    return base('shape', x, y, w, h, {
      kind,
      fill: kind === 'line' || kind === 'arrow' ? 'transparent' : '#ffffff',
      stroke: '#1b1b1f', strokeWidth: 2, opacity: 1, dash: 'solid',
      text: '', fontSize: 18, bold: false, italic: false, align: 'center', color: '#1b1b1f',
      flipX: false, flipY: false,
      ...style,
    });
  },
  text(x, y, w = 220, h = 36, style = {}) {
    return base('text', x, y, w, h, {
      text: '', fontSize: 24, bold: false, italic: false, align: 'left', color: '#1b1b1f', autoSize: true,
      ...style,
    });
  },
  sticky(x, y, color = 'yellow', style = {}) {
    return base('sticky', x, y, 180, 180, {
      color, text: '', fontSize: 18, bold: false, italic: false, align: 'left', votes: {}, ...style,
    });
  },
  image(x, y, w, h, src, alt = '') {
    return base('image', x, y, w, h, { src, alt, opacity: 1 });
  },
  frame(x, y, w, h, title = 'Frame') {
    return base('frame', x, y, w, h, { title, fill: 'transparent', stroke: '#6b7280' });
  },
  table(x, y, rows = 3, cols = 3, style = {}) {
    const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
    return base('table', x, y, cols * 120, rows * 40, {
      cells, rows, cols, fontSize: 16, header: true, stroke: '#6b7280', fill: '#ffffff', color: '#1b1b1f', ...style,
    });
  },
  checklist(x, y, items, style = {}) {
    const list = items || [{ text: 'Item', done: false }];
    return base('checklist', x, y, 260, 44 + list.length * 32, {
      title: 'Checklist', items: list, fontSize: 16, color: '#1b1b1f', fill: '#ffffff', stroke: '#6b7280', ...style,
    });
  },
  stamp(x, y, emoji) {
    return base('stamp', x, y, 56, 56, { emoji });
  },
  connector(from, to, style = {}) {
    return base('connector', Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y), {
      from, to, route: 'elbow', arrowStart: false, arrowEnd: true,
      stroke: '#1b1b1f', strokeWidth: 2, dash: 'solid', opacity: 1, label: '',
      ...style,
    });
  },
};

const round = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

export function emptyBoard(name = 'Untitled board') {
  const now = Date.now();
  return {
    schema: SCHEMA_VERSION,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    lastOpened: now,
    folder: '',
    favourite: false,
    settings: { background: 'dots', snap: false, gridSize: GRID },
    view: { x: 0, y: 0, zoom: 1 },
    objects: {},
    order: [],
    comments: [],
  };
}

export const TYPES = ['pen', 'shape', 'text', 'sticky', 'image', 'frame', 'table', 'checklist', 'stamp', 'connector'];

/** Types that carry editable text, with the field that holds it. */
export function textOf(o) {
  switch (o.type) {
    case 'shape': case 'text': case 'sticky': return o.text || '';
    case 'frame': return o.title || '';
    case 'connector': return o.label || '';
    case 'image': return o.alt || '';
    case 'table': return (o.cells || []).flat().join(' ');
    case 'checklist': return [o.title, ...(o.items || []).map((i) => i.text)].join(' ');
    default: return '';
  }
}

/** Dot votes are stored per voter so concurrent votes from different people never overwrite each other. */
export function totalVotes(o) {
  let n = 0;
  if (o && o.votes && typeof o.votes === 'object') for (const v of Object.values(o.votes)) n += v | 0;
  return n;
}
