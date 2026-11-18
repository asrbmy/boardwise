import { useEffect, useRef } from 'react';
import { boundsOf, contentBounds } from '../core/hit.js';
import { unionRects } from '../core/geometry.js';
import { STICKY_COLORS } from '../core/model.js';
import { visibleRect } from '../core/viewport.js';
import { useApp } from './common.jsx';

const W = 180, H = 120;

/** Bird's-eye view. Draws simple coloured rectangles (cheap even with thousands of objects). Click/drag to move the view. */
export default function Minimap({ engine, version }) {
  const { t, theme } = useApp();
  const ref = useRef(null);
  const geo = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const vr = visibleRect(engine.view, engine.size.w, engine.size.h);
    const content = contentBounds(engine.store);
    const world = unionRects([vr, ...(content ? [content] : [])]);
    const pad = 40;
    const s = Math.min((W - 8) / (world.w + pad), (H - 8) / (world.h + pad));
    const ox = (W - world.w * s) / 2 - world.x * s, oy = (H - world.h * s) / 2 - world.y * s;
    geo.current = { s, ox, oy };
    const dark = theme === 'dark';
    for (const id of engine.store.order) {
      const o = engine.store.get(id);
      const b = boundsOf(o, engine.store.objects);
      ctx.fillStyle = o.type === 'sticky' ? (STICKY_COLORS.find((k) => k.id === o.color)?.fill || '#fff176')
        : o.type === 'pen' ? (dark ? '#d0d4de' : '#555b66') : o.type === 'frame' ? 'transparent' : (dark ? '#5b6270' : '#b9bfcc');
      if (o.type === 'frame') { ctx.strokeStyle = dark ? '#8a91a0' : '#8a91a0'; ctx.strokeRect(b.x * s + ox, b.y * s + oy, Math.max(1, b.w * s), Math.max(1, b.h * s)); continue; }
      ctx.fillRect(b.x * s + ox, b.y * s + oy, Math.max(1.5, b.w * s), Math.max(1.5, b.h * s));
    }
    ctx.strokeStyle = dark ? '#8fb0ff' : '#1f4fd8'; ctx.lineWidth = 1.5;
    ctx.fillStyle = dark ? 'rgba(143,176,255,.14)' : 'rgba(31,79,216,.1)';
    ctx.fillRect(vr.x * s + ox, vr.y * s + oy, vr.w * s, vr.h * s);
    ctx.strokeRect(vr.x * s + ox, vr.y * s + oy, vr.w * s, vr.h * s);
  }, [engine, version, theme]);

  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    const { s, ox, oy } = geo.current;
    const wx = ((e.clientX - r.left) * (W / r.width) - ox) / s, wy = ((e.clientY - r.top) * (H / r.height) - oy) / s;
    const z = engine.view.zoom;
    engine.setView({ zoom: z, x: wx - engine.size.w / 2 / z, y: wy - engine.size.h / 2 / z });
  };
  return (
    <div className="minimap" role="img" aria-label={t('minimap.label')}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={(e) => { if (e.buttons) move(e); }}>
      <canvas ref={ref} />
    </div>
  );
}
