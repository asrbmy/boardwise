// Vector export. Mirrors the canvas renderer (same text layout, same geometry) but emits SVG markup.
// Output is self-contained: images are embedded as data URLs, no external references, no scripts.
import { FONT, STICKY_COLORS } from '../core/model.js';
import { THEMES, layoutText, shapeTextBox, isRTL, LINE_H, fitFontSize } from '../core/render.js';
import { boundsOf, lineEnds, resolveConnector } from '../core/hit.js';
import { center, shapePolygon } from '../core/geometry.js';
import { totalVotes } from '../core/model.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 100) / 100;
const dashOf = (dash, w) => (dash === 'dashed' ? ` stroke-dasharray="${n(w * 4)} ${n(w * 3)}"` : dash === 'dotted' ? ` stroke-dasharray="${n(w)} ${n(w * 2.2)}"` : '');
const fillOf = (f) => (!f || f === 'transparent' ? 'none' : f);

function textBlock(o, text, box, { color, size = o.fontSize, vAlign = 'top', pad = 6 } = {}) {
  if (!text) return '';
  const lines = layoutText(o, text, box.w - pad * 2, size);
  const lh = size * LINE_H;
  const total = lines.length * lh;
  const y0 = vAlign === 'middle' ? box.y + (box.h - total) / 2 : box.y + pad;
  const rtl = isRTL(text);
  const align = o.align || 'left';
  let x, anchor;
  if (align === 'center') { x = box.x + box.w / 2; anchor = 'middle'; }
  else { const start = (align === 'left') !== rtl; x = start ? box.x + pad : box.x + box.w - pad; anchor = start ? 'start' : 'end'; }
  const tspans = lines.map((l, i) => `<tspan x="${n(x)}" y="${n(y0 + i * lh + lh / 2)}">${esc(l) || ' '}</tspan>`).join('');
  return `<text font-family="${esc(FONT)}" font-size="${n(size)}"${o.bold ? ' font-weight="700"' : ''}${o.italic ? ' font-style="italic"' : ''} fill="${color}" text-anchor="${anchor}" dominant-baseline="central"${rtl ? ' direction="rtl"' : ''} xml:space="preserve">${tspans}</text>`;
}

function arrowHead(tip, from, size, color) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const p = (d) => `${n(tip.x - size * Math.cos(a + d))},${n(tip.y - size * Math.sin(a + d))}`;
  return `<polygon points="${n(tip.x)},${n(tip.y)} ${p(-0.45)} ${p(0.45)}" fill="${color}"/>`;
}

function rotate(o, inner) {
  if (!o.rotation) return inner;
  const c = center(o);
  return `<g transform="rotate(${n((o.rotation * 180) / Math.PI)} ${n(c.x)} ${n(c.y)})">${inner}</g>`;
}

