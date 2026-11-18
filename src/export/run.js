// Runs an export and returns { blob, filename }. UI-agnostic so tests can call it directly.
import { exportBoardJSON } from '../core/serialize.js';
import { exportTarget, renderToCanvas, canvasToBlob } from './raster.js';
import { objectsToSvg } from './svg.js';
import { buildPdf, jpegSize } from './pdf.js';
import { boardToMarkdown } from './markdown.js';
import { safeName } from './files.js';

export const FORMATS = ['png', 'svg', 'pdf', 'json', 'md'];

export function framesInOrder(store) {
  return store.list().filter((o) => o.type === 'frame').sort((a, b) => (Math.abs(a.y - b.y) < 80 ? a.x - b.x : a.y - b.y));
}

/** opts: { format, scope: 'board'|'selection'|'frame', frameId, scale, transparent, dark, name, selection, labels } */
export async function runExport(store, opts) {
  const { format, scope = 'board', frameId = null, scale = 1, transparent = false, dark = false, selection = [] } = opts;
  const name = safeName(opts.name || store.meta.name);
  const theme = dark ? 'dark' : 'light';
  if (format === 'json') {
    return { blob: new Blob([exportBoardJSON(store.snapshot())], { type: 'application/json' }), filename: `${name}.boardwise.json` };
  }
  if (format === 'md') {
    const md = boardToMarkdown(store, { name: store.meta.name, comments: store.meta.comments || [], labels: opts.labels });
    return { blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }), filename: `${name}.md` };
  }
  if (format === 'pdf') {
    const frames = scope === 'board' ? framesInOrder(store) : [];
    const targets = frames.length ? frames.map((f) => exportTarget(store, { kind: 'frame', frameId: f.id })) : [exportTarget(store, { kind: scope === 'selection' ? 'selection' : 'board', ids: selection })];
    if (!targets[0].rect) throw new Error('empty');
    const pages = [];
    for (const t of targets) {
      const { canvas } = await renderToCanvas(store, { ...t, scale: 1.5, theme });
      const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
      const sz = jpegSize(jpeg) || { w: canvas.width, h: canvas.height };
      pages.push({ jpeg, w: t.rect.w, h: t.rect.h, pxW: sz.w, pxH: sz.h });
    }
    return { blob: new Blob([buildPdf(pages, { title: store.meta.name })], { type: 'application/pdf' }), filename: `${name}.pdf`, pages: pages.length };
  }
  const target = exportTarget(store, { kind: scope, ids: selection, frameId });
  if (!target.rect) throw new Error('empty');
  const suffix = scope === 'frame' ? `-${safeName(store.get(frameId)?.title || 'frame')}` : scope === 'selection' ? '-selection' : '';
  if (format === 'svg') {
    const svg = objectsToSvg(store, { rect: target.rect, ids: target.ids, theme, transparent, title: store.meta.name });
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), filename: `${name}${suffix}.svg` };
  }
  const { canvas, scale: used } = await renderToCanvas(store, { ...target, scale, theme, transparent });
  const blob = await canvasToBlob(canvas, 'image/png');
  return { blob, filename: `${name}${suffix}${scale > 1 ? `@${scale}x` : ''}.png`, width: canvas.width, height: canvas.height, scale: used };
}
