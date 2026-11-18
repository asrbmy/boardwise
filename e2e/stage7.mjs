import { openPage, assert, eq } from './lib.mjs';

export default async function stage7({ browser, srv, R, url }) {
  console.log('Stage 7: optional folder sync (browser private file system stands in for a chosen folder)');

  await R.test('folder sync pushes, pulls an external edit, and keeps the older side of a conflict as a version', async () => {
    const { page, errors } = await openPage(browser, url);
    await page.evaluate(() => { window.__bwPickDir = async () => { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('bw-sync-test', { create: true }); }; });
    await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); try { await root.removeEntry('bw-sync-test', { recursive: true }); } catch {} });
    await page.click('[data-template="kanban"]'); await page.waitForFunction(() => window.__bw?.store.size > 3);
    const id = await page.evaluate(() => window.__bw.store.meta.id);
    await page.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('Saved'), { timeout: 6000 });
    await page.click('button[aria-label="All boards"]'); await page.waitForSelector('[data-testid="home"]');

    await page.click('button[aria-label="Settings"]'); await page.click('[data-testid="menu-sync"]');
    await page.waitForSelector('[data-testid="sync-help"]');
    await page.click('[data-testid="sync-choose"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-folder"]')?.textContent.includes('bw-sync-test'));
    await page.click('[data-testid="sync-now"]');
    await page.waitForSelector('[data-testid="sync-report"]');
    assert((await page.$eval('[data-testid="sync-report"]', (e) => e.textContent)).includes('Sent 1'), 'pushed one board');
    const names = await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('bw-sync-test'); const o = []; for await (const [n] of d.entries()) o.push(n); return o; });
    eq(names, [`${id}.boardwise.json`]);

    // external edit: rename the board in the file with a newer timestamp -> pulled
    const edit = (name, delta) => page.evaluate(async (fid, nm, dt) => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('bw-sync-test');
      const fh = await d.getFileHandle(fid + '.boardwise.json'); const j = JSON.parse(await (await fh.getFile()).text());
      j.board.name = nm; j.board.updatedAt = j.board.updatedAt + dt;
      const w = await fh.createWritable(); await w.write(JSON.stringify(j)); await w.close();
    }, id, name, delta);
    await edit('Edited outside', 5000);
    await page.click('[data-testid="sync-now"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-report"]')?.textContent.includes('received 1'), { timeout: 6000 });

    // conflict: change the file (older than local) AND the local board (newer)
    await edit('File side', 1000); // remote moves forward a little
    await page.evaluate(async (bid) => {
      // bump local: write via the app's own storage so it is a genuine local edit with a later time
      const req = indexedDB.open('boardwise'); const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
      const tx = db.transaction(['boards', 'index'], 'readwrite');
      const bs = tx.objectStore('boards'), ix = tx.objectStore('index');
      const b = await new Promise((r) => { const g = bs.get(bid); g.onsuccess = () => r(g.result); });
      b.name = 'Local side'; b.updatedAt = Date.now() + 60000; bs.put(b, bid);
      const s = await new Promise((r) => { const g = ix.get(bid); g.onsuccess = () => r(g.result); });
      ix.put({ ...s, name: b.name, updatedAt: b.updatedAt }, bid);
      await new Promise((r) => { tx.oncomplete = r; });
    }, id);
    await page.click('[data-testid="sync-now"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-report"]')?.textContent.includes('changed in both places'), { timeout: 6000 });
    const vs = await page.$eval('[data-testid="sync-versions"]', (e) => e.textContent);
    assert(vs.includes('File side'), 'older (file) side saved as a version: ' + vs);
    const fileName = await page.evaluate(async (fid) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('bw-sync-test'); const j = JSON.parse(await (await (await d.getFileHandle(fid + '.boardwise.json')).getFile()).text()); return j.board.name; }, id);
    eq(fileName, 'Local side', 'the newer local edit was written to the folder');
    // restore the older version as a copy
    await page.click('[data-testid="sync-versions"] button');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((e) => /Restored as a new board/.test(e.textContent)), { timeout: 4000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.card, [data-board]').length >= 2 || document.body.textContent.includes('older version'));
    eq(errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)), [], 'errors');
    await page.close();
  });
}
