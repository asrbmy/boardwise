// Clipboard payloads for copying objects between boards/tabs. A marker prefix lets paste
// tell Boardwise data apart from ordinary text. Everything pasted is re-validated.
import { normaliseObject } from './serialize.js';

const MARK = 'boardwise/objects:v1:';
let memory = null; // same-tab fast path (also survives clipboard permission problems)

export function packObjects(objs) {
  const payload = MARK + JSON.stringify(objs);
  memory = payload;
  return payload;
}

export function unpackObjects(text) {
  const src = typeof text === 'string' && text.startsWith(MARK) ? text : null;
  if (!src) return null;
  try {
    const arr = JSON.parse(src.slice(MARK.length));
    if (!Array.isArray(arr) || arr.length > 5000) return null;
    const out = arr.map(normaliseObject).filter(Boolean);
    return out.length ? out : null;
  } catch { return null; }
}

export const memoryClipboard = () => memory;
export const isBoardwiseClip = (t) => typeof t === 'string' && t.startsWith(MARK);
