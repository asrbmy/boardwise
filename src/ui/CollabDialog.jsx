import { useState, useSyncExternalStore } from 'react';
import { Dialog, useApp } from './common.jsx';
import { p2pSupported } from '../collab/p2p.js';

function CodeBox({ label, value, onCopy, t }) {
  return (
    <div className="field">
      <label>{label}
        <textarea className="input mono" readOnly rows={4} value={value} onFocus={(e) => e.target.select()} data-testid="collab-code-out" />
      </label>
      <div><button className="btn" onClick={onCopy}>{t('collab.copy')}</button></div>
    </div>
  );
}

export default function CollabDialog({ session, onClose }) {
  const { t, toast, announce } = useApp();
  useSyncExternalStore(session.subscribe, session.getVersion);
  const [mode, setMode] = useState('host');
  const [stun, setStun] = useState('');
  const [peer, setPeer] = useState(null);
  const [out, setOut] = useState('');
  const [inp, setInp] = useState('');
  const [busy, setBusy] = useState(false);
  const supported = p2pSupported();

  const fail = (e) => toast(t(e?.message === 'code-wrong-kind' ? 'collab.wrongKind' : e?.message?.startsWith('code-') ? 'collab.badCode' : 'error.generic'), { kind: 'error' });
  const copy = async () => { try { await navigator.clipboard.writeText(out); toast(t('collab.copied')); } catch { /* user can copy by hand from the box */ } };
  const reset = () => { setPeer(null); setOut(''); setInp(''); };
  const watch = (p) => p.onState((s) => { if (s === 'connected') { toast(t('collab.connected')); announce(t('collab.connected')); } if (s === 'closed') announce(t('collab.lost')); });

  const createOffer = async () => { setBusy(true); try { const p = session.newPeer(stun); watch(p); setPeer(p); setOut(await p.createOffer()); } catch (e) { fail(e); } setBusy(false); };
  const connect = async () => { setBusy(true); try { await peer.acceptAnswer(inp); setInp(''); } catch (e) { fail(e); } setBusy(false); };
  const createAnswer = async () => { setBusy(true); let p; try { p = session.newPeer(stun); watch(p); setPeer(p); setOut(await p.acceptOffer(inp)); } catch (e) { if (p) session.drop(p); setPeer(null); fail(e); } setBusy(false); };

  return (
    <Dialog title={t('collab.title')} onClose={onClose} wide footer={<>
      {session.peers.length > 0 && <button className="btn danger" onClick={() => { session.close(); reset(); }} data-testid="collab-stop">{t('collab.stopAll')}</button>}
      <button className="btn" onClick={onClose}>{t('common.close')}</button></>}>
      <p className="muted" style={{ margin: 0 }} data-testid="collab-warn">{t('collab.warn')}</p>
      {!supported ? <p role="alert">{t('collab.unsupported')}</p> : <>
        <div role="tablist" aria-label={t('collab.title')} className="seg">
          {['host', 'join'].map((m) => <button key={m} role="tab" aria-selected={mode === m} className={`btn ${mode === m ? 'primary' : ''}`} onClick={() => { setMode(m); reset(); }} data-testid={`collab-tab-${m}`}>{t('collab.' + m)}</button>)}
        </div>
        <p className="muted" style={{ margin: 0 }}>{t(mode === 'host' ? 'collab.hostHelp' : 'collab.joinHelp')}</p>
        <label className="field">{t('collab.stun')}
          <input className="input" value={stun} onChange={(e) => setStun(e.target.value)} disabled={!!peer} placeholder="stun:" spellCheck="false" data-testid="collab-stun" />
          <span className="muted">{t('collab.stunHelp')}</span>
        </label>
        {mode === 'host' && <>
          {!peer && <div><button className="btn primary" onClick={createOffer} disabled={busy} data-testid="collab-create-offer" data-autofocus>{t('collab.createOffer')}</button></div>}
          {peer && out && <CodeBox label={t('collab.offer')} value={out} onCopy={copy} t={t} />}
          {peer && peer.state !== 'connected' && <>
            <label className="field">{t('collab.pasteAnswer')}
              <textarea className="input mono" rows={4} value={inp} onChange={(e) => setInp(e.target.value)} spellCheck="false" data-testid="collab-answer-in" />
            </label>
            <div><button className="btn primary" onClick={connect} disabled={busy || !inp.trim()} data-testid="collab-connect">{t('collab.connect')}</button></div>
          </>}
        </>}
        {mode === 'join' && <>
          {!peer && <>
            <label className="field">{t('collab.pasteOffer')}
              <textarea className="input mono" rows={4} value={inp} onChange={(e) => setInp(e.target.value)} spellCheck="false" data-testid="collab-offer-in" data-autofocus />
            </label>
            <div><button className="btn primary" onClick={createAnswer} disabled={busy || !inp.trim()} data-testid="collab-create-answer">{t('collab.createAnswer')}</button></div>
          </>}
          {peer && out && <CodeBox label={t('collab.answer')} value={out} onCopy={copy} t={t} />}
        </>}
        {session.peers.length > 0 && <section aria-label={t('collab.peers')}>
          <h3 style={{ margin: '8px 0 4px', fontSize: 14 }}>{t('collab.peers')}</h3>
          <ul className="plain" data-testid="collab-peers">
            {session.peers.map((p, i) => <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span role="status">{i + 1}. {t('collab.status.' + p.state)}</span>
              <button className="btn" onClick={() => { session.drop(p); if (p === peer) reset(); }}>{t('collab.disconnect')}</button>
            </li>)}
          </ul>
          {peer?.state === 'connected' && <button className="btn" onClick={reset}>{t(mode === 'host' ? 'collab.host' : 'collab.join')}</button>}
        </section>}
      </>}
    </Dialog>
  );
}
