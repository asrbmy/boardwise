import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, Dialog, ConfirmDialog, MenuButton, MenuItem, fmtDate } from './common.jsx';
import Icon from './Icon.jsx';
import { emptyBoard, uid } from '../core/model.js';
import { TEMPLATES, buildTemplate } from '../core/templates.js';
import { exportBackupJSON, parseImport } from '../core/serialize.js';
import { LIMITS, ImportError } from '../core/sanitize.js';
import { downloadBlob, readFileText } from '../export/files.js';
import SyncDialog from './SyncDialog.jsx';

export default function Home() {
  const { storage, t, lang, navigate, toast, prefs, setPref, langs, announce } = useApp();
  const [boards, setBoards] = useState(null);
  const [folders, setFolders] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | fav | recent | folder:<name>
  const [dlg, setDlg] = useState(null);
  const importRef = useRef(null);
  const restoreRef = useRef(null);

  const refresh = useCallback(async () => {
    setBoards(await storage.listBoards());
    setFolders(await storage.getFolders());
  }, [storage]);
  useEffect(() => { refresh(); }, [refresh]);

  const allFolders = useMemo(() => [...new Set([...folders, ...(boards || []).map((b) => b.folder).filter(Boolean)])].sort((a, b) => a.localeCompare(b, lang)), [folders, boards, lang]);

  const list = useMemo(() => {
    if (!boards) return [];
    let l = boards;
    if (filter === 'fav') l = l.filter((b) => b.favourite);
    else if (filter === 'recent') l = [...l].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 8);
    else if (filter.startsWith('folder:')) l = l.filter((b) => b.folder === filter.slice(7));
    const needle = q.trim().toLowerCase();
    if (needle) l = l.filter((b) => b.name.toLowerCase().includes(needle));
    const by = prefs.sort;
    const cmp = { updated: (a, b) => b.updatedAt - a.updatedAt, created: (a, b) => b.createdAt - a.createdAt, name: (a, b) => a.name.localeCompare(b.name, lang), opened: (a, b) => b.lastOpened - a.lastOpened }[by] || ((a, b) => b.updatedAt - a.updatedAt);
    return filter === 'recent' ? l : [...l].sort(cmp);
  }, [boards, filter, q, prefs.sort, lang]);

  const create = async (templateId = 'blank') => {
    const b = buildTemplate(templateId, { name: templateId === 'blank' ? t('common.untitled') : t('tpl.' + templateId), t });
    b.settings = { ...b.settings, background: prefs.background };
    if (filter.startsWith('folder:')) b.folder = filter.slice(7);
    await storage.saveBoard(b);
    navigate(`#/b/${b.id}`);
  };

  const duplicate = async (summary) => {
    const r = await storage.getBoard(summary.id);
    if (!r) return;
    const copy = { ...r.board, id: uid(), name: t('home.copyOf', { name: r.board.name }), createdAt: Date.now(), updatedAt: Date.now(), lastOpened: Date.now() };
    await storage.saveBoard(copy, summary.thumb);
    await refresh();
    announce(t('home.duplicated', { name: copy.name }));
  };

  const remove = async (summary) => { await storage.deleteBoard(summary.id); await refresh(); announce(t('home.deleted', { name: summary.name })); };
  const rename = async (summary, name) => { await storage.patchSummary(summary.id, { name: name.trim() || t('common.untitled') }); await refresh(); };
  const toggleFav = async (summary) => { await storage.patchSummary(summary.id, { favourite: !summary.favourite }); await refresh(); };
  const moveTo = async (summary, folder) => { if (folder) await storage.putFolders([...new Set([...folders, folder])]); await storage.patchSummary(summary.id, { folder }); await refresh(); };

  const importJSON = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      if (file.size > LIMITS.jsonBytes) throw new ImportError(t('error.tooLarge'));
      const { boards: bs } = parseImport(await readFileText(file));
      for (const b of bs) { b.id = uid(); b.lastOpened = Date.now(); await storage.saveBoard(b); }
      await refresh();
      toast(t('import.done', { n: bs.length }));
      if (bs.length === 1) navigate(`#/b/${bs[0].id}`);
    } catch (err) { toast(err instanceof ImportError ? err.message : t('error.generic'), { kind: 'error' }); }
  };

  const backupAll = async () => {
    const all = await storage.allBoards();
    downloadBlob(new Blob([exportBackupJSON(all)], { type: 'application/json' }), `boardwise-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast(t('backup.done', { n: all.length }));
  };

  const restore = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      if (file.size > LIMITS.backupBytes) throw new ImportError(t('error.tooLarge'));
      const parsed = parseImport(await readFileText(file), { maxBytes: LIMITS.backupBytes });
      setDlg({ type: 'restore', parsed });
    } catch (err) { toast(err instanceof ImportError ? err.message : t('error.generic'), { kind: 'error' }); }
  };

  const doRestore = async (parsed, mode) => {
    const existing = new Set((boards || []).map((b) => b.id));
    let added = 0, replaced = 0, skipped = 0;
    for (const b of parsed.boards) {
      if (existing.has(b.id)) {
        if (mode === 'replace') { await storage.saveBoard(b); replaced++; }
        else if (mode === 'copy') { await storage.saveBoard({ ...b, id: uid(), name: t('home.copyOf', { name: b.name }) }); added++; }
        else skipped++;
      } else { await storage.saveBoard(b); added++; }
    }
    await refresh();
    toast(t('restore.done', { added, replaced, skipped }));
  };

  return (
    <div className="home" data-testid="home">
      <div className="home-head">
        <h1>{t('app.name')}</h1>
        <span className="muted grow">{t('app.tagline')}</span>
        <MenuButton label={t('settings.title')} icon="settings" menuClass="home-menu">
          <div className="heading">{t('settings.theme')}</div>
          {['system', 'light', 'dark'].map((th) => <MenuItem key={th} role="menuitemradio" aria-checked={prefs.theme === th} icon={prefs.theme === th ? 'check' : undefined} onClick={() => setPref('theme', th)}>{t('theme.' + th)}</MenuItem>)}
          <hr />
          <div className="heading">{t('settings.language')}</div>
          {langs.map((l) => <MenuItem key={l.code} role="menuitemradio" aria-checked={(prefs.lang === 'auto' ? lang : prefs.lang) === l.code} icon={lang === l.code ? 'check' : undefined} onClick={() => setPref('lang', l.code)} lang={l.code}>{l.name}</MenuItem>)}
          <hr />
          <MenuItem icon="download" onClick={backupAll}>{t('backup.all')}</MenuItem>
          <MenuItem icon="upload" onClick={() => restoreRef.current?.click()}>{t('backup.restore')}</MenuItem>
          <MenuItem icon="upload" onClick={() => importRef.current?.click()}>{t('import.board')}</MenuItem>
          <MenuItem icon="folder" onClick={() => setDlg({ type: 'sync' })} data-testid="menu-sync">{t('sync.title')}</MenuItem>
        </MenuButton>
        <button className="btn primary" onClick={() => create('blank')} data-testid="new-board"><Icon name="plus" />{t('home.new')}</button>
      </div>
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importJSON} aria-label={t('import.board')} />
      <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={restore} aria-label={t('backup.restore')} />

      <section aria-labelledby="tpl-h" style={{ marginBottom: 22 }}>
        <h2 id="tpl-h" style={{ fontSize: 15, margin: '0 0 8px' }}>{t('home.templates')}</h2>
        <div className="templates">
          {TEMPLATES.map((tp) => (
            <button key={tp.id} className="template" onClick={() => create(tp.id)} data-template={tp.id}>
              <strong>{t('tpl.' + tp.id)}</strong><span>{t('tpl.' + tp.id + '.desc')}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="home-tools">
        <label className="sr-only" htmlFor="board-search">{t('home.search')}</label>
        <input id="board-search" className="input" type="search" placeholder={t('home.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr-only" htmlFor="board-sort">{t('home.sort')}</label>
        <select id="board-sort" className="select" style={{ width: 'auto' }} value={prefs.sort} onChange={(e) => setPref('sort', e.target.value)}>
          {['updated', 'created', 'opened', 'name'].map((s) => <option key={s} value={s}>{t('sort.' + s)}</option>)}
        </select>
        <button className="btn" onClick={() => setDlg({ type: 'folder' })}><Icon name="folder" />{t('home.newFolder')}</button>
      </div>
      <div className="chips" role="group" aria-label={t('home.filter')} style={{ marginBottom: 16 }}>
        {[['all', t('common.all')], ['fav', t('home.favourites')], ['recent', t('home.recent')], ...allFolders.map((f) => [`folder:${f}`, f])].map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {boards && list.length === 0 && (
        <div className="empty" role="status"><p style={{ margin: '0 0 12px' }}>{boards.length ? t('home.noMatch') : t('home.empty')}</p>{!boards.length && <button className="btn primary" onClick={() => create('blank')}>{t('home.new')}</button>}</div>
      )}
      <ul className="cards list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {list.map((b) => (
          <li key={b.id} className="card" data-board={b.id}>
            <button className="thumb" onClick={() => navigate(`#/b/${b.id}`)} aria-label={t('home.open', { name: b.name })}>
              {b.thumb ? <img src={b.thumb} alt="" /> : <span>{t('home.emptyBoard')}</span>}
            </button>
            <div className="meta">
              <span className="title" title={b.name}>{b.name}</span>
              <span className="sub">{t('home.objects', { n: b.count })} · {fmtDate(b.updatedAt, lang)}{b.folder ? ` · ${b.folder}` : ''}</span>
            </div>
            <div className="actions">
              <button className="btn icon-only" onClick={() => toggleFav(b)} aria-pressed={b.favourite} aria-label={t(b.favourite ? 'home.unfavourite' : 'home.favourite', { name: b.name })}><Icon name="star2" filled={b.favourite} /></button>
              <MenuButton label={t('home.actions', { name: b.name })} icon="more" className="btn icon-only">
                <MenuItem icon="text" onClick={() => setDlg({ type: 'rename', b })}>{t('common.rename')}</MenuItem>
                <MenuItem icon="copy" onClick={() => duplicate(b)}>{t('common.duplicate')}</MenuItem>
                <MenuItem icon="folder" onClick={() => setDlg({ type: 'move', b })}>{t('home.moveTo')}</MenuItem>
                <MenuItem icon="trash" onClick={() => setDlg({ type: 'delete', b })}>{t('common.delete')}</MenuItem>
              </MenuButton>
            </div>
          </li>
        ))}
      </ul>

      {dlg?.type === 'rename' && <RenameDialog b={dlg.b} onClose={() => setDlg(null)} onSave={(n) => rename(dlg.b, n)} />}
      {dlg?.type === 'delete' && <ConfirmDialog title={t('home.deleteTitle')} message={t('home.deleteMsg', { name: dlg.b.name })} onConfirm={() => remove(dlg.b)} onClose={() => setDlg(null)} />}
      {dlg?.type === 'folder' && <NameDialog title={t('home.newFolder')} label={t('common.name')} onClose={() => setDlg(null)} onSave={async (n) => { await storage.putFolders([...new Set([...folders, n.trim().slice(0, 80)])]); await refresh(); setFilter(`folder:${n.trim().slice(0, 80)}`); }} />}
      {dlg?.type === 'sync' && <SyncDialog onClose={() => setDlg(null)} onChanged={refresh} />}
      {dlg?.type === 'move' && <MoveDialog b={dlg.b} folders={allFolders} onClose={() => setDlg(null)} onMove={(f) => moveTo(dlg.b, f)} />}
      {dlg?.type === 'restore' && <RestoreDialog parsed={dlg.parsed} existing={new Set((boards || []).map((x) => x.id))} onClose={() => setDlg(null)} onRestore={(m) => doRestore(dlg.parsed, m)} />}
    </div>
  );
}

