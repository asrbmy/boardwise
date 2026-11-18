import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BoardStore } from '../core/store.js';
import { Engine } from './engine.js';
import { makeThumbnail } from '../export/raster.js';
import { packHistory, unpackHistory, historyMatches } from '../core/historyStore.js';
import { uid } from '../core/model.js';
import { resolveConnector } from '../core/hit.js';
import { runExport } from '../export/run.js';
import { useApp, MenuButton, MenuItem } from './common.jsx';
import Icon from './Icon.jsx';
import Toolbar from './Toolbar.jsx';
import Inspector from './Inspector.jsx';
import Minimap from './Minimap.jsx';
import ExportDialog from './ExportDialog.jsx';
import ImportDialog from './ImportDialog.jsx';
import CollabDialog from './CollabDialog.jsx';
import { CollabSession } from '../collab/session.js';
import { parseImport } from '../core/serialize.js';
import { ImportError, LIMITS } from '../core/sanitize.js';
import { unionRects } from '../core/geometry.js';
import { SearchPanel, NotesPanel, CommentsPanel, CommentPins, RemoteCursors, CommentPopover, TimerPill, TimerDialog, VotingBar, ShortcutsDialog, CommandPalette, PresentMode } from './Panels.jsx';
import { SHORTCUTS } from '../core/commands.js';
import * as TM from '../core/timer.js';

const SAVE_DELAY = 400;

export default function Board({ id }) {
  const app = useApp();
  const { storage, t, navigate } = app;
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await storage.getBoard(id);
      if (dead) return;
      if (!r) { setState({ phase: 'missing' }); return; }
      const hist = unpackHistory(await storage.getHistory(id));
      const store = new BoardStore({ ...r.board, lastOpened: Date.now() });
      if (historyMatches(hist, r.board)) store.history = hist;
      store.touch({ lastOpened: Date.now() });
      setState({ phase: 'ready', store, recovered: r.recovered });
    })();
    return () => { dead = true; };
  }, [id, storage]);

  if (state.phase === 'loading') return <div role="status" style={{ padding: 24 }}>…</div>;
  if (state.phase === 'missing') {
    return (
      <div style={{ padding: 32 }}>
        <p role="alert">{t('error.boardMissing')}</p>
        <button className="btn primary" onClick={() => navigate('#/')}>{t('board.allBoards')}</button>
      </div>
    );
  }
  return <BoardView store={state.store} recovered={state.recovered} />;
}

