import { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';
import Icon from './Icon.jsx';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Modal dialog with focus trap, Escape to close and focus restore. */
export function Dialog({ title, onClose, children, footer, wide = false, labelledBy }) {
  const ref = useRef(null);
  const { t } = useApp();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const first = el.querySelector('[data-autofocus]') || el.querySelector(FOCUSABLE);
    first?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  const id = labelledBy || 'dlg-title';
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <header>
          <h2 id={id}>{title}</h2>
          <button className="btn ghost icon-only" onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></button>
        </header>
        <div className="body" tabIndex={0} role="region" aria-labelledby={id}>{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose, danger = true }) {
  const { t } = useApp();
  return (
    <Dialog title={title} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose} data-autofocus>{t('common.cancel')}</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel || t('common.delete')}</button>
      </>
    )}>
      <p style={{ margin: 0 }}>{message}</p>
    </Dialog>
  );
}

/** Button + dropdown menu with Escape/outside-click close and arrow-key navigation. */
export function MenuButton({ label, icon, children, className = 'btn ghost icon-only', menuClass = '', text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...ref.current.querySelectorAll('.menu .item')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };
  useEffect(() => { if (open) ref.current?.querySelector('.menu .item')?.focus(); }, [open]);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }} ref={ref} onKeyDown={onKey}>
      <button className={className} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} />}{text}
      </button>
      {open && <div className={`menu ${menuClass}`} role="menu" onClick={(e) => { if (e.target.closest('.item') && !e.target.closest('[data-keep-open]')) setOpen(false); }}>{children}</div>}
    </span>
  );
}
export const MenuItem = ({ icon, children, shortcut, ...p }) => (
  <button className="item" role="menuitem" {...p}>{icon && <Icon name={icon} />}<span>{children}</span>{shortcut && <span className="sc">{shortcut}</span>}</button>
);

export function Toasts({ toasts, dismiss }) {
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind || ''}`} role={x.kind === 'error' ? 'alert' : 'status'}>
          <span>{x.msg}</span>
          {x.action && <button onClick={() => { x.action.run(); dismiss(x.id); }}>{x.action.label}</button>}
          <button onClick={() => dismiss(x.id)} aria-label="×">×</button>
        </div>
      ))}
    </div>
  );
}

export function useDebounced(fn, ms) {
  const ref = useRef({ fn, t: null });
  ref.current.fn = fn;
  const call = useCallback((...a) => { clearTimeout(ref.current.t); ref.current.t = setTimeout(() => ref.current.fn(...a), ms); }, [ms]);
  const flush = useCallback((...a) => { clearTimeout(ref.current.t); ref.current.t = null; return ref.current.fn(...a); }, []);
  const cancel = useCallback(() => clearTimeout(ref.current.t), []);
  return { call, flush, cancel };
}

export const fmtDate = (ts, lang) => {
  try { return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(ts); } catch { return new Date(ts).toLocaleString(); }
};
