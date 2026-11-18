import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useApp } from './common.jsx';
import { SHAPE_KINDS, STAMPS } from '../core/model.js';

const MAIN = [
  { tool: 'select', icon: 'select', key: 'V' }, { tool: 'hand', icon: 'hand', key: 'H' }, 'sep',
  { tool: 'pen', icon: 'pen', key: 'P' }, { tool: 'highlighter', icon: 'highlighter', key: 'L' }, { tool: 'eraser', icon: 'eraser', key: 'E' }, 'sep',
  { tool: 'sticky', icon: 'sticky', key: 'N' }, { tool: 'text', icon: 'text', key: 'T' }, { tool: 'shape', icon: 'shape', key: 'R', flyout: 'shapes' },
  { tool: 'connector', icon: 'connector', key: 'C' }, { tool: 'frame', icon: 'frame', key: 'F' }, { tool: 'table', icon: 'table', key: 'B' },
  { tool: 'checklist', icon: 'checklist', key: 'K' }, { tool: 'image', icon: 'image', key: 'I', action: true }, 'sep',
  { tool: 'stamp', icon: 'stamp', key: 'S', flyout: 'stamps' }, { tool: 'laser', icon: 'laser', key: 'Z' }, { tool: 'comment', icon: 'comment', key: 'M' },
];

export default function Toolbar({ engine, collapsed, onPickImage }) {
  const { t } = useApp();
  const [fly, setFly] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (!ref.current?.contains(e.target)) setFly(null); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);
  const shapeIcon = engine.opts.shapeKind;
  return (
    <div className={`toolbar ${collapsed ? 'collapsed' : ''}`} role="toolbar" aria-orientation="vertical" aria-label={t('toolbar.label')} ref={ref}
      onKeyDown={(e) => { if (e.key === 'Escape') setFly(null); }}>
      {MAIN.map((it, i) => {
        if (it === 'sep') return <div className="sep" key={i} role="separator" />;
        const label = t('tool.' + it.tool);
        const active = engine.tool === it.tool;
        return (
          <div className="tool-wrap" key={it.tool}>
            <button className="btn" aria-pressed={it.action ? undefined : active} aria-label={`${label} (${it.key})`} title={`${label} (${it.key})`} data-tool={it.tool}
              aria-haspopup={it.flyout ? 'true' : undefined} aria-expanded={it.flyout ? fly === it.flyout : undefined}
              onClick={() => {
                if (it.action) { onPickImage(); return; }
                if (it.flyout && active) { setFly(fly === it.flyout ? null : it.flyout); return; }
                engine.setTool(it.tool);
                setFly(it.flyout || null);
              }}>
              <Icon name={it.tool === 'shape' ? shapeIcon : it.icon} />
            </button>
            {fly === 'shapes' && it.flyout === 'shapes' && (
              <div className="flyout" role="group" aria-label={t('tool.shape')}>
                {SHAPE_KINDS.map((k) => (
                  <button key={k} className="btn" aria-pressed={engine.opts.shapeKind === k} aria-label={t('type.shape.' + k)} title={t('type.shape.' + k)} data-shape={k}
                    onClick={() => { engine.setTool('shape', { shapeKind: k }); setFly(null); }}><Icon name={k} /></button>
                ))}
              </div>
            )}
            {fly === 'stamps' && it.flyout === 'stamps' && (
              <div className="flyout stamps" role="group" aria-label={t('tool.stamp')}>
                {STAMPS.map((s) => (
                  <button key={s} className="btn" aria-pressed={engine.opts.stamp === s} aria-label={s} onClick={() => { engine.setTool('stamp', { stamp: s }); setFly(null); }}>{s}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
