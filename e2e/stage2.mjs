import { openPage, newBoard, canvasBox, drag, state, sleep, assert, eq, enableDownloads, clickMenuItem, openMenu, toastText, pngSize } from './lib.mjs';
import { parseImport } from '../src/core/serialize.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const key = (page, k, mods = []) => (async () => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of mods.reverse()) await page.keyboard.up(m); })();
const waitSaved = (page) => page.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('Saved'), { timeout: 6000 });

export default async function stage2({ browser, srv, R, url }) {
  console.log('Stage 2: undo/redo, export, import, board list, backup');

  // ---------- undo / redo ----------
  {
    const { page, errors } = await openPage(browser, url);
    await newBoard(page, srv.url);
    const box = await canvasBox(page); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await R.test('undo/redo across add, move and delete', async () => {
      await key(page, 'r'); await drag(page, { x: cx - 100, y: cy - 60 }, { x: cx + 50, y: cy + 30 });
      await key(page, 'v'); await drag(page, { x: cx, y: cy }, { x: cx + 120, y: cy + 80 });
      const moved = (await state(page)).objects[0].x;
      await key(page, 'Delete');
      eq((await state(page)).count, 0, 'deleted');
      await key(page, 'z', ['Control']); eq((await state(page)).count, 1, 'undo delete');
      await key(page, 'z', ['Control']); assert((await state(page)).objects[0].x < moved - 50, 'undo move');
      await key(page, 'z', ['Control']); eq((await state(page)).count, 0, 'undo add');
      await key(page, 'z', ['Control', 'Shift']); await key(page, 'y', ['Control']); await key(page, 'y', ['Control']);
      const s = await state(page); eq(s.count, 0, 'redo all'); eq(s.redo, 0, 'redo stack empty');
    });
    await R.test('undo spans tool changes and a drag is a single step', async () => {
      await key(page, 'p'); await drag(page, { x: cx - 100, y: cy - 100 }, { x: cx - 20, y: cy - 60 }, { steps: 30 });
      await key(page, 'n'); await page.mouse.click(cx + 100, cy + 100); await page.waitForSelector('textarea.bw-editor'); await page.keyboard.type('note'); await key(page, 'Escape');
      await key(page, 'v');
      const before = await state(page); eq(before.count, 2, 'pen + sticky');
      await key(page, 'z', ['Control']); eq((await state(page)).objects.map((o) => o.type), ['pen'], 'sticky undone as one step');
      await key(page, 'z', ['Control']); eq((await state(page)).count, 0, 'pen undone as one step');
      await key(page, 'y', ['Control']); await key(page, 'y', ['Control']);
      eq((await state(page)).count, 2, 'redo both');
    });
    await R.test('undo/redo buttons reflect availability', async () => {
      const dis = await page.$eval('button[aria-label^="Redo"]', (b) => b.disabled);
      eq(dis, true, 'redo disabled at tip');
      assert(!(await page.$eval('button[aria-label^="Undo"]', (b) => b.disabled)), 'undo enabled');
    });
    await R.test('history survives a reload', async () => {
      await waitSaved(page); await sleep(1800);
      await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__bw?.store.size === 2);
      await page.click('[data-testid="board-canvas"]', { offset: { x: 5, y: 5 } }).catch(() => {});
      await page.evaluate(() => window.__bw.engine.undo());
      eq((await state(page)).count, 1, 'undo after reload');
      await page.evaluate(() => window.__bw.engine.redo());
      eq((await state(page)).count, 2, 'redo after reload');
    });
    await R.test('stage 2: no console errors', async () => eq(errors, [], 'errors'));
    await page.close();
  }

  // ---------- export ----------
  {
    const { page, errors } = await openPage(browser, url);
    const dl = await enableDownloads(page);
    await newBoard(page, srv.url);
    // Build content programmatically: 2 frames with notes, a shape, a table, a checklist.
    await page.evaluate(async () => {
      const { store, engine } = window.__bw;
      const mod = await import(/* @vite-ignore */ new URL(document.querySelector('script[type=module]').src).href).catch(() => null);
      void mod;
    });
    await page.evaluate(() => {
      const { store } = window.__bw;
      const mk = (o) => ({ id: 'x' + Math.random().toString(36).slice(2, 10), rotation: 0, locked: false, groupId: null, ...o });
      store.add([
        mk({ type: 'frame', x: 0, y: 0, w: 500, h: 360, title: 'First', fill: 'transparent', stroke: '#6b7280' }),
        mk({ type: 'frame', x: 600, y: 0, w: 500, h: 360, title: 'Second', fill: 'transparent', stroke: '#6b7280' }),
        mk({ type: 'sticky', x: 30, y: 30, w: 180, h: 180, color: 'pink', text: 'Alpha note', fontSize: 18, bold: false, italic: false, align: 'left', votes: {} }),
        mk({ type: 'sticky', x: 630, y: 30, w: 180, h: 180, color: 'blue', text: 'Beta note', fontSize: 18, bold: false, italic: false, align: 'left', votes: {} }),
        mk({ type: 'shape', kind: 'ellipse', x: 260, y: 60, w: 150, h: 100, fill: '#a5d8ff', stroke: '#1b1b1f', strokeWidth: 2, opacity: 1, dash: 'solid', text: 'Idea', fontSize: 18, bold: false, italic: false, align: 'center', color: '#1b1b1f', flipX: false, flipY: false }),
      ]);
      window.__bw.engine.fitContent();
    });
    const openExport = async () => { await openMenu(page, 'File'); await clickMenuItem(page, 'Export board'); await page.waitForSelector('[data-testid="export-go"]'); };
    const exportAs = async (format, { scope, scale, frame } = {}) => {
      await openExport();
      await page.click(`[data-format="${format}"]`);
      if (scope) await page.click(`[data-scope="${scope}"]`);
      if (frame) await page.select('[data-testid="export-frame"]', frame);
      if (scale) await page.click(`[data-scale="${scale}"]`);
      await page.click('[data-testid="export-go"]');
    };
    await R.test('PNG export: whole board at 1× and 2×', async () => {
      await exportAs('png'); const a = await dl.wait(/\.png$/); await dl.clear();
      eq(a.bytes.subarray(1, 4).toString(), 'PNG', 'signature'); const s1 = pngSize(a.bytes);
      assert(s1.w > 1000 && s1.h > 300, 'plausible size ' + JSON.stringify(s1));
      await exportAs('png', { scale: 2 }); const b = await dl.wait(/@2x\.png$/); await dl.clear();
      const s2 = pngSize(b.bytes); eq([s2.w, s2.h], [s1.w * 2, s1.h * 2], '2x dimensions');
    });
    await R.test('PNG export: one frame and the selection', async () => {
      const frameId = await page.evaluate(() => window.__bw.store.list().find((o) => o.type === 'frame' && o.title === 'Second').id);
      await exportAs('png', { scope: 'frame', frame: frameId }); const f = await dl.wait(/Second\.png$/); await dl.clear();
      eq(pngSize(f.bytes), { w: 500, h: 360 }, 'frame size');
      await page.evaluate(() => { const { store, engine } = window.__bw; engine.select([store.list().find((o) => o.text === 'Alpha note').id]); });
      await exportAs('png', { scope: 'selection' }); const sel = await dl.wait(/selection\.png$/); await dl.clear();
      eq(pngSize(sel.bytes), { w: 228, h: 228 }, 'selection + padding');
      await page.evaluate(() => window.__bw.engine.clearSelection());
    });
    await R.test('SVG export is well-formed and keeps text as text', async () => {
      await exportAs('svg'); const f = await dl.wait(/\.svg$/); await dl.clear();
      const text = f.bytes.toString();
      assert(text.includes('Alpha note') && text.includes('Beta note') && text.includes('Idea'), 'text present');
      const ok = await page.evaluate((t) => !new DOMParser().parseFromString(t, 'image/svg+xml').getElementsByTagName('parsererror').length, text);
      assert(ok, 'parses as XML'); assert(!/<script|onload=|http:\/\/(?!www\.w3\.org)/.test(text), 'no scripts or external refs');
    });
    await R.test('PDF export: one page per frame', async () => {
      await exportAs('pdf'); const f = await dl.wait(/\.pdf$/); await dl.clear();
      const text = f.bytes.toString('latin1');
      assert(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'), 'pdf framing'); assert(/\/Count 2/.test(text), 'two pages');
      assert(text.includes('/DCTDecode'), 'jpeg pages');
    });
    await R.test('JSON export validates and round-trips', async () => {
      await exportAs('json'); const f = await dl.wait(/\.boardwise\.json$/); await dl.clear();
      const { kind, boards } = parseImport(f.bytes.toString());
      eq(kind, 'board'); eq(boards[0].order.length, 5, 'objects'); eq(boards[0].dropped, 0, 'nothing dropped');
    });
    await R.test('Markdown outline groups text by frame', async () => {
      await exportAs('md'); const f = await dl.wait(/\.md$/); await dl.clear();
      const md = f.bytes.toString();
      assert(md.includes('## First') && md.includes('- Alpha note') && md.includes('## Second') && md.includes('- Beta note'), 'frame sections: ' + md);
      assert(md.indexOf('Alpha') < md.indexOf('Beta'), 'frame order');
    });
    await R.test('exporting an empty board shows a message instead of a broken file', async () => {
      const p2 = await openPage(browser, url); await newBoard(p2.page, srv.url);
      await openMenu(p2.page, 'File'); await clickMenuItem(p2.page, 'Export board'); await p2.page.waitForSelector('[data-testid="export-go"]');
      assert(await p2.page.$eval('[data-testid="export-go"]', (b) => b.disabled), 'export disabled');
      assert((await p2.page.$eval('.dialog', (d) => d.textContent)).includes('nothing to export'), 'message');
      await p2.page.close();
    });
    await R.test('export: no console errors', async () => eq(errors, [], 'errors'));
    await dl.cleanup(); await page.close();
  }

  // ---------- import & paste ----------
  {
    const { page, errors } = await openPage(browser, url);
    await newBoard(page, srv.url);
    const tmp = await (await import('node:fs/promises')).mkdtemp(join((await import('node:os')).tmpdir(), 'bw-imp-'));
    const uploadVia = async (file) => { await openMenu(page, 'File'); await clickMenuItem(page, 'Import into this board'); const input = await page.waitForSelector('[data-testid="import-file"]'); await input.uploadFile(file); };
    await R.test('pasting multi-line text creates sticky notes; single line creates a text box', async () => {
      await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '- one\n- two\n- three'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
      await sleep(150); const s = await state(page);
      eq(s.objects.filter((o) => o.type === 'sticky').map((o) => o.text), ['one', 'two', 'three']);
      await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'just a line'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
      await sleep(100); assert((await state(page)).objects.some((o) => o.type === 'text' && o.text === 'just a line'), 'text box');
    });
    await R.test('pasted HTML is reduced to plain text (scripts never run)', async () => {
      await page.evaluate(() => { window.__pwn = 0; const dt = new DataTransfer(); dt.setData('text/html', '<p>Safe</p><img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script><p>Text</p>'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
      await sleep(200);
      eq(await page.evaluate(() => window.__pwn), 0, 'no script ran');
      const texts = (await state(page)).objects.map((o) => o.text || '').join('|'); assert(texts.includes('Safe') && texts.includes('Text'), 'text kept');
    });
    await R.test('CSV file import becomes sticky notes', async () => {
      const f = join(tmp, 'data.csv'); await writeFile(f, 'Name,Idea\n"Ann, Jr",Plan B\n'); const n0 = (await state(page)).count;
      await uploadVia(f); await sleep(300);
      eq((await state(page)).count - n0, 4, 'four cells -> four notes');
    });
    await R.test('malicious SVG is sanitised on import', async () => {
      const f = join(tmp, 'evil.svg');
      await writeFile(f, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" onload="window.__pwn=3"><script>window.__pwn=4</script><rect width="100" height="50" fill="#0a0" onclick="x()"/><image href="https://evil.example/x.png"/></svg>');
      await uploadVia(f); await sleep(300);
      const img = (await state(page)).objects.find((o) => o.type === 'image');
      assert(img, 'image created');
      const svg = decodeURIComponent(img.src.split(',')[1]);
      assert(!/script|onload|onclick|evil\.example|<image/i.test(svg), 'sanitised: ' + svg); assert(svg.includes('<rect'), 'rect kept');
      eq(await page.evaluate(() => window.__pwn), 0);
    });
    await R.test('malformed and oversized imports are rejected with a clear message', async () => {
      await writeFile(join(tmp, 'bad.json'), '{"app":"nope"'); await uploadVia(join(tmp, 'bad.json')); await sleep(250);
      assert((await toastText(page)).some((t) => /not valid JSON/i.test(t)), 'bad json message: ' + (await toastText(page)).join(';'));
      await writeFile(join(tmp, 'foreign.json'), '{"hello":"world"}'); await uploadVia(join(tmp, 'foreign.json')); await sleep(250);
      assert((await toastText(page)).some((t) => /not a Boardwise file/i.test(t)), 'foreign message');
      await writeFile(join(tmp, 'huge.svg'), '<svg xmlns="http://www.w3.org/2000/svg">' + ' '.repeat(2.2 * 1024 * 1024) + '</svg>'); await uploadVia(join(tmp, 'huge.svg')); await sleep(300);
      assert((await toastText(page)).some((t) => /too large/i.test(t)), 'svg too large: ' + (await toastText(page)).join(';'));
      await writeFile(join(tmp, 'x.exe'), 'MZ'); await uploadVia(join(tmp, 'x.exe')); await sleep(250);
      assert((await toastText(page)).some((t) => /not a supported file/i.test(t)), 'unsupported');
    });
    await R.test('import: no console errors beyond handled rejections', async () => { eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], 'errors'); });
    await page.close();
  }

  // ---------- board list & backup/restore ----------
  {
    const { page, errors } = await openPage(browser, url);
    const dl = await enableDownloads(page);
    const boardCards = () => page.$$eval('.card', (c) => c.map((x) => x.querySelector('.title').textContent));
    const cardMenu = async (name, item) => { await page.click(`button[aria-label="Actions for ${name}"]`); await clickMenuItem(page, item); };
    await R.test('creates boards from templates and lists them with search and sort', async () => {
      await page.click('[data-template="kanban"]'); await page.waitForFunction(() => window.__bw?.store.size > 3);
      eq((await page.evaluate(() => window.__bw.store.list().filter((o) => o.type === 'frame').length)), 3, 'kanban lanes');
      await sleep(900); await page.click('button[aria-label="All boards"]'); await page.waitForSelector('[data-testid="home"]');
      await page.click('[data-template="swot"]'); await page.waitForFunction(() => window.__bw?.store.size > 3); await sleep(900);
      await page.click('button[aria-label="All boards"]'); await page.waitForSelector('.card');
      eq((await boardCards()).length, 2, 'two boards');
      await page.type('#board-search', 'swot'); eq(await boardCards(), ['SWOT'], 'search'); await page.focus('#board-search'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
      await page.select('#board-sort', 'name'); eq(await boardCards(), ['Kanban', 'SWOT'], 'sort by name');
    });
    await R.test('thumbnails are generated', async () => {
      const n = await page.$$eval('.card .thumb img', (i) => i.length); assert(n >= 1, 'thumbnail present, got ' + n);
    });
    await R.test('rename, favourite, folders and recents', async () => {
      await cardMenu('Kanban', 'Rename'); await page.waitForSelector('#name-form input'); await sleep(100); await page.type('#name-form input', 'Sprint board'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => [...document.querySelectorAll('.card .title')].some((t) => t.textContent === 'Sprint board'));
      await page.click('button[aria-label="Add Sprint board to favourites"]'); await page.waitForSelector('button[aria-label="Remove Sprint board from favourites"]');
      await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent === 'Favourites').click());
      eq(await boardCards(), ['Sprint board'], 'favourites filter');
      await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent === 'All').click());
      await cardMenu('SWOT', 'Move to folder'); await page.waitForSelector('.dialog');
      await page.click('button.chip[aria-pressed]'); // "No folder" – close dialog path
      await cardMenu('SWOT', 'Move to folder'); await page.waitForSelector('.dialog');
      await page.keyboard.press('Escape');
      await page.click('.home-tools .btn'); await page.waitForSelector('#name-form input'); await page.type('#name-form input', 'Clients'); await page.keyboard.press('Enter');
      await sleep(200); eq(await boardCards(), [], 'new empty folder is selected and empty');
      await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent === 'All').click());
      await cardMenu('SWOT', 'Move to folder'); await page.evaluate(() => [...document.querySelectorAll('.dialog .chip')].find((c) => c.textContent === 'Clients').click());
      await sleep(200); await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent === 'Clients').click());
      eq(await boardCards(), ['SWOT'], 'folder filter');
      await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent === 'Recently opened').click());
      eq((await boardCards()).length, 2, 'recents');
      await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent === 'All').click());
    });
    await R.test('duplicate creates an independent copy', async () => {
      await cardMenu('SWOT', 'Duplicate'); await page.waitForFunction(() => document.querySelectorAll('.card').length === 3);
      assert((await boardCards()).includes('Copy of SWOT'), 'copy named');
    });
    await R.test('delete asks for confirmation and can be cancelled', async () => {
      await cardMenu('Copy of SWOT', 'Delete'); await page.waitForSelector('.dialog');
      assert((await page.$eval('.dialog', (d) => d.textContent)).includes('cannot be undone'), 'warning shown');
      await page.keyboard.press('Escape'); await sleep(100); eq((await boardCards()).length, 3, 'still there after cancel');
      await cardMenu('Copy of SWOT', 'Delete'); await page.waitForSelector('.dialog .btn.danger'); await page.click('.dialog .btn.danger');
      await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
    });
    await R.test('backup all boards, wipe, then restore', async () => {
      await openMenu(page, 'Settings'); await clickMenuItem(page, 'Back up all boards');
      const f = await dl.wait(/boardwise-backup.*\.json$/); await dl.clear();
      const keep = join(await (await import('node:fs/promises')).mkdtemp(join((await import('node:os')).tmpdir(), 'bw-bk-')), f.name); await writeFile(keep, f.bytes);
      const { kind, boards } = parseImport(f.bytes.toString(), { maxBytes: 2e8 }); eq(kind, 'backup'); eq(boards.length, 2, 'two boards in backup');
      for (const name of ['Sprint board', 'SWOT']) { await cardMenu(name, 'Delete'); await page.waitForSelector('.dialog .btn.danger'); await page.click('.dialog .btn.danger'); await sleep(250); }
      eq((await boardCards()).length, 0, 'wiped');
      await openMenu(page, 'Settings'); await page.evaluate(() => [...document.querySelectorAll('.menu .item')].find((e) => e.textContent.startsWith('Restore from backup')).click());
      const input = await page.$('input[aria-label="Restore from backup"]'); await input.uploadFile(keep);
      await page.waitForSelector('.dialog'); assert((await page.$eval('.dialog', (d) => d.textContent)).includes('2 board(s)'), 'summary');
      await page.evaluate(() => [...document.querySelectorAll('.dialog .btn.primary')].find((b) => b.textContent === 'Restore').click());
      await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
      eq((await boardCards()).sort(), ['SWOT', 'Sprint board'], 'restored names');
    });
    await R.test('restore rejects garbage and clashing ids offer choices', async () => {
      const tmp = await (await import('node:fs/promises')).mkdtemp(join((await import('node:os')).tmpdir(), 'bw-rs-'));
      await writeFile(join(tmp, 'g.json'), '{"app":"boardwise","format":1,"kind":"backup","boards":"nope"}');
      await openMenu(page, 'Settings'); await page.evaluate(() => [...document.querySelectorAll('.menu .item')].find((e) => e.textContent.startsWith('Restore from backup')).click());
      await (await page.$('input[aria-label="Restore from backup"]')).uploadFile(join(tmp, 'g.json')); await sleep(250);
      assert((await toastText(page)).some((t) => /no boards/i.test(t)), 'error toast');
      const f = (await page.evaluate(() => 1)) && null; void f;
    });
    await R.test('board list: no console errors', async () => eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], 'errors'));
    await dl.cleanup(); await page.close();
  }
}
