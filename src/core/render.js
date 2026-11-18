// Canvas renderer. Draws a board (or any list of objects) into a 2D context in world units.
// The caller sets the context transform; this module never touches the DOM except for Image decoding.

import { FONT, STICKY_COLORS, totalVotes } from './model.js';
import { center, rectsIntersect, shapePolygon } from './geometry.js';
import { boundsOf, lineEnds, resolveConnector } from './hit.js';


// ---------- theme ----------
export const THEMES = {
  light: {
    bg: '#fbfbfc', dot: '#c9ccd3', grid: '#e3e5ea', gridStrong: '#d3d6dd', line: '#dfe2e8',
    ink: '#1b1b1f', surface: '#ffffff', accent: '#1f4fd8', selection: '#1f4fd8', muted: '#6b7280',
  },
  dark: {
    bg: '#17181c', dot: '#3b3e46', grid: '#25272d', gridStrong: '#30333a', line: '#2a2c33',
    ink: '#ececf1', surface: '#24262c', accent: '#7aa2ff', selection: '#7aa2ff', muted: '#9aa0ab',
  },
};

/** Map the two "default" colours so a board stays legible in dark mode; everything else is left alone. */
export function themed(c, theme) {
  if (theme !== 'dark' || !c) return c;
  const k = c.toLowerCase();
  if (k === '#1b1b1f') return '#ececf1';
  if (k === '#ffffff' || k === '#fff') return '#24262c';
  return c;
}

// ---------- images ----------
const imageCache = new Map();
let onImageLoad = () => {};
export function setImageLoadHandler(fn) { onImageLoad = fn; }
export function getImage(src) {
  let e = imageCache.get(src);
  if (e) return e.ready ? e.img : null;
  const img = new Image();
  e = { img, ready: false };
  imageCache.set(src, e);
  img.onload = () => { e.ready = true; onImageLoad(); };
  img.onerror = () => { e.failed = true; };
  img.decoding = 'async';
  img.src = src;
  if (imageCache.size > 400) imageCache.delete(imageCache.keys().next().value);
  return null;
}
export function preloadImages(objects) {
  return Promise.all(
    objects.filter((o) => o.type === 'image').map(
      (o) => new Promise((res) => {
        const e = imageCache.get(o.src);
        if (e?.ready) return res();
        const img = e?.img || new Image();
        const entry = e || { img, ready: false };
        imageCache.set(o.src, entry);
        img.onload = () => { entry.ready = true; res(); };
        img.onerror = () => res();
        if (!e) img.src = o.src;
      })
    )
  );
}

// ---------- text layout ----------
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export const isRTL = (s) => RTL_RE.test(s || '');
export const fontFor = (o, size = o.fontSize) => `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${size}px ${FONT}`;

let measureCtx = null;
function mctx() {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  return measureCtx;
}

