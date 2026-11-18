// Starter templates. Text comes from translation keys so templates follow the UI language.
import { emptyBoard, makers } from './model.js';

export const TEMPLATES = [
  { id: 'blank' }, { id: 'brainstorm' }, { id: 'kanban' }, { id: 'retro' }, { id: 'swot' },
  { id: 'mindmap' }, { id: 'flowchart' }, { id: 'planner' }, { id: 'journey' },
];

const noop = (k) => k;

function frame(list, x, y, w, h, title) { const f = makers.frame(x, y, w, h, title); list.push(f); return f; }
function note(list, x, y, color, text) { const s = makers.sticky(x, y, color, { text }); list.push(s); return s; }
function shape(list, kind, x, y, w, h, text, style = {}) { const s = makers.shape(kind, x, y, w, h, { text, ...style }); list.push(s); return s; }
function link(list, a, b, style = {}) { const c = makers.connector({ id: a.id, side: 'auto', x: 0, y: 0 }, { id: b.id, side: 'auto', x: 0, y: 0 }, { route: 'elbow', ...style }); list.push(c); return c; }

const BUILD = {
  blank: () => [],
  brainstorm: (L, t) => {
    const topic = shape(L, 'ellipse', -140, -80, 280, 160, t('tpl.brainstorm.topic'), { fill: '#a5d8ff', fontSize: 24, bold: true });
    const cols = [['tpl.brainstorm.ideas', 'yellow', -760], ['tpl.brainstorm.questions', 'pink', 360]];
    cols.forEach(([k, c, x]) => { frame(L, x, -260, 400, 520, t(k)); note(L, x + 24, -200, c, ''); note(L, x + 220, -200, c, ''); });
    frame(L, -300, 200, 600, 360, t('tpl.brainstorm.next')); note(L, -270, 260, 'green', '');
    return topic;
  },
  kanban: (L, t) => {
    ['todo', 'doing', 'done'].forEach((k, i) => frame(L, i * 360 - 540, -280, 330, 640, t('tpl.kanban.' + k)));
    note(L, -516, -220, 'yellow', t('tpl.kanban.sample1')); note(L, -516, -20, 'yellow', t('tpl.kanban.sample2')); note(L, -156, -220, 'blue', t('tpl.kanban.sample3'));
  },
  retro: (L, t) => {
    [['well', 'green'], ['improve', 'pink'], ['actions', 'blue']].forEach(([k, c], i) => { const x = i * 440 - 660; frame(L, x, -260, 410, 600, t('tpl.retro.' + k)); note(L, x + 24, -200, c, ''); });
  },
  swot: (L, t) => {
    [['s', 'green', -460, -330], ['w', 'orange', 20, -330], ['o', 'blue', -460, 30], ['t', 'pink', 20, 30]].forEach(([k, c, x, y]) => { frame(L, x, y, 440, 330, t('tpl.swot.' + k)); note(L, x + 24, y + 40, c, ''); });
  },
  mindmap: (L, t) => {
    const hub = shape(L, 'ellipse', -130, -60, 260, 120, t('tpl.mindmap.center'), { fill: '#ffd8a8', fontSize: 22, bold: true });
    const pos = [[-520, -260], [-520, 140], [300, -260], [300, 140], [-110, -330]];
    pos.forEach(([x, y], i) => { const n = shape(L, 'round', x, y, 220, 90, t('tpl.mindmap.branch', { n: i + 1 }), { fill: '#d0bfff' }); link(L, hub, n, { route: 'curve', arrowEnd: false }); });
  },
  flowchart: (L, t) => {
    const a = shape(L, 'round', -110, -330, 220, 80, t('tpl.flow.start'), { fill: '#b2f2bb' });
    const b = shape(L, 'rect', -110, -190, 220, 80, t('tpl.flow.step'), { fill: '#a5d8ff' });
    const d = shape(L, 'diamond', -140, -50, 280, 160, t('tpl.flow.decision'), { fill: '#ffe08a' });
    const y = shape(L, 'rect', -110, 190, 220, 80, t('tpl.flow.yes'), { fill: '#a5d8ff' });
    const n = shape(L, 'rect', 220, -10, 220, 80, t('tpl.flow.no'), { fill: '#a5d8ff' });
    const e = shape(L, 'round', -110, 330, 220, 80, t('tpl.flow.end'), { fill: '#ffc9c9' });
    link(L, a, b); link(L, b, d); link(L, d, y, { label: t('tpl.flow.yesLabel') }); link(L, d, n, { label: t('tpl.flow.noLabel') }); link(L, y, e);
  },
  planner: (L, t) => {
    ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((k, i) => frame(L, i * 340 - 860, -300, 320, 560, t('day.' + k)));
    ['sat', 'sun'].forEach((k, i) => frame(L, i * 340 - 520, 320, 320, 300, t('day.' + k)));
    frame(L, 190, 320, 650, 300, t('tpl.planner.notes'));
  },
  journey: (L, t) => {
    const stages = ['aware', 'consider', 'decide', 'use', 'advocate'];
    const rows = ['actions', 'thoughts', 'feelings', 'ideas'];
    const tbl = makers.table(-420, -200, rows.length + 1, stages.length + 1, { fontSize: 15 });
    tbl.w = 920; tbl.h = 420;
    tbl.cells = tbl.cells.map((r, ri) => r.map((_, ci) => (ri === 0 && ci > 0 ? t('tpl.journey.' + stages[ci - 1]) : ci === 0 && ri > 0 ? t('tpl.journey.' + rows[ri - 1]) : '')));
    L.push(tbl);
  },
};

export function buildTemplate(id, { name, t = noop } = {}) {
  const board = emptyBoard(name || 'Untitled board');
  const list = [];
  (BUILD[id] || BUILD.blank)(list, t);
  for (const o of list) { board.objects[o.id] = o; board.order.push(o.id); }
  // Frames first so notes/shapes sit on top of them.
  board.order.sort((a, b) => (board.objects[a].type === 'frame' ? 0 : 1) - (board.objects[b].type === 'frame' ? 0 : 1));
  return board;
}
