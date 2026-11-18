// Countdown timer based on absolute end time (not setInterval ticks), so it stays correct when the tab is throttled.
export function startTimer(seconds, now = Date.now()) { return { total: seconds, endsAt: now + seconds * 1000, paused: null }; }
export function remaining(t, now = Date.now()) {
  if (!t) return 0;
  if (t.paused !== null) return Math.max(0, Math.ceil(t.paused / 1000));
  return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
}
export function pauseTimer(t, now = Date.now()) { return t.paused !== null ? t : { ...t, paused: Math.max(0, t.endsAt - now) }; }
export function resumeTimer(t, now = Date.now()) { return t.paused === null ? t : { ...t, endsAt: now + t.paused, paused: null }; }
export function addTime(t, seconds, now = Date.now()) {
  return t.paused !== null ? { ...t, paused: Math.max(0, t.paused + seconds * 1000), total: t.total + seconds } : { ...t, endsAt: Math.max(now, t.endsAt + seconds * 1000), total: t.total + seconds };
}
export const isDone = (t, now = Date.now()) => !!t && remaining(t, now) === 0;
export function format(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