function BoardView({ store, recovered }) {
  const app = useApp();
  const { storage, t, prefs, setPref, theme, announce, toast, navigate, lang, langs } = app;
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const [status, setStatus] = useState('saved');
  const [dialog, setDialog] = useState(null);
  const [panel, setPanel] = useState(null);           // 'search' | 'notes' | 'comments'
  const [present, setPresent] = useState(false);
  const [timer, setTimer] = useState(null);
  const [voting, setVoting] = useState(false);
  const [commentOpen, setCommentOpen] = useState(null); // comment id
  const [commentDraft, setCommentDraft] = useState(null); // {x,y}
  const commentReq = useRef(null);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(() => matchMedia('(max-width: 860px)').matches);
  const tRef = useRef(t); tRef.current = t;
  const importRef = useRef(null);
  const session = useMemo(() => new CollabSession(store), [store]);
  useEffect(() => () => session.close(), [session]);
  const liveCount = useSyncExternalStore(session.subscribe, () => session.connectedCount);
  const importFiles = (files) => importRef.current?.(files);

  const engine = useMemo(() => {
    const voterId = (() => { try { let v = localStorage.getItem('boardwise.voter'); if (!v) { v = uid(); localStorage.setItem('boardwise.voter', v); } return v; } catch { return 'local'; } })();
    const e = new Engine(store, {
      prefs, voterId, t: (k, v) => tRef.current(k, v),
      announce: (m) => announce(m),
      notify: (kind, data) => {
        if (kind === 'toast') toast(data.msg, { kind: data.kind });
        if (kind === 'open-image') fileRef.current?.click();
        if (kind === 'import-file') importFiles([data]);
        if (kind === 'comment-request') commentReq.current?.(data);
        return false;
      },
    });
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  useEffect(() => {
    if (!liveCount) return undefined;
    const el = canvasRef.current; let last = 0;
    const move = (e) => {
      const now = performance.now(); if (now - last < 50) return; last = now;
      const r = el.getBoundingClientRect(); const w = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      session.setLocal({ x: w.x, y: w.y, name: prefs.author || '' });
    };
    el.addEventListener('pointermove', move);
    return () => el.removeEventListener('pointermove', move);
  }, [liveCount, engine, session, prefs.author]);

  // Route imported files: images/SVG -> image objects, JSON -> objects added to this board, text/CSV -> sticky notes.
  importRef.current = async (files) => {
    for (const f of files) {
      try {
        if (f.type.startsWith('image/')) await engine.insertImageFile(f, engine.viewCenter());
        else if (/\.json$/i.test(f.name) || f.type === 'application/json') {
          if (f.size > LIMITS.jsonBytes) throw new ImportError(t('error.tooLarge'));
          const { kind, boards } = parseImport(await f.text());
          if (kind === 'backup') { toast(t('import.useRestore'), { kind: 'error' }); continue; }
          const objs = boards[0].order.map((id) => boards[0].objects[id]);
          if (!objs.length) { toast(t('import.nothing')); continue; }
          engine.pasteObjects(objs, engine.viewCenter());
          engine.fitContent([...store.selection]);
          toast(t('import.added', { n: objs.length }));
        } else if (f.type.startsWith('text/') || /\.(csv|tsv|txt|md)$/i.test(f.name)) {
          if (f.size > 2e6) throw new ImportError(t('error.tooLarge'));
          engine.pasteText(await f.text(), engine.viewCenter());
        } else toast(t('error.unsupported', { name: f.name }), { kind: 'error' });
      } catch (err) { toast(err instanceof ImportError ? err.message : t('error.generic'), { kind: 'error' }); }
    }
  };

  // ----- attach engine to the canvas -----
  useEffect(() => {
    engine.attach(stageRef.current, canvasRef.current);
    if (!store.meta.view || (store.meta.view.x === 0 && store.meta.view.y === 0 && store.meta.view.zoom === 1 && store.size === 0)) engine.resetView();
    else if (store.size) { /* restore saved view */ }
    canvasRef.current.focus({ preventScroll: true });
    // Test/debug hook, enabled only with ?e2e in the URL (never in normal use).
    if (/[?&#]e2e\b/.test(location.href) || localStorage.getItem('boardwise.debug') === '1') window.__bw = { store, engine, resolveConnector, runExport, session };
    return () => { engine.detach(); if (window.__bw?.engine === engine) delete window.__bw; };
  }, [engine, store]);
  useEffect(() => { engine.setTheme(theme); }, [engine, theme]);
  useEffect(() => { engine.t = (k, v) => t(k, v); }, [engine, t]);
  useEffect(() => { engine.requestRender(); }, [engine, store.meta.settings]);

  // ----- autosave -----
  const timers = useRef({ save: null, hist: null, lastThumb: 0, thumbVersion: -1 });
  const saving = useRef(Promise.resolve());
  const doSave = useCallback(() => {
    saving.current = saving.current.then(async () => {
      clearTimeout(timers.current.save); timers.current.save = null;
      try {
        setStatus('saving');
        store.touch({ updatedAt: Date.now() });
        let thumb;
        const now = Date.now();
        if (store.version !== timers.current.thumbVersion && now - timers.current.lastThumb > 5000) {
          try { thumb = (await makeThumbnail(store)) ?? ''; } catch { thumb = undefined; }
          timers.current.lastThumb = now; timers.current.thumbVersion = store.version;
        }
        const snap = store.snapshot();
        await storage.saveBoard(snap, thumb === '' ? null : thumb);
        store.dirty = false;
        setStatus(timers.current.save ? 'unsaved' : 'saved');
      } catch { setStatus('error'); }
    });
    return saving.current;
  }, [store, storage]);
  const saveHistory = useCallback(async () => {
    try { await storage.putHistory(store.meta.id, packHistory(store.history)); } catch { /* reported through storage.onError */ }
  }, [store, storage]);

  useEffect(() => {
    const off = store.onChange((kind) => {
      if (kind === 'patch' && store.base) { setStatus('unsaved'); return; } // mid-gesture: wait for commit
      setStatus('unsaved');
      clearTimeout(timers.current.save);
      timers.current.save = setTimeout(doSave, SAVE_DELAY);
      clearTimeout(timers.current.hist);
      timers.current.hist = setTimeout(saveHistory, 1500);
    });
    const flush = () => { if (timers.current.save) doSave(); if (timers.current.hist) { clearTimeout(timers.current.hist); timers.current.hist = null; saveHistory(); } };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    const onUnload = (e) => {
      flush();
      if (!storage.persistent && store.size > 0) { e.preventDefault(); e.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', onVis);
    addEventListener('pagehide', flush);
    addEventListener('beforeunload', onUnload);
    return () => { off(); flush(); document.removeEventListener('visibilitychange', onVis); removeEventListener('pagehide', flush); removeEventListener('beforeunload', onUnload); };
  }, [store, storage, doSave, saveHistory]);
  useEffect(() => { if (recovered) toast(t('status.recovered')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Boards that were never edited here (templates, imports) have no thumbnail yet: make one once.
  useEffect(() => {
    if (!store.size) return undefined;
    let dead = false;
    const t0 = setTimeout(async () => {
      try {
        const sum = (await storage.listBoards()).find((b) => b.id === store.meta.id);
        if (dead || sum?.thumb) return;
        const thumb = await makeThumbnail(store);
        if (!dead && thumb) await storage.setThumb(store.meta.id, thumb);
      } catch { /* thumbnails are optional */ }
    }, 700);
    return () => { dead = true; clearTimeout(t0); };
  }, [store, storage]);

  // ----- comments (stored on the board, saved with it) -----
  const comments = store.meta.comments || [];
  commentReq.current = (pt) => { setCommentOpen(null); setCommentDraft(pt); engine.setTool('select'); };
  const saveComments = (list) => store.setMeta({ comments: list });
  const addComment = (text) => { const c = { id: uid(), x: commentDraft.x, y: commentDraft.y, text, author: prefs.author || '', time: Date.now(), resolved: false }; saveComments([...comments, c]); setCommentDraft(null); setCommentOpen(c.id); announce(t('comment.added')); };
  const resolveComment = (cid) => saveComments(comments.map((c) => (c.id === cid ? { ...c, resolved: !c.resolved } : c)));
  const deleteComment = (cid) => { saveComments(comments.filter((c) => c.id !== cid)); setCommentOpen(null); announce(t('comment.deleted')); };

  // ----- workshop -----
  const toggleVoting = () => { const on = !voting; setVoting(on); engine.setOpt('voting', on); if (on) engine.setTool('select'); announce(t(on ? 'vote.started' : 'vote.stopped')); };
  const openPanel = (name) => setPanel((p) => (p === name ? null : name));

  // ----- command palette & global shortcuts -----
  const commands = useMemo(() => {
    const c = (id, run, extra = {}) => ({ id, label: t('cmd.' + id), run, keys: SHORTCUTS.find((x) => x.id === id)?.keys, ...extra });
    const hasSel = store.selection.size > 0;
    return [
      ...['select', 'hand', 'pen', 'highlighter', 'eraser', 'sticky', 'text', 'connector', 'frame', 'table', 'checklist', 'stamp', 'laser', 'comment'].map((k) => c('tool.' + k, () => engine.setTool(k), { icon: k === 'sticky' ? 'sticky' : k })),
      ...['rect', 'ellipse', 'diamond', 'arrow'].map((k) => c('tool.' + k, () => engine.setTool('shape', { shapeKind: k }), { icon: k })),
      c('tool.image', () => fileRef.current?.click(), { icon: 'image' }),
      c('undo', () => engine.undo(), { icon: 'undo' }), c('redo', () => engine.redo(), { icon: 'redo' }), c('selectAll', () => engine.selectAll()),
      c('duplicate', () => engine.duplicateSelection(), { enabled: hasSel, icon: 'copy' }), c('delete', () => engine.deleteSelection(), { enabled: hasSel, icon: 'trash' }),
      c('group', () => engine.group(), { enabled: store.selection.size > 1, icon: 'group' }), c('ungroup', () => engine.ungroup(), { enabled: hasSel }),
      c('lock', () => engine.setLocked(true), { enabled: hasSel, icon: 'lock' }), c('unlock', () => engine.setLocked(false), { enabled: hasSel, icon: 'unlock' }),
      c('bringFront', () => engine.order('front'), { enabled: hasSel }), c('sendBack', () => engine.order('back'), { enabled: hasSel }),
      ...['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map((a) => ({ id: 'align.' + a, label: `${t('cmd.align')}: ${t('align.' + a)}`, run: () => engine.align(a), enabled: store.selection.size > 1, icon: 'align' })),
      { id: 'distH', label: t('align.distH'), run: () => engine.distribute('h'), enabled: store.selection.size > 2 }, { id: 'distV', label: t('align.distV'), run: () => engine.distribute('v'), enabled: store.selection.size > 2 },
      c('zoomIn', () => engine.zoomStep(1), { icon: 'plus' }), c('zoomOut', () => engine.zoomStep(-1), { icon: 'minus' }), c('zoom100', () => engine.zoomTo(1)), c('fit', () => engine.fitContent(), { icon: 'fit' }),
      c('fitSel', () => engine.fitContent([...store.selection]), { enabled: hasSel }),
      c('search', () => setPanel('search'), { icon: 'search' }), c('shortcuts', () => setDialog('shortcuts'), { icon: 'keyboard' }),
      { id: 'export', label: t('export.title'), run: () => setDialog('export'), icon: 'download' }, { id: 'import', label: t('import.title'), run: () => setDialog('import'), icon: 'upload' },
      { id: 'present', label: t('present.title'), run: () => setPresent(true), icon: 'present' },
      { id: 'collab', label: t('collab.title'), run: () => setDialog('collab'), icon: 'users' },
      { id: 'timer', label: t('timer.title'), run: () => setDialog('timer'), icon: 'timer' }, { id: 'voting', label: t(voting ? 'vote.stop' : 'vote.title'), run: toggleVoting, icon: 'vote' },
      { id: 'notes', label: t('notes.title'), run: () => setPanel('notes'), icon: 'notes' }, { id: 'comments', label: t('comment.panel'), run: () => setPanel('comments'), icon: 'comment' },
      { id: 'inkToShape', label: `${t('style.inkToShape')}: ${t(engine.opts.inkToShape ? 'common.off' : 'common.on')}`, run: () => engine.setOpt('inkToShape', !engine.opts.inkToShape) },
      { id: 'snap', label: t('board.snap'), run: () => store.setMeta({ settings: { ...store.meta.settings, snap: !store.meta.settings?.snap } }) },
      ...['plain', 'dots', 'grid', 'lines'].map((b) => ({ id: 'bg.' + b, label: `${t('board.background')}: ${t('bg.' + b)}`, run: () => store.setMeta({ settings: { ...store.meta.settings, background: b } }) })),
      ...['system', 'light', 'dark'].map((th) => ({ id: 'theme.' + th, label: `${t('settings.theme')}: ${t('theme.' + th)}`, run: () => setPref('theme', th) })),
      ...langs.map((l) => ({ id: 'lang.' + l.code, label: `${t('settings.language')}: ${l.name}`, run: () => setPref('lang', l.code) })),
      { id: 'home', label: t('board.allBoards'), run: () => navigate('#/'), icon: 'home' },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, engine, store, store.selection.size, voting, langs]);

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el?.closest?.('input,textarea,select,[contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setDialog((d) => (d === 'palette' ? null : 'palette')); return; }
      if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); setPanel('search'); return; }
      if (!typing && !mod && e.key === '?' && !el?.closest?.('[role="dialog"]')) { e.preventDefault(); setDialog('shortcuts'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ----- derived UI -----
  const settings = store.meta.settings || {};
  const setSetting = (k, v) => { store.setMeta({ settings: { ...settings, [k]: v } }); engine.requestRender(); };
  const pct = Math.round(engine.view.zoom * 100);
  const sel = engine.selected();
  const objectsList = useMemo(() => store.list().slice(0, 300), [store.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const rename = (name) => { const n = name.trim() || t('common.untitled'); if (n !== store.meta.name) store.setMeta({ name: n }); };
  const pickImages = async (e) => { for (const f of e.target.files) await engine.insertImageFile(f, engine.viewCenter()); e.target.value = ''; };

  const statusLabel = status === 'saved' ? t('status.saved') : status === 'saving' ? t('status.saving') : status === 'error' ? t('status.error') : t('status.unsaved');

  return (
    <div className={`board-page ${prefs.minimap ? '' : 'minimap-hidden'}`}>
      <header className="topbar">
        <button className="btn ghost icon-only" onClick={() => { navigate('#/'); }} aria-label={t('board.allBoards')} title={t('board.allBoards')}><Icon name="home" /></button>
        <label className="sr-only" htmlFor="board-name">{t('board.name')}</label>
        <input id="board-name" className="name" defaultValue={store.meta.name} key={store.meta.name} onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); canvasRef.current.focus(); } }} maxLength={120} />
        <span className={`save-status ${status}`} role="status"><span className="dot" aria-hidden="true" />{statusLabel}</span>
        {liveCount > 0 && <span className="live-pill" role="status" data-testid="live-pill">{t('collab.live', { n: liveCount })}</span>}
        <span className="grow" />
        <button className="btn ghost icon-only" onClick={() => engine.undo()} disabled={!store.history.canUndo} aria-label={`${t('common.undo')} (Ctrl+Z)`} title={`${t('common.undo')} (Ctrl+Z)`}><Icon name="undo" /></button>
        <button className="btn ghost icon-only" onClick={() => engine.redo()} disabled={!store.history.canRedo} aria-label={`${t('common.redo')} (Ctrl+Shift+Z)`} title={`${t('common.redo')} (Ctrl+Shift+Z)`}><Icon name="redo" /></button>
        <button className="btn ghost icon-only" onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))} aria-pressed={panel === 'search'} aria-label={`${t('search.title')} (Ctrl+F)`} title={`${t('search.title')} (Ctrl+F)`} data-testid="open-search"><Icon name="search" /></button>
        <button className="btn ghost icon-only hide-sm" onClick={() => setDialog('palette')} aria-label={`${t('palette.title')} (Ctrl+K)`} title={`${t('palette.title')} (Ctrl+K)`} data-testid="open-palette"><Icon name="command" /></button>
        <button className="btn ghost icon-only" onClick={() => setPresent(true)} aria-label={t('present.title')} title={t('present.title')} data-testid="open-present"><Icon name="present" /></button>
        <MenuButton label={t('workshop.menu')} icon="users" menuClass="workshop-menu">
          <MenuItem icon="timer" onClick={() => setDialog('timer')} data-testid="menu-timer">{t('timer.title')}</MenuItem>
          <MenuItem icon="vote" role="menuitemcheckbox" aria-checked={voting} onClick={toggleVoting} data-testid="menu-voting">{t(voting ? 'vote.stop' : 'vote.title')}</MenuItem>
          <MenuItem icon="notes" onClick={() => openPanel('notes')} data-testid="menu-notes">{t('notes.title')}</MenuItem>
          <MenuItem icon="comment" onClick={() => openPanel('comments')} data-testid="menu-comments">{t('comment.panel')}</MenuItem>
        </MenuButton>
        <MenuButton label={t('file.menu')} icon="menu" menuClass="file-menu">
          <MenuItem icon="download" onClick={() => setDialog('export')} data-testid="menu-export">{t('export.title')}</MenuItem>
          <MenuItem icon="upload" onClick={() => setDialog('import')} data-testid="menu-import">{t('import.title')}</MenuItem>
          <MenuItem icon="users" onClick={() => setDialog('collab')} data-testid="menu-collab">{t('collab.title')}</MenuItem>
        </MenuButton>
        <MenuButton label={t('board.view')} icon="grid" menuClass="view-menu">
          <div className="heading">{t('board.background')}</div>
          {['plain', 'dots', 'grid', 'lines'].map((b) => <MenuItem key={b} role="menuitemradio" aria-checked={settings.background === b} onClick={() => setSetting('background', b)} icon={settings.background === b ? 'check' : undefined}>{t('bg.' + b)}</MenuItem>)}
          <hr />
          <MenuItem role="menuitemcheckbox" aria-checked={!!settings.snap} icon={settings.snap ? 'check' : undefined} onClick={() => setSetting('snap', !settings.snap)}>{t('board.snap')}</MenuItem>
          <MenuItem role="menuitemcheckbox" aria-checked={prefs.minimap} icon={prefs.minimap ? 'check' : undefined} onClick={() => setPref('minimap', !prefs.minimap)}>{t('board.minimap')}</MenuItem>
          <hr />
          <div className="heading">{t('settings.theme')}</div>
          {['system', 'light', 'dark'].map((th) => <MenuItem key={th} role="menuitemradio" aria-checked={prefs.theme === th} icon={prefs.theme === th ? 'check' : undefined} onClick={() => setPref('theme', th)}>{t('theme.' + th)}</MenuItem>)}
          <hr />
          <div className="heading">{t('settings.language')}</div>
          {langs.map((l) => <MenuItem key={l.code} role="menuitemradio" aria-checked={lang === l.code} icon={lang === l.code ? 'check' : undefined} onClick={() => setPref('lang', l.code)} lang={l.code}>{l.name}</MenuItem>)}
        </MenuButton>
      </header>

      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} tabIndex={0} role="application" aria-label={t('canvas.label')} aria-describedby="canvas-help" data-testid="board-canvas" />
        <p id="canvas-help" className="sr-only">{t('canvas.help')}</p>
        <Toolbar engine={engine} collapsed={toolbarCollapsed} onPickImage={() => fileRef.current?.click()} />
        <button className="btn toolbar-toggle icon-only" aria-expanded={!toolbarCollapsed} aria-label={t('toolbar.toggle')} onClick={() => setToolbarCollapsed((c) => !c)}><Icon name="menu" /></button>
        <Inspector engine={engine} />
        <RemoteCursors engine={engine} session={session} />
        <CommentPins engine={engine} comments={comments} openId={commentOpen} onOpen={(cid) => { setCommentDraft(null); setCommentOpen(cid === commentOpen ? null : cid); }} />
        {commentDraft && <CommentPopover engine={engine} draft={commentDraft} onSave={addComment} onClose={() => setCommentDraft(null)} />}
        {commentOpen && comments.find((c) => c.id === commentOpen) && <CommentPopover engine={engine} comment={comments.find((c) => c.id === commentOpen)} onResolve={resolveComment} onDelete={deleteComment} onClose={() => setCommentOpen(null)} />}
        {timer && <TimerPill timer={timer} setTimer={setTimer} onClose={() => setTimer(null)} />}
        {voting && <VotingBar engine={engine} onClose={toggleVoting} />}
        <div className="corner">
          {prefs.minimap && <Minimap engine={engine} version={engine.uiVersion} />}
          <div className="zoombar" role="group" aria-label={t('zoom.label')}>
            <button className="btn" onClick={() => engine.zoomStep(-1)} aria-label={t('zoom.out')} title={t('zoom.out')}><Icon name="minus" /></button>
            <button className="btn pct" onClick={() => engine.zoomTo(1)} aria-label={t('zoom.reset', { pct })} title={t('zoom.reset', { pct })} data-testid="zoom-pct">{pct}%</button>
            <button className="btn" onClick={() => engine.zoomStep(1)} aria-label={t('zoom.in')} title={t('zoom.in')}><Icon name="plus" /></button>
            <button className="btn" onClick={() => engine.fitContent()} aria-label={t('zoom.fit')} title={`${t('zoom.fit')} (Shift+1)`}><Icon name="fit" /></button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple hidden onChange={pickImages} aria-label={t('tool.image')} />
        <ul className="sr-only" aria-label={t('objects.title')}>
          {objectsList.length === 0 && <li>{t('objects.empty')}</li>}
          {objectsList.map((o) => (
            <li key={o.id}><button tabIndex={-1} onClick={() => engine.jumpTo(o.id)} aria-pressed={store.selection.has(o.id)}>{t('objects.select', { what: engine.describe(o) })}</button></li>
          ))}
        </ul>
      </div>
      <span className="sr-only" data-testid="selection-count">{sel.length}</span>
      {panel === 'search' && <SearchPanel engine={engine} onClose={() => { setPanel(null); canvasRef.current?.focus(); }} />}
      {panel === 'notes' && <NotesPanel engine={engine} onClose={() => { setPanel(null); canvasRef.current?.focus(); }} />}
      {panel === 'comments' && <CommentsPanel engine={engine} comments={comments} onOpen={setCommentOpen} onResolve={resolveComment} onClose={() => { setPanel(null); canvasRef.current?.focus(); }} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => { setDialog(null); canvasRef.current?.focus(); }} />}
      {dialog === 'palette' && <CommandPalette commands={commands} onClose={() => { setDialog(null); canvasRef.current?.focus(); }} />}
      {dialog === 'timer' && <TimerDialog onStart={(sec) => { setTimer(TM.startTimer(sec)); announce(t('timer.started')); }} onClose={() => { setDialog(null); canvasRef.current?.focus(); }} />}
      {present && <PresentMode engine={engine} onClose={() => { setPresent(false); canvasRef.current?.focus(); }} />}
      {dialog === 'collab' && <CollabDialog session={session} onClose={() => { setDialog(null); canvasRef.current?.focus(); }} />}
      {dialog === 'export' && <ExportDialog engine={engine} onClose={() => { setDialog(null); canvasRef.current?.focus(); }} />}
      {dialog === 'import' && <ImportDialog onFiles={(f) => importFiles(f)} onText={(tx) => engine.pasteText(tx, engine.viewCenter())} onClose={() => { setDialog(null); canvasRef.current?.focus(); }} />}
    </div>
  );
}
