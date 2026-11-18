import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, useApp, fmtDate } from './common.jsx';
import Icon from './Icon.jsx';
import { searchBoard, snippet } from '../core/search.js';
import { SHORTCUTS, formatKeys, score } from '../core/commands.js';
import { STICKY_COLORS, totalVotes, uid } from '../core/model.js';
import { framesInOrder } from '../export/run.js';
import { renderToCanvas, exportTarget } from '../export/raster.js';
import * as T from '../core/timer.js';

export function SidePanel({ title, onClose, children }) {
  const { t } = useApp();
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('[data-autofocus]')?.focus(); }, []);
  return (
    <aside className="side" role="complementary" aria-label={title} ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header><h2>{title}</h2><button className="btn ghost icon-only" onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></button></header>
      <div className="body">{children}</div>
    </aside>
  );
}

// ---------------- Search ----------------
export function SearchPanel({ engine, onClose }) {
  const { t, announce } = useApp();
  const [q, setQ] = useState('');
  const [cur, setCur] = useState(0);
  const results = useMemo(() => searchBoard(engine.store, q), [engine.store, q, engine.store.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCur(0); }, [q]);
  const go = (i) => {
    if (!results.length) return;
    const k = (i + results.length) % results.length; setCur(k); engine.jumpTo(results[k].id);
    announce(t('search.at', { i: k + 1, n: results.length }));
  };
  useEffect(() => { if (q.trim()) announce(results.length ? t('search.count', { n: results.length }) : t('search.none')); }, [results.length, q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SidePanel title={t('search.title')} onClose={onClose}>
      <label className="sr-only" htmlFor="bsearch">{t('search.title')}</label>
      <input id="bsearch" className="input" type="search" data-autofocus value={q} placeholder={t('search.placeholder')} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? cur - 1 : results.length && q ? (cur + (results[cur] && engine.store.selection.has(results[cur].id) ? 1 : 0)) : 0); } }} />
      <div className="row"><span className="muted grow" role="status">{q.trim() ? (results.length ? t('search.count', { n: results.length }) : t('search.none')) : ''}</span>
        <button className="btn" disabled={!results.length} onClick={() => go(cur - 1)} aria-label={t('search.prev')}><Icon name="chevronUp" /></button>
        <button className="btn" disabled={!results.length} onClick={() => go(cur + 1)} aria-label={t('search.next')}><Icon name="chevronDown" /></button></div>
      <ul className="list">
        {results.map((r, i) => { const o = engine.store.get(r.id); const sn = snippet(r.text, r.index, r.length); return (
          <li key={r.id}><button className="li" aria-current={i === cur} onClick={() => { setCur(i); engine.jumpTo(r.id); }}>
            <span className="small">{t('type.' + (o.type === 'shape' ? 'shape.' + o.kind : o.type))}</span>
            <span>{sn.before}<mark>{sn.match}</mark>{sn.after}</span></button></li>); })}
      </ul>
    </SidePanel>
  );
}

// ---------------- Notes grid ----------------
export function NotesPanel({ engine, onClose }) {
  const { t } = useApp();
  const [by, setBy] = useState('colour');
  const [group, setGroup] = useState(true);
  const notes = engine.store.list().filter((o) => o.type === 'sticky');
  const sorted = [...notes].sort((a, b) => by === 'colour' ? STICKY_COLORS.findIndex((c) => c.id === a.color) - STICKY_COLORS.findIndex((c) => c.id === b.color) : by === 'votes' ? totalVotes(b) - totalVotes(a) : (a.text || '').localeCompare(b.text || ''));
  const groups = group && by === 'colour' ? STICKY_COLORS.map((c) => [c, sorted.filter((n) => n.color === c.id)]).filter(([, l]) => l.length) : [[null, sorted]];
  return (
    <SidePanel title={t('notes.title')} onClose={onClose}>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>{t('notes.sortBy')}
          <select className="select" value={by} onChange={(e) => setBy(e.target.value)} data-autofocus>{['colour', 'votes', 'text'].map((k) => <option key={k} value={k}>{t('notes.by.' + k)}</option>)}</select></label>
        <label className="row" style={{ alignSelf: 'end', minHeight: 40 }}><input type="checkbox" checked={group} disabled={by !== 'colour'} onChange={(e) => setGroup(e.target.checked)} />{t('notes.group')}</label>
      </div>
      <button className="btn" disabled={notes.length < 2} onClick={() => engine.arrangeNotes({ by, group })}><Icon name="notes" />{t('notes.arrange')}</button>
      {!notes.length && <p className="muted">{t('notes.empty')}</p>}
      {groups.map(([c, list]) => (
        <section key={c?.id || 'all'} aria-label={c ? t('color.' + c.id) : undefined}>
          {c && <h3 style={{ fontSize: 13, margin: '8px 0', color: 'var(--muted)' }}>{t('color.' + c.id)} ({list.length})</h3>}
          <div className="notes-grid">
            {list.map((n) => { const col = STICKY_COLORS.find((k) => k.id === n.color); const v = totalVotes(n); return (
              <button key={n.id} className="note-card" style={{ background: col.fill }} onClick={() => engine.jumpTo(n.id)} aria-label={`${n.text || t('notes.blank')}${v ? `, ${t('notes.votes', { n: v })}` : ''}`}>
                <span>{(n.text || '…').slice(0, 90)}</span>{v > 0 && <span className="votes">● {v}</span>}</button>); })}
          </div>
        </section>
      ))}
    </SidePanel>
  );
}

