import { describe, it, expect, beforeEach } from 'vitest';
import { Storage, loadPrefs, savePrefs, DEFAULT_PREFS } from '../src/core/storage.js';
import { emptyBoard, makers } from '../src/core/model.js';

async function fresh(opts) { const s = await Storage.open(opts); await s.wipe(); return s; }
const board = (name = 'B') => { const b = emptyBoard(name); const o = makers.sticky(1, 2, 'blue', { text: 'x' }); b.objects[o.id] = o; b.order.push(o.id); return b; };

describe('storage (IndexedDB)', () => {
  it('opens IndexedDB and persists boards', async () => {
    const s = await fresh();
    expect(s.mode).toBe('indexeddb'); expect(s.persistent).toBe(true);
    const b = board();
    await s.saveBoard(b, 'data:image/png;base64,AA');
    const list = await s.listBoards();
    expect(list).toHaveLength(1); expect(list[0].count).toBe(1); expect(list[0].thumb).toBe('data:image/png;base64,AA');
    const r = await s.getBoard(b.id);
    expect(r.recovered).toBe(false); expect(r.board.objects[b.order[0]].text).toBe('x');
  });
  it('keeps the thumbnail when saving without one', async () => {
    const s = await fresh(); const b = board();
    await s.saveBoard(b, 'data:image/png;base64,AA'); await s.saveBoard(b);
    expect((await s.listBoards())[0].thumb).toBe('data:image/png;base64,AA');
  });
  it('deletes everything for a board', async () => {
    const s = await fresh(); const b = board();
    await s.saveBoard(b); await s.putHistory(b.id, { undo: [], redo: [] });
    await s.deleteBoard(b.id);
    expect(await s.listBoards()).toHaveLength(0);
    expect(await s.getBoard(b.id)).toBeNull(); expect(await s.getHistory(b.id)).toBeNull();
  });
  it('stores and restores history', async () => {
    const s = await fresh(); const h = { undo: [{ changes: {} }], redo: [] };
    await s.putHistory('x', h);
    expect(await s.getHistory('x')).toEqual(h);
  });
  it('patchSummary renames in both stores', async () => {
    const s = await fresh(); const b = board();
    await s.saveBoard(b); await s.patchSummary(b.id, { name: 'Renamed', favourite: true });
    expect((await s.listBoards())[0].name).toBe('Renamed');
    expect((await s.getBoard(b.id)).board.favourite).toBe(true);
  });
  it('recovers from a corrupted record using the backup copy', async () => {
    const s = await fresh(); const b = board('Good');
    await s.saveBoard(b);            // first save: nothing to back up yet
    s.lastBackup.clear();
    await s.saveBoard({ ...b, name: 'Good v2' }); // copies previous record to backup
    await s.backend.put('boards', b.id, 'garbage');
    const r = await s.getBoard(b.id);
    expect(r.recovered).toBe(true); expect(r.board.name).toBe('Good');
  });
  it('allBoards returns every board (for backup)', async () => {
    const s = await fresh();
    await s.saveBoard(board('1')); await s.saveBoard(board('2'));
    expect((await s.allBoards()).map((b) => b.name).sort()).toEqual(['1', '2']);
  });
  it('folders persist', async () => {
    const s = await fresh(); await s.putFolders(['A', 'B']);
    expect(await s.getFolders()).toEqual(['A', 'B']);
  });
});

describe('storage (memory fallback)', () => {
  it('works without IndexedDB and reports the mode', async () => {
    const s = await Storage.open({ forceMemory: true });
    expect(s.mode).toBe('memory'); expect(s.persistent).toBe(false);
    const b = board(); await s.saveBoard(b);
    expect((await s.getBoard(b.id)).board.id).toBe(b.id);
    await s.deleteBoard(b.id); expect(await s.listBoards()).toHaveLength(0);
  });
  it('falls back automatically if indexedDB is missing', async () => {
    const real = globalThis.indexedDB; delete globalThis.indexedDB;
    try { const s = await Storage.open(); expect(s.mode).toBe('memory'); expect(s.reason).toMatch(/not available/i); }
    finally { globalThis.indexedDB = real; }
  });
});

describe('preferences', () => {
  beforeEach(() => localStorage.clear());
  it('defaults, saves and merges', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    savePrefs({ ...DEFAULT_PREFS, theme: 'dark' });
    expect(loadPrefs().theme).toBe('dark');
  });
  it('survives corrupt localStorage', () => {
    localStorage.setItem('boardwise.prefs.v1', '{oops');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
