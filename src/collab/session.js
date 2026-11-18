// Holds the optional collaboration session for the open board: one Yjs doc, any number of peers.
import { BoardDoc } from './boardDoc.js';
import { Peer } from './p2p.js';

export class CollabSession {
  constructor(store) {
    this.store = store; this.doc = null; this.peers = []; this.listeners = new Set(); this.version = 0;
    this.me = { id: Math.random().toString(36).slice(2, 10), name: '' };
    this.presence = new Map(); // id -> { id, name, color, x, y, t, from }
    this.pv = 0; this.pl = new Set();
    this.timer = null;
  }
  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getVersion = () => this.version;
  _emit() { this.version++; for (const fn of this.listeners) fn(); }
  get connectedCount() { return this.peers.filter((p) => p.state === 'connected').length; }

  newPeer(stun) {
    this.doc ||= new BoardDoc(this.store);
    const p = new Peer({ stun });
    p.attach(this.doc);
    p.onPresence = (raw) => this.receivePresence(raw, p);
    p.onState((s) => { if (s === 'closed' || s === 'failed') this._dropPresence(p); if (s === 'closed' || s === 'failed') this.peers = this.peers.filter((x) => x !== p || s === 'failed'); this._emit(); });
    this.peers.push(p); this._emit();
    return p;
  }
  // ---- presence (cursors) ----
  subscribePresence = (fn) => { this.pl.add(fn); return () => this.pl.delete(fn); };
  getPresenceVersion = () => this.pv;
  _pEmit() { this.pv++; for (const fn of this.pl) fn(); }
  _dropPresence(peer) { let ch = false; for (const [k, v] of this.presence) if (v.from === peer) { this.presence.delete(k); ch = true; } if (ch) this._pEmit(); }
  /** Share our pointer (world coordinates) and display name with everyone connected. */
  setLocal({ x, y, name }) {
    if (name !== undefined) this.me.name = String(name).slice(0, 40);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const msg = { k: 'cur', id: this.me.id, name: this.me.name, x, y };
    for (const p of this.peers) if (p.state === 'connected') p.sendPresence(msg);
  }
  /** Validate presence from a peer (never trusted), store it, and pass it on to our other peers. */
  receivePresence(raw, from) {
    if (!raw || raw.k !== 'cur' || typeof raw.id !== 'string' || !/^[\w-]{1,16}$/.test(raw.id) || raw.id === this.me.id) return;
    const x = raw.x, y = raw.y;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) return;
    if (!this.presence.has(raw.id) && this.presence.size >= 50) return;
    const name = typeof raw.name === 'string' ? raw.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) : '';
    let h = 0; for (const c of raw.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    this.presence.set(raw.id, { id: raw.id, name, color: `hsl(${h % 360} 70% 38%)`, x, y, t: Date.now(), from });
    this._pEmit();
    for (const p of this.peers) if (p !== from && p.state === 'connected') p.sendPresence({ k: 'cur', id: raw.id, name, x, y });
    if (!this.timer) this.timer = setInterval(() => this._prune(), 3000);
  }
  _prune() {
    const now = Date.now(); let ch = false;
    for (const [k, v] of this.presence) if (now - v.t > 8000) { this.presence.delete(k); ch = true; }
    if (ch) this._pEmit();
    if (!this.presence.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  drop(peer) { peer.close(); this.peers = this.peers.filter((p) => p !== peer); this._emit(); }
  close() {
    for (const p of this.peers) p.close();
    this.peers = []; this.doc?.destroy(); this.doc = null;
    this.presence.clear(); clearInterval(this.timer); this.timer = null; this._pEmit(); this._emit();
  }
}
