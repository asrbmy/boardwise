import 'fake-indexeddb/auto';

// jsdom has no canvas. Text layout only needs measureText, so give it a deterministic stub (8px per character).
const stubCtx = { font: '', measureText: (t) => ({ width: String(t).length * 8 }) };
HTMLCanvasElement.prototype.getContext = function getContext() { return stubCtx; };
