// Image intake: validate, decode, downscale to a safe size and return a data URL stored with the board.
import { ImportError, LIMITS, sanitizeSvg, svgSize, svgToDataUrl } from '../core/sanitize.js';

const OK = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new ImportError('This image could not be read.'));
    img.src = url;
  });
}

export async function fileToImage(file) {
  if (!file || !OK.test(file.type)) throw new ImportError('Unsupported image type. Use PNG, JPEG, WebP, GIF or SVG.');
  if (file.size > LIMITS.imageBytes) throw new ImportError(`Image is too large (limit ${Math.round(LIMITS.imageBytes / 1048576)} MB).`, 'too-large');
  if (file.type === 'image/svg+xml') {
    const svg = sanitizeSvg(await file.text());
    const { w, h } = svgSize(svg);
    return { src: svgToDataUrl(svg), w, h };
  }
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(blobUrl);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) throw new ImportError('This image has no pixels.');
    const scale = Math.min(1, LIMITS.maxImageDim / Math.max(nw, nh));
    let w = Math.max(1, Math.round(nw * scale)), h = Math.max(1, Math.round(nh * scale));
    const keepPng = file.type === 'image/png' && file.size < 400 * 1024;
    for (let attempt = 0; attempt < 6; attempt++) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const q = Math.max(0.5, 0.88 - attempt * 0.08);
      const type = keepPng && attempt === 0 ? 'image/png' : 'image/webp';
      const src = c.toDataURL(type, q);
      if (src.length <= LIMITS.storedImageBytes * 1.37) return { src, w: nw, h: nh };
      w = Math.round(w * 0.8); h = Math.round(h * 0.8);
    }
    throw new ImportError('Image is still too large after shrinking.', 'too-large');
  } finally { URL.revokeObjectURL(blobUrl); }
}
