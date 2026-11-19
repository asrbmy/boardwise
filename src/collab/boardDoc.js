// Yjs binding for one BoardStore (OPTIONAL peer-to-peer collaboration).
//
// Model: Y.Map "objects" (id -> plain JSON object, replaced atomically per object) and Y.Map "z"
// (id -> number, the stacking position). Last-writer-wins per object; deletes win over concurrent
// edits of the same object. Remote data is NEVER trusted: every object is rebuilt through
// normaliseObject() before it touches the store.
import * as Y from 'yjs';
import { normaliseObject } from '../core/serialize.js';

const LOCAL = Symbol('local');
const MAX_REMOTE_OBJECTS = 20000; // a peer cannot make this board unmanageably large

export class BoardDoc {
  constructor(store) {
    this.store = store;
    this.doc = new Y.Doc();
    this.objects = this.doc.getMap('objects');
    this.z = this.doc.getMap('z');
    this.last = new Map(); // id -> object reference last mirrored to/from the doc
    this.lastOrder = '';
    this.updateListeners = new Set();
    this.applying = false;

    // Seed from the local board (first peer to join also merges its objects; ids are unique so this is a union).
    this.pushLocal();
    this.doc.on('update', (u, origin) => { for (const fn of this.updateListeners) fn(u, origin); });
    this.objects.observe((ev, tr) => { if (tr.origin === LOCAL) return; this.pullRemote(ev); });
    this.z.observe((ev, tr) => { if (tr.origin === LOCAL) return; this.pullRemote(null); });
    this.offStore = store.onChange((kind) => { if (kind !== 'remote' && !this.applying) this.pushLocal(); });
  }

  onUpdate(fn) { this.updateListeners.add(fn); return () => this.updateListeners.delete(fn); }
  destroy() { this.offStore?.(); this.doc.destroy(); }

  /** Mirror local changes (by object identity) into the doc. */
  pushLocal() {
    const { objects, order } = this.store;
    this.doc.transact(() => {
      for (const id of order) {
        const o = objects[id];
        if (this.last.get(id) !== o) { this.objects.set(id, o); this.last.set(id, o); }
      }
      for (const id of [...this.last.keys()]) {
        if (!objects[id]) { this.objects.delete(id); this.z.delete(id); this.last.delete(id); }
      }
      const key = order.join('|');
      if (key !== this.lastOrder) {
        order.forEach((id, i) => { if (this.z.get(id) !== i) this.z.set(id, i); });
        this.lastOrder = key;
      }
    }, LOCAL);
  }

  /** Rebuild the local store from the doc after remote changes. */
  pullRemote() {
    const next = {};
    let count = 0;
    for (const [id, raw] of this.objects.entries()) {
      if (++count > MAX_REMOTE_OBJECTS) break;
      const prev = this.last.get(id);
      if (prev && JSON.stringify(prev) === JSON.stringify(raw)) { next[id] = prev; continue; }
      const clean = normaliseObject(raw);
      if (clean && clean.id === id) next[id] = clean;
    }
    const ids = Object.keys(next).sort((a, b) => ((this.z.get(a) ?? 1e9) - (this.z.get(b) ?? 1e9)) || (a < b ? -1 : 1));
    const set = {}, remove = [];
    for (const id of ids) if (this.store.objects[id] !== next[id]) set[id] = next[id];
    for (const id of this.store.order) if (!next[id]) remove.push(id);
    this.applying = true;
    try {
      this.store.applyRemote({ set, remove, order: ids });
    } finally { this.applying = false; }
    this.last = new Map(Object.entries(next));
    this.lastOrder = ids.join('|');
  }

  // ---- wire helpers ----
  stateVector() { return Y.encodeStateVector(this.doc); }
  diffSince(sv) { return Y.encodeStateAsUpdate(this.doc, sv); }
  /** `origin` identifies the sender so a relay never echoes an update back to it (star topology with several guests). */
  applyUpdate(u, origin = 'remote') { Y.applyUpdate(this.doc, u, origin); }
}
