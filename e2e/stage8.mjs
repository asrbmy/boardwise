import { openPage, assert, eq } from './lib.mjs';

const SIZES = [['small phone', 320, 568, true], ['phone', 390, 844, true], ['landscape phone', 844, 390, true], ['tablet', 820, 1180, true], ['laptop', 1280, 720, false], ['wide', 1920, 1080, false]];

export default async function stage8({ browser, R, url }) {
  console.log('Stage 8: responsive layout and first-open view');
  for (const [name, width, height, touch] of SIZES) {
    await R.test(`${name} (${width}x${height}): template opens fitted, no horizontal overflow, controls reachable`, async () => {
      const { page, errors } = await openPage(browser, url, { viewport: { width, height, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 } });
      const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      eq(await over(), 0, 'home overflow');
      await page.click('[data-template="brainstorm"]'); await page.waitForFunction(() => window.__bw?.store.size > 2);
      await new Promise((r) => setTimeout(r, 400));
      eq(await over(), 0, 'board overflow');
      // the content must actually be on screen (this used to open on empty canvas)
      const vis = await page.evaluate(() => {
        const { store, engine } = window.__bw; let seen = 0;
        for (const o of store.list()) { const p = engine.worldToScreen(o.x + o.w / 2, o.y + o.h / 2); if (p.x >= 0 && p.y >= 0 && p.x <= engine.size.w && p.y <= engine.size.h) seen++; }
        return seen / store.size;
      });
      assert(vis > 0.3, `content visible on first open (${(vis * 100).toFixed(0)}%)`);
      // every top-bar control sits inside the viewport
      const out = await page.$$eval('.topbar button, .topbar input', (els) => els.filter((e) => e.offsetParent).filter((e) => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).length);
      eq(out, 0, 'topbar controls inside viewport');
      // a tool can be reached and used at this size (toolbar may be behind a toggle on small screens)
      if (await page.$('.toolbar.collapsed')) await page.click('.toolbar-toggle');
      await page.waitForSelector('.toolbar [data-tool="sticky"], .toolbar [aria-label]', { visible: true });
      const tb = await page.$eval('.toolbar', (e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.top >= 0; });
      assert(tb, 'toolbar inside viewport');
      eq(errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)), [], 'errors');
      await page.close();
    });
  }
  await R.test('dialogs stay inside a 320px screen and scroll when tall', async () => {
    const { page } = await openPage(browser, url, { viewport: { width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } });
    await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw);
    await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
    await page.waitForSelector('.palette');
    const r = await page.$eval('.palette', (e) => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; });
    assert(r, 'palette fits');
    await page.keyboard.press('Escape');
    await page.click('button[aria-label="File"]'); await page.click('[data-testid="menu-collab"]');
    await page.waitForSelector('[data-testid="collab-warn"]');
    const d = await page.$eval('.dialog', (e) => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight + 1; });
    assert(d, 'collab dialog fits');
    await page.close();
  });
}
