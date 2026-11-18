import { openPage, newBoard, canvasBox, drag, state, sleep, assert, eq, openMenu, clickMenuItem } from './lib.mjs';

const press = async (page, k, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of [...mods].reverse()) await page.keyboard.up(m); };
const add = (page, objs) => page.evaluate((list) => {
  const { store } = window.__bw;
  const mk = (o) => ({ id: 'x' + Math.random().toString(36).slice(2, 10), rotation: 0, locked: false, groupId: null, ...o });
  const made = list.map(mk); store.add(made); return made.map((o) => o.id);
}, objs);
const sticky = (x, y, color, text) => ({ type: 'sticky', x, y, w: 180, h: 180, color, text, fontSize: 18, bold: false, italic: false, align: 'left', votes: {} });
const shape = (kind, x, y, w, h, text = '') => ({ type: 'shape', kind, x, y, w, h, fill: '#ffffff', stroke: '#1b1b1f', strokeWidth: 2, opacity: 1, dash: 'solid', text, fontSize: 18, bold: false, italic: false, align: 'center', color: '#1b1b1f', flipX: false, flipY: false });
const screenOf = (page, wx, wy) => page.evaluate(([x, y]) => { const e = window.__bw.engine; const p = e.worldToScreen(x, y); const r = e.canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [wx, wy]);
const resetView = (page) => page.evaluate(() => window.__bw.engine.setView({ x: -400, y: -300, zoom: 1 }));

export default async function stage3({ browser, srv, R, url }) {
  console.log('Stage 3a: editing, connectors, panels, workshop, present');
  const { page, errors } = await openPage(browser, url);
  await newBoard(page, srv.url);
  await resetView(page);

  await R.test('connectors attach to shapes and follow when they move', async () => {
    const [a, b] = await add(page, [shape('rect', 0, 0, 120, 80, 'A'), shape('rect', 400, 0, 120, 80, 'B')]);
    await page.keyboard.press('c');
    const from = await screenOf(page, 60, 40), to = await screenOf(page, 460, 40);
    await drag(page, from, to, { steps: 12 });
    let s = await state(page);
    const c = s.objects.find((o) => o.type === 'connector');
    assert(c, 'connector created'); eq([c.from.id, c.to.id], [a, b], 'attached both ends');
    await page.keyboard.press('v');
    const ends = (cid) => page.evaluate(([i]) => { const { store, resolveConnector } = window.__bw; const r = resolveConnector(store.get(i), store.objects); return { a: r.a, b: r.b }; }, [cid]);
    const before = await ends(c.id);
    eq(before.a, { x: 120, y: 40 }, 'starts on A right edge'); eq(before.b, { x: 400, y: 40 }, 'ends on B left edge');
    await page.evaluate(([id]) => window.__bw.store.update(id, { x: 400, y: 300 }), [b]);
    const after = await ends(c.id);
    eq(after.b, { x: 460, y: 300 }, 'end follows B and re-routes to its top edge (B is now below-right)');
    eq(after.a, { x: 60, y: 80 }, 'start re-routes to the bottom edge of A');
    await page.evaluate(([id]) => { window.__bw.engine.select([id]); window.__bw.engine.deleteSelection(); }, [b]);
    const detached = await ends(c.id); eq(detached.b, { x: 460, y: 300 }, 'deleting the target leaves the end exactly where it was displayed');
    await page.evaluate(() => { window.__bw.store.undo(); window.__bw.store.undo(); });
  });

  await R.test('resize handle changes size; rotate handle rotates; both undo', async () => {
    await page.evaluate(() => { const { store } = window.__bw; store.remove([...store.order], 'clear'); });
    const [id] = await add(page, [shape('rect', 0, 0, 200, 100)]);
    await page.evaluate(([i]) => window.__bw.engine.select([i]), [id]);
    const se = await screenOf(page, 200, 100);
    await drag(page, se, { x: se.x + 100, y: se.y + 60 }, { steps: 8 });
    let o = (await state(page)).objects[0]; assert(o.w >= 290 && o.h >= 150, `resized ${o.w}x${o.h}`);
    const top = await screenOf(page, o.x + o.w / 2, o.y - 28);
    const centre = await screenOf(page, o.x + o.w / 2, o.y + o.h / 2);
    await drag(page, top, { x: centre.x + 150, y: centre.y }, { steps: 10 });
    o = (await state(page)).objects[0]; assert(Math.abs(o.rotation - Math.PI / 2) < 0.2, 'rotated ~90°, got ' + o.rotation);
    await page.evaluate(() => { window.__bw.engine.undo(); window.__bw.engine.undo(); });
    o = (await state(page)).objects[0]; eq([o.w, o.rotation], [200, 0], 'both undone');
  });

  await R.test('group moves together; align and distribute; lock blocks edits', async () => {
    await page.evaluate(() => { const { store } = window.__bw; store.remove([...store.order], 'clear'); });
    const ids = await add(page, [shape('rect', 0, 0, 80, 80), shape('rect', 150, 40, 80, 80), shape('rect', 420, 100, 80, 80)]);
    await page.evaluate((i) => window.__bw.engine.select(i), ids);
    await page.evaluate(() => window.__bw.engine.align('top'));
    eq((await state(page)).objects.map((o) => o.y), [0, 0, 0], 'aligned top');
    await page.evaluate(() => window.__bw.engine.distribute('h'));
    const xs = (await state(page)).objects.map((o) => o.x); eq(xs, [0, 210, 420], 'distributed');
    await page.evaluate(() => window.__bw.engine.group());
    await page.evaluate((i) => window.__bw.engine.select([i[0]]), ids);
    eq((await state(page)).selection.length, 3, 'selecting one selects the group');
    const p = await screenOf(page, 40, 40);
    await drag(page, p, { x: p.x + 50, y: p.y + 50 }, { steps: 6 });
    eq((await state(page)).objects.map((o) => o.x), [50, 260, 470], 'group moved as one');
    await page.evaluate(() => window.__bw.engine.setLocked(true));
    const q = await screenOf(page, 90, 90);
    await drag(page, q, { x: q.x + 80, y: q.y }, { steps: 5 });
    eq((await state(page)).objects.map((o) => o.x), [50, 260, 470], 'locked objects do not move');
    await page.keyboard.press('Delete'); eq((await state(page)).count, 3, 'locked objects are not deleted');
    await page.evaluate(() => window.__bw.engine.setLocked(false));
  });

  await R.test('copy and paste duplicates; paste works into another board', async () => {
    await page.evaluate(() => { const { store, engine } = window.__bw; engine.selectAll(); });
    await page.evaluate(() => { const dt = new DataTransfer(); document.addEventListener('copy', function h(e) { window.__clip = null; setTimeout(() => {}, 0); document.removeEventListener('copy', h); }); });
    const clip = await page.evaluate(() => window.__bw.engine.copySelection());
    assert(clip && clip.startsWith('boardwise/objects:v1:'), 'clipboard payload');
    await page.evaluate((c) => { const dt = new DataTransfer(); dt.setData('text/plain', c); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, clip);
    await sleep(150); eq((await state(page)).count, 6, 'pasted copies');
    const ids = (await state(page)).objects.map((o) => o.id); eq(new Set(ids).size, 6, 'unique ids');
    // a second board
    await sleep(900);
    await page.click('button[aria-label="All boards"]'); await page.waitForSelector('[data-testid="home"]');
    await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw && window.__bw.store.size === 0);
    await page.evaluate((c) => { const dt = new DataTransfer(); dt.setData('text/plain', c); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, clip);
    await sleep(200); eq((await state(page)).count, 3, 'pasted into a different board');
  });

  await R.test('search finds text, highlights results and jumps to them', async () => {
    await add(page, [sticky(2000, 1500, 'blue', 'Quarterly roadmap'), sticky(-1500, -900, 'pink', 'Roadmap risks')]);
    await page.click('[data-testid="open-search"]'); await page.waitForSelector('#bsearch');
    await page.type('#bsearch', 'ROADMAP'); await sleep(200);
    eq(await page.$$eval('.side .list mark', (m) => m.length), 2, 'two highlighted results');
    await page.click('.side .list li:nth-child(1) button');
    await sleep(150);
    const s = await state(page); eq(s.selection.length, 1, 'result selected');
    const sel = s.objects.find((o) => o.id === s.selection[0]);
    const vr = await page.evaluate(() => { const e = window.__bw.engine; const v = e.visible(); return v; });
    assert(sel.x >= vr.x && sel.x <= vr.x + vr.w && sel.y >= vr.y && sel.y <= vr.y + vr.h, 'jumped into view');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.side'));
  });

  await R.test('command palette opens with Ctrl+K, filters and runs a command', async () => {
    await page.focus('[data-testid="board-canvas"]');
    await press(page, 'k', ['Control']); await page.waitForSelector('[data-testid="palette-input"]');
    await page.type('[data-testid="palette-input"]', 'highlighter'); await sleep(100);
    await page.keyboard.press('Enter'); await sleep(150);
    eq(await page.evaluate(() => window.__bw.engine.tool), 'highlighter', 'command ran');
    assert(!(await page.$('[data-testid="palette-input"]')), 'palette closed');
    await press(page, 'v');
  });

  await R.test('shortcuts dialog opens with ? and lists tool keys; Escape closes and restores focus', async () => {
    await page.focus('[data-testid="board-canvas"]');
    await page.keyboard.press('?'); await page.waitForSelector('[role="dialog"]');
    const text = await page.$eval('[role="dialog"]', (d) => d.textContent); assert(text.includes('Pen tool') && text.includes('Ctrl') && text.includes('Command palette'), 'content');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    eq(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'board-canvas', 'focus restored');
  });

  await R.test('comments: pin, resolve, reopen, delete, and they persist', async () => {
    await page.evaluate(() => { const { store } = window.__bw; store.remove([...store.order], 'clear'); window.__bw.engine.setView({ x: -400, y: -300, zoom: 1 }); });
    await page.keyboard.press('m');
    const at = await screenOf(page, 100, 100); await page.mouse.click(at.x, at.y);
    await page.waitForSelector('.comment-pop textarea'); await page.type('.comment-pop textarea', 'Check the numbers');
    await page.click('.comment-pop .btn.primary'); await page.waitForSelector('.pin');
    eq(await page.$eval('.pin', (p) => p.getAttribute('aria-label')), 'Comment 1: Check the numbers', 'pin label');
    await page.waitForSelector('.comment-pop button[data-autofocus]'); await page.click('.comment-pop button[data-autofocus]');
    await page.waitForSelector('.pin.resolved');
    await page.click('.pin'); await page.click('.pin');   // toggle popover closed/open
    await page.waitForSelector('.comment-pop');
    await page.evaluate(() => [...document.querySelectorAll('.comment-pop .btn')].find((b) => /Reopen/.test(b.textContent)).click());
    await page.waitForFunction(() => !document.querySelector('.pin.resolved'));
    await sleep(1000);
    const saved = await page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('boardwise'); q.onsuccess = () => r(q.result); }); const all = await new Promise((r) => { const q = db.transaction('boards').objectStore('boards').getAll(); q.onsuccess = () => r(q.result); }); return all.flatMap((b) => b.comments.map((c) => c.text)); });
    assert(saved.includes('Check the numbers'), 'saved to IndexedDB: ' + JSON.stringify(saved));
    await page.evaluate(() => [...document.querySelectorAll('.comment-pop .btn.danger')].forEach((b) => b.click()));
    await page.waitForFunction(() => !document.querySelector('.pin'));
  });

  await R.test('notes panel sorts by colour and arranges stickies into a tidy grid', async () => {
    await page.evaluate(() => { const { store } = window.__bw; store.remove([...store.order], 'clear'); });
    await add(page, [sticky(0, 0, 'blue', 'b1'), sticky(900, 500, 'yellow', 'y1'), sticky(-300, 800, 'blue', 'b2'), sticky(500, -400, 'pink', 'p1')]);
    await openMenu(page, 'Workshop tools'); await clickMenuItem(page, 'Sticky notes'); await page.waitForSelector('.notes-grid');
    eq(await page.$$eval('.side section h3', (h) => h.map((x) => x.textContent)), ['Yellow (1)', 'Pink (1)', 'Blue (2)'], 'grouped by colour');
    await page.evaluate(() => [...document.querySelectorAll('.side .btn')].find((b) => b.textContent.includes('Arrange on board')).click());
    const os = (await state(page)).objects;
    const col = (c) => os.filter((o) => o.color === c).map((o) => o.x);
    assert(Math.max(...col('blue')) - Math.min(...col('blue')) < 400, 'blues are together');
    assert(col('yellow')[0] < col('pink')[0] && col('pink')[0] < Math.min(...col('blue')), 'colour order left→right');
    await page.keyboard.press('Escape');
  });

  await R.test('dot voting: limited votes per person, shared per-voter tally, clear', async () => {
    await page.evaluate(() => window.__bw.engine.setOpt('votesPerPerson', 2));
    await openMenu(page, 'Workshop tools'); await clickMenuItem(page, 'Dot voting');
    await page.waitForFunction(() => document.body.textContent.includes('2 votes left'));
    const target = await page.evaluate(() => { const o = window.__bw.store.list()[0]; return { x: o.x + 90, y: o.y + 90 }; });
    const at = await screenOf(page, target.x, target.y);
    await page.evaluate((t) => window.__bw.engine.focusRect({ x: t.x - 200, y: t.y - 200, w: 400, h: 400 }, { minZoom: 1 }), target);
    const at2 = await screenOf(page, target.x, target.y); void at;
    await page.mouse.click(at2.x, at2.y); await page.mouse.click(at2.x, at2.y); await page.mouse.click(at2.x, at2.y);
    const total = await page.evaluate(() => window.__bw.store.list().reduce((n, o) => n + Object.values(o.votes || {}).reduce((a, b) => a + b, 0), 0));
    eq(total, 2, 'third click refused');
    assert((await page.$$eval('.toast', (t) => t.map((x) => x.textContent))).some((t) => /used all your votes/i.test(t)), 'toast');
    await page.evaluate(() => [...document.querySelectorAll('.timer-pill .btn')].find((b) => b.textContent === 'Clear votes').click());
    eq(await page.evaluate(() => window.__bw.store.list().reduce((n, o) => n + Object.values(o.votes || {}).length, 0)), 0, 'cleared');
    await page.evaluate(() => [...document.querySelectorAll('.timer-pill .btn')].find((b) => b.getAttribute('aria-label') === 'Stop voting').click());
  });

  await R.test('timer counts down, pauses and adds time', async () => {
    await openMenu(page, 'Workshop tools'); await clickMenuItem(page, 'Timer'); await page.waitForSelector('[data-testid="timer-start"]');
    await page.click('[data-testid="timer-start"]'); await page.waitForSelector('.timer-pill .time');
    const t0 = await page.$eval('.timer-pill .time', (e) => e.textContent); eq(t0, '05:00', 'starts at 5:00');
    await sleep(1300); assert((await page.$eval('.timer-pill .time', (e) => e.textContent)) !== '05:00', 'ticks');
    await page.click('button[aria-label="Pause timer"]'); const p1 = await page.$eval('.timer-pill .time', (e) => e.textContent); await sleep(1200);
    eq(await page.$eval('.timer-pill .time', (e) => e.textContent), p1, 'paused');
    await page.click('button[aria-label="Add one minute"]');
    assert((await page.$eval('.timer-pill .time', (e) => e.textContent)) >= '05:5', 'minute added');
    await page.click('button[aria-label="Close timer"]');
  });

  await R.test('present mode steps through frames with the keyboard', async () => {
    await page.evaluate(() => { const { store } = window.__bw; store.remove([...store.order], 'clear'); });
    await add(page, [{ type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Intro', fill: 'transparent', stroke: '#6b7280' }, { type: 'frame', x: 500, y: 0, w: 400, h: 300, title: 'Plan', fill: 'transparent', stroke: '#6b7280' }, { type: 'frame', x: 1000, y: 0, w: 400, h: 300, title: 'Wrap-up', fill: 'transparent', stroke: '#6b7280' }, sticky(20, 20, 'yellow', 'Hello')]);
    await page.click('[data-testid="open-present"]'); await page.waitForSelector('[data-testid="present"] canvas');
    const pos = () => page.$eval('[data-testid="present-pos"]', (e) => e.textContent);
    eq(await pos(), '1 / 3 · Intro');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); eq(await pos(), '3 / 3 · Wrap-up');
    await page.keyboard.press('ArrowRight'); eq(await pos(), '3 / 3 · Wrap-up', 'stops at last');
    await page.keyboard.press('Home'); eq(await pos(), '1 / 3 · Intro');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[data-testid="present"]'));
  });

  await R.test('stage 3a: no console errors', async () => eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], 'errors'));
  await page.close();
}
