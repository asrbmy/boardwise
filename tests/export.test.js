import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/core/store.js';
import { makers } from '../src/core/model.js';
import { objectsToSvg } from '../src/export/svg.js';
import { buildPdf, jpegSize } from '../src/export/pdf.js';
import { boardToMarkdown } from '../src/export/markdown.js';
import { sanitizeSvg } from '../src/core/sanitize.js';
import { exportTarget, clampScale, MAX_SIDE } from '../src/export/raster.js';

function sample() {
  const s = new BoardStore();
  const f = makers.frame(0, 0, 500, 400, 'Plan <A>');
  const a = makers.sticky(20, 20, 'pink', { text: 'Buy milk & eggs' });
  const b = makers.shape('ellipse', 240, 40, 120, 80, { text: 'Idea', fill: '#a5d8ff' });
  const c = makers.connector({ id: a.id, side: 'auto', x: 0, y: 0 }, { id: b.id, side: 'auto', x: 0, y: 0 }, { label: 'leads to', route: 'curve' });
  const pen = makers.pen([{ x: 10, y: 300 }, { x: 80, y: 340 }, { x: 150, y: 310 }], { color: '#d62839', width: 4 });
  const img = makers.image(300, 250, 100, 80, 'data:image/png;base64,AAAA', 'A "picture"');
  const tb = makers.table(20, 200, 2, 2); tb.cells = [['H1', 'H|2'], ['x', 'y']];
  const cl = makers.checklist(260, 150, [{ text: 'one', done: true }, { text: 'two', done: false }]);
  const outside = makers.text(700, 20, 200, 40, { text: '# not a heading' });
  s.add([f, a, b, c, pen, img, tb, cl, outside, makers.stamp(450, 10, '🎉')]);
  return { s, ids: { f, a, b, c } };
}

describe('SVG export', () => {
  it('produces well-formed, self-contained SVG that survives our own sanitiser', () => {
    const { s } = sample();
    const t = exportTarget(s, { kind: 'board' });
    const svg = objectsToSvg(s, { rect: t.rect, ids: t.ids, title: 'Test' });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(svg).toContain('Buy milk &amp; eggs');
    expect(svg).toContain('Plan &lt;A&gt;');
    expect(svg).not.toMatch(/<script|onclick|http:\/\/(?!www\.w3\.org)/i);
    expect(() => sanitizeSvg(svg.replace(/<image[\s\S]*?<\/image>/, ''))).not.toThrow();
  });
  it('can export only a frame (clipped to it, with its contents)', () => {
    const { s, ids } = sample();
    const t = exportTarget(s, { kind: 'frame', frameId: ids.f.id });
    expect(t.rect).toEqual({ x: 0, y: 0, w: 500, h: 400 });
    expect(t.ids).toContain(ids.a.id);
    expect(t.ids).not.toContain(s.list().find((o) => o.type === 'text').id);
  });
  it('can export a selection with padding', () => {
    const { s, ids } = sample();
    const t = exportTarget(s, { kind: 'selection', ids: [ids.a.id], padding: 10 });
    expect(t.rect).toEqual({ x: 10, y: 10, w: 200, h: 200 });
  });
  it('transparent option drops the background rect', () => {
    const { s } = sample();
    const t = exportTarget(s, { kind: 'board' });
    expect(objectsToSvg(s, { rect: t.rect, ids: t.ids, transparent: true })).not.toMatch(/<svg[^>]*>\s*<rect[^>]*fill="#fbfbfc"/);
  });
  it('clamps raster scale to safe limits', () => {
    expect(clampScale({ w: 100, h: 100 }, 2)).toBe(2);
    expect(clampScale({ w: 20000, h: 100 }, 2) * 20000).toBeLessThanOrEqual(MAX_SIDE + 1);
    const s = clampScale({ w: 8000, h: 8000 }, 2);
    expect(8000 * s * 8000 * s).toBeLessThanOrEqual(36e6 + 1);
  });
});

describe('PDF writer', () => {
  const fakeJpeg = (w, h) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  it('writes a structurally valid PDF with one page per image', () => {
    const j = fakeJpeg(300, 200);
    expect(jpegSize(j)).toEqual({ w: 300, h: 200 });
    const pdf = buildPdf([{ jpeg: j, w: 300, h: 200, pxW: 300, pxH: 200 }, { jpeg: j, w: 300, h: 200, pxW: 300, pxH: 200 }], { title: 'Café' });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toMatch(/\/Count 2/);
    expect(text).toContain('/MediaBox [0 0 225 150]');
    // every xref offset must point at "<n> 0 obj"
    const start = Number(/startxref\n(\d+)/.exec(text)[1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const entries = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(entries.length).toBe(4 + 2 * 3 - 1);
    entries.forEach((off, i) => expect(text.slice(off, off + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    expect(text).toContain('(Caf?)'); // non-ASCII title is made safe, file stays valid
  });
});

describe('Markdown outline', () => {
  it('groups by frame, keeps checklists/tables, escapes markup', () => {
    const { s } = sample();
    const md = boardToMarkdown(s, { name: 'My *board*', comments: [{ text: 'Check this', author: 'Ann', resolved: false }, { text: 'Done thing', resolved: true }] });
    expect(md).toMatch(/^# My \\\*board\\\*/);
    expect(md).toContain('## Plan \\<A\\>');
    expect(md).toContain('- Buy milk & eggs');
    expect(md).toContain('- Idea');
    expect(md).toContain('- [x] one');
    expect(md).toContain('- [ ] two');
    expect(md).toContain('| H1 | H\\|2 |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('- Buy milk & eggs → Idea: leads to'.replace('&', '&'));
    expect(md).toContain('## Other notes');
    expect(md).toContain('\\# not a heading');
    expect(md).toContain('## Comments');
    expect(md).toContain('~~Done thing~~ (resolved)');
    expect(md).toContain('Check this — Ann');
  });
  it('orders items top-to-bottom, left-to-right', () => {
    const s = new BoardStore();
    s.add([makers.sticky(300, 0, 'blue', { text: 'B' }), makers.sticky(0, 0, 'blue', { text: 'A' }), makers.sticky(0, 400, 'blue', { text: 'C' })]);
    const md = boardToMarkdown(s, { name: 'x' });
    expect(md.indexOf('- A')).toBeLessThan(md.indexOf('- B'));
    expect(md.indexOf('- B')).toBeLessThan(md.indexOf('- C'));
  });
  it('empty board gives just a title', () => { expect(boardToMarkdown(new BoardStore(), { name: 'E' })).toBe('# E\n'); });
});
