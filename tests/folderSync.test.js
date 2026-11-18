import { describe, it, expect } from 'vitest';
import { Storage } from '../src/core/storage.js';
import { emptyBoard, makers } from '../src/core/model.js';
import { decide, syncFolder, listVersions, restoreVersion } from '../src/sync/folder.js';

// in-memory FileSystemDirectoryHandle
function fakeDir() {
  const files = new Map();
  const handle = (name) => ({
    kind: 'file', name,
    async getFile() { const t = files.get(name); return { size: t.length, async text() { return t; } }; },
    async createWritable() { let buf = ''; return { async write(s) { buf += s; }, async close() { files.set(name, buf); } }; },
  });
  return {
    files,
    async *entries() { for (const n of files.keys()) yield [n, handle(n)]; },
    async getFileHandle(name) { return handle(name); },
  };
}
const board = (id, name, updatedAt, text = '') => { const b = emptyBoard(name); b.id = id; b.updatedAt = updatedAt; b.createdAt = 1; if (text) { const o = makers.sticky(0, 0); o.id = 's' + id; o.text = text; b.objects[o.id] = o; b.order = [o.id]; } return b; };

describe('decide', () => {
  it('covers each case', () => {
    expect(decide(undefined, 5)).toBe('pull');
    expect(decide(5, undefined)).toBe('push');
    expect(decide(5, 5)).toBe('same');
    expect(decide(7, 5, { l: 5, r: 5 })).toBe('push');
    expect(decide(5, 7, { l: 5, r: 5 })).toBe('pull');
    expect(decide(9, 7, { l: 5, r: 5 })).toBe('conflict-local-wins');
    expect(decide(6, 7, { l: 5, r: 5 })).toBe('conflict-remote-wins');
    expect(decide(9, 7, undefined)).toBe('conflict-local-wins');
  });
});

describe('syncFolder', () => {
  it('pushes, pulls, and is idempotent', async () => {
    const st = await Storage.open({ forceMemory: true }); const dir = fakeDir();
    await st.saveBoard(board('b1', 'Local one', 100, 'hello'));
    let r = await syncFolder(dir, st);
    expect(r.pushed).toEqual(['b1']); expect([...dir.files.keys()]).toEqual(['b1.boardwise.json']);
    // another device wrote a board
    const st2 = await Storage.open({ forceMemory: true }); await st2.saveBoard(board('b2', 'Remote', 200, 'yo'));
    await syncFolder(dir, st2);
    r = await syncFolder(dir, st);
    expect(r.pulled).toEqual(['b2']);
    expect((await st.getBoard('b2')).board.name).toBe('Remote');
    r = await syncFolder(dir, st);
    expect(r.pushed).toEqual([]); expect(r.pulled).toEqual([]);
  });
  it('conflict: newer edit wins, older is saved as a restorable version', async () => {
    const A = await Storage.open({ forceMemory: true }), B = await Storage.open({ forceMemory: true }); const dir = fakeDir();
    await A.saveBoard(board('c', 'Base', 100, 'base')); await syncFolder(dir, A); await syncFolder(dir, B);
    await A.saveBoard(board('c', 'A edit', 300, 'A')); // A edits later
    await B.saveBoard(board('c', 'B edit', 200, 'B')); // B edits earlier, offline from A
    const rb = await syncFolder(dir, B); // B syncs after A? A has not pushed yet -> B pushes its edit (remote unchanged since sync)
    expect(rb.pushed).toEqual(['c']);
    const ra = await syncFolder(dir, A); // A: local changed (300), remote changed (200 by B) -> conflict, A newer
    expect(ra.conflicts).toEqual([{ id: 'c', kept: 'local' }]);
    expect((await A.getBoard('c')).board.name).toBe('A edit');
    const v = await listVersions(A);
    expect(v).toHaveLength(1); expect(v[0].name).toBe('B edit');
    const newId = await restoreVersion(A, v[0].key);
    expect(newId).not.toBe('c');
    expect((await A.getBoard(newId)).board.name).toBe('B edit (older version)');
    // B pulls the winner
    const rb2 = await syncFolder(dir, B);
    expect(rb2.pulled).toEqual(['c']); expect((await B.getBoard('c')).board.name).toBe('A edit');
  });
  it('skips malformed, mismatched and oddly named files without failing', async () => {
    const st = await Storage.open({ forceMemory: true }); const dir = fakeDir();
    dir.files.set('bad.boardwise.json', 'not json');
    dir.files.set('../evil.boardwise.json', '{}');
    dir.files.set('notes.txt', 'ignore me');
    dir.files.set('x.boardwise.json', JSON.stringify({ app: 'boardwise', format: 1, kind: 'board', board: { id: 'other', name: 'liar' } }));
    const r = await syncFolder(dir, st);
    expect(r.skipped.map((s) => s.name).sort()).toEqual(['../evil.boardwise.json', 'bad.boardwise.json', 'x.boardwise.json']);
    expect(await st.listBoards()).toEqual([]);
  });
});
