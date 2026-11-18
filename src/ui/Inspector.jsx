import { useState } from 'react';
import Icon from './Icon.jsx';
import { useApp } from './common.jsx';
import { FILLS, PALETTE, STICKY_COLORS } from '../core/model.js';

function Swatches({ colors, value, onPick, label, none = false, t }) {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {colors.map((c) => (
        <button key={c} className={`swatch ${c === 'transparent' ? 'none' : ''}`} style={c === 'transparent' ? undefined : { background: c }}
          aria-pressed={value?.toLowerCase() === c} aria-label={c === 'transparent' ? t('style.noFill') : c} title={c === 'transparent' ? t('style.noFill') : c}
          onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

const Btn = ({ icon, label, onClick, pressed, disabled }) => (
  <button className="btn" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled}><Icon name={icon} /></button>
);

export default function Inspector({ engine }) {
  const { t } = useApp();
  const [more, setMore] = useState(false);
  const sel = engine.selected();
  const tool = engine.tool;
  const o = engine.opts;
  const first = sel[0];
  const types = new Set(sel.map((s) => s.type));
  const drawing = tool === 'pen' || tool === 'highlighter';

  if (!sel.length && !drawing && !['shape', 'sticky', 'connector'].includes(tool)) return null;

  // Tool options (nothing selected)
  if (!sel.length) {
    if (drawing) {
      const hl = tool === 'highlighter';
      return (
        <div className="inspector" role="group" aria-label={t('inspector.label')}>
          <Swatches t={t} label={t('style.color')} colors={PALETTE.slice(0, 10)} value={hl ? o.hlColor : o.penColor} onPick={(c) => { engine.setOpt(hl ? 'hlColor' : 'penColor', c); engine.prefs[hl ? 'highlighterColor' : 'penColor'] = c; }} />
          <span className="sep" />
          <label className="lbl" htmlFor="pw">{t('style.width')}</label>
          <input id="pw" className="range" type="range" min={hl ? 8 : 1} max={hl ? 40 : 24} value={hl ? o.hlWidth : o.penWidth} onChange={(e) => engine.setOpt(hl ? 'hlWidth' : 'penWidth', +e.target.value)} />
          <label className="lbl" htmlFor="ps">{t('style.smoothing')}</label>
          <input id="ps" className="range" type="range" min={0} max={3} value={o.smoothing} onChange={(e) => engine.setOpt('smoothing', +e.target.value)} />
          {!hl && <button className="btn" aria-pressed={o.inkToShape} onClick={() => engine.setOpt('inkToShape', !o.inkToShape)} title={t('style.inkToShapeHelp')}>{t('style.inkToShape')}</button>}
        </div>
      );
    }
    if (tool === 'sticky') {
      return (
        <div className="inspector" role="group" aria-label={t('inspector.label')}>
          <div className="swatches" role="group" aria-label={t('style.noteColor')}>
            {STICKY_COLORS.map((c) => <button key={c.id} className="swatch" style={{ background: c.fill }} aria-pressed={o.stickyColor === c.id} aria-label={t('color.' + c.id)} title={t('color.' + c.id)} onClick={() => engine.setStickyColor(c.id)} />)}
          </div>
        </div>
      );
    }
    if (tool === 'connector') {
      return (
        <div className="inspector" role="group" aria-label={t('inspector.label')}>
          {['elbow', 'straight', 'curve'].map((r) => <button key={r} className="btn" aria-pressed={o.connectorRoute === r} onClick={() => engine.setOpt('connectorRoute', r)}>{t('connector.' + r)}</button>)}
        </div>
      );
    }
    return (
      <div className="inspector" role="group" aria-label={t('inspector.label')}>
        <span className="lbl">{t('style.fill')}</span>
        <Swatches t={t} label={t('style.fill')} colors={FILLS.slice(0, 9)} value={o.fill} onPick={(c) => engine.setOpt('fill', c)} />
        <span className="sep" />
        <span className="lbl">{t('style.stroke')}</span>
        <Swatches t={t} label={t('style.stroke')} colors={PALETTE.slice(0, 10)} value={o.stroke} onPick={(c) => engine.setOpt('stroke', c)} />
      </div>
    );
  }

  // Selection options
  const hasText = [...types].some((x) => ['text', 'sticky', 'shape'].includes(x));
  const hasFill = [...types].some((x) => ['shape', 'table', 'checklist'].includes(x));
  const hasStroke = [...types].some((x) => ['shape', 'pen', 'connector', 'frame', 'table', 'checklist'].includes(x));
  const hasSticky = types.has('sticky');
  const locked = sel.every((s) => s.locked);
  const single = sel.length === 1;
  const textColorable = [...types].some((x) => ['text', 'shape', 'table', 'checklist'].includes(x));
  return (
    <div className="inspector" role="group" aria-label={t('inspector.label')}>
      {hasSticky && (
        <div className="swatches" role="group" aria-label={t('style.noteColor')}>
          {STICKY_COLORS.map((c) => <button key={c.id} className="swatch" style={{ background: c.fill }} aria-pressed={first.color === c.id} aria-label={t('color.' + c.id)} title={t('color.' + c.id)} onClick={() => engine.setStickyColor(c.id)} />)}
        </div>
      )}
      {hasFill && <><span className="lbl">{t('style.fill')}</span><Swatches t={t} label={t('style.fill')} colors={FILLS} value={first.fill} onPick={(c) => engine.setStyle({ fill: c })} /></>}
      {hasStroke && <><span className="lbl">{t('style.stroke')}</span><Swatches t={t} label={t('style.stroke')} colors={PALETTE.slice(0, 10)} value={first.stroke || first.color} onPick={(c) => engine.setStyle({ stroke: c })} /></>}
      {hasText && textColorable && <><span className="lbl">{t('style.text')}</span><Swatches t={t} label={t('style.textColor')} colors={PALETTE.slice(0, 6)} value={first.color} onPick={(c) => engine.setStyle({ color: c })} /></>}
      {hasText && (
        <div className="group" role="group" aria-label={t('style.text')}>
          <Btn icon="bold" label={t('style.bold')} pressed={!!first.bold} onClick={() => engine.setStyle({ bold: !first.bold })} />
          <Btn icon="italic" label={t('style.italic')} pressed={!!first.italic} onClick={() => engine.setStyle({ italic: !first.italic })} />
          <Btn icon="alignLeft" label={t('style.alignLeft')} pressed={first.align === 'left'} onClick={() => engine.setStyle({ align: 'left' })} />
          <Btn icon="alignCenter" label={t('style.alignCenter')} pressed={first.align === 'center'} onClick={() => engine.setStyle({ align: 'center' })} />
          <Btn icon="alignRight" label={t('style.alignRight')} pressed={first.align === 'right'} onClick={() => engine.setStyle({ align: 'right' })} />
          <label className="sr-only" htmlFor="fs">{t('style.fontSize')}</label>
          <input id="fs" className="select" style={{ width: 74, minHeight: 36 }} type="number" min={8} max={200} value={first.fontSize || 18} onChange={(e) => engine.setStyle({ fontSize: Math.max(8, Math.min(200, +e.target.value || 18)) })} />
        </div>
      )}
      {hasStroke && !types.has('pen') && (
        <><label className="lbl" htmlFor="sw">{t('style.width')}</label>
          <input id="sw" className="range" type="range" min={0} max={16} value={first.strokeWidth ?? 2} onChange={(e) => engine.setStyle({ strokeWidth: +e.target.value })} /></>
      )}
      {(types.has('pen') || types.has('shape') || types.has('image') || types.has('connector')) && (
        <><label className="lbl" htmlFor="op">{t('style.opacity')}</label>
          <input id="op" className="range" type="range" min={10} max={100} value={Math.round((first.opacity ?? 1) * 100)} onChange={(e) => engine.setStyle({ opacity: +e.target.value / 100 })} /></>
      )}
      {types.has('connector') && (
        <div className="group" role="group" aria-label={t('tool.connector')}>
          {['elbow', 'straight', 'curve'].map((r) => <button key={r} className="btn" aria-pressed={first.route === r} onClick={() => engine.store.updateMany(Object.fromEntries(sel.filter((s) => s.type === 'connector').map((s) => [s.id, { route: r }])), 'Connector style')}>{t('connector.' + r)}</button>)}
          <Btn icon="arrow" label={t('connector.arrowEnd')} pressed={!!first.arrowEnd} onClick={() => engine.store.updateMany(Object.fromEntries(sel.filter((s) => s.type === 'connector').map((s) => [s.id, { arrowEnd: !first.arrowEnd }])), 'Arrow')} />
        </div>
      )}
      <span className="sep" />
      <div className="group" role="group" aria-label={t('inspector.arrange')}>
        <Btn icon="front" label={t('cmd.bringFront')} onClick={() => engine.order('front')} />
        <Btn icon="back" label={t('cmd.sendBack')} onClick={() => engine.order('back')} />
        <Btn icon="copy" label={t('common.duplicate')} onClick={() => engine.duplicateSelection()} />
        <Btn icon={locked ? 'unlock' : 'lock'} label={locked ? t('cmd.unlock') : t('cmd.lock')} pressed={locked} onClick={() => engine.setLocked(!locked)} />
        {!single && <Btn icon="group" label={t('cmd.group')} onClick={() => engine.group()} />}
        {sel.some((s) => s.groupId) && <Btn icon="group" label={t('cmd.ungroup')} pressed onClick={() => engine.ungroup()} />}
        {!single && <button className="btn" aria-expanded={more} onClick={() => setMore((m) => !m)}><Icon name="align" /></button>}
        <Btn icon="trash" label={t('common.delete')} onClick={() => engine.deleteSelection()} />
      </div>
      {more && !single && (
        <div className="group" role="group" aria-label={t('cmd.align')}>
          {['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map((a) => <button key={a} className="btn" onClick={() => engine.align(a)}>{t('align.' + a)}</button>)}
          {sel.length > 2 && <><button className="btn" onClick={() => engine.distribute('h')}>{t('align.distH')}</button><button className="btn" onClick={() => engine.distribute('v')}>{t('align.distV')}</button></>}
        </div>
      )}
    </div>
  );
}
