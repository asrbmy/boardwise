// Minimal PDF 1.4 writer: one page per image (JPEG, DCTDecode). No dependencies, no network.
// Page size is the image size at 96 dpi (px * 0.75 pt), so frames export at their on-board proportions.

const enc = new TextEncoder();

export function buildPdf(pages, { title = 'Boardwise export' } = {}) {
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); pos += b.length; };
  const obj = (id, body) => { offsets[id] = pos; push(`${id} 0 obj\n`); push(body); push('\nendobj\n'); };
  const objStream = (id, dict, bytes) => { offsets[id] = pos; push(`${id} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`); push(bytes); push('\nendstream\nendobj\n'); };

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  // ids: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const pageIds = pages.map((_, i) => 4 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  obj(3, `<< /Title (${pdfString(title)}) /Producer (Boardwise) >>`);
  pages.forEach((pg, i) => {
    const pid = 4 + i * 3, cid = pid + 1, iid = pid + 2;
    const w = Math.max(1, Math.round(pg.w * 0.75 * 100) / 100), h = Math.max(1, Math.round(pg.h * 0.75 * 100) / 100);
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
    const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    objStream(cid, '', content);
    objStream(iid, `/Type /XObject /Subtype /Image /Width ${pg.pxW} /Height ${pg.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, pg.jpeg);
  });
  const count = 4 + pages.length * 3;
  const xref = pos;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function pdfString(s) {
  // Title as ASCII-safe literal; non-ASCII becomes '?' to keep the file valid without a font/encoding setup.
  return String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1').slice(0, 120);
}

/** Read the pixel size from a JPEG byte stream (SOFn marker). */
export function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}