// ---------------- Collaborator cursors ----------------
export function RemoteCursors({ engine, session }) {
  const { t } = useApp();
  useSyncExternalStore(session.subscribePresence, session.getPresenceVersion);
  return [...session.presence.values()].map((c) => {
    const p = engine.worldToScreen(c.x, c.y);
    if (p.x < -20 || p.y < -20 || p.x > engine.size.w + 20 || p.y > engine.size.h + 20) return null;
    return (
      <div key={c.id} className="remote-cursor" style={{ left: p.x, top: p.y, color: c.color }} data-testid="remote-cursor" aria-hidden="true">
        <svg width="16" height="20" viewBox="0 0 16 20"><path d="M1 1l13 8-6 1.500L5 17z" fill="currentColor" stroke="#fff" strokeWidth="1.200" /></svg>
        <span>{c.name || t('collab.guest')}</span>
      </div>
    );
  });
}

// ---------------- Comments ----------------
export function CommentPins({ engine, comments, onOpen, openId }) {
  const { t } = useApp();
  return comments.map((c, i) => {
    const p = engine.worldToScreen(c.x, c.y);
    if (p.x < -40 || p.y < -40 || p.x > engine.size.w + 40 || p.y > engine.size.h + 80) return null;
    return <button key={c.id} className={`pin ${c.resolved ? 'resolved' : ''}`} style={{ left: p.x, top: p.y }} aria-expanded={openId === c.id}
      aria-label={t(c.resolved ? 'comment.pinResolved' : 'comment.pin', { n: i + 1, text: c.text.slice(0, 60) })} onClick={() => onOpen(c.id)}><span>{i + 1}</span></button>;
  });
}

export function CommentPopover({ engine, comment, draft, onSave, onResolve, onDelete, onClose }) {
  const { t, prefs, lang } = useApp();
  const [text, setText] = useState(comment?.text || '');
  const pos = engine.worldToScreen((comment || draft).x, (comment || draft).y);
  const left = Math.min(Math.max(8, pos.x), Math.max(8, engine.size.w - 296)), top = Math.min(pos.y + 8, Math.max(8, engine.size.h - 200));
  return (
    <div className="comment-pop" style={{ left, top }} role="dialog" aria-label={t('comment.title')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      {comment ? (
        <>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.text}</p>
          <span className="small muted">{comment.author ? `${comment.author} · ` : ''}{fmtDate(comment.time, lang)}{comment.resolved ? ` · ${t('comment.resolved')}` : ''}</span>
          <div className="row">
            <button className="btn" data-autofocus onClick={() => onResolve(comment.id)}><Icon name="check" />{t(comment.resolved ? 'comment.unresolve' : 'comment.resolve')}</button>
            <button className="btn danger" onClick={() => onDelete(comment.id)}><Icon name="trash" />{t('common.delete')}</button>
            <button className="btn ghost" onClick={onClose}>{t('common.close')}</button>
          </div>
        </>
      ) : (
        <>
          <label className="field">{t('comment.new')}<textarea className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) onSave(text.trim()); }} /></label>
          {!prefs.author && <span className="small muted">{t('comment.noAuthor')}</span>}
          <div className="row"><button className="btn primary" disabled={!text.trim()} onClick={() => onSave(text.trim())}>{t('comment.add')}</button><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button></div>
        </>
      )}
    </div>
  );
}

