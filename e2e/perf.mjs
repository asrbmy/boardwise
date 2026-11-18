// 2,000-object performance test. Measures (a) CPU cost of drawing a frame and (b) real rendered frames per second
// while panning/zooming. Note: headless Chrome here has no GPU, so numbers are a pessimistic floor.
import { serve, launch, openPage, newBoard, Reporter, assert, sleep } from './lib.mjs';

export default async function perf({ browser, srv, R, url }) {
  console.log('Performance: 2,000 objects');
  const { page, errors } = await openPage(browser, url, { viewport: { width: 1440, height: 900 } });
  await newBoard(page, srv.url);
  await page.evaluate(() => {
    const { store } = window.__bw;
    const objs = []; let n = 0;
    const base = (type, x, y, w, h, extra) => ({ id: 'p' + (n++), type, x, y, w, h, rotation: 0, locked: false, groupId: null, ...extra });
    const cols = 50, gx = 260, gy = 200;
    for (let i = 0; i < 2000; i++) {
      const x = (i % cols) * gx, y = Math.floor(i / cols) * gy, k = i % 5;
      if (k === 0) objs.push(base('sticky', x, y, 180, 150, { color: ['yellow', 'pink', 'blue', 'green'][i % 4], text: 'Note ' + i + ' lorem ipsum dolor sit amet', fontSize: 18, bold: false, italic: false, align: 'left', votes: {} }));
      else if (k === 1) objs.push(base('shape', x, y, 200, 120, { kind: ['rect', 'ellipse', 'diamond', 'round'][i % 4], fill: '#a5d8ff', stroke: '#1b1b1f', strokeWidth: 2, opacity: 1, dash: 'solid', text: 'Shape ' + i, fontSize: 18, bold: false, italic: false, align: 'center', color: '#1b1b1f', flipX: false, flipY: false }));
      else if (k === 2) { const pts = Array.from({ length: 60 }, (_, j) => [j * 3, 40 + Math.sin(j / 4) * 30, 0.5]); objs.push(base('pen', x, y, 180, 80, { pts, color: '#d62839', width: 3, opacity: 1, highlighter: false })); }
      else if (k === 3) objs.push(base('text', x, y, 220, 60, { text: 'Heading number ' + i, color: '#1b1b1f', autoSize: true, fontSize: 24, bold: false, italic: false, align: 'left' }));
      else objs.push(base('checklist', x, y, 220, 110, { title: 'List ' + i, items: [{ text: 'one', done: true }, { text: 'two', done: false }], fontSize: 16, color: '#1b1b1f', fill: '#ffffff', stroke: '#6b7280' }));
    }
    store.add(objs, 'bulk');
  });
  const count = await page.evaluate(() => window.__bw.store.size);
  assert(count === 2000, 'created 2000 objects, got ' + count);

  // Draw cost: "cold" = first time each object is drawn (text layout, path building); "warm" = same frames again.
  const drawCost = (label, view, step = { dx: 17, dy: 9 }) => page.evaluate(async ([label, view, step]) => {
    const e = window.__bw.engine; e.setView(view, false);
    const pass = () => { const t = []; let drawn = 0; for (let i = 0; i < 60; i++) { e.setView({ ...view, x: view.x + i * step.dx, y: view.y + i * step.dy }, false); const t0 = performance.now(); e.draw(performance.now()); t.push(performance.now() - t0); drawn = Math.max(drawn, e.stats.drawn); } t.sort((a, b) => a - b); return { median: t[30], p95: t[57], max: t[59], drawn }; };
    const cold = pass(), warm = pass();
    return { label, drawn: warm.drawn, median: warm.median, p95: warm.p95, coldP95: cold.p95, coldMax: cold.max };
  }, [label, view, step]);

  const results = [];
  await R.test('warm draw cost at 100% zoom is well under a 16.7ms frame', async () => { const r = await drawCost('100%', { x: 3000, y: 1500, zoom: 1 }); results.push(r); assert(r.median < 8, `median ${r.median.toFixed(2)}ms`); assert(r.p95 < 40, `p95 ${r.p95.toFixed(2)}ms`); });
  await R.test('cold draw (newly visible objects) stays under 50ms worst case', async () => {
    const r = await page.evaluate(async () => { const e = window.__bw.engine; const { store } = window.__bw; store.add([], 'noop'); const fresh = store.list().map((o) => ({ ...o })); store.apply({ set: Object.fromEntries(fresh.map((o) => [o.id, o])) }); e.setView({ x: 6000, y: 2500, zoom: 1 }, false); const t = []; for (let i = 0; i < 40; i++) { e.setView({ x: 6000 + i * 40, y: 2500 + i * 20, zoom: 1 }, false); const t0 = performance.now(); e.draw(performance.now()); t.push(performance.now() - t0); } t.sort((a, b) => a - b); return { median: t[20], p95: t[37], max: t[39] }; });
    console.log(`      cold: median ${r.median.toFixed(1)}ms, p95 ${r.p95.toFixed(1)}ms, max ${r.max.toFixed(1)}ms`); results.push({ label: 'cold 100%', median: r.median, p95: r.p95 }); assert(r.max < 50, 'cold max ' + r.max.toFixed(1));
  });
  await R.test('warm draw at 40% zoom (many objects visible)', async () => { const r = await drawCost('40%', { x: 2500, y: 1000, zoom: 0.4 }); results.push(r); assert(r.median < 16, `median ${r.median.toFixed(2)}ms`); });
  await R.test('ALL 2,000 objects visible (10% zoom) still draws within ~2 frames, and every object is drawn', async () => { const r = await drawCost('all', { x: -200, y: -200, zoom: 0.1 }, { dx: 0, dy: 0 }); results.push(r); assert(r.drawn >= 2000, 'everything drawn: ' + r.drawn); assert(r.median < 33, `median ${r.median.toFixed(2)}ms`); });
  await R.test('real frame rate while panning and zooming through rAF', async () => {
    const fps = await page.evaluate(() => new Promise((resolve) => {
      const e = window.__bw.engine; let frames = 0, t0 = performance.now(); let i = 0; const long = [];
      let last = t0;
      const step = (t) => {
        e.setView({ x: 3000 + i * 14, y: 1500 + Math.sin(i / 20) * 400, zoom: 0.6 + 0.4 * Math.sin(i / 60) }, false); i++; frames++;
        long.push(t - last); last = t;
        if (t - t0 < 2500) requestAnimationFrame(step); else { long.shift(); long.sort((a, b) => a - b); resolve({ fps: (frames * 1000) / (t - t0), p95: long[Math.floor(long.length * 0.95)], worst: long[long.length - 1] }); }
      };
      requestAnimationFrame(step);
    }));
    console.log(`      measured ${fps.fps.toFixed(1)} fps (p95 frame ${fps.p95.toFixed(1)}ms, worst ${fps.worst.toFixed(1)}ms) in software-rendered headless Chrome`);
    results.push({ label: 'rAF pan/zoom', fps: fps.fps });
    assert(fps.fps >= 55, `fps ${fps.fps.toFixed(1)}`);
  });
  await R.test('selecting, marquee hit-testing and moving 2,000 objects stays interactive', async () => {
    const r = await page.evaluate(() => {
      const { store, engine } = window.__bw;
      let t0 = performance.now(); engine.selectAll(); const tSel = performance.now() - t0;
      t0 = performance.now(); for (let i = 0; i < 200; i++) engine.screenToWorld(i, i) && 0; const tMath = performance.now() - t0;
      t0 = performance.now(); store.begin(); const set = {}; for (const o of engine.selected()) set[o.id] = { ...o, x: o.x + 10 }; store.apply({ set }); store.commit('Move'); const tMove = performance.now() - t0;
      t0 = performance.now(); store.undo(); const tUndo = performance.now() - t0;
      engine.clearSelection();
      return { tSel, tMove, tUndo, tMath };
    });
    console.log(`      select-all ${r.tSel.toFixed(1)}ms, move-all ${r.tMove.toFixed(1)}ms, undo ${r.tUndo.toFixed(1)}ms`);
    assert(r.tSel < 100 && r.tMove < 150 && r.tUndo < 100, JSON.stringify(r));
  });
  await R.test('hover hit-testing on a 2,000-object board is fast', async () => {
    const ms = await page.evaluate(() => { const e = window.__bw.engine; e.setView({ x: 3000, y: 1500, zoom: 1 }, false); const t0 = performance.now(); for (let i = 0; i < 200; i++) e.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + i * 3, clientY: 300, bubbles: true })); return (performance.now() - t0) / 200; });
    console.log(`      hover hit-test ${ms.toFixed(3)} ms/move`); assert(ms < 4, 'hover cost ' + ms);
  });
  await R.test('PNG export of the whole 2,000-object board is clamped to a safe size and completes', async () => {
    const r = await page.evaluate(async () => { const t0 = performance.now(); const out = await window.__bw.runExport(window.__bw.store, { format: 'png', scope: 'board', scale: 2 }); const buf = new Uint8Array(await out.blob.arrayBuffer()); const dv = new DataView(buf.buffer); return { ms: performance.now() - t0, bytes: buf.length, w: dv.getUint32(16), h: dv.getUint32(20), sig: String.fromCharCode(...buf.slice(1, 4)) }; });
    console.log(`      export ${r.w}x${r.h}px, ${(r.bytes / 1e6).toFixed(1)} MB in ${(r.ms / 1000).toFixed(1)}s`);
    assert(r.sig === 'PNG', 'png'); assert(r.w <= 8192 && r.h <= 8192 && r.w * r.h <= 36e6 + 1, 'size clamped'); assert(r.ms < 30000, 'completes in time');
  });
  await R.test('JSON export + re-import of the 2,000-object board round-trips', async () => {
    const r = await page.evaluate(async () => { const out = await window.__bw.runExport(window.__bw.store, { format: 'json' }); const text = await out.blob.text(); return { bytes: text.length, n: JSON.parse(text).board.order.length }; });
    assert(r.n === 2000, 'objects in file ' + r.n); console.log(`      JSON ${(r.bytes / 1e6).toFixed(1)} MB`);
  });
  await R.test('perf run: no console errors', async () => assert(errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, 'console errors: ' + errors.join('; ')));
  console.table(results.map((r) => ({ case: r.label, drawn: r.drawn, 'median ms': r.median?.toFixed?.(2), 'p95 ms': r.p95?.toFixed?.(2), fps: r.fps?.toFixed?.(1) })));
  await page.close();
}

if (process.argv[1].endsWith('perf.mjs')) {
  const srv = await serve(); const browser = await launch({ args: ['--enable-gpu-rasterization'] }); const R = new Reporter('perf');
  await perf({ browser, srv, R, url: srv.url + '?e2e=1' });
  await browser.close(); await srv.close(); process.exit(R.summary() ? 0 : 1);
}
