import { describe, it, expect } from 'vitest';
import en from '../src/i18n/en.js';
import es from '../src/i18n/es.js';
import fr from '../src/i18n/fr.js';
import de from '../src/i18n/de.js';
import pt from '../src/i18n/pt.js';
import hi from '../src/i18n/hi.js';
import ar from '../src/i18n/ar.js';
import he from '../src/i18n/he.js';
import { LANGS, makeT } from '../src/i18n/index.js';

const packs = { es, fr, de, pt, hi, ar, he };
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

describe('i18n', () => {
  for (const [code, pack] of Object.entries(packs)) {
    describe(code, () => {
      it('only uses keys that exist in English', () => {
        const unknown = Object.keys(pack).filter((k) => !(k in en));
        expect(unknown).toEqual([]);
      });
      it('keeps {placeholders} identical to English', () => {
        const bad = Object.keys(pack).filter((k) => ph(pack[k]) !== ph(en[k]));
        expect(bad).toEqual([]);
      });
      it('has no empty strings and covers the core UI (>=100 keys)', () => {
        expect(Object.values(pack).every((v) => typeof v === 'string' && v.trim())).toBe(true);
        expect(Object.keys(pack).length).toBeGreaterThanOrEqual(100);
      });
    });
  }
  it('declares rtl for Arabic and Hebrew only', () => {
    const rtl = LANGS.filter((l) => l.dir === 'rtl').map((l) => l.code).sort();
    expect(rtl).toEqual(['ar', 'he']);
  });
  it('falls back to English for missing keys', () => {
    const t = makeT({ 'common.ok': 'X' }, en);
    expect(t('common.ok')).toBe('X');
    expect(t('common.cancel')).toBe('Cancel');
  });
});
