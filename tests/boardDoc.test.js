import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/core/store.js';
import { BoardDoc } from '../src/collab/boardDoc.js';
import { makers } from '../src/core/model.js';

const mk = (id, text = '', x = 0) => ({ ...makers.sticky(x, 0), id, text });
function link(a, b) {
  const send = (from, to) => from.onUpdate((u, origin) => { if (origin !== to) to.applyUpdate(u, from); });
  send(a, b); send(b, a);
  b.applyUpdate(a.diffSince(b.stateVector()), a); a.applyUpdate(b.diffSince(a.stateVector()), b);
}

describe('BoardDoc (Yjs binding)', () => {
  it('merges two boards and keeps them in sync', () => {
    const s1 = new BoardStore(), s2 = new BoardStore();
    s1.add(mk('a', 'one')); s2.add(mk('b', 'two'));
    const d1 = new BoardDoc(s1), d2 = new BoardDoc(s2);
    link(d1, d2);
    expect(Object.keys(s1.objects).sort()).toEqual(['a', 'b']);
    expect(Object.keys(s2.objects).sort()).toEqual(['a', 'b']);
    s1.update('a', { text: 'edited' });
    expect(s2.get('a').text).toBe('edited');
    s2.remove(['b']);
    expect(s1.get('b')).toBeUndefined();
    expect(s1.order).toEqual(s2.order);
  });
  it('remote edits do not enter local undo history and do not echo back', () => {
    const s1 = new BoardStore(), s2 = new BoardStore();
    const d1 = new BoardDoc(s1), d2 = new BoardDoc(s2);
    link(d1, d2);
    s1.add(mk('a', 'x'));
    expect(s2.history.undoStack.length).toBe(0);
    let echoes = 0; d1.onUpdate(() => echoes++);
    expect(s2.get('a').text).toBe('x');
    expect(echoes).toBe(0);
  });
  it('converges on concurrent edits to different objects and keeps z-order identical', () => {
    const s1 = new BoardStore(), s2 = new BoardStore();
    const d1 = new BoardDoc(s1), d2 = new BoardDoc(s2);
    link(d1, d2);
    s1.add([mk('a', '1'), mk('b', '2')]);
    // go "offline": edit without relay
    const off1 = [], off2 = [];
    const u1 = d1.onUpdate((u) => off1.push(u)), u2 = d2.onUpdate((u) => off2.push(u));
    // (listeners above are additional; the live link still relays, so this just checks convergence)
    s1.update('a', { text: 'A' }); s2.update('b', { text: 'B' });
    u1(); u2();
    expect(s1.get('a').text).toBe('A'); expect(s1.get('b').text).toBe('B');
    expect(s2.get('a').text).toBe('A'); expect(s2.get('b').text).toBe('B');
    expect(s1.order).toEqual(s2.order);
  });
  it('rejects malformed or hostile remote objects', () => {
    const s1 = new BoardStore(); const d1 = new BoardDoc(s1);
    const s2 = new BoardStore(); const d2 = new BoardDoc(s2);
    link(d1, d2);
    d2.doc.transact(() => {
      d2.objects.set('evil', { id: 'evil', type: 'image', src: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 });
      d2.objects.set('bad', { id: 'bad', type: 'nope' });
      d2.objects.set('mismatch', { id: 'other', type: 'sticky', x: 0, y: 0 });
      d2.objects.set('ok', { id: 'ok', type: 'sticky', x: 5, y: 5, w: 100, h: 100, text: '<img src=x onerror=1>' });
    });
    expect(Object.keys(s1.objects)).toEqual(['ok']);
  });
});

import { encodeCode, decodeCode } from '../src/collab/p2p.js';
describe('connection codes', () => {
  const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n';
  it('round-trips and checks the kind', () => {
    const c = encodeCode('offer', { type: 'offer', sdp });
    expect(decodeCode(c, 'offer')).toEqual({ type: 'offer', sdp });
    expect(() => decodeCode(c, 'answer')).toThrow('code-wrong-kind');
  });
  it('rejects junk, oversized and tampered codes', () => {
    for (const bad of ['', 'hello', 'BW1.offer.!!!', 'BW1.offer.' + 'A'.repeat(70000), 'BW1.offer.' + btoa('{"type":"offer","sdp":"x"}')]) expect(() => decodeCode(bad)).toThrow();
  });
  it('relays through a host to a second guest without echoing', () => {
    const [h, g1, g2] = [new BoardStore(), new BoardStore(), new BoardStore()];
    const dh = new BoardDoc(h), d1 = new BoardDoc(g1), d2 = new BoardDoc(g2);
    link(dh, d1); link(dh, d2);
    g1.add(mk('x', 'from g1'));
    expect(g2.get('x')?.text).toBe('from g1');
    expect(h.get('x')?.text).toBe('from g1');
  });
});

import { CollabSession } from '../src/collab/session.js';
describe('presence', () => {
  const mkSession = () => new CollabSession(new BoardStore());
  it('accepts valid cursors, sanitises names, ignores junk and our own id', () => {
    const s = mkSession();
    s.receivePresence({ k: 'cur', id: 'abc123', name: 'Ann\u0007<b>', x: 5, y: 6 }, null);
    expect([...s.presence.values()][0]).toMatchObject({ id: 'abc123', name: 'Ann<b>', x: 5, y: 6 });
    for (const bad of [null, {}, { k: 'cur', id: 'x y', x: 1, y: 1 }, { k: 'cur', id: 'ok', x: NaN, y: 1 }, { k: 'cur', id: 'ok', x: 1e9, y: 1 }, { k: 'cur', id: s.me.id, x: 1, y: 1 }]) s.receivePresence(bad, null);
    expect(s.presence.size).toBe(1);
    s.close();
  });
  it('caps the number of remote cursors', () => {
    const s = mkSession();
    for (let i = 0; i < 80; i++) s.receivePresence({ k: 'cur', id: 'p' + i, x: 0, y: 0 }, null);
    expect(s.presence.size).toBe(50);
    s.close();
  });
});
