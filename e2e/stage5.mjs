import { openPage, assert, eq } from './lib.mjs';

const setLang = async (page, lang) => {
  await page.evaluate((l) => { const k = 'boardwise.prefs.v1'; const p = JSON.parse(localStorage.getItem(k) || '{}'); p.lang = l; localStorage.setItem(k, JSON.stringify(p)); }, lang);
  await page.reload({ waitUntil: 'load' });
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export default async function stage5({ browser, srv, R, url }) {
  console.log('Stage 5: languages and right-to-left');

  for (const [lang, dir, newBoard] of [['ar', 'rtl', 'لوحة جديدة'], ['he', 'rtl', 'לוח חדש'], ['es', 'ltr', 'Nueva pizarra'], ['de', 'ltr', 'Neues Board'], ['fr', 'ltr', 'Nouveau tableau'], ['pt', 'ltr', 'Novo quadro'], ['hi', 'ltr', 'नया बोर्ड']]) {
    await R.test(`${lang}: html lang/dir set, UI translated, no overflow on home and board`, async () => {
      const { page, errors } = await openPage(browser, url);
      await setLang(page, lang);
      await page.waitForFunction((t) => document.querySelector('[data-testid="new-board"]')?.textContent.includes(t), { timeout: 8000 }, newBoard);
      eq(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]), [lang, dir]);
      eq(await overflow(page), 0, 'home overflow');
      await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw);
      eq(await overflow(page), 0, 'board overflow');
      // toolbar and topbar stay inside the viewport
      const out = await page.$$eval('.toolbar, .topbar', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }));
      assert(!out.some(Boolean), 'toolbar/topbar fit the viewport');
      if (dir === 'rtl') {
        // the toolbar should sit on the inline-start (right) side
        const side = await page.$eval('.toolbar', (t) => { const r = t.getBoundingClientRect(); return (r.left + r.right) / 2 > innerWidth / 2 ? 'right' : 'left'; });
        eq(side, 'right', 'toolbar mirrors in RTL');
      }
      eq(errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)), [], 'errors');
      await page.close();
    });
  }

  await R.test('ar: phone layout has no horizontal overflow', async () => {
    const { page } = await openPage(browser, url, { viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
    await setLang(page, 'ar');
    await page.waitForSelector('[data-testid="new-board"]');
    await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw);
    eq(await overflow(page), 0);
    await page.close();
  });
}
