// Viewport math: world <-> screen conversion, zoom about a point, fit-to-rect.
// view = { x, y, zoom } where screen = (world - (x,y)) * zoom, i.e. (x,y) is the world point at the top-left.

import { MAX_ZOOM, MIN_ZOOM } from './model.js';
import { clamp } from './geometry.js';

export const toWorld = (view, sx, sy) => ({ x: sx / view.zoom + view.x, y: sy / view.zoom + view.y });
export const toScreen = (view, wx, wy) => ({ x: (wx - view.x) * view.zoom, y: (wy - view.y) * view.zoom });

export function zoomAt(view, factor, sx, sy) {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (zoom === view.zoom) return view;
  const w = toWorld(view, sx, sy);
  return { zoom, x: w.x - sx / zoom, y: w.y - sy / zoom };
}

export function setZoomAt(view, zoom, sx, sy) {
  return zoomAt(view, clamp(zoom, MIN_ZOOM, MAX_ZOOM) / view.zoom, sx, sy);
}

export function panBy(view, dxScreen, dyScreen) {
  return { ...view, x: view.x - dxScreen / view.zoom, y: view.y - dyScreen / view.zoom };
}

export function fitRect(rect, width, height, padding = 60, maxZoom = 1.5) {
  if (!rect || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const w = Math.max(rect.w, 1), h = Math.max(rect.h, 1);
  const zoom = clamp(Math.min((width - 2 * padding) / w, (height - 2 * padding) / h), MIN_ZOOM, maxZoom);
  return {
    zoom,
    x: rect.x + rect.w / 2 - width / 2 / zoom,
    y: rect.y + rect.h / 2 - height / 2 / zoom,
  };
}

export function visibleRect(view, width, height) {
  return { x: view.x, y: view.y, w: width / view.zoom, h: height / view.zoom };
}

/** Zoom steps used by the +/- buttons and keyboard. */
export const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
export function stepZoom(zoom, dir) {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? MIN_ZOOM;
}
