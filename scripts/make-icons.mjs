// Generates the PWA PNG icons with no dependencies (pure zlib + a tiny rasteriser).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const s = size / 512;
  const inRound = (x, y, rx, ry, rw, rh, r) => {
    if (x < rx || y < ry || x > rx + rw || y > ry + rh) return false;
    const cx = Math.min(Math.max(x, rx + r), rx + rw - r), cy = Math.min(Math.max(y, ry + r), ry + rh - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const distSeg = (px, py, pts) => { let best = 1e9; for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy)); } return best; };
  const line = [[170, 360], [215, 340], [260, 335], [300, 310], [345, 285], [392, 250]];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const X = x / s, Y = y / s;
      let c = [0, 0, 0, 0];
      if (inRound(X, Y, 0, 0, 512, 512, 112)) c = [0x1f, 0x4f, 0xd8, 255];
      if (inRound(X, Y, 96, 112, 320, 288, 28)) c = [255, 255, 255, 255];
      if (inRound(X, Y, 136, 152, 112, 112, 10)) c = [0xff, 0xe0, 0x8a, 255];
      if (distSeg(X, Y, line) < 11) c = [0x1f, 0x4f, 0xd8, 255];
      if ((X - 370) ** 2 + (Y - 190) ** 2 < 26 * 26) c = [0xd6, 0x28, 0x39, 255];
      raw.set(c, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [192, 512]) writeFileSync(new URL(`../public/icon-${n}.png`, import.meta.url), png(n));
console.log('icons written');
