// Pure undo/redo over transactions. A transaction records, per object id, the
// object before and after (undefined = absent), plus z-order before/after if it changed.
// Nothing here touches the DOM or storage, so it is trivially testable.

export function makeTx(label, base, next) {
  const changes = {};
  const ids = new Set([...Object.keys(base.objects), ...Object.keys(next.objects)]);
  for (const id of ids) {
    if (base.objects[id] !== next.objects[id]) changes[id] = [base.objects[id], next.objects[id]];
  }
  const orderChanged = !sameArray(base.order, next.order);
  if (!orderChanged && Object.keys(changes).length === 0) return null;
  return {
    label,
    time: Date.now(),
    changes,
    orderBefore: orderChanged ? base.order : undefined,
    orderAfter: orderChanged ? next.order : undefined,
  };
}

export function applyTx(state, tx, dir) {
  const objects = { ...state.objects };
  for (const [id, pair] of Object.entries(tx.changes)) {
    const v = dir === 'undo' ? pair[0] : pair[1];
    if (v === undefined) delete objects[id];
    else objects[id] = v;
  }
  let order = state.order;
  if (tx.orderBefore) order = dir === 'undo' ? tx.orderBefore : tx.orderAfter;
  // Guard: order must only reference existing objects and include all of them.
  order = order.filter((id) => objects[id]);
  if (order.length !== Object.keys(objects).length) {
    const seen = new Set(order);
    for (const id of Object.keys(objects)) if (!seen.has(id)) order.push(id);
  }
  return { objects, order };
}

export class History {
  constructor(limit = Infinity) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
  }
  push(tx) {
    if (!tx) return;
    this.undoStack.push(tx);
    this.redoStack = [];
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo(state) {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.redoStack.push(tx);
    return { tx, state: applyTx(state, tx, 'undo') };
  }
  redo(state) {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.undoStack.push(tx);
    return { tx, state: applyTx(state, tx, 'redo') };
  }
  toJSON() { return { undo: this.undoStack, redo: this.redoStack }; }
  static fromJSON(data, limit = Infinity) {
    const h = new History(limit);
    if (data && Array.isArray(data.undo) && Array.isArray(data.redo)) {
      h.undoStack = data.undo.filter(validTx);
      h.redoStack = data.redo.filter(validTx);
    }
    return h;
  }
}

function validTx(tx) {
  return tx && typeof tx === 'object' && tx.changes && typeof tx.changes === 'object';
}

function sameArray(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