export function CommentsPanel({ engine, comments, onOpen, onResolve, onClose }) {
  const { t, prefs, setPref, lang } = useApp();
  const [showResolved, setShowResolved] = useState(true);
  const list = comments.map((c, i) => ({ ...c, n: i + 1 })).filter((c) => showResolved || !c.resolved);
  return (
    <SidePanel title={t('comment.panel')} onClose={onClose}>
      <label className="field">{t('comment.yourName')}<input className="input" value={prefs.author} maxLength={60} onChange={(e) => setPref('author', e.target.value)} data-autofocus /></label>
      <label className="row"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />{t('comment.showResolved')}</label>
      {!list.length && <p className="muted">{t('comment.empty')}</p>}
      <ul className="list">{list.map((c) => (
        <li key={c.id}><div className="li" style={{ cursor: 'default' }}>
          <button className="btn ghost" style={{ justifyContent: 'flex-start', padding: 0, minHeight: 0, textAlign: 'start', textDecoration: c.resolved ? 'line-through' : 'none' }} onClick={() => { engine.focusRect({ x: c.x - 150, y: c.y - 150, w: 300, h: 300 }, { minZoom: 0.5 }); onOpen(c.id); }}>#{c.n} {c.text}</button>
          <span className="small">{c.author ? `${c.author} · ` : ''}{fmtDate(c.time, lang)}</span>
          <button className="btn" style={{ minHeight: 32, justifySelf: 'start' }} onClick={() => onResolve(c.id)}>{t(c.resolved ? 'comment.unresolve' : 'comment.resolve')}</button>
        </div></li>))}</ul>
    </SidePanel>
  );
}

// ---------------- Timer ----------------
export function TimerPill({ timer, setTimer, onClose }) {
  const { t, announce } = useApp();
  const [, tick] = useState(0);
  const doneAnnounced = useRef(false);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, []);
  const rem = T.remaining(timer), done = T.isDone(timer);
  useEffect(() => { if (done && !doneAnnounced.current) { doneAnnounced.current = true; announce(t('timer.done')); } if (!done) doneAnnounced.current = false; }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = timer.paused === null && !done;
  return (
    <div className={`timer-pill ${done ? 'done' : ''}`} role="group" aria-label={t('timer.title')}>
      <span className="time" role="timer" aria-live="off" aria-label={t('timer.remaining', { time: T.format(rem) })}>{T.format(rem)}</span>
      <button className="btn icon-only" onClick={() => setTimer(running ? T.pauseTimer(timer) : done ? T.startTimer(timer.total) : T.resumeTimer(timer))} aria-label={t(running ? 'timer.pause' : done ? 'timer.restart' : 'timer.resume')}><Icon name={running ? 'pause' : 'play'} /></button>
      <button className="btn" onClick={() => setTimer(T.addTime(timer, 60))} aria-label={t('timer.addMinute')}>+1</button>
      <button className="btn icon-only" onClick={onClose} aria-label={t('timer.close')}><Icon name="close" /></button>
    </div>
  );
}

export function TimerDialog({ onStart, onClose }) {
  const { t } = useApp();
  const [min, setMin] = useState(5);
  return (
    <Dialog title={t('timer.title')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={() => { onStart(Math.max(1, Math.min(180, min)) * 60); onClose(); }} data-testid="timer-start">{t('timer.start')}</button></>}>
      <div className="chips">{[1, 3, 5, 10, 15, 30].map((m) => <button key={m} className="chip" aria-pressed={min === m} onClick={() => setMin(m)}>{t('timer.minutes', { n: m })}</button>)}</div>
      <label className="field">{t('timer.custom')}<input className="input" type="number" min={1} max={180} value={min} onChange={(e) => setMin(+e.target.value || 1)} data-autofocus /></label>
    </Dialog>
  );
}

// ---------------- Voting ----------------
export function VotingBar({ engine, onClose }) {
  const { t } = useApp();
  const left = Math.max(0, engine.opts.votesPerPerson - engine.myVotes());
  return (
    <div className="timer-pill" style={{ top: 62 }} role="group" aria-label={t('vote.title')}>
      <Icon name="vote" /><span role="status">{t('vote.left', { n: left })}</span>
      <label className="sr-only" htmlFor="vpp">{t('vote.perPerson')}</label>
      <input id="vpp" className="input" style={{ width: 64, minHeight: 36 }} type="number" min={1} max={20} value={engine.opts.votesPerPerson} onChange={(e) => engine.setOpt('votesPerPerson', Math.max(1, Math.min(20, +e.target.value || 1)))} />
      <button className="btn" onClick={() => engine.clearVotes()}>{t('vote.clear')}</button>
      <button className="btn icon-only" onClick={onClose} aria-label={t('vote.stop')}><Icon name="close" /></button>
    </div>
  );
}

// ---------------- Shortcuts dialog ----------------
export function ShortcutsDialog({ onClose }) {
  const { t } = useApp();
  const groups = ['tools', 'edit', 'view', 'app'];
  return (
    <Dialog title={t('shortcuts.title')} onClose={onClose} wide>
      {groups.map((g) => (
        <section key={g} aria-labelledby={'sg-' + g}>
          <h3 id={'sg-' + g} style={{ margin: '0 0 6px', fontSize: 14 }}>{t('shortcuts.group.' + g)}</h3>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '4px 24px' }}>
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
                <dt>{t('cmd.' + s.id)}</dt><dd style={{ margin: 0, display: 'flex', gap: 3 }}>{formatKeys(s.keys).map((k, i) => <span key={i} className="kbd">{k}</span>)}</dd>
              </div>))}
          </dl>
        </section>))}
    </Dialog>
  );
}

