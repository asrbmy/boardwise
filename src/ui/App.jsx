import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Storage, loadPrefs, savePrefs } from '../core/storage.js';
import { LANGS, dirOf, loadLang, makeT, pickLang, registerLoaders } from '../i18n/index.js';
import { AppCtx, Toasts } from './common.jsx';
import Home from './Home.jsx';
import Board from './Board.jsx';
import en from '../i18n/en.js';

registerLoaders({
  es: () => import('../i18n/es.js'), fr: () => import('../i18n/fr.js'), de: () => import('../i18n/de.js'),
  pt: () => import('../i18n/pt.js'), hi: () => import('../i18n/hi.js'), ar: () => import('../i18n/ar.js'), he: () => import('../i18n/he.js'),
});

function parseRoute(hash) {
  const m = /^#\/b\/([\w-]{1,64})/.exec(hash);
  if (m) return { name: 'board', id: m[1] };
  return { name: 'home' };
}

export default function App() {
  const [storage, setStorage] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [dict, setDict] = useState(en);
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [toasts, setToasts] = useState([]);
  const [live, setLive] = useState('');
  const [sysDark, setSysDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const toastId = useRef(0);

  const lang = pickLang(prefs.lang);
  const theme = prefs.theme === 'system' ? (sysDark ? 'dark' : 'light') : prefs.theme;
  const t = useMemo(() => makeT(dict), [dict]);

  useEffect(() => { Storage.open().then(setStorage); }, []);
  useEffect(() => { const h = () => setRoute(parseRoute(location.hash)); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  useEffect(() => { const mq = matchMedia('(prefers-color-scheme: dark)'); const h = (e) => setSysDark(e.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, []);
  useEffect(() => { let live = true; loadLang(lang).then((d) => live && setDict(d)); return () => { live = false; }; }, [lang]);
  useEffect(() => {
    const r = document.documentElement;
    r.lang = lang; r.dir = dirOf(lang); r.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121317' : '#1f4fd8');
  }, [lang, theme]);
  useEffect(() => { document.title = t('app.name'); }, [t]);
  useEffect(() => { const h = () => toast(t('status.offlineReady')); addEventListener('bw-offline-ready', h); return () => removeEventListener('bw-offline-ready', h); });

  const setPref = useCallback((k, v) => setPrefs((p) => { const n = { ...p, [k]: v }; savePrefs(n); return n; }), []);
  const toast = useCallback((msg, opts = {}) => {
    const id = ++toastId.current;
    setToasts((l) => [...l.slice(-3), { id, msg, ...opts }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), opts.kind === 'error' ? 9000 : 5000);
  }, []);
  const dismiss = useCallback((id) => setToasts((l) => l.filter((x) => x.id !== id)), []);
  const announce = useCallback((msg) => { setLive(''); setTimeout(() => setLive(msg), 30); }, []);
  const navigate = useCallback((path) => { location.hash = path; }, []);

  useEffect(() => {
    if (!storage) return undefined;
    return storage.onError(() => toast(t('error.storage'), { kind: 'error' }));
  }, [storage, t, toast]);

  const ctx = useMemo(() => ({ storage, prefs, setPref, t, lang, theme, toast, announce, navigate, langs: LANGS }), [storage, prefs, setPref, t, lang, theme, toast, announce, navigate]);

  if (!storage) return <div role="status" style={{ padding: 24 }}>…</div>;
  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('app.skip')}</a>
        {!storage.persistent && <div className="banner" role="alert">{t('status.memory')}</div>}
        <main id="main" tabIndex={-1} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}>
          {route.name === 'board' ? <Board key={route.id} id={route.id} /> : <Home />}
        </main>
        <div className="sr-only" aria-live="polite" aria-atomic="true" id="live-region">{live}</div>
        <Toasts toasts={toasts} dismiss={dismiss} />
      </div>
    </AppCtx.Provider>
  );
}
