// Runs axe-core (WCAG 2.x A/AA + best practices) on the main screens in light and dark themes.
import { createRequire } from 'node:module';
import { serve, launch, openPage, sleep, Reporter, openMenu, clickMenuItem } from './lib.mjs';
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

export async function runAxe(page, label) {
  await page.addScriptTag({ path: axePath });
  const res = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] }));
  return res.violations.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0].target.join(' ')} :: ${(v.nodes[0].failureSummary || '').split('\n')[1] || ''}`);
}

export default async function a11y({ browser, srv, R, url }) {
  console.log('Accessibility (axe-core)');
  for (const theme of ['light', 'dark']) {
    const { page } = await openPage(browser, url);
    await page.setBypassCSP(true);
    await page.evaluate((t) => { const p = JSON.parse(localStorage.getItem('boardwise.prefs.v1') || '{}'); p.theme = t; localStorage.setItem('boardwise.prefs.v1', JSON.stringify(p)); }, theme);
    await page.reload({ waitUntil: 'networkidle0' });
    await R.test(`home, empty (${theme})`, async () => { const v = await runAxe(page, 'home'); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    await page.click('[data-template="kanban"]'); await page.waitForFunction(() => window.__bw?.store.size > 3); await sleep(1200);
    await page.click('button[aria-label="All boards"]'); await page.waitForSelector('.card');
    await R.test(`home with boards (${theme})`, async () => { const v = await runAxe(page, 'home+cards'); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    await page.click('.card .thumb'); await page.waitForFunction(() => window.__bw); await sleep(300);
    await R.test(`board, nothing selected (${theme})`, async () => { const v = await runAxe(page, 'board'); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    await page.evaluate(() => { const { engine, store } = window.__bw; engine.select([store.list().find((o) => o.type === 'sticky' || o.type === 'frame').id]); });
    await page.evaluate(() => window.__bw.engine.setTool('pen')); 
    await R.test(`board with pen options (${theme})`, async () => { const v = await runAxe(page, 'pen-inspector'); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    await page.evaluate(() => { window.__bw.engine.setTool('select'); const { engine, store } = window.__bw; engine.select([store.list().find((o) => o.type === 'frame').id]); });
    await R.test(`board with selection inspector (${theme})`, async () => { const v = await runAxe(page, 'sel-inspector'); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    const dialogs = [
      ['export dialog', async () => { await openMenu(page, 'File'); await clickMenuItem(page, 'Export board'); await page.waitForSelector('.dialog'); }],
      ['shortcuts dialog', async () => { await page.focus('[data-testid="board-canvas"]'); await page.keyboard.press('?'); await page.waitForSelector('.dialog'); }],
      ['command palette', async () => { await page.focus('[data-testid="board-canvas"]'); await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await page.waitForSelector('.palette'); }],
      ['import dialog', async () => { await openMenu(page, 'File'); await clickMenuItem(page, 'Import into this board'); await page.waitForSelector('.dialog'); }],
      ['collaboration dialog', async () => { await openMenu(page, 'File'); await clickMenuItem(page, 'Live collaboration (optional)'); await page.waitForSelector('[data-testid="collab-warn"]'); }],
      ['timer dialog', async () => { await openMenu(page, 'Workshop tools'); await clickMenuItem(page, 'Timer'); await page.waitForSelector('.dialog'); }],
    ];
    for (const [name, open] of dialogs) {
      await R.test(`${name} (${theme})`, async () => { await page.evaluate(() => document.activeElement?.blur()); await open(); const v = await runAxe(page, name); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.scrim')); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    }
    const panels = [
      ['search panel', async () => { await page.click('[data-testid="open-search"]'); await page.waitForSelector('.side'); }],
      ['notes panel', async () => { await openMenu(page, 'Workshop tools'); await clickMenuItem(page, 'Sticky notes'); await page.waitForSelector('.side'); }],
      ['comments panel', async () => { await openMenu(page, 'Workshop tools'); await clickMenuItem(page, 'Comments'); await page.waitForSelector('.side'); }],
    ];
    for (const [name, open] of panels) {
      await R.test(`${name} (${theme})`, async () => { await open(); const v = await runAxe(page, name); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.side')); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    }
    await R.test(`menus open: view/settings (${theme})`, async () => { await openMenu(page, 'View and settings'); await page.waitForSelector('.menu'); const v = await runAxe(page, 'view menu'); await page.keyboard.press('Escape'); if (v.length) throw new Error('\n      ' + v.join('\n      ')); });
    await page.close();
  }
}


export async function a11yExtra({ browser, R, url }) {
  await R.test('folder sync dialog on the home page', async () => {
    const { page } = await openPage(browser, url); await page.setBypassCSP(true); await page.reload({ waitUntil: 'networkidle0' });
    await openMenu(page, 'Settings'); await page.click('[data-testid="menu-sync"]'); await page.waitForSelector('[data-testid="sync-help"]');
    const v = await runAxe(page, 'sync dialog'); if (v.length) throw new Error('\n      ' + v.join('\n      '));
    await page.close();
  });
  for (const lang of ['ar', 'he', 'de']) {
    await R.test(`home and board in ${lang}`, async () => {
      const { page } = await openPage(browser, url); await page.setBypassCSP(true); await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate((l) => localStorage.setItem('boardwise.prefs.v1', JSON.stringify({ lang: l })), lang);
      await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('[data-testid="new-board"]');
      let v = await runAxe(page, 'home-' + lang);
      await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw);
      v = v.concat(await runAxe(page, 'board-' + lang));
      if (v.length) throw new Error('\n      ' + v.join('\n      '));
      await page.close();
    });
  }
}

if (process.argv[1].endsWith('a11y.mjs')) {
  const srv = await serve(); const browser = await launch(); const R = new Reporter('axe');
  await a11y({ browser, srv, R, url: srv.url + '?e2e=1' });
  await a11yExtra({ browser, R, url: srv.url + '?e2e=1' });
  await browser.close(); await srv.close(); process.exit(R.summary() ? 0 : 1);
}
