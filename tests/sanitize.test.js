import { describe, it, expect } from 'vitest';
import { sanitizeSvg, htmlToText, parseCSV, textToNotes, cleanText, svgSize, isSafeImageDataUrl } from '../src/core/sanitize.js';

describe('SVG sanitiser', () => {
  const wrap = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" ${attrs}>${inner}</svg>`;
  it('keeps safe shapes', () => {
    const out = sanitizeSvg(wrap('<rect x="1" y="2" width="10" height="10" fill="#f00"/><circle cx="5" cy="5" r="3"/>'));
    expect(out).toContain('<rect'); expect(out).toContain('<circle');
  });
  it('removes script, foreignObject, event handlers, external refs', () => {
    const out = sanitizeSvg(wrap(
      '<script>alert(1)</script><foreignObject><div>x</div></foreignObject>' +
      '<rect width="5" height="5" onclick="alert(1)" onload="x()"/>' +
      '<image href="https://evil.example/a.png"/><a href="javascript:alert(1)"><text>t</text></a>' +
      '<use href="https://evil.example/s.svg#a"/><use href="#ok"/>', 'onload="alert(1)"'));
    expect(out).not.toMatch(/script|foreignObject|onclick|onload|evil\.example|javascript:|<image|<a[ >]/i);
    expect(out).toContain('href="#ok"');
  });
  it('strips risky css and external url() references', () => {
    const out = sanitizeSvg(wrap('<rect width="5" height="5" style="fill:red;background:url(http://evil/x)" fill="url(http://evil/y)"/><rect width="1" height="1" fill="url(#g)"/><style>@import url(x)</style>'));
    expect(out).not.toMatch(/evil|@import|<style/);
    expect(out).toContain('fill:red'); expect(out).toContain('url(#g)');
  });
  it('rejects non-SVG, malformed XML, entity bombs and oversize', () => {
    expect(() => sanitizeSvg('<html></html>')).toThrow(/valid SVG/);
    expect(() => sanitizeSvg('<svg><rect></svg>')).toThrow(/valid SVG/);
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "aaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')).toThrow(/entity/i);
    expect(() => sanitizeSvg('<svg>' + 'x'.repeat(3 * 1024 * 1024) + '</svg>')).toThrow(/too large/i);
    expect(() => sanitizeSvg(null)).toThrow();
  });
  it('reads natural size', () => {
    expect(svgSize('<svg viewBox="0 0 200 100">')).toEqual({ w: 200, h: 100 });
    expect(svgSize('<svg width="40" height="30">')).toEqual({ w: 40, h: 30 });
  });
});

describe('text import', () => {
  it('html → plain text, no scripts', () => {
    const t = htmlToText('<p>Hello</p><script>alert(1)</script><div>World<br>again</div><img src=x onerror=alert(1)>');
    expect(t).toContain('Hello'); expect(t).toContain('World'); expect(t).not.toMatch(/alert|script/);
  });
  it('parses quoted CSV', () => {
    expect(parseCSV('a,"b,c",d\n"x ""y""",2,3')).toEqual([['a', 'b,c', 'd'], ['x "y"', '2', '3']]);
  });
  it('parses TSV', () => { expect(parseCSV('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]); });
  it('lines and bullets become notes', () => {
    expect(textToNotes('- one\n* two\n3. three\n\nfour')).toEqual(['one', 'two', 'three', 'four']);
  });
  it('csv becomes notes per cell, capped', () => {
    expect(textToNotes('a,b\nc,d')).toEqual(['a', 'b', 'c', 'd']);
    expect(textToNotes(Array.from({ length: 1000 }, (_, i) => 'n' + i).join('\n'))).toHaveLength(300);
  });
  it('cleanText strips control chars and caps length', () => {
    expect(cleanText('a\u0000\u0007b\nc')).toBe('ab\nc');
    expect(cleanText('abcdef', 3)).toBe('abc');
  });
  it('image data-url allow-list', () => {
    expect(isSafeImageDataUrl('data:image/png;base64,AA')).toBe(true);
    expect(isSafeImageDataUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeImageDataUrl('javascript:alert(1)')).toBe(false);
  });
});
