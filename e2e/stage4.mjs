import { openPage, newBoard, state, sleep, assert, eq, openMenu, clickMenuItem } from './lib.mjs';

export default async function stage4({ browser, srv, R, url }) {
  console.log('Stage 4: offline PWA, responsive layouts');

  await R.test('installable manifest and service worker are served', async () => {
    const { page } = await openPage(browser, url);
    const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return r.json(); });
    eq([man.name, man.display], ['Boardwise', 'standalone']);
    assert(man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.sizes === '192x192'), 'icons');
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    assert(reg, 'service worker active');
    await page.close();
  });

  await R.test('works fully offline: reload with the network off, then create, draw and save a board', async () => {
    const { page, errors } = await openPage(browser, url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle0' }); // first load controlled by SW => everything is cached
    await page.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 8000 });
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-testid="home"]', { timeout: 8000 });
    await page.click('[data-template="kanban"]'); await page.waitForFunction(() => window.__bw?.store.size > 3);
    await page.evaluate(() => { const { store } = window.__bw; const mk = { id: 'off1', type: 'sticky', x: 0, y: 0, w: 180, h: 180, rotation: 0, locked: false, groupId: null, color: 'yellow', text: 'offline note', fontSize: 18, bold: false, italic: false, align: 'left', votes: {} }; store.add(mk); });
    await page.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('Saved'), { timeout: 6000 });
    await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.__bw?.store.get('off1')?.text === 'offline note', { timeout: 8000 });
    await page.setOfflineMode(false);
    eq(errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)), [], 'errors');
    await page.close();
  });

  await R.test('other languages are separate chunks that are also cached for offline use', async () => {
    const { page } = await openPage(browser, url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const keys = await page.evaluate(async () => { const out = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname); return out; });
    for (const l of ['es', 'fr', 'de', 'pt', 'hi', 'ar', 'he']) assert(keys.some((k) => new RegExp(`/${l}-[\\w-]+\\.js$`).test(k)), `${l} chunk precached`);
    await page.close();
  });

  await R.test('phone layout (390×844, touch): no horizontal scroll, collapsible toolbar, big touch targets', async () => {
    const { page } = await openPage(browser, url, { viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
    await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    eq(overflow, 0, 'no horizontal overflow');
    assert(await page.$eval('.toolbar', (t) => t.classList.contains('collapsed')), 'toolbar collapsed by default on phones');
    await page.tap('button[aria-label="Show or hide tools"]'); await page.waitForFunction(() => !document.querySelector('.toolbar').classList.contains('collapsed'));
    const small = await page.$$eval('.toolbar .btn, .topbar .btn', (b) => b.filter((x) => x.offsetParent && (x.getBoundingClientRect().width < 44 || x.getBoundingClientRect().height < 44)).map((x) => x.getAttribute('aria-label') + ' ' + Math.round(x.getBoundingClientRect().width) + 'x' + Math.round(x.getBoundingClientRect().height)));
    eq(small, [], 'every visible toolbar/topbar button is at least 44px');
    const tb = await page.$eval('.toolbar', (t) => { const r = t.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
    assert(tb.l >= 0 && tb.r <= tb.w + 1, 'toolbar fits the screen: ' + JSON.stringify(tb));
    await page.tap('button[aria-label^="Sticky note"]');
    const box = await (await page.$('[data-testid="board-canvas"]')).boundingBox();
    await page.touchscreen.tap(box.x + 150, box.y + 250); await page.waitForSelector('textarea.bw-editor');
    await page.keyboard.type('tapped'); await page.keyboard.press('Escape');
    eq((await state(page)).objects.map((o) => o.text), ['tapped'], 'tap creates a sticky on touch');
    await page.close();
  });

  await R.test('tablet layout (820×1180) and short laptop (1280×600) keep the toolbar on screen', async () => {
    for (const vp of [{ width: 820, height: 1180, isMobile: true, hasTouch: true }, { width: 1280, height: 600 }]) {
      const { page } = await openPage(browser, url, { viewport: vp });
      await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw);
      if (await page.$eval('.toolbar', (t) => t.classList.contains('collapsed'))) await page.click('.toolbar-toggle');
      const r = await page.$eval('.toolbar', (t) => { const b = t.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: innerHeight, w: innerWidth }; });
      assert(r.t >= 0 && r.b <= r.h && r.l >= 0 && r.r <= r.w, `toolbar inside viewport at ${vp.width}x${vp.height}: ${JSON.stringify(r)}`);
      eq(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal overflow');
      await page.close();
    }
  });

  await R.test('home page on phone: cards reflow, no overflow', async () => {
    const { page } = await openPage(browser, url, { viewport: { width: 360, height: 740, isMobile: true, hasTouch: true } });
    eq(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no overflow');
    await page.close();
  });
}
