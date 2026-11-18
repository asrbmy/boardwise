// Persistence layer. IndexedDB (via idb) with an in-memory fallback if IndexedDB is blocked.
// Stores:
//   boards   – full board records (key: id)
//   index    – lightweight summaries incl. thumbnail, for the board list (key: id)
//   history  – undo/redo stacks per board (key: boardId)
//   backup   – last known-good copy of each board, refreshed at most once a minute
//   kv       – misc (folder list, etc.)
// Board + index are written in ONE transaction so a crash can never leave them out of step.

import { openDB } from 'idb';
import { normaliseBoard } from './serialize.js';

const DB_NAME = 'boardwise';
const DB_VERSION = 1;
const BACKUP_EVERY_MS = 60_000;

export function summarise(board, thumb) {
  return {
    id: board.id, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt,
    lastOpened: board.lastOpened, folder: board.folder || '', favourite: !!board.favourite,
    count: board.order ? board.order.length : 0, thumb: thumb ?? undefined,
  };
}

class MemoryBackend {
  constructor() { this.mode = 'memory'; this.m = { boards: new Map(), index: new Map(), history: new Map(), backup: new Map(), kv: new Map() }; }
  async get(store, key) { const v = this.m[store].get(key); return v === undefined ? undefined : structuredClone(v); }
  async getAll(store) { return [...this.m[store].values()].map((v) => structuredClone(v)); }
  async put(store, key, value) { this.m[store].set(key, structuredClone(value)); }
  async delete(store, key) { this.m[store].delete(key); }
  async clear(store) { this.m[store].clear(); }
  async tx(ops) { for (const op of ops) { if (op.del) this.m[op.store].delete(op.key); else this.m[op.store].set(op.key, structuredClone(op.value)); } }
  async estimate() { return null; }
}

class IdbBackend {
  constructor(db) { this.db = db; this.mode = 'indexeddb'; }
  get(store, key) { return this.db.get(store, key); }
  getAll(store) { return this.db.getAll(store); }
  async put(store, key, value) { await this.db.put(store, value, key); }
  delete(store, key) { return this.db.delete(store, key); }
  clear(store) { return this.db.clear(store); }
  async tx(ops) {
    const names = [...new Set(ops.map((o) => o.store))];
    const t = this.db.transaction(names, 'readwrite');
    for (const op of ops) {
      if (op.del) t.objectStore(op.store).delete(op.key);
      else t.objectStore(op.store).put(op.value, op.key);
    }
    await t.done;
  }
  async estimate() { try { return await navigator.storage?.estimate?.(); } catch { return null; } }
}

export class Storage {
  constructor(backend, reason = null) {
    this.backend = backend;
    this.reason = reason; // why we fell back to memory
    this.lastBackup = new Map();
    this.errorListeners = new Set();
  }
  get mode() { return this.backend.mode; }
  get persistent() { return this.backend.mode === 'indexeddb'; }
  onError(fn) { this.errorListeners.add(fn); return () => this.errorListeners.delete(fn); }
  _fail(e) { for (const fn of this.errorListeners) fn(e); }

  static async open({ forceMemory = false } = {}) {
    if (forceMemory) return new Storage(new MemoryBackend(), 'forced');
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
      const db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(d) {
          for (const s of ['boards', 'index', 'history', 'backup', 'kv']) d.createObjectStore(s);
        },
        blocked() {}, blocking() {},
      });
      // Probe: some browsers open the DB but throw on first write (private modes).
      await db.put('kv', Date.now(), '__probe');
      return new Storage(new IdbBackend(db));
    } catch (e) {
      return new Storage(new MemoryBackend(), e?.message || 'IndexedDB blocked');
    }
  }

  async listBoards() {
    const all = await this.backend.getAll('index');
    return all.filter((x) => x && x.id);
  }

  async getBoard(id) {
    const raw = await this.backend.get('boards', id);
    if (raw) {
      try { return { board: normaliseBoard(raw), recovered: false }; } catch { /* fall through to backup */ }
    }
    const bk = await this.backend.get('backup', id);
    if (bk) {
      try { return { board: normaliseBoard(bk), recovered: true }; } catch { /* nothing usable */ }
    }
    return null;
  }

  async saveBoard(board, thumb) {
    const now = Date.now();
    const prevSummary = await this.backend.get('index', board.id);
    const summary = summarise(board, thumb ?? prevSummary?.thumb);
    const ops = [
      { store: 'boards', key: board.id, value: board },
      { store: 'index', key: board.id, value: summary },
    ];
    if (now - (this.lastBackup.get(board.id) || 0) > BACKUP_EVERY_MS) {
      const prev = await this.backend.get('boards', board.id);
      if (prev) { ops.push({ store: 'backup', key: board.id, value: prev }); this.lastBackup.set(board.id, now); }
    }
    try { await this.backend.tx(ops); } catch (e) { this._fail(e); throw e; }
    return summary;
  }

  /** Store a thumbnail for the board list without touching the board itself or its edit time. */
  async setThumb(id, thumb) {
    const s = await this.backend.get('index', id);
    if (s) await this.backend.put('index', id, { ...s, thumb });
  }

  async patchSummary(id, changes) {
    const s = await this.backend.get('index', id);
    const b = await this.backend.get('boards', id);
    if (!s || !b) return;
    await this.backend.tx([
      { store: 'index', key: id, value: { ...s, ...changes } },
      { store: 'boards', key: id, value: { ...b, ...pick(changes, ['name', 'folder', 'favourite', 'lastOpened']) } },
    ]);
  }

  async deleteBoard(id) {
    await this.backend.tx([
      { store: 'boards', key: id, del: true }, { store: 'index', key: id, del: true },
      { store: 'history', key: id, del: true }, { store: 'backup', key: id, del: true },
    ]);
  }

  async getHistory(id) { return (await this.backend.get('history', id)) || null; }
  async putHistory(id, data) { try { await this.backend.put('history', id, data); } catch (e) { this._fail(e); } }

  async getFolders() { return (await this.backend.get('kv', 'folders')) || []; }
  async putFolders(list) { await this.backend.put('kv', 'folders', list); }

  async allBoards() {
    const ids = (await this.listBoards()).map((s) => s.id);
    const out = [];
    for (const id of ids) { const r = await this.getBoard(id); if (r) out.push(r.board); }
    return out;
  }

  async estimate() { return this.backend.estimate(); }

  async wipe() {
    for (const s of ['boards', 'index', 'history', 'backup', 'kv']) await this.backend.clear(s);
  }
}

function pick(obj, keys) { const o = {}; for (const k of keys) if (k in obj) o[k] = obj[k]; return o; }

// ---- preferences (localStorage only; never board data) ----
const PREF_KEY = 'boardwise.prefs.v1';
export const DEFAULT_PREFS = {
  theme: 'system', lang: 'auto', penColor: '#1b1b1f', penWidth: 3, highlighterColor: '#e0a800',
  background: 'dots', snap: false, toolbarCollapsed: false, sort: 'updated', author: '',
  shapeFill: '#ffffff', shapeStroke: '#1b1b1f', stickyColor: 'yellow', minimap: true, seenWelcome: false,
};
export function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage blocked: preferences just won't persist */ }
}
