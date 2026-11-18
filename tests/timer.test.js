import { describe, it, expect } from 'vitest';
import * as T from '../src/core/timer.js';

describe('timer', () => {
  it('counts down from absolute time', () => {
    const t = T.startTimer(300, 1000);
    expect(T.remaining(t, 1000)).toBe(300); expect(T.remaining(t, 1000 + 61_500)).toBe(239);
    expect(T.remaining(t, 1000 + 400_000)).toBe(0); expect(T.isDone(t, 1000 + 300_000)).toBe(true); expect(T.isDone(t, 1000 + 299_000)).toBe(false);
  });
  it('pauses and resumes without losing time', () => {
    let t = T.startTimer(60, 0); t = T.pauseTimer(t, 20_000);
    expect(T.remaining(t, 99_999)).toBe(40);
    t = T.resumeTimer(t, 100_000); expect(T.remaining(t, 110_000)).toBe(30);
  });
  it('adds time while running or paused', () => {
    expect(T.remaining(T.addTime(T.startTimer(60, 0), 30, 0), 0)).toBe(90);
    expect(T.remaining(T.addTime(T.pauseTimer(T.startTimer(60, 0), 10_000), 30, 10_000), 0)).toBe(80);
  });
  it('formats mm:ss', () => { expect(T.format(0)).toBe('00:00'); expect(T.format(754)).toBe('12:34'); expect(T.format(3600)).toBe('60:00'); });
  it('null timer is safe', () => { expect(T.remaining(null)).toBe(0); expect(T.isDone(null)).toBe(false); });
});
