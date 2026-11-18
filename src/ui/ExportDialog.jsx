import { useMemo, useState } from 'react';
import { Dialog, useApp } from './common.jsx';
import { FORMATS, framesInOrder, runExport } from '../export/run.js';
import { downloadBlob } from '../export/files.js';
import { exportTarget, clampScale } from '../export/raster.js';

export default function ExportDialog({ engine, onClose }) {
  const { t, toast, announce } = useApp();
  const store = engine.store;
  const sel = [...store.selection];
  const frames = useMemo(() => framesInOrder(store), [store]);
  const [format, setFormat] = useState('png');
  const [scope, setScope] = useState(sel.length ? 'selection' : 'board');
  const [frameId, setFrameId] = useState(frames[0]?.id || '');
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(false);
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const visual = ['png', 'svg', 'pdf'].includes(format);
  const scopes = visual ? ['board', 'selection', 'frame'].filter((s) => (s !== 'selection' || sel.length) && (s !== 'frame' || frames.length) && !(format === 'pdf' && s === 'frame')) : ['board'];
  const effScope = scopes.includes(scope) ? scope : 'board';
  const target = visual ? exportTarget(store, { kind: effScope, ids: sel, frameId }) : null;
  const size = target?.rect ? (() => { const s = clampScale(target.rect, scale); return `${Math.round(target.rect.w * s)} × ${Math.round(target.rect.h * s)} px`; })() : null;
  const empty = visual && !target?.rect;

  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await runExport(store, { format, scope: effScope, frameId, scale, transparent: transparent && format !== 'pdf', dark, selection: sel, labels: { other: t('export.md.other'), comments: t('export.md.comments'), resolved: t('export.md.resolved') } });
      downloadBlob(r.blob, r.filename);
      announce(t('export.done', { name: r.filename }));
      toast(t('export.done', { name: r.filename }));
      onClose();
    } catch (e) { setErr(e.message === 'empty' ? t('export.empty') : t('export.failed')); } finally { setBusy(false); }
  };

  return (
    <Dialog title={t('export.title')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={go} disabled={busy || empty} data-testid="export-go">{busy ? t('export.working') : t('common.export')}</button></>}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ marginBottom: 6, fontWeight: 600 }}>{t('export.format')}</legend>
        <div className="chips">{FORMATS.map((f) => <button key={f} className="chip" aria-pressed={format === f} onClick={() => setFormat(f)} data-format={f}>{t('export.fmt.' + f)}</button>)}</div>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>{t('export.fmt.' + format + '.help')}</p>
      </fieldset>
      {visual && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="muted" style={{ marginBottom: 6, fontWeight: 600 }}>{t('export.scope')}</legend>
          {scopes.map((s) => <label key={s} className="row"><input type="radio" name="scope" checked={effScope === s} onChange={() => setScope(s)} data-scope={s} /> {t('export.scope.' + s)}{format === 'pdf' && s === 'board' && frames.length ? ` (${t('export.pdf.pages', { n: frames.length })})` : ''}</label>)}
          {effScope === 'frame' && (
            <label className="field">{t('export.frame')}
              <select className="select" value={frameId} onChange={(e) => setFrameId(e.target.value)} data-testid="export-frame">
                {frames.map((f) => <option key={f.id} value={f.id}>{f.title || t('type.frame')}</option>)}
              </select>
            </label>
          )}
        </fieldset>
      )}
      {format === 'png' && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted" style={{ marginBottom: 6, fontWeight: 600 }}>{t('export.resolution')}</legend>
          <div className="row">{[1, 2].map((s) => <label key={s} className="row"><input type="radio" name="scale" checked={scale === s} onChange={() => setScale(s)} data-scale={s} /> {s}×</label>)}{size && <span className="muted">{size}</span>}</div>
        </fieldset>
      )}
      {visual && (
        <div style={{ display: 'grid', gap: 6 }}>
          {format !== 'pdf' && <label className="row"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> {t('export.transparent')}</label>}
          <label className="row"><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> {t('export.dark')}</label>
        </div>
      )}
      {empty && <p role="alert" style={{ margin: 0, color: 'var(--warn)' }}>{t('export.empty')}</p>}
      {err && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{err}</p>}
    </Dialog>
  );
}
