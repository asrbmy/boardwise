import { openPage, assert, eq, sleep } from './lib.mjs';

const waitFor = (label) => (page, fn, opts) => page.waitForFunction(fn, opts).catch(() => { throw new Error(`wait #${label} failed: ${String(fn).slice(0, 110)}`); });
export default async function stage6({ browser, srv, R, url }) {
  console.log('Stage 6: optional peer-to-peer collaboration');

  await R.test('two tabs connect over WebRTC with copy-paste codes and stay in sync (add, edit, delete, undo stays local)', async () => {
    const a = await openPage(browser, url), b = await openPage(browser, url);
    for (const { page } of [a, b]) { await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw); }
    const sticky = (id, text) => ({ id, type: 'sticky', x: 0, y: 0, w: 180, h: 180, rotation: 0, locked: false, groupId: null, color: 'yellow', text, fontSize: 18, bold: false, italic: false, align: 'left', votes: {} });
    await a.page.evaluate((o) => window.__bw.store.add(o), sticky('a1', 'from A'));
    await b.page.evaluate((o) => window.__bw.store.add(o), sticky('b1', 'from B'));

    // host (A)
    await a.page.click('button[aria-label="File"]'); await a.page.click('[data-testid="menu-collab"]');
    await a.page.waitForSelector('[data-testid="collab-warn"]');
    await a.page.click('[data-testid="collab-create-offer"]');
    await a.page.waitForFunction(() => document.querySelector('[data-testid="collab-code-out"]')?.value.startsWith('BW1.offer.'), { timeout: 10000 });
    const offer = await a.page.$eval('[data-testid="collab-code-out"]', (e) => e.value);

    // guest (B)
    await b.page.click('button[aria-label="File"]'); await b.page.click('[data-testid="menu-collab"]');
    await b.page.click('[data-testid="collab-tab-join"]');
    await b.page.type('[data-testid="collab-offer-in"]', offer);
    await b.page.click('[data-testid="collab-create-answer"]');
    await b.page.waitForFunction(() => document.querySelector('[data-testid="collab-code-out"]')?.value.startsWith('BW1.answer.'), { timeout: 10000 });
    const answer = await b.page.$eval('[data-testid="collab-code-out"]', (e) => e.value);

    await a.page.type('[data-testid="collab-answer-in"]', answer);
    await a.page.click('[data-testid="collab-connect"]');
    for (const { page } of [a, b]) await waitFor(2)(page, () => window.__bw.session.connectedCount === 1, { timeout: 15000 });

    // merged boards
    for (const { page } of [a, b]) await waitFor(3)(page, () => window.__bw.store.get('a1') && window.__bw.store.get('b1'), { timeout: 8000 });
    // collaborator cursor appears on the other side
    await a.page.evaluate(() => window.__bw.session.setLocal({ x: 40, y: 50, name: 'Ann' }));
    await waitFor(4)(b.page, () => document.querySelector('[data-testid="remote-cursor"]')?.textContent.includes('Ann'), { timeout: 5000 });
    // live edit, delete
    await a.page.evaluate(() => window.__bw.store.update('b1', { text: 'edited by A' }));
    await waitFor(5)(b.page, () => window.__bw.store.get('b1').text === 'edited by A', { timeout: 5000 });
    await b.page.evaluate(() => window.__bw.store.remove(['a1']));
    await waitFor(6)(a.page, () => !window.__bw.store.get('a1'), { timeout: 5000 });
    // remote edits never land in the other person's undo history
    eq(await a.page.evaluate(() => window.__bw.store.history.undoStack.length), 2, 'A has only its own 2 steps (add, edit)');
    assert((await a.page.$eval('[data-testid="live-pill"]', (e) => e.textContent)).includes('1'), 'live pill shows 1');
    // orders match
    eq(await a.page.evaluate(() => window.__bw.store.order), await b.page.evaluate(() => window.__bw.store.order));
    // disconnect
    await a.page.evaluate(() => window.__bw.session.close());
    await waitFor(7)(b.page, () => window.__bw.session.connectedCount === 0, { timeout: 8000 });
    await a.page.close(); await b.page.close();
  });

  await R.test('bad connection codes are rejected with a clear message', async () => {
    const { page } = await openPage(browser, url);
    await page.click('[data-testid="new-board"]'); await page.waitForFunction(() => window.__bw);
    await page.click('button[aria-label="File"]'); await page.click('[data-testid="menu-collab"]');
    await page.click('[data-testid="collab-tab-join"]');
    await page.type('[data-testid="collab-offer-in"]', 'not a code');
    await page.click('[data-testid="collab-create-answer"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((e) => /not valid/i.test(e.textContent)), { timeout: 4000 });
    eq(await page.evaluate(() => window.__bw.session.peers.length), 0);
    await page.close();
  });
}
