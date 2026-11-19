import { serve, launch, Reporter } from './lib.mjs';
import stage1 from './stage1.mjs';

const only = process.argv[2];
const srv = await serve();
const browser = await launch();
const R = new Reporter('Boardwise e2e');
const url = srv.url + '?e2e=1';
const stages = { 1: stage1 };
for (const n of ['2', '3', '4', '5', '6', '7', '8']) { try { stages[n] = (await import(`./stage${n}.mjs`)).default; } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } }
for (const [n, fn] of Object.entries(stages)) { if (only && only !== n && only !== 'all') continue; await fn({ browser, srv, R, url }); }
await browser.close();
await srv.close();
process.exit(R.summary() ? 0 : 1);