export function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (para === '') { out.push(''); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width <= maxWidth || line === '') {
        if (ctx.measureText(w).width > maxWidth && line === '') {
          // break very long words by character
          let chunk = '';
          for (const ch of w) {
            if (ctx.measureText(chunk + ch).width > maxWidth && chunk) { out.push(chunk); chunk = ch; } else chunk += ch;
          }
          line = chunk;
        } else line = test;
      } else {
        out.push(line.trimEnd());
        line = w.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

const layoutCache = new WeakMap();
export function layoutText(o, text, width, size = o.fontSize) {
  const key = `${width}|${size}|${o.bold}|${o.italic}|${text}`;
  const c = layoutCache.get(o);
  if (c && c.key === key) return c.lines;
  const ctx = mctx();
  ctx.font = fontFor(o, size);
  const lines = wrapLines(ctx, text, Math.max(10, width));
  layoutCache.set(o, { key, lines });
  return lines;
}

export const LINE_H = 1.3;

/** Height a text box needs for its content (used for auto-resizing). */
export function textBoxHeight(o, text = o.text, width = o.w) {
  const lines = layoutText({ ...o }, text || ' ', width - 12, o.fontSize);
  return Math.max(o.fontSize * LINE_H + 12, lines.length * o.fontSize * LINE_H + 12);
}

function drawTextBlock(ctx, o, text, box, { color, size = o.fontSize, vAlign = 'top', pad = 6 } = {}) {
  if (!text) return;
  const lines = layoutText(o, text, box.w - pad * 2, size);
  const lh = size * LINE_H;
  const total = lines.length * lh;
  let y = box.y + pad;
  if (vAlign === 'middle') y = box.y + (box.h - total) / 2;
  const rtl = isRTL(text);
  ctx.font = fontFor(o, size);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  const align = o.align || 'left';
  let ax, ta;
  if (align === 'center') { ax = box.x + box.w / 2; ta = 'center'; }
  else {
    const start = (align === 'left') !== rtl; // true => anchored to left edge
    ax = start ? box.x + pad : box.x + box.w - pad;
    ta = start ? 'left' : 'right';
  }
  ctx.textAlign = ta;
  for (let i = 0; i < lines.length; i++) {
    const ly = y + i * lh + lh / 2;
    if (ly - lh > box.y + box.h) break;
    ctx.fillText(lines[i], ax, ly);
  }
  ctx.direction = 'ltr';
}

/** Largest font size (<= o.fontSize) at which sticky text fits. */
export function fitFontSize(o, text, w, h) {
  let size = o.fontSize;
  while (size > 10) {
    const lines = layoutText(o, text, w - 24, size);
    if (lines.length * size * LINE_H <= h - 24) break;
    size -= 1;
  }
  return size;
}

// ---------- background ----------
export function drawBackground(ctx, view, w, h, mode, theme, gridSize = 24) {
  const t = THEMES[theme];
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, w, h);
  if (mode === 'plain') return;
  const z = view.zoom;
  let step = gridSize;
  while (step * z < 14) step *= 2;       // keep the pattern readable when zoomed out
  const sx = step * z;
  const ox = -((view.x * z) % sx), oy = -((view.y * z) % sx);
  ctx.save();
  if (mode === 'dots') {
    ctx.fillStyle = t.dot;
    const r = Math.max(0.9, Math.min(2, z * 1.1));
    for (let x = ox; x < w; x += sx) for (let y = oy; y < h; y += sx) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  } else if (mode === 'grid') {
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.grid;
    ctx.beginPath();
    for (let x = ox; x < w; x += sx) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    for (let y = oy; y < h; y += sx) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();
  } else if (mode === 'lines') {
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.line;
    ctx.beginPath();
    const ls = Math.max(sx * 1.5, 20);
    const loy = -((view.y * z) % ls);
    for (let y = loy; y < h; y += ls) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- shapes ----------
function setDash(ctx, dash, width) {
  if (dash === 'dashed') ctx.setLineDash([width * 4, width * 3]);
  else if (dash === 'dotted') ctx.setLineDash([width, width * 2.2]);
  else ctx.setLineDash([]);
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function arrowHead(ctx, tip, from, size, color) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(a - 0.45), tip.y - size * Math.sin(a - 0.45));
  ctx.lineTo(tip.x - size * Math.cos(a + 0.45), tip.y - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function withRotation(ctx, o, fn) {
  if (!o.rotation) return fn();
  const c = center(o);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(o.rotation);
  ctx.translate(-c.x, -c.y);
  fn();
  ctx.restore();
}

/** The area inside a shape that its label may use. */
export function shapeTextBox(o) {
  if (o.kind === 'triangle') return { x: o.x + o.w * 0.2, y: o.y + o.h * 0.35, w: o.w * 0.6, h: o.h * 0.6 };
  if (o.kind === 'diamond' || o.kind === 'star') return { x: o.x + o.w * 0.2, y: o.y + o.h * 0.2, w: o.w * 0.6, h: o.h * 0.6 };
  if (o.kind === 'ellipse') return { x: o.x + o.w * 0.1, y: o.y + o.h * 0.1, w: o.w * 0.8, h: o.h * 0.8 };
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

function drawShape(ctx, o, theme) {
  const stroke = themed(o.stroke, theme), fill = themed(o.fill, theme);
  ctx.globalAlpha = o.opacity;
  ctx.lineWidth = o.strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  setDash(ctx, o.dash, Math.max(1, o.strokeWidth));
  if (o.kind === 'line' || o.kind === 'arrow') {
    const [s, e] = lineEnds(o);
    ctx.strokeStyle = stroke;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    if (o.kind === 'arrow') arrowHead(ctx, e, s, 10 + o.strokeWidth * 2.5, stroke);
    ctx.globalAlpha = 1;
    return;
  }
  if (o.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.max(0.1, o.w / 2), Math.max(0.1, o.h / 2), 0, 0, Math.PI * 2);
  } else if (o.kind === 'round') roundRectPath(ctx, o.x, o.y, o.w, o.h, Math.min(o.w, o.h) * 0.2);
  else if (o.kind === 'rect') { ctx.beginPath(); ctx.rect(o.x, o.y, o.w, o.h); }
  else polyPath(ctx, shapePolygon(o.kind, o.x, o.y, o.w, o.h));
  if (fill && fill !== 'transparent') { ctx.fillStyle = fill; ctx.fill(); }
  if (o.strokeWidth > 0) { ctx.strokeStyle = stroke; ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  if (o.text) {
    drawTextBlock(ctx, o, o.text, shapeTextBox(o), { color: themed(o.color, theme), vAlign: 'middle' });
  }
}

// ---------- pen ----------
const penCache = new WeakMap();
function penPath(o) {
  let c = penCache.get(o);
  if (c) return c;
  const pts = o.pts;
  const variable = pts.some((p) => Math.abs(p[2] - pts[0][2]) > 0.05);
  const path = new Path2D();
  if (pts.length === 1) { path.moveTo(o.x + pts[0][0], o.y + pts[0][1]); path.lineTo(o.x + pts[0][0] + 0.01, o.y + pts[0][1]); }
  else {
    path.moveTo(o.x + pts[0][0], o.y + pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      path.quadraticCurveTo(o.x + pts[i][0], o.y + pts[i][1], o.x + mx, o.y + my);
    }
    const l = pts[pts.length - 1];
    path.lineTo(o.x + l[0], o.y + l[1]);
  }
  c = { path, variable };
  penCache.set(o, c);
  return c;
}

function drawPen(ctx, o, theme) {
  const { path, variable } = penPath(o);
  ctx.lineCap = o.highlighter ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  const col = themed(o.color, theme);
  ctx.strokeStyle = col;
  if (o.highlighter) {
    ctx.globalAlpha = 0.38 * o.opacity;
    ctx.globalCompositeOperation = theme === 'dark' ? 'screen' : 'multiply';
    ctx.lineWidth = o.width;
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = o.opacity;
  if (!variable) {
    ctx.lineWidth = o.width;
    ctx.stroke(path);
  } else {
    // Pressure: stroke short segments with width scaled by pressure.
    const pts = o.pts;
    for (let i = 1; i < pts.length; i++) {
      const p = (pts[i][2] + pts[i - 1][2]) / 2;
      ctx.lineWidth = Math.max(0.6, o.width * (0.35 + p * 1.3));
      ctx.beginPath();
      ctx.moveTo(o.x + pts[i - 1][0], o.y + pts[i - 1][1]);
      ctx.lineTo(o.x + pts[i][0], o.y + pts[i][1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- other objects ----------
function drawSticky(ctx, o, theme) {
  const col = STICKY_COLORS.find((c) => c.id === o.color) || STICKY_COLORS[0];
  ctx.save();
  ctx.shadowColor = theme === 'dark' ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.22)';
  ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = col.fill;
  roundRectPath(ctx, o.x, o.y, o.w, o.h, 6);
  ctx.fill();
  ctx.restore();
  const size = fitFontSize(o, o.text || ' ', o.w, o.h);
  drawTextBlock(ctx, o, o.text, { x: o.x + 6, y: o.y + 6, w: o.w - 12, h: o.h - 12 }, { color: '#1b1b1f', size, pad: 6, vAlign: 'top' });
  const votes = totalVotes(o);
  if (votes > 0) {
    const n = Math.min(votes, 12);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = '#d62839';
      ctx.beginPath();
      ctx.arc(o.x + o.w - 14 - (i % 6) * 14, o.y + o.h - 14 - Math.floor(i / 6) * 14, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (votes > 12) { ctx.fillStyle = '#1b1b1f'; ctx.font = `700 12px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`+${votes - 12}`, o.x + 8, o.y + o.h - 14); }
  }
}

function drawText(ctx, o, theme, editing) {
  if (editing) return;
  drawTextBlock(ctx, o, o.text, { x: o.x, y: o.y, w: o.w, h: o.h }, { color: themed(o.color, theme), pad: 6 });
}

function drawImage(ctx, o) {
  const img = getImage(o.src);
  ctx.globalAlpha = o.opacity;
  if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
  else { ctx.fillStyle = 'rgba(128,128,128,.2)'; ctx.fillRect(o.x, o.y, o.w, o.h); }
  ctx.globalAlpha = 1;
}

function drawFrame(ctx, o, theme, view) {
  const t = THEMES[theme];
  if (o.fill && o.fill !== 'transparent') { ctx.fillStyle = themed(o.fill, theme); ctx.fillRect(o.x, o.y, o.w, o.h); }
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = themed(o.stroke, theme);
  ctx.strokeRect(o.x, o.y, o.w, o.h);
  ctx.setLineDash([]);
  const fs = Math.max(12, 14 / Math.min(1, view?.zoom || 1));
  ctx.font = `600 ${fs}px ${FONT}`;
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  ctx.fillStyle = t.muted;
  const title = o.title || 'Frame';
  let shown = title;
  while (shown.length > 1 && ctx.measureText(shown).width > o.w) shown = shown.slice(0, -2) + '…';
  ctx.fillText(shown, o.x, o.y - 6);
}

function drawTable(ctx, o, theme) {
  const cw = o.w / o.cols, rh = o.h / o.rows;
  ctx.fillStyle = themed(o.fill, theme);
  ctx.fillRect(o.x, o.y, o.w, o.h);
  if (o.header) { ctx.fillStyle = theme === 'dark' ? '#33363f' : '#eef1f6'; ctx.fillRect(o.x, o.y, o.w, rh); }
  ctx.strokeStyle = themed(o.stroke, theme);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let r = 0; r <= o.rows; r++) { ctx.moveTo(o.x, o.y + r * rh); ctx.lineTo(o.x + o.w, o.y + r * rh); }
  for (let c = 0; c <= o.cols; c++) { ctx.moveTo(o.x + c * cw, o.y); ctx.lineTo(o.x + c * cw, o.y + o.h); }
  ctx.stroke();
  for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
    const txt = o.cells[r]?.[c];
    if (!txt) continue;
    const cell = { ...o, bold: o.header && r === 0, align: 'left' };
    ctx.save();
    ctx.beginPath(); ctx.rect(o.x + c * cw, o.y + r * rh, cw, rh); ctx.clip();
    drawTextBlock(ctx, cell, txt, { x: o.x + c * cw, y: o.y + r * rh, w: cw, h: rh }, { color: themed(o.color, theme), vAlign: 'middle', pad: 6 });
    ctx.restore();
  }
}

function drawChecklist(ctx, o, theme) {
  ctx.fillStyle = themed(o.fill, theme);
  roundRectPath(ctx, o.x, o.y, o.w, o.h, 8); ctx.fill();
  ctx.strokeStyle = themed(o.stroke, theme); ctx.lineWidth = 1.2; ctx.stroke();
  const ink = themed(o.color, theme);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `700 ${o.fontSize + 2}px ${FONT}`; ctx.fillStyle = ink;
  ctx.fillText(o.title, o.x + 12, o.y + 22, o.w - 24);
  const rowH = 32;
  o.items.forEach((it, i) => {
    const y = o.y + 44 + i * rowH + rowH / 2;
    ctx.strokeStyle = ink; ctx.lineWidth = 1.6;
    ctx.strokeRect(o.x + 12, y - 8, 16, 16);
    if (it.done) { ctx.beginPath(); ctx.moveTo(o.x + 15, y); ctx.lineTo(o.x + 19.5, y + 4.5); ctx.lineTo(o.x + 26, y - 5); ctx.stroke(); }
    ctx.font = `400 ${o.fontSize}px ${FONT}`;
    ctx.fillStyle = it.done ? THEMES[theme].muted : ink;
    const tx = o.x + 38;
    const text = it.text;
    ctx.fillText(text, tx, y, o.w - 52);
    if (it.done && text) { const w = Math.min(ctx.measureText(text).width, o.w - 52); ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(tx + w, y); ctx.lineWidth = 1.2; ctx.strokeStyle = THEMES[theme].muted; ctx.stroke(); }
  });
}

function drawStamp(ctx, o) {
  ctx.font = `${Math.min(o.w, o.h) * 0.82}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(o.emoji, o.x + o.w / 2, o.y + o.h / 2 + o.h * 0.04);
}

function drawConnector(ctx, o, objects, theme) {
  const r = resolveConnector(o, objects);
  const col = themed(o.stroke, theme);
  ctx.globalAlpha = o.opacity;
  ctx.lineWidth = o.strokeWidth; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  setDash(ctx, o.dash, Math.max(1, o.strokeWidth));
  ctx.beginPath();
  if (r.kind === 'curve') {
    ctx.moveTo(r.a.x, r.a.y);
    ctx.bezierCurveTo(r.ctrl[0].x, r.ctrl[0].y, r.ctrl[1].x, r.ctrl[1].y, r.b.x, r.b.y);
  } else {
    r.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  }
  ctx.stroke();
  const n = r.pts.length;
  const head = 9 + o.strokeWidth * 2.2;
  if (o.arrowEnd && n > 1) arrowHead(ctx, r.pts[n - 1], r.pts[n - 2], head, col);
  if (o.arrowStart && n > 1) arrowHead(ctx, r.pts[0], r.pts[1], head, col);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  if (o.label) {
    const mid = r.pts[Math.floor(r.pts.length / 2)];
    ctx.font = `500 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(o.label).width + 12;
    ctx.fillStyle = THEMES[theme].bg; ctx.fillRect(mid.x - w / 2, mid.y - 11, w, 22);
    ctx.fillStyle = themed('#1b1b1f', theme); ctx.fillText(o.label, mid.x, mid.y);
  }
}

export function drawObject(ctx, o, { objects, theme = 'light', editingId = null, view = null, lod = false } = {}) {
  if (o.type === 'connector') { drawConnector(ctx, o, objects, theme); return; }
  if (lod && lodBox(ctx, o, theme)) return;
  withRotation(ctx, o, () => {
    switch (o.type) {
      case 'pen': drawPen(ctx, o, theme); break;
      case 'shape': drawShape(ctx, o, theme); break;
      case 'sticky': if (editingId !== o.id) drawSticky(ctx, o, theme); else drawSticky(ctx, { ...o, text: '' }, theme); break;
      case 'text': drawText(ctx, o, theme, editingId === o.id); break;
      case 'image': drawImage(ctx, o); break;
      case 'frame': drawFrame(ctx, o, theme, view); break;
      case 'table': drawTable(ctx, o, theme); break;
      case 'checklist': drawChecklist(ctx, o, theme); break;
      case 'stamp': drawStamp(ctx, o); break;
      default: break;
    }
  });
}

/**
 * Level of detail for zoomed-out views: below ~35% zoom text is unreadable and shadows are costly,
 * so objects are drawn as flat boxes. Returns true if the object was fully handled.
 */
function lodBox(ctx, o, theme) {
  switch (o.type) {
    case 'sticky': {
      const col = STICKY_COLORS.find((c) => c.id === o.color) || STICKY_COLORS[0];
      ctx.fillStyle = col.fill; ctx.fillRect(o.x, o.y, o.w, o.h); return !o.rotation;
    }
    case 'shape': {
      if (o.kind === 'line' || o.kind === 'arrow' || o.rotation) return false;
      const f = themed(o.fill, theme);
      if (f && f !== 'transparent') { ctx.fillStyle = f; ctx.fillRect(o.x, o.y, o.w, o.h); }
      ctx.lineWidth = Math.max(o.strokeWidth, 1.5 / (ctx.getTransform().a || 1)); ctx.strokeStyle = themed(o.stroke, theme); ctx.strokeRect(o.x, o.y, o.w, o.h); return true;
    }
    case 'text': ctx.fillStyle = themed(o.color, theme); ctx.globalAlpha = 0.45; ctx.fillRect(o.x + 4, o.y + o.h * 0.35, Math.max(8, o.w - 8), Math.max(2, o.h * 0.25)); ctx.globalAlpha = 1; return true;
    case 'table': case 'checklist': ctx.fillStyle = themed(o.fill, theme); ctx.fillRect(o.x, o.y, o.w, o.h); ctx.lineWidth = 1.5 / (ctx.getTransform().a || 1); ctx.strokeStyle = themed(o.stroke, theme); ctx.strokeRect(o.x, o.y, o.w, o.h); return !o.rotation;
    case 'stamp': ctx.fillStyle = '#f2b705'; ctx.fillRect(o.x + o.w * 0.15, o.y + o.h * 0.15, o.w * 0.7, o.h * 0.7); return true;
    default: return false; // pens, images, frames, connectors keep their normal rendering
  }
}

/** Draw all visible objects (culled). Returns number drawn. */
export function drawObjects(ctx, store, visible, opts) {
  let n = 0;
  const pad = 40;
  const lod = !!opts?.view && opts.view.zoom < 0.35;
  const vis = visible && { x: visible.x - pad, y: visible.y - pad, w: visible.w + pad * 2, h: visible.h + pad * 2 };
  for (const id of store.order) {
    const o = store.objects[id];
    if (!o) continue;
    if (vis) {
      let b = boundsOf(o, store.objects);
      if (o.type === 'frame') b = { x: b.x, y: b.y - 40, w: b.w, h: b.h + 40 }; // title sits above the frame
      else if (o.type === 'sticky' || o.type === 'shape') b = { x: b.x - 12, y: b.y - 12, w: b.w + 24, h: b.h + 24 }; // shadow / stroke
      if (!rectsIntersect(b, vis)) continue;
    }
    drawObject(ctx, o, { objects: store.objects, ...opts, lod });
    n++;
  }
  return n;
}