function shapeSvg(o) {
  const sw = o.strokeWidth, stroke = o.stroke, fill = fillOf(o.fill);
  const common = `fill="${fill}" stroke="${sw > 0 ? stroke : 'none'}" stroke-width="${sw}"${dashOf(o.dash, Math.max(1, sw))} stroke-linejoin="round" opacity="${o.opacity}"`;
  let body = '';
  if (o.kind === 'line' || o.kind === 'arrow') {
    const [s, e] = lineEnds(o);
    body = `<line x1="${n(s.x)}" y1="${n(s.y)}" x2="${n(e.x)}" y2="${n(e.y)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${dashOf(o.dash, Math.max(1, sw))} opacity="${o.opacity}"/>`;
    if (o.kind === 'arrow') body += arrowHead(e, s, 10 + sw * 2.5, stroke);
    return rotate(o, body);
  }
  if (o.kind === 'ellipse') body = `<ellipse cx="${n(o.x + o.w / 2)}" cy="${n(o.y + o.h / 2)}" rx="${n(o.w / 2)}" ry="${n(o.h / 2)}" ${common}/>`;
  else if (o.kind === 'rect') body = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" ${common}/>`;
  else if (o.kind === 'round') body = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="${n(Math.min(o.w, o.h) * 0.2)}" ${common}/>`;
  else body = `<polygon points="${shapePolygon(o.kind, o.x, o.y, o.w, o.h).map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" ${common}/>`;
  if (o.text) body += textBlock(o, o.text, shapeTextBox(o), { color: o.color, vAlign: 'middle' });
  return rotate(o, body);
}

function penSvg(o) {
  const pts = o.pts.map(([x, y]) => [o.x + x, o.y + y]);
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  if (pts.length === 1) d += ` l0.01 0`;
  for (let i = 1; i < pts.length - 1; i++) d += ` Q${n(pts[i][0])} ${n(pts[i][1])} ${n((pts[i][0] + pts[i + 1][0]) / 2)} ${n((pts[i][1] + pts[i + 1][1]) / 2)}`;
  if (pts.length > 1) d += ` L${n(pts[pts.length - 1][0])} ${n(pts[pts.length - 1][1])}`;
  const hl = o.highlighter;
  return rotate(o, `<path d="${d}" fill="none" stroke="${o.color}" stroke-width="${o.width}" stroke-linecap="${hl ? 'butt' : 'round'}" stroke-linejoin="round" opacity="${hl ? 0.38 * o.opacity : o.opacity}"${hl ? ' style="mix-blend-mode:multiply"' : ''}/>`);
}

function connectorSvg(o, objects) {
  const r = resolveConnector(o, objects);
  const col = o.stroke;
  let d;
  if (r.kind === 'curve') d = `M${n(r.a.x)} ${n(r.a.y)} C${n(r.ctrl[0].x)} ${n(r.ctrl[0].y)} ${n(r.ctrl[1].x)} ${n(r.ctrl[1].y)} ${n(r.b.x)} ${n(r.b.y)}`;
  else d = r.pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(' ');
  let out = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${o.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dashOf(o.dash, Math.max(1, o.strokeWidth))} opacity="${o.opacity}"/>`;
  const k = r.pts.length, head = 9 + o.strokeWidth * 2.2;
  if (o.arrowEnd && k > 1) out += arrowHead(r.pts[k - 1], r.pts[k - 2], head, col);
  if (o.arrowStart && k > 1) out += arrowHead(r.pts[0], r.pts[1], head, col);
  if (o.label) {
    const m = r.pts[Math.floor(k / 2)];
    out += `<rect x="${n(m.x - o.label.length * 4.2 - 6)}" y="${n(m.y - 11)}" width="${n(o.label.length * 8.4 + 12)}" height="22" fill="var(--bw-bg,#fbfbfc)"/>`;
    out += `<text x="${n(m.x)}" y="${n(m.y)}" font-family="${esc(FONT)}" font-size="15" text-anchor="middle" dominant-baseline="central" fill="#1b1b1f">${esc(o.label)}</text>`;
  }
  return out;
}

