import { useRef, useState } from 'react';
import { Dialog, useApp } from './common.jsx';

export default function ImportDialog({ onFiles, onText, onClose }) {
  const { t } = useApp();
  const ref = useRef(null);
  const [text, setText] = useState('');
  return (
    <Dialog title={t('import.title')} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t('common.close')}</button>}>
      <p className="muted" style={{ margin: 0 }}>{t('import.help')}</p>
      <div>
        <button className="btn primary" onClick={() => ref.current?.click()} data-autofocus>{t('import.chooseFiles')}</button>
        <input ref={ref} type="file" multiple hidden data-testid="import-file" aria-label={t('import.chooseFiles')}
          accept="application/json,.json,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg,.csv,.tsv,.txt,.md,text/plain,text/csv"
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { onFiles(f); onClose(); } }} />
      </div>
      <label className="field">{t('import.pasteLabel')}
        <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('import.pastePlaceholder')} data-testid="import-text" />
      </label>
      <div><button className="btn" disabled={!text.trim()} onClick={() => { onText(text); onClose(); }}>{t('import.addNotes')}</button></div>
    </Dialog>
  );
}
