import { useCallback, useEffect, useState } from 'react';
import { Dialog, useApp, fmtDate } from './common.jsx';
import * as F from '../sync/folder.js';

export default function SyncDialog({ onClose, onChanged }) {
  const { storage, t, toast, lang, announce } = useApp();
  const [handle, setHandle] = useState(null);
  const [perm, setPerm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [last, setLast] = useState(null);
  const [versions, setVersions] = useState([]);
  const supported = F.folderSyncSupported() || (typeof window !== 'undefined' && window.__bwPickDir && /[?&#]e2e\b/.test(location.href));

  const load = useCallback(async () => {
    const h = await F.loadHandle(storage); setHandle(h);
    setPerm(h ? await F.hasPermission(h) : false);
    setLast(await storage.backend.get('kv', 'syncLast'));
    setVersions(await F.listVersions(storage));
  }, [storage]);
  useEffect(() => { load(); }, [load]);

  const choose = async () => {
    try {
      const h = await F.pickFolder();
      if (!(await F.hasPermission(h, true))) return;
      await F.forgetHandle(storage); // a new folder starts with a clean history of what was synced
      const ok = await F.saveHandle(storage, h);
      setHandle(h); setPerm(true); setReport(null);
      if (!ok) toast(t('status.memory'), { kind: 'error' });
    } catch (e) { if (e?.name !== 'AbortError') toast(t('sync.failed'), { kind: 'error' }); else toast(t('sync.cancelled')); }
  };
  const reconnect = async () => setPerm(await F.hasPermission(handle, true));
  const run = async () => {
    setBusy(true); announce(t('sync.running'));
    try {
      const r = await F.syncFolder(handle, storage);
      setReport(r); await load(); onChanged?.();
      announce(t('sync.report', { pushed: r.pushed.length, pulled: r.pulled.length, same: r.same }));
    } catch { toast(t('sync.failed'), { kind: 'error' }); }
    setBusy(false);
  };
  const stop = async () => { await F.forgetHandle(storage); setHandle(null); setReport(null); };
  const restore = async (key) => { await F.restoreVersion(storage, key); toast(t('sync.restored')); await load(); onChanged?.(); };

  return (
    <Dialog title={t('sync.title')} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>{t('common.close')}</button>}>
      <p className="muted" style={{ margin: 0 }} data-testid="sync-help">{t('sync.help')}</p>
      {!supported ? <p role="alert" data-testid="sync-unsupported">{t('sync.unsupported')}</p> : <>
        <p style={{ margin: 0 }} data-testid="sync-folder">{handle ? t('sync.folder', { name: handle.name }) : t('sync.none')}</p>
        <div className="seg">
          <button className="btn" onClick={choose} data-testid="sync-choose" data-autofocus>{t(handle ? 'sync.change' : 'sync.choose')}</button>
          {handle && perm && <button className="btn primary" onClick={run} disabled={busy} data-testid="sync-now">{busy ? t('sync.running') : t('sync.now')}</button>}
          {handle && !perm && <button className="btn primary" onClick={reconnect} data-testid="sync-reconnect">{t('sync.reconnect')}</button>}
          {handle && <button className="btn" onClick={stop}>{t('sync.stop')}</button>}
        </div>
        {handle && !perm && <p className="muted" style={{ margin: 0 }}>{t('sync.needPermission')}</p>}
        {last && <p className="muted" style={{ margin: 0 }}>{t('sync.last', { time: fmtDate(last, lang) })}</p>}
        {report && <div role="status" data-testid="sync-report">
          <p style={{ margin: 0 }}>{t('sync.report', { pushed: report.pushed.length, pulled: report.pulled.length, same: report.same })}</p>
          {report.conflicts.length > 0 && <p style={{ margin: '4px 0 0' }}>{t('sync.conflicts', { n: report.conflicts.length })}</p>}
          {report.skipped.length > 0 && <p style={{ margin: '4px 0 0' }}>{t('sync.skipped', { n: report.skipped.length })}</p>}
        </div>}
        <section aria-label={t('sync.versions')}>
          <h3 style={{ margin: '8px 0 4px', fontSize: 14 }}>{t('sync.versions')}</h3>
          {versions.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('sync.versionsNone')}</p> :
            <ul className="plain" data-testid="sync-versions">{versions.map((v) => (
              <li key={v.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{v.name} · {fmtDate(v.editedAt, lang)}</span>
                <button className="btn" onClick={() => restore(v.key)}>{t('sync.restoreCopy')}</button>
              </li>))}</ul>}
        </section>
      </>}
    </Dialog>
  );
}