function objectSvg(o, objects, theme) {
  const ink = '#1b1b1f';
  switch (o.type) {
    case 'pen': return penSvg(o);
    case 'shape': return shapeSvg(o);
    case 'connector': return connectorSvg(o, objects);
    case 'text': return rotate(o, textBlock(o, o.text, o, { color: o.color }));
    case 'sticky': {
      const col = STICKY_COLORS.find((c) => c.id === o.color) || STICKY_COLORS[0];
      const size = fitFontSize(o, o.text || ' ', o.w, o.h);
      let s = `<rect x="${n(o.x + 1)}" y="${n(o.y + 3)}" width="${n(o.w)}" height="${n(o.h)}" rx="6" fill="rgba(0,0,0,.16)"/><rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="6" fill="${col.fill}"/>`;
      s += textBlock(o, o.text, { x: o.x + 6, y: o.y + 6, w: o.w - 12, h: o.h - 12 }, { color: ink, size, pad: 6 });
      const v = Math.min(totalVotes(o), 12);
      for (let i = 0; i < v; i++) s += `<circle cx="${n(o.x + o.w - 14 - (i % 6) * 14)}" cy="${n(o.y + o.h - 14 - Math.floor(i / 6) * 14)}" r="5.5" fill="#d62839" stroke="#fff" stroke-width="1.2"/>`;
      return rotate(o, s);
    }
    case 'image': return rotate(o, `<image href="${esc(o.src)}" x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" preserveAspectRatio="none" opacity="${o.opacity}"><title>${esc(o.alt || '')}</title></image>`);
    case 'frame': {
      const t = o.title || 'Frame';
      return `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${fillOf(o.fill)}" stroke="${o.stroke}" stroke-width="1.5" stroke-dasharray="8 5"/><text x="${n(o.x)}" y="${n(o.y - 6)}" font-family="${esc(FONT)}" font-size="14" font-weight="600" fill="${THEMES[theme].muted}">${esc(t)}</text>`;
    }
    case 'table': {
      const cw = o.w / o.cols, rh = o.h / o.rows;
      let s = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${o.fill}"/>`;
      if (o.header) s += `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(rh)}" fill="#eef1f6"/>`;
      let d = '';
      for (let r = 0; r <= o.rows; r++) d += `M${n(o.x)} ${n(o.y + r * rh)}H${n(o.x + o.w)}`;
      for (let c = 0; c <= o.cols; c++) d += `M${n(o.x + c * cw)} ${n(o.y)}V${n(o.y + o.h)}`;
      s += `<path d="${d}" stroke="${o.stroke}" stroke-width="1.2" fill="none"/>`;
      for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
        const tx = o.cells[r]?.[c];
        if (tx) s += textBlock({ ...o, bold: o.header && r === 0, align: 'left' }, tx, { x: o.x + c * cw, y: o.y + r * rh, w: cw, h: rh }, { color: o.color, vAlign: 'middle' });
      }
      return rotate(o, s);
    }
    case 'checklist': {
      let s = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="8" fill="${o.fill}" stroke="${o.stroke}" stroke-width="1.2"/>`;
      s += `<text x="${n(o.x + 12)}" y="${n(o.y + 22)}" font-family="${esc(FONT)}" font-size="${o.fontSize + 2}" font-weight="700" fill="${o.color}" dominant-baseline="central">${esc(o.title)}</text>`;
      o.items.forEach((it, i) => {
        const y = o.y + 44 + i * 32 + 16;
        s += `<rect x="${n(o.x + 12)}" y="${n(y - 8)}" width="16" height="16" fill="none" stroke="${o.color}" stroke-width="1.6"/>`;
        if (it.done) s += `<path d="M${n(o.x + 15)} ${n(y)}L${n(o.x + 19.5)} ${n(y + 4.5)}L${n(o.x + 26)} ${n(y - 5)}" fill="none" stroke="${o.color}" stroke-width="1.6"/>`;
        s += `<text x="${n(o.x + 38)}" y="${n(y)}" font-family="${esc(FONT)}" font-size="${o.fontSize}" fill="${it.done ? THEMES[theme].muted : o.color}" dominant-baseline="central"${it.done ? ' text-decoration="line-through"' : ''}>${esc(it.text)}</text>`;
      });
      return rotate(o, s);
    }
    case 'stamp': return rotate(o, `<text x="${n(o.x + o.w / 2)}" y="${n(o.y + o.h / 2 + o.h * 0.04)}" font-size="${n(Math.min(o.w, o.h) * 0.82)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(FONT)}">${esc(o.emoji)}</text>`);
    default: return '';
  }
}

/** Build a standalone SVG document for `rect` containing `ids` (in z-order). */
export function objectsToSvg(store, { rect, ids, theme = 'light', transparent = false, title = '' }) {
  const set = new Set(ids);
  const body = store.order.filter((id) => set.has(id)).map((id) => objectSvg(store.objects[id], store.objects, theme)).join('\n');
  const w = Math.max(1, Math.round(rect.w)), h = Math.max(1, Math.round(rect.h));
  const bg = THEMES[theme].bg;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(rect.x)} ${n(rect.y)} ${n(rect.w)} ${n(rect.h)}" width="${w}" height="${h}" role="img"${title ? ` aria-label="${esc(title)}"` : ''}>\n${title ? `<title>${esc(title)}</title>\n` : ''}${transparent ? '' : `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}" fill="${bg}"/>\n`}${body}\n</svg>\n`;
}

void boundsOf;