// ---------------- Command palette ----------------
export function CommandPalette({ commands, onClose }) {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo(() => commands.map((c) => ({ ...c, s: score(c.label, q) })).filter((c) => c.s >= 0 && (c.enabled ?? true)).sort((a, b) => b.s - a.s).slice(0, 60), [commands, q]);
  useEffect(() => setSel(0), [q]);
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const run = (c) => { onClose(); setTimeout(() => c.run(), 0); };
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.title')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); run(items[sel]); }
        }}>
        <input className="input" autoFocus role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[sel] ? 'pal-' + items[sel].id : undefined} aria-label={t('palette.title')}
          placeholder={t('palette.placeholder')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="palette-input" />
        <ul id="palette-list" role="listbox" ref={listRef}>
          {items.map((c, i) => (
            <li key={c.id} id={'pal-' + c.id} role="option" aria-selected={i === sel} className="pal-item" onClick={() => run(c)} onMouseMove={() => setSel(i)}>
              {c.icon && <Icon name={c.icon} />}<span>{c.label}</span>{c.keys && <span className="sc">{formatKeys(c.keys).map((k, j) => <span key={j} className="kbd" style={{ marginInlineStart: 3 }}>{k}</span>)}</span>}
            </li>))}
          {!items.length && <li role="presentation" style={{ padding: 14 }} className="muted">{t('palette.none')}</li>}
        </ul>
      </div>
    </div>
  );
}

// ---------------- Present mode ----------------
export function PresentMode({ engine, onClose }) {
  const { t, theme, announce } = useApp();
  const frames = useMemo(() => framesInOrder(engine.store), [engine.store]);
  const [i, setI] = useState(0);
  const [barHidden, setBarHidden] = useState(false);
  const canvasHolder = useRef(null);
  const root = useRef(null);
  const slides = frames.length ? frames.map((f) => ({ id: f.id, title: f.title })) : [{ id: null, title: engine.store.meta.name }];

  useEffect(() => {
    const el = root.current;
    el?.focus();
    try { el?.requestFullscreen?.().catch(() => {}); } catch { /* fullscreen is optional */ }
    const onFs = () => { if (!document.fullscreenElement && root.current && window.__presentClosing !== true) { /* user left fullscreen with Esc: keep presenting */ } };
    document.addEventListener('fullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      const slide = slides[i];
      const target = slide.id ? exportTarget(engine.store, { kind: 'frame', frameId: slide.id }) : exportTarget(engine.store, { kind: 'board' });
      if (!target.rect) return;
      const dpr = window.devicePixelRatio || 1;
      const avail = { w: window.innerWidth, h: window.innerHeight };
      const fit = Math.min(avail.w / target.rect.w, avail.h / target.rect.h);
      const { canvas } = await renderToCanvas(engine.store, { ...target, scale: fit * dpr, theme });
      if (dead) return;
      canvas.style.width = Math.floor(target.rect.w * fit) + 'px'; canvas.style.height = Math.floor(target.rect.h * fit) + 'px';
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', slide.title || t('present.slide', { n: i + 1 }));
      canvasHolder.current?.replaceChildren(canvas);
    })();
    announce(t('present.at', { i: i + 1, n: slides.length, title: slides[i].title || '' }));
    return () => { dead = true; };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (d) => setI((x) => Math.min(slides.length - 1, Math.max(0, x + d)));
  useEffect(() => { setBarHidden(false); const id = setTimeout(() => setBarHidden(true), 2800); return () => clearTimeout(id); }, [i]);
  const onKey = (e) => {
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) { e.preventDefault(); go(-1); }
    else if (k === 'Home') { e.preventDefault(); setI(0); } else if (k === 'End') { e.preventDefault(); setI(slides.length - 1); }
    else if (k === 'Escape') { e.preventDefault(); onClose(); }
  };
  return (
    <div className="present" role="dialog" aria-modal="true" aria-label={t('present.title')} tabIndex={-1} ref={root} onKeyDown={onKey} onMouseMove={() => setBarHidden(false)} data-testid="present">
      <div ref={canvasHolder} />
      <div className={`bar ${barHidden ? 'hide' : ''}`}>
        <button className="btn icon-only" onClick={() => go(-1)} disabled={i === 0} aria-label={t('present.prev')}><Icon name="chevronLeft" /></button>
        <span role="status" data-testid="present-pos">{i + 1} / {slides.length}{slides[i].title ? ` · ${slides[i].title}` : ''}</span>
        <button className="btn icon-only" onClick={() => go(1)} disabled={i === slides.length - 1} aria-label={t('present.next')}><Icon name="chevronRight" /></button>
        <button className="btn" onClick={onClose}>{t('present.exit')}</button>
      </div>
    </div>
  );
}

export { uid };
