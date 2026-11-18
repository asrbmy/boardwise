// Sanitisers for everything that comes from outside: SVG files, pasted HTML, text, CSV.
// Strategy: parse, then rebuild from an allow-list. Never insert untrusted markup with innerHTML.

export const LIMITS = {
  jsonBytes: 40 * 1024 * 1024,
  backupBytes: 200 * 1024 * 1024,
  svgBytes: 2 * 1024 * 1024,
  imageBytes: 12 * 1024 * 1024,
  storedImageBytes: 1.5 * 1024 * 1024,
  maxObjects: 20000,
  maxPenPoints: 20000,
  maxText: 20000,
  maxBoards: 500,
  maxImageDim: 2048,
  maxPasteLines: 300,
};

export class ImportError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'symbol', 'marker', 'pattern',
]);

const SVG_ATTRS = new Set([
  'id', 'class', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'font-family', 'font-size',
  'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'dx', 'dy', 'preserveaspectratio', 'xmlns',
  'clip-path', 'mask', 'clip-rule', 'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight',
  'refx', 'refy', 'orient', 'patternunits', 'patterntransform', 'fx', 'fy', 'spreadmethod', 'href', 'xlink:href',
  'version', 'aria-label', 'role', 'style',
]);

const SAFE_URL_REF = /^url\(\s*#[\w\-.:]+\s*\)$/i;

function safeStyle(value) {
  // Keep only simple declarations without url(), expression(), @import or javascript:
  return value
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/url\s*\(|expression|@import|javascript:|behavior|-moz-binding/i.test(d))
    .filter((d) => /^[a-z-]+\s*:\s*[^{}<>]*$/i.test(d))
    .join(';');
}

/** Returns a sanitised SVG string, or throws ImportError. */
export function sanitizeSvg(text) {
  if (typeof text !== 'string') throw new ImportError('Not an SVG file.');
  if (text.length > LIMITS.svgBytes) throw new ImportError('SVG is too large (limit 2 MB).', 'too-large');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) throw new ImportError('SVG contains unsupported entity declarations.');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new ImportError('This file is not a valid SVG.');
  }
  const out = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
  const outRoot = out.documentElement;
  let nodes = 0;

  const copy = (src, dst) => {
    for (const child of Array.from(src.childNodes)) {
      if (++nodes > 20000) throw new ImportError('SVG is too complex.', 'too-large');
      if (child.nodeType === 3) {
        if (/^(text|tspan|title|desc)$/i.test(src.localName)) dst.appendChild(out.createTextNode(child.nodeValue.slice(0, 2000)));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const name = child.localName.toLowerCase();
      if (!SVG_ELEMENTS.has(name)) continue; // drops script, foreignObject, image, a, style, animate...
      const el = out.createElementNS('http://www.w3.org/2000/svg', child.localName);
      copyAttrs(child, el, name);
      copy(child, el);
      dst.appendChild(el);
    }
  };

  const copyAttrs = (src, dst, name) => {
    for (const attr of Array.from(src.attributes)) {
      const n = attr.name.toLowerCase();
      let v = attr.value;
      if (n.startsWith('on') || !SVG_ATTRS.has(n)) continue;
      if (n === 'href' || n === 'xlink:href') {
        if (name !== 'use' && name !== 'lineargradient' && name !== 'radialgradient' && name !== 'pattern') continue;
        if (!/^#[\w\-.:]+$/.test(v)) continue; // internal references only
      }
      if (n === 'style') {
        v = safeStyle(v);
        if (!v) continue;
      }
      if (/(^|[\s(])javascript:/i.test(v) || /data:text\/html/i.test(v)) continue;
      if (/url\s*\(/i.test(v) && !SAFE_URL_REF.test(v.trim())) continue;
      if (n === 'xlink:href') dst.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', v);
      else dst.setAttribute(attr.name, v.slice(0, 20000));
    }
  };

  copyAttrs(root, outRoot, 'svg');
  copy(root, outRoot);
  outRoot.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(outRoot);
}

export function svgToDataUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Natural size of a sanitised SVG string (from width/height or viewBox). */
export function svgSize(svg) {
  const m = /viewBox="([\d.\s,-]+)"/i.exec(svg);
  const w = /\swidth="([\d.]+)(px)?"/i.exec(svg), h = /\sheight="([\d.]+)(px)?"/i.exec(svg);
  if (w && h) return { w: parseFloat(w[1]), h: parseFloat(h[1]) };
  if (m) {
    const [, , vw, vh] = m[1].trim().split(/[\s,]+/).map(Number);
    if (vw > 0 && vh > 0) return { w: vw, h: vh };
  }
  return { w: 300, h: 200 };
}

/** Strip control characters and cap the length of user text. */
export function cleanText(s, max = LIMITS.maxText) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

/** Extract plain text from pasted HTML without ever inserting it into the live DOM. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html).slice(0, 2_000_000), 'text/html');
  doc.querySelectorAll('script,style,template,noscript,iframe,object,embed').forEach((n) => n.remove());
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6').forEach((n) => n.append('\n'));
  doc.querySelectorAll('td,th').forEach((n) => n.append('\t'));
  return cleanText((doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim());
}

/** Minimal RFC 4180 CSV/TSV parser. Returns array of rows. */
export function parseCSV(text, delimiter) {
  const src = cleanText(text, 2_000_000);
  if (!delimiter) {
    const first = src.split('\n', 1)[0];
    delimiter = (first.match(/\t/g) || []).length >= (first.match(/,/g) || []).length && first.includes('\t') ? '\t' : ',';
  }
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** Turn pasted text/CSV into a list of sticky-note texts. */
export function textToNotes(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const looksTabular = /\t/.test(t) || (/,/.test(t) && t.split('\n').length > 1 && t.split('\n').every((l) => l.includes(',')));
  let items;
  if (looksTabular) {
    items = parseCSV(t).flat().map((s) => s.trim()).filter(Boolean);
  } else {
    items = t.split(/\n+/).map((s) => s.replace(/^\s*[-*•\d.)]+\s+/, '').trim()).filter(Boolean);
  }
  return items.slice(0, LIMITS.maxPasteLines).map((s) => cleanText(s, 500));
}

export function isSafeImageDataUrl(src) {
  return typeof src === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)(;charset=[\w-]+)?(;base64)?,/i.test(src);
}
