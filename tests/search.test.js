import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/core/store.js';
import { makers } from '../src/core/model.js';
import { searchBoard, snippet, fold } from '../src/core/search.js';
import { score, formatKeys, SHORTCUTS } from '../src/core/commands.js';

describe('search', () => {
  const mk = () => {
    const s = new BoardStore();
    s.add([
      makers.sticky(300, 0, 'blue', { text: 'Café plan' }), makers.sticky(0, 0, 'blue', { text: 'Plan B' }), makers.sticky(0, 400, 'blue', { text: 'unrelated' }),
      makers.frame(0, 800, 100, 100, 'Planning'), makers.checklist(0, 0, [{ text: 'make plan', done: false }]),
      makers.table(0, 1000, 1, 2, { cells: [['x', 'The PLAN']] }),
    ]);
    return s;
  };
  it('finds text across all object types, ignoring case and accents, in reading order', () => {
    const r = searchBoard(mk(), 'PLAN');
    expect(r.length).toBe(5);
    expect(r.some((x) => x.text === 'unrelated')).toBe(false);
    expect(searchBoard(mk(), 'cafe')[0].text).toBe('Café plan');
    const ys = r.map((x) => x.y); expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });
  it('empty or no-match queries return nothing', () => {
    expect(searchBoard(mk(), '   ')).toEqual([]);
    expect(searchBoard(mk(), 'zzz')).toEqual([]);
  });
  it('snippets keep the match and trim long text', () => {
    const long = 'a'.repeat(100) + 'NEEDLE' + 'b'.repeat(100);
    const sn = snippet(long, 100, 6);
    expect(sn.match).toBe('NEEDLE'); expect(sn.before.startsWith('…')).toBe(true); expect(sn.after.endsWith('…')).toBe(true);
    expect(sn.before.length).toBeLessThan(45);
  });
  it('fold strips diacritics', () => { expect(fold('Éñ')).toBe('en'); });
});

describe('command helpers', () => {
  it('fuzzy score needs every word', () => {
    expect(score('Bring to front', 'front bring')).toBeGreaterThan(0);
    expect(score('Bring to front', 'xyz')).toBe(-1);
    expect(score('Pen', '')).toBe(0);
    expect(score('Pen tool', 'pen')).toBeGreaterThan(score('Open file', 'pen'));
  });
  it('formats modifier keys per platform', () => {
    expect(formatKeys('Mod+Shift+Z', false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(formatKeys('Mod+Shift+Z', true)).toEqual(['⌘', '⇧', 'Z']);
  });
  it('every shortcut id is unique', () => { const ids = SHORTCUTS.map((s) => s.id); expect(new Set(ids).size).toBe(ids.length); });
});
