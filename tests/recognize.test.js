import { describe, it, expect } from 'vitest';
import { recognizeShape } from '../src/core/recognize.js';

const line = (a, b, n = 20) => Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const path = (...ps) => ps.flatMap((p, i) => (i ? line(ps[i - 1], p) : []));
const jitter = (pts) => pts.map((p, i) => ({ x: p.x + Math.sin(i) * 1.2, y: p.y + Math.cos(i * 2) * 1.2 }));

describe('ink to shape (local)', () => {
  it('recognises a line', () => {
    const r = recognizeShape(jitter(line({ x: 0, y: 0 }, { x: 200, y: 40 }, 30)));
    expect(r.kind).toBe('line'); expect(r.flipX).toBe(false); expect(r.w).toBeGreaterThan(150);
  });
  it('flags reversed line direction', () => {
    expect(recognizeShape(line({ x: 200, y: 0 }, { x: 0, y: 0 }, 20)).flipX).toBe(true);
  });
  it('recognises a rectangle', () => {
    const r = recognizeShape(jitter(path({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }, { x: 3, y: 4 })));
    expect(r.kind).toBe('rect');
  });
  it('recognises a triangle', () => {
    const r = recognizeShape(jitter(path({ x: 100, y: 0 }, { x: 200, y: 160 }, { x: 0, y: 160 }, { x: 100, y: 3 })));
    expect(r.kind).toBe('triangle');
  });
  it('recognises a diamond', () => {
    const r = recognizeShape(jitter(path({ x: 100, y: 0 }, { x: 200, y: 80 }, { x: 100, y: 160 }, { x: 0, y: 80 }, { x: 100, y: 3 })));
    expect(r.kind).toBe('diamond');
  });
  it('recognises an ellipse', () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ x: 100 + 100 * Math.cos((i / 60) * Math.PI * 2), y: 60 + 60 * Math.sin((i / 60) * Math.PI * 2) }));
    expect(recognizeShape(jitter(pts)).kind).toBe('ellipse');
  });
  it('leaves scribbles and tiny strokes alone', () => {
    const scribble = Array.from({ length: 80 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 2) * 40 }));
    expect(recognizeShape(scribble)).toBeNull();
    expect(recognizeShape(line({ x: 0, y: 0 }, { x: 5, y: 5 }, 10))).toBeNull();
    expect(recognizeShape([])).toBeNull();
  });
});
