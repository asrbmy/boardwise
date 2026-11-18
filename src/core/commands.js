// Command list for the palette and shortcuts dialog. Single source of truth for shortcut labels.
export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** id → { key text for display, group } ; labels come from i18n (`cmd.<id>`). */
export const SHORTCUTS = [
  { id: 'tool.select', keys: 'V', group: 'tools' }, { id: 'tool.hand', keys: 'H', group: 'tools' }, { id: 'tool.pen', keys: 'P', group: 'tools' },
  { id: 'tool.highlighter', keys: 'L', group: 'tools' }, { id: 'tool.eraser', keys: 'E', group: 'tools' }, { id: 'tool.sticky', keys: 'N', group: 'tools' },
  { id: 'tool.text', keys: 'T', group: 'tools' }, { id: 'tool.rect', keys: 'R', group: 'tools' }, { id: 'tool.ellipse', keys: 'O', group: 'tools' },
  { id: 'tool.diamond', keys: 'D', group: 'tools' }, { id: 'tool.arrow', keys: 'A', group: 'tools' }, { id: 'tool.connector', keys: 'C', group: 'tools' },
  { id: 'tool.frame', keys: 'F', group: 'tools' }, { id: 'tool.table', keys: 'B', group: 'tools' }, { id: 'tool.checklist', keys: 'K', group: 'tools' },
  { id: 'tool.stamp', keys: 'S', group: 'tools' }, { id: 'tool.laser', keys: 'Z', group: 'tools' }, { id: 'tool.comment', keys: 'M', group: 'tools' },
  { id: 'tool.image', keys: 'I', group: 'tools' },
  { id: 'undo', keys: 'Mod+Z', group: 'edit' }, { id: 'redo', keys: 'Mod+Shift+Z', group: 'edit' }, { id: 'selectAll', keys: 'Mod+A', group: 'edit' },
  { id: 'duplicate', keys: 'Mod+D', group: 'edit' }, { id: 'copy', keys: 'Mod+C', group: 'edit' }, { id: 'cut', keys: 'Mod+X', group: 'edit' }, { id: 'paste', keys: 'Mod+V', group: 'edit' },
  { id: 'delete', keys: 'Delete', group: 'edit' }, { id: 'group', keys: 'Mod+G', group: 'edit' }, { id: 'ungroup', keys: 'Mod+Shift+G', group: 'edit' }, { id: 'lock', keys: 'Mod+Shift+L', group: 'edit' },
  { id: 'bringFront', keys: 'Mod+]', group: 'edit' }, { id: 'sendBack', keys: 'Mod+[', group: 'edit' }, { id: 'editText', keys: 'Enter', group: 'edit' },
  { id: 'nudge', keys: 'Arrows', group: 'edit' }, { id: 'nudgeBig', keys: 'Shift+Arrows', group: 'edit' }, { id: 'cycle', keys: 'Tab', group: 'edit' }, { id: 'escape', keys: 'Esc', group: 'edit' },
  { id: 'pan', keys: 'Space+Drag', group: 'view' }, { id: 'zoomIn', keys: '+', group: 'view' }, { id: 'zoomOut', keys: '-', group: 'view' }, { id: 'zoom100', keys: '0', group: 'view' },
  { id: 'fit', keys: 'Shift+1', group: 'view' }, { id: 'fitSel', keys: 'Shift+2', group: 'view' },
  { id: 'palette', keys: 'Mod+K', group: 'app' }, { id: 'search', keys: 'Mod+F', group: 'app' }, { id: 'shortcuts', keys: '?', group: 'app' },
];

export function formatKeys(keys, mac = isMac()) {
  return keys.split('+').map((k) => (k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : k === 'Shift' && mac ? '⇧' : k === 'Delete' && mac ? '⌫' : k));
}

/** Fuzzy match: every query word must appear (in order not required). Returns a score or -1. */
export function score(label, query) {
  const l = label.toLowerCase(), words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let s = 0;
  for (const w of words) {
    const i = l.indexOf(w);
    if (i < 0) return -1;
    s += i === 0 ? 3 : l[i - 1] === ' ' ? 2 : 1;
  }
  return s;
}