function NameDialog({ title, label, initial = '', onClose, onSave }) {
  const { t } = useApp();
  const [v, setV] = useState(initial);
  const submit = (e) => { e.preventDefault(); if (!v.trim()) return; onSave(v); onClose(); };
  return (
    <Dialog title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" form="name-form" type="submit" disabled={!v.trim()}>{t('common.save')}</button></>}>
      <form id="name-form" onSubmit={submit}>
        <label className="field">{label}<input className="input" value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} maxLength={120} data-autofocus /></label>
      </form>
    </Dialog>
  );
}
const RenameDialog = ({ b, onClose, onSave }) => { const { t } = useApp(); return <NameDialog title={t('common.rename')} label={t('common.name')} initial={b.name} onClose={onClose} onSave={onSave} />; };

function MoveDialog({ b, folders, onClose, onMove }) {
  const { t } = useApp();
  return (
    <Dialog title={t('home.moveTo')} onClose={onClose}>
      <div className="chips">
        <button className="chip" aria-pressed={!b.folder} onClick={() => { onMove(''); onClose(); }}>{t('home.noFolder')}</button>
        {folders.map((f) => <button key={f} className="chip" aria-pressed={b.folder === f} onClick={() => { onMove(f); onClose(); }}>{f}</button>)}
      </div>
    </Dialog>
  );
}

function RestoreDialog({ parsed, existing, onClose, onRestore }) {
  const { t } = useApp();
  const [mode, setMode] = useState('copy');
  const clashes = parsed.boards.filter((b) => existing.has(b.id)).length;
  const dropped = parsed.boards.reduce((s, b) => s + (b.dropped || 0), 0);
  return (
    <Dialog title={t('backup.restore')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={() => { onRestore(mode); onClose(); }}>{t('common.restore')}</button></>}>
      <p style={{ margin: 0 }}>{t('restore.summary', { n: parsed.boards.length, clashes })}</p>
      {dropped > 0 && <p role="alert" style={{ margin: 0, color: 'var(--warn)' }}>{t('restore.dropped', { n: dropped })}</p>}
      {clashes > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="muted" style={{ marginBottom: 6 }}>{t('restore.clash')}</legend>
          {[['copy', t('restore.asCopy')], ['replace', t('restore.replace')], ['skip', t('restore.skip')]].map(([k, l]) => (
            <label key={k} className="row"><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} /> {l}</label>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
