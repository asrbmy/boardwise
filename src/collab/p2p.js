// OPTIONAL peer-to-peer collaboration over WebRTC with MANUAL copy-paste signalling.
// No server is contacted. By default no STUN/TURN servers are configured, so peers must be able to
// reach each other directly (same network / same machine). An optional STUN URL may be entered by the
// user; using it is the only way this feature contacts a third party, and it is off unless typed in.

const MAX_CODE = 64_000;        // characters accepted when pasting a connection code
const CHUNK = 16_000;           // bytes per data-channel message
const MAX_MESSAGE = 32_000_000; // reassembled message cap
const T_SYNC1 = 1, T_UPDATE = 2, T_PRESENCE = 3;

// ---- connection codes ----
const b64 = {
  enc: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); },
};

export function encodeCode(kind, desc) {
  return 'BW1.' + kind + '.' + b64.enc(JSON.stringify({ type: desc.type, sdp: desc.sdp }));
}
export function decodeCode(code, expectKind) {
  const text = String(code || '').trim().replace(/\s+/g, '');
  if (text.length > MAX_CODE) throw new Error('code-too-long');
  const m = /^BW1\.(offer|answer)\.([A-Za-z0-9_-]+)$/.exec(text);
  if (!m) throw new Error('code-invalid');
  if (expectKind && m[1] !== expectKind) throw new Error('code-wrong-kind');
  let d;
  try { d = JSON.parse(b64.dec(m[2])); } catch { throw new Error('code-invalid'); }
  if (!d || d.type !== m[1] || typeof d.sdp !== 'string' || d.sdp.length > MAX_CODE * 2 || !d.sdp.startsWith('v=0')) throw new Error('code-invalid');
  return { type: d.type, sdp: d.sdp };
}

function waitIce(pc, ms = 4000) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const done = () => { pc.removeEventListener('icegatheringstatechange', chk); clearTimeout(t); res(); };
    const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', chk);
  });
}

/** One connection to one peer. Create with Peer.host() / Peer.join(), then bind a BoardDoc with attach(). */
export class Peer {
  constructor({ stun = '' } = {}) {
    const iceServers = stun && /^stuns?:[\w.:-]+$/i.test(stun.trim()) ? [{ urls: stun.trim() }] : [];
    this.pc = new RTCPeerConnection({ iceServers });
    this.state = 'new'; // new | waiting | connecting | connected | closed | failed
    this.listeners = new Set();
    this.channel = null;
    this.inbox = new Map();
    this.msgId = 0;
    this.boardDoc = null;
    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      if (s === 'failed') this._set('failed'); else if (s === 'closed' || s === 'disconnected') this._set('closed');
    });
  }
  onState(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _set(s) { if (this.state === s) return; this.state = s; for (const fn of this.listeners) fn(s); }

  /** Step 1 (host): returns an offer code to send to the guest. */
  async createOffer() {
    this.channel = this.pc.createDataChannel('boardwise', { ordered: true });
    this._wire(this.channel);
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitIce(this.pc);
    this._set('waiting');
    return encodeCode('offer', this.pc.localDescription);
  }
  /** Step 2 (guest): accept an offer code, returns an answer code to send back. */
  async acceptOffer(code) {
    const offer = decodeCode(code, 'offer');
    this.pc.addEventListener('datachannel', (e) => { this.channel = e.channel; this._wire(e.channel); });
    await this.pc.setRemoteDescription(offer);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitIce(this.pc);
    this._set('connecting');
    return encodeCode('answer', this.pc.localDescription);
  }
  /** Step 3 (host): accept the guest's answer code. */
  async acceptAnswer(code) {
    const answer = decodeCode(code, 'answer');
    await this.pc.setRemoteDescription(answer);
    this._set('connecting');
  }

  _wire(ch) {
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => { this._set('connected'); this._hello(); };
    ch.onclose = () => this._set('closed');
    ch.onmessage = (e) => this._recv(new Uint8Array(e.data));
  }

  attach(boardDoc) {
    this.boardDoc = boardDoc;
    this.off = boardDoc.onUpdate((u, origin) => { if (origin !== this) this._send(T_UPDATE, u); });
    if (this.channel?.readyState === 'open') this._hello();
  }
  /** Small JSON message (cursor position, name). Dropped silently if the channel is not open. */
  sendPresence(obj) { this._send(T_PRESENCE, new TextEncoder().encode(JSON.stringify(obj))); }
  _hello() { if (this.boardDoc && this.channel?.readyState === 'open') this._send(T_SYNC1, this.boardDoc.stateVector()); }

  _send(type, bytes) {
    const ch = this.channel;
    if (!ch || ch.readyState !== 'open') return;
    const id = ++this.msgId, total = Math.max(1, Math.ceil(bytes.length / CHUNK));
    for (let i = 0; i < total; i++) {
      const part = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
      const out = new Uint8Array(10 + part.length), dv = new DataView(out.buffer);
      out[0] = type; dv.setUint32(1, id); dv.setUint16(5, i); dv.setUint16(7, total); out[9] = 0; out.set(part, 10);
      ch.send(out);
    }
  }
  _recv(buf) {
    if (buf.length < 10) return;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const type = buf[0], id = dv.getUint32(1), i = dv.getUint16(5), total = dv.getUint16(7);
    if (!total || i >= total || (type < 1 || type > 3)) return;
    let m = this.inbox.get(id);
    if (!m) { m = { type, total, parts: [], size: 0 }; this.inbox.set(id, m); if (this.inbox.size > 32) this.inbox.delete(this.inbox.keys().next().value); }
    if (m.parts[i]) return;
    m.parts[i] = buf.subarray(10); m.size += buf.length - 10;
    if (m.size > MAX_MESSAGE) { this.inbox.delete(id); return; }
    if (m.parts.filter(Boolean).length < m.total) return;
    this.inbox.delete(id);
    const all = new Uint8Array(m.size); let o = 0; for (const p of m.parts) { all.set(p, o); o += p.length; }
    try {
      if (m.type === T_PRESENCE) { if (all.length <= 1024) this.onPresence?.(JSON.parse(new TextDecoder().decode(all))); return; }
      if (!this.boardDoc) return;
      if (m.type === T_SYNC1) this._send(T_UPDATE, this.boardDoc.diffSince(all));
      else this.boardDoc.applyUpdate(all, this);
    } catch { /* malformed update from the peer: ignore it, keep the session alive */ }
  }

  close() { this.off?.(); try { this.channel?.close(); this.pc.close(); } catch { /* already closed */ } this._set('closed'); }
}

export const p2pSupported = () => typeof RTCPeerConnection !== 'undefined';
