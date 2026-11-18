// Shared helpers for the real-browser tests: static server for dist/, Chrome launcher, small utilities.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

export async function serve(port = 0, base = '/') {
  const hits = { count: 0, external: [] };
  const server = createServer(async (req, res) => {
    hits.count++;
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (base !== '/' && path.startsWith(base)) path = path.slice(base.length - 1);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(ROOT, 'index.html'); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch { res.writeHead(404).end('nf'); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, port: server.address().port, hits, url: `http://127.0.0.1:${server.address().port}${base}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

export async function launch(opts = {}) {
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu-sandbox', ...(opts.args || [])],
    defaultViewport: opts.viewport || { width: 1280, height: 800 },
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Reporter {
  constructor(name) { this.name = name; this.results = []; }
  async test(title, fn) {
    const t0 = Date.now();
    try { await fn(); this.results.push({ title, ok: true }); console.log(`  ✓ ${title} (${Date.now() - t0}ms)`); }
    catch (e) { this.results.push({ title, ok: false, err: e }); console.log(`  ✗ ${title}\n      ${String(e?.message || e).split('\n').filter((l) => l.trim()).slice(0, 8).join('\n      ')}`); }
  }
  summary() {
    const failed = this.results.filter((r) => !r.ok);
    console.log(`\n${this.name}: ${this.results.length - failed.length}/${this.results.length} passed`);
    return failed.length === 0;
  }
}

export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }

/** Open a fresh page in an isolated browser context; collects console errors and external requests. */
export async function openPage(browser, url, { viewport, permissions } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (viewport) await page.setViewport(viewport);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(new URL(url).origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) external.push(u); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  return { page, ctx, errors, external };
}

export async function newBoard(page, base, template = null) {
  if (template) await page.click(`[data-template="${template}"]`);
  else await page.click('[data-testid="new-board"]');
  await page.waitForSelector('[data-testid="board-canvas"]');
  await page.waitForFunction(() => window.__bw);
  await sleep(150);
}

export const canvasBox = async (page) => (await page.$('[data-testid="board-canvas"]')).boundingBox();

export async function drag(page, from, to, { steps = 10, button = 'left' } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up({ button });
}

export const state = (page) => page.evaluate(() => {
  const { store } = window.__bw;
  return { count: store.size, objects: store.list(), selection: [...store.selection], undo: store.history.undoStack.length, redo: store.history.redoStack.length, view: { ...window.__bw.engine.view } };
});

// ---- helpers added for later stages ----
import { mkdtemp, readdir, readFile as rf, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

export async function enableDownloads(page) {
  const dir = await mkdtemp(join(tmpdir(), 'bw-dl-'));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true, browserContextId: page.browserContext().id });
  // Chrome asks before allowing repeated automatic downloads; grant it, as a user clicking "Allow" would.
  await cdp.send('Browser.setPermission', { permission: { name: 'automatic-downloads' }, setting: 'granted', origin: new URL(page.url()).origin, browserContextId: page.browserContext().id }).catch(() => {});
  return { dir, async wait(re, timeout = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const f = (await readdir(dir)).find((n) => re.test(n) && !n.endsWith('.crdownload'));
      if (f) { await sleep(100); return { name: f, path: join(dir, f), bytes: await rf(join(dir, f)) }; }
      await sleep(80);
    }
    throw new Error(`download matching ${re} not found; have ${(await readdir(dir)).join(', ')}`);
  }, async clear() { for (const f of await readdir(dir)) await rm(join(dir, f)); }, async cleanup() { await rm(dir, { recursive: true, force: true }); } };
}

export async function clickMenuItem(page, text) {
  await page.waitForSelector('.menu .item');
  const ok = await page.evaluate((txt) => { const el = [...document.querySelectorAll('.menu .item')].find((e) => e.textContent.trim().startsWith(txt)); if (el) { el.click(); return true; } return false; }, text);
  if (!ok) throw new Error(`menu item "${text}" not found`);
}
export const openMenu = (page, label) => page.click(`button[aria-label="${label}"]`);
export const toastText = (page) => page.$$eval('.toast', (e) => e.map((x) => x.textContent));
export const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
