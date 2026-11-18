// BoardStore: the single source of truth for one open board.
// - Immutable object map (objects[id] replaced on change) so renderers can cache per object.
// - Transient edits (drags, strokes) are folded into ONE history entry on commit.
// - Emits change events so autosave, the minimap and the optional Yjs binding can follow.

import { History, makeTx, applyTx } from './history.js';
import { emptyBoard } from './model.js';

export class BoardStore {
  constructor(board = emptyBoard()) {
    this.meta = { ...board, objects: undefined, order: undefined };
    this.objects = board.objects || {};
    this.order = board.order || [];
    this.history = new History();
    this.listeners = new Set();
    this.changeListeners = new Set();
    this.version = 0;
    this.base = null; // snapshot captured by begin()
    this.selection = new Set();
    this.dirty = false;
  }

  // ---- subscription ----
  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  onChange(fn) { this.changeListeners.add(fn); return () => this.changeListeners.delete(fn); }
  getVersion = () => this.version;

  _emit(kind, detail) {
    this.version++;
    this.dirty = true;
    for (const fn of this.changeListeners) fn(kind, detail);
    for (const fn of this.listeners) fn();
  }

  state() { return { objects: this.objects, order: this.order }; }

  get(id) { return this.objects[id]; }
  list() { return this.order.map((id) => this.objects[id]).filter(Boolean); }
  get size() { return this.order.length; }

  // ---- low-level mutation (no history) ----
  _set(patch) {
    // patch: { set?: {id: obj}, remove?: [ids], order?: [ids] }
    let objects = this.objects;
    let order = this.order;
    if (patch.set) {
      objects = { ...objects };
      let appended = null;
      for (const [id, o] of Object.entries(patch.set)) {
        if (!objects[id]) (appended ||= []).push(id);
        objects[id] = o;
      }
      if (appended) order = [...order, ...appended];
    }
    if (patch.remove && patch.remove.length) {
      if (objects === this.objects) objects = { ...objects };
      const rm = new Set(patch.remove);
      for (const id of rm) delete objects[id];
      order = order.filter((id) => !rm.has(id));
      for (const id of rm) this.selection.delete(id);
    }
    if (patch.order) order = patch.order.filter((id) => objects[id]);
    this.objects = objects;
    this.order = order;
  }

  // ---- transactions ----
  /** Begin a gesture. Edits until commit() collapse into one undo step. */
  begin() {
    if (!this.base) this.base = this.state();
  }

  /** Apply a patch. With an open gesture it is transient; otherwise it is its own undo step. */
  apply(patch, label = 'Edit') {
    const standalone = !this.base;
    const before = this.state();
    this._set(patch);
    if (standalone) {
      this.history.push(makeTx(label, before, this.state()));
    }
    this._emit('patch', patch);
  }

  commit(label = 'Edit') {
    if (!this.base) return;
    const tx = makeTx(label, this.base, this.state());
    this.base = null;
    if (tx) this.history.push(tx);
    this._emit('commit', tx);
  }

  /** Abort an open gesture and restore the pre-gesture state. */
  cancel() {
    if (!this.base) return;
    this.objects = this.base.objects;
    this.order = this.base.order;
    this.base = null;
    this._emit('cancel');
  }

  // ---- convenience ----
  add(objs, label = 'Add') {
    const arr = Array.isArray(objs) ? objs : [objs];
    const set = {};
    for (const o of arr) set[o.id] = o;
    this.apply({ set }, label);
  }

  update(id, changes, label = 'Edit') {
    const o = this.objects[id];
    if (!o) return;
    this.apply({ set: { [id]: { ...o, ...changes } } }, label);
  }

  updateMany(map, label = 'Edit') {
    const set = {};
    for (const [id, ch] of Object.entries(map)) {
      const o = this.objects[id];
      if (o) set[id] = { ...o, ...ch };
    }
    this.apply({ set }, label);
  }

  remove(ids, label = 'Delete') {
    this.apply({ remove: [...ids] }, label);
  }

  // ---- undo/redo ----
  undo() {
    if (this.base) this.commit('Edit');
    const r = this.history.undo(this.state());
    if (!r) return null;
    this.objects = r.state.objects;
    this.order = r.state.order;
    this._prune();
    this._emit('undo', r.tx);
    return r.tx;
  }
  redo() {
    if (this.base) this.commit('Edit');
    const r = this.history.redo(this.state());
    if (!r) return null;
    this.objects = r.state.objects;
    this.order = r.state.order;
    this._prune();
    this._emit('redo', r.tx);
    return r.tx;
  }
  _prune() {
    for (const id of [...this.selection]) if (!this.objects[id]) this.selection.delete(id);
  }

  // ---- replace whole board (load / restore / sync) ----
  load(board) {
    this.meta = { ...board, objects: undefined, order: undefined };
    this.objects = board.objects || {};
    this.order = board.order || [];
    this.selection = new Set();
    this.base = null;
    this._emit('load');
    this.dirty = false;
  }

  /** Remote/CRDT patches: applied without history. */
  applyRemote(patch) {
    this._set(patch);
    this._emit('remote', patch);
  }

  // ---- serialisation ----
  snapshot() {
    return {
      ...this.meta,
      objects: this.objects,
      order: this.order,
    };
  }

  /** Update bookkeeping fields (e.g. updatedAt) without notifying listeners. */
  touch(changes) { this.meta = { ...this.meta, ...changes }; }

  setMeta(changes) {
    this.meta = { ...this.meta, ...changes };
    this._emit('meta', changes);
  }
}

export { applyTx };
