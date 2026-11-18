import en from './en.js';

export const LANGS = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'pt', name: 'Português', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'he', name: 'עברית', dir: 'rtl' },
];

const loaders = {};
const dicts = { en };

export function pickLang(pref, nav = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : ['en']) {
  if (pref && pref !== 'auto' && LANGS.some((l) => l.code === pref)) return pref;
  for (const n of nav || []) {
    const c = String(n).toLowerCase().split('-')[0];
    if (LANGS.some((l) => l.code === c)) return c;
  }
  return 'en';
}

export const dirOf = (code) => LANGS.find((l) => l.code === code)?.dir || 'ltr';

export function makeT(dict) {
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  };
}

/** Languages are separate chunks so only the active one is downloaded (and all are precached for offline). */
export async function loadLang(code) {
  if (dicts[code]) return dicts[code];
  const mod = await (loaders[code]?.() ?? Promise.resolve({ default: en }));
  dicts[code] = { ...en, ...mod.default };
  return dicts[code];
}

export function registerLoaders(map) { Object.assign(loaders, map); }
