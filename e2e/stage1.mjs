import { openPage, newBoard, canvasBox, drag, state, sleep, assert, eq } from './lib.mjs';

export default async function stage1({ browser, srv, R, url }) {
console.log('Stage 1: canvas, pan/zoom, pen, shapes, text, sticky, autosave');
{
  const { page, errors, external } = await openPage(browser, url);
  await R.test('home page renders with templates', async () => {
    await page.waitForSelector('[data-testid="home"]');
    const n = await page.$$eval('[data-template]', (e) => e.length);
    eq(n, 9, 'template count');
  });
  await R.test('creates a board and shows the canvas', async () => { await newBoard(page, srv.url); });
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await R.test('pen draws a stroke', async () => {
    await page.keyboard.press('p');
    await drag(page, { x: cx - 150, y: cy - 100 }, { x: cx - 50, y: cy - 20 }, { steps: 20 });
    const s = await state(page);
    eq(s.count, 1, 'objects'); eq(s.objects[0].type, 'pen');
  });
  await R.test('rectangle by drag', async () => {
    await page.keyboard.press('r');
    await drag(page, { x: cx + 40, y: cy - 100 }, { x: cx + 200, y: cy - 10 });
    const s = await state(page);
    const r = s.objects.find((o) => o.type === 'shape');
    assert(r && r.kind === 'rect' && r.w > 100, 'rect created');
  });
  await R.test('sticky note via tool + typing', async () => {
    await page.keyboard.press('n');
    await page.mouse.click(cx - 200, cy + 120);
    await page.waitForSelector('textarea.bw-editor');
    await page.keyboard.type('Hello board');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('textarea.bw-editor'), { timeout: 5000 });
    const s = await state(page);
    const n = s.objects.find((o) => o.type === 'sticky');
    eq(n?.text, 'Hello board', 'sticky text');
  });
  await R.test('text box via tool + typing', async () => {
    await page.keyboard.press('t');
    await page.mouse.click(cx + 60, cy + 120);
    await page.waitForSelector('textarea.bw-editor');
    await page.keyboard.type('Plain text');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('textarea.bw-editor'), { timeout: 5000 });
    const s = await state(page);
    eq(s.objects.find((o) => o.type === 'text')?.text, 'Plain text');
  });
  await R.test('empty text box is discarded without history', async () => {
    const before = await state(page);
    await page.keyboard.press('t');
    await page.mouse.click(cx + 300, cy + 200);
    await page.waitForSelector('textarea.bw-editor');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('textarea.bw-editor'), { timeout: 5000 });
    const after = await state(page);
    eq(after.count, before.count, 'count'); eq(after.undo, before.undo, 'history');
  });
  await R.test('select, move and marquee', async () => {
    await page.keyboard.press('v');
    await drag(page, { x: cx + 120, y: cy - 50 }, { x: cx + 160, y: cy - 20 });
    let s = await state(page);
    eq(s.selection.length, 1, 'selected after drag');
    await drag(page, { x: box.x + 170, y: box.y + 20 }, { x: box.x + box.width - 20, y: box.y + box.height - 20 }, { steps: 6 });
    s = await state(page);
    assert(s.selection.length >= 4, 'marquee selected all, got ' + s.selection.length);
  });
  await R.test('pan with space+drag and wheel; zoom with ctrl+wheel', async () => {
    await page.keyboard.press('Escape');
    const v0 = (await state(page)).view;
    await page.keyboard.down('Space');
    await drag(page, { x: cx, y: cy }, { x: cx + 100, y: cy + 50 }, { steps: 5 });
    await page.keyboard.up('Space');
    const v1 = (await state(page)).view;
    assert(Math.abs(v1.x - (v0.x - 100)) < 1 && Math.abs(v1.y - (v0.y - 50)) < 1, 'space pan moved view');
    await page.mouse.move(cx, cy);
    await page.mouse.wheel({ deltaY: 120 });
    await sleep(60);
    const v2 = (await state(page)).view;
    assert(v2.y > v1.y, 'wheel pans');
    await page.keyboard.down('Control');
    await page.mouse.wheel({ deltaY: -200 });
    await page.keyboard.up('Control');
    await sleep(60);
    const v3 = (await state(page)).view;
    assert(v3.zoom > v2.zoom, 'ctrl+wheel zooms in');
  });
  await R.test('zoom is clamped to 10%–400%', async () => {
    await page.evaluate(() => { const e = window.__bw.engine; for (let i = 0; i < 30; i++) e.zoomStep(1); });
    assert((await state(page)).view.zoom <= 4, 'max'); eq((await state(page)).view.zoom, 4, 'max exactly');
    await page.evaluate(() => { const e = window.__bw.engine; for (let i = 0; i < 40; i++) e.zoomStep(-1); });
    eq(Math.round((await state(page)).view.zoom * 100) / 100, 0.1, 'min exactly');
  });
  await R.test('autosave persists to IndexedDB and shows Saved', async () => {
    await page.evaluate(() => window.__bw.engine.fitContent());
    await page.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('Saved'), { timeout: 10000 });
    await page.waitForFunction(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('boardwise'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = await new Promise((res) => { const q = db.transaction('boards').objectStore('boards').getAll(); q.onsuccess = () => res(q.result); });
      return all.length === 1 && all[0].order.length === 4;
    }, { timeout: 10000 });
    const saved = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('boardwise'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = await new Promise((res) => { const q = db.transaction('boards').objectStore('boards').getAll(); q.onsuccess = () => res(q.result); });
      return all.map((b) => b.order.length);
    });
    eq(saved, [4], 'persisted object count');
  });
  await R.test('reload restores the board', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__bw && window.__bw.store.size === 4, { timeout: 10000 });
  });
  await R.test('no runtime errors or external network requests', async () => {
    eq(errors, [], 'console errors'); eq(external, [], 'external requests');
  });
}

}
