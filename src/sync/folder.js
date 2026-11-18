// OPTIONAL two-way sync of boards with a folder on disk (File System Access API, Chromium-based browsers).
// One file per board: "<id>.boardwise.json". Works against any FileSystemDirectoryHandle-like object,
// so it is unit-tested with an in-memory fake and e2e-tested with the browser's private file system.
//
// Conflict rule: when a board changed on BOTH sides since the last sync, the NEWER edit wins and the
// OLDER copy is kept as a saved version (up to MAX_VERSIONS per board) that can be restored as a copy.
import { exportBoardJSON, normaliseBoard, parseImport } from '../core/serialize.js';
import { LIMITS } from '../core/sanitize.js';

const SUFFIX = '.boardwise.json';
export const MAX_VERSIONS = 10;
const SAFE_ID = /^[\w-]{1,64}$/;

export const folderSyncSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

/** Decide what to do for one board. Pure. L/R = local/remote updatedAt (undefined if missing); S = last synced {l, r}. */
export function decide(L, R, S) {
  if (L === undefined && R === undefined) return 'none';
  if (R === undefined) return 'push';
  if (L === undefined) return 'pull';
  if (L === R) return 'same';
  const localChanged = !S || S.l !== L, remoteChanged = !S || S.r !== R;
  if (localChanged && remoteChanged) return L > R ? 'conflict-local-wins' : 'conflict-remote-wins';
  if (localChanged) return 'push';
  if (remoteChanged) return 'pull';
  return 'same';
}

async function readRemote(dir) {
  const out = new Map(); const skipped = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || !name.endsWith(SUFFIX)) continue;
    const id = name.slice(0, -SUFFIX.length);
    if (!SAFE_ID.test(id)) { skipped.push({ name, reason: 'name' }); continue; }
    try {
      const f = await h.getFile();
      if (f.size > LIMITS.jsonBytes) throw new Error('too large');
      const { kind, boards } = parseImport(await f.text());
      if (kind !== 'board' || boards[0].id !== id) throw new Error('id mismatch');
      out.set(id, boards[0]);
    } catch (e) { skipped.push({ name, reason: e?.message || 'invalid' }); }
  }
  return { remote: out, skipped };
}

async function writeFile(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try { await w.write(text); } finally { await w.close(); }
}

/**
 * Run one sync pass. `storage` is the app Storage. Returns a report:
 * { pushed:[ids], pulled:[ids], conflicts:[{id,kept:'local'|'remote'}], skipped:[{name,reason}], same:n }.
 */
export async function syncFolder(dir, storage) {
  const report = { pushed: [], pulled: [], conflicts: [], skipped: [], same: 0 };
  const { remote, skipped } = await readRemote(dir);
  report.skipped = skipped;
  const state = (await storage.backend.get('kv', 'syncstate')) || {};
  const locals = new Map((await storage.listBoards()).map((s) => [s.id, s]));
  const ids = new Set([...locals.keys(), ...remote.keys()]);

  for (const id of ids) {
    const L = locals.get(id)?.updatedAt, rb = remote.get(id), R = rb?.updatedAt;
    const action = decide(L, R, state[id]);
    if (action === 'same' || action === 'none') { if (action === 'same') { report.same++; state[id] = { l: L, r: R }; } continue; }

    const pushLocal = async () => {
      const lb = (await storage.getBoard(id))?.board; if (!lb) return;
      await writeFile(dir, id + SUFFIX, exportBoardJSON(lb));
      state[id] = { l: lb.updatedAt, r: lb.updatedAt };
    };
    const pullRemote = async () => {
      await storage.saveBoard(rb);
      state[id] = { l: rb.updatedAt, r: rb.updatedAt };
    };

    if (action === 'push') { await pushLocal(); report.pushed.push(id); }
    else if (action === 'pull') { await pullRemote(); report.pulled.push(id); }
    else {
      const localWins = action === 'conflict-local-wins';
      const loser = localWins ? rb : (await storage.getBoard(id))?.board;
      await addVersion(storage, id, loser, localWins ? 'remote' : 'local');
      if (localWins) await pushLocal(); else await pullRemote();
      report.conflicts.push({ id, kept: localWins ? 'local' : 'remote' });
      (localWins ? report.pushed : report.pulled).push(id);
    }
  }
  await storage.backend.put('kv', 'syncstate', state);
  await storage.backend.put('kv', 'syncLast', Date.now());
  return report;
}

// ---- saved older versions ----
export async function listVersions(storage) {
  const all = (await storage.backend.get('kv', 'syncVersions')) || [];
  return all.map(({ board, ...m }) => ({ ...m, name: board?.name, count: board?.order?.length || 0 }));
}
async function addVersion(storage, id, board, from) {
  if (!board) return;
  const all = (await storage.backend.get('kv', 'syncVersions')) || [];
  all.unshift({ key: `${id}:${Date.now()}`, id, from, savedAt: Date.now(), editedAt: board.updatedAt, board });
  const perBoard = new Map();
  const kept = all.filter((v) => { const n = (perBoard.get(v.id) || 0) + 1; perBoard.set(v.id, n); return n <= MAX_VERSIONS; });
  await storage.backend.put('kv', 'syncVersions', kept);
}
/** Restore a saved version as a NEW board (never overwrites). Returns the new board id. */
export async function restoreVersion(storage, key) {
  const all = (await storage.backend.get('kv', 'syncVersions')) || [];
  const v = all.find((x) => x.key === key);
  if (!v) return null;
  const copy = normaliseBoard(v.board, { keepId: false });
  copy.name = `${v.board.name} (older version)`.slice(0, 200);
  copy.updatedAt = Date.now();
  await storage.saveBoard(copy);
  return copy.id;
}

// ---- folder handle persistence & permission ----
// The handle is kept in memory for the session and also stored in IndexedDB so the choice survives reloads
// (the browser then asks the user to re-grant access). The e2e test hook never persists its stand-in handle:
// headless Chrome crashes when a browser-private-file-system handle is stored in IndexedDB.
let memHandle = null;
const testHook = () => typeof window !== 'undefined' && !!window.__bwPickDir && /[?&#]e2e\b/.test(location.href);
export async function saveHandle(storage, handle) {
  memHandle = handle;
  if (testHook()) return true;
  try { await storage.backend.put('kv', 'folderHandle', handle); return true; } catch { return false; }
}
export async function loadHandle(storage) {
  if (memHandle) return memHandle;
  try { return (await storage.backend.get('kv', 'folderHandle')) || null; } catch { return null; }
}
export async function forgetHandle(storage) {
  memHandle = null;
  try { await storage.backend.delete('kv', 'folderHandle'); await storage.backend.delete('kv', 'syncstate'); } catch { /* nothing stored */ }
}
export async function hasPermission(handle, request = false) {
  try {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission?.(opts)) === 'granted') return true;
    return request ? (await handle.requestPermission?.(opts)) === 'granted' : false;
  } catch { return false; }
}
export async function pickFolder() {
  if (typeof window !== 'undefined' && window.__bwPickDir && /[?&#]e2e\b/.test(location.href)) return window.__bwPickDir(); // test hook (e2e only)
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'boardwise' });
}
