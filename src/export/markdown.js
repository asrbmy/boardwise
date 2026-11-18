// Markdown outline of a board's text, grouped by frame and ordered the way people read (top to bottom, left to right).
import { boundsOf, objectsInsideFrame } from '../core/hit.js';
import { textOf, totalVotes } from '../core/model.js';

const mdEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/([*_`[\]<>])/g, '\\$1').replace(/^(\s*)([#>+-])/gm, '$1\\$2');
const oneLine = (s) => mdEsc(String(s).replace(/\s*\n\s*/g, ' ').trim());
const cell = (s) => oneLine(s).replace(/\|/g, '\\|');

function readingOrder(a, b, objects) {
  const A = boundsOf(a, objects), B = boundsOf(b, objects);
  return Math.abs(A.y - B.y) < 60 ? A.x - B.x : A.y - B.y;
}

function itemLines(o, store) {
  switch (o.type) {
    case 'sticky': { const v = totalVotes(o); return o.text.trim() ? [`- ${oneLine(o.text)}${v ? ` (${v} vote${v === 1 ? '' : 's'})` : ''}`] : []; }
    case 'text': return o.text.trim() ? ['', ...o.text.split('\n').map((l) => mdEsc(l)), ''] : [];
    case 'shape': return o.text?.trim() ? [`- ${oneLine(o.text)}`] : [];
    case 'checklist': return [`- **${oneLine(o.title)}**`, ...o.items.filter((i) => i.text.trim()).map((i) => `  - [${i.done ? 'x' : ' '}] ${oneLine(i.text)}`)];
    case 'table': {
      const rows = o.cells.map((r) => `| ${r.map(cell).join(' | ')} |`);
      if (!rows.length || o.cells.flat().every((c) => !c.trim())) return [];
      return ['', rows[0], `| ${o.cells[0].map(() => '---').join(' | ')} |`, ...rows.slice(1), ''];
    }
    case 'image': return o.alt?.trim() ? [`- *(image)* ${oneLine(o.alt)}`] : [];
    case 'connector': {
      if (!o.label?.trim()) return [];
      const name = (e) => (e.id && store.objects[e.id] ? oneLine(textOf(store.objects[e.id]) || store.objects[e.id].type) : '…');
      return [`- ${name(o.from)} → ${name(o.to)}: ${oneLine(o.label)}`];
    }
    default: return [];
  }
}

export function boardToMarkdown(store, { name = 'Board', comments = [], labels = {} } = {}) {
  const L = { other: 'Other notes', comments: 'Comments', resolved: 'resolved', ...labels };
  const out = [`# ${oneLine(name)}`, ''];
  const frames = store.list().filter((o) => o.type === 'frame').sort((a, b) => readingOrder(a, b, store.objects));
  const used = new Set();
  const section = (title, items) => {
    const lines = items.flatMap((o) => itemLines(o, store));
    if (!lines.length) return;
    out.push(`## ${oneLine(title)}`, '', ...lines, '');
  };
  for (const f of frames) {
    const inside = objectsInsideFrame(store, f).sort((a, b) => readingOrder(a, b, store.objects));
    inside.forEach((o) => used.add(o.id));
    section(f.title || 'Frame', inside);
  }
  const rest = store.list().filter((o) => o.type !== 'frame' && !used.has(o.id)).sort((a, b) => readingOrder(a, b, store.objects));
  const restLines = rest.flatMap((o) => itemLines(o, store));
  if (restLines.length) { if (frames.length) out.push(`## ${L.other}`, ''); out.push(...restLines, ''); }
  if (comments.length) {
    out.push(`## ${L.comments}`, '');
    for (const c of comments) out.push(`- ${c.resolved ? `~~${oneLine(c.text)}~~ (${L.resolved})` : oneLine(c.text)}${c.author ? ` — ${oneLine(c.author)}` : ''}`);
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
