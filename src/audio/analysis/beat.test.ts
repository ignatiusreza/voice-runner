import { describe, expect, it } from 'vitest';
import { BeatTracker, FALLBACK_BPM } from './beat';
import type { AudioFeatures } from './features';
import { SILENT_FEATURES } from './features';

/** Feeds the tracker a click track at `bpm` for `seconds`, sampled at 120Hz. */
function feedClickTrack(tracker: BeatTracker, bpm: number, seconds: number, offset = 0): void {
  const period = 60 / bpm;
  const frameRate = 120;
  for (let i = 0; i < seconds * frameRate; i++) {
    const time = i / frameRate;
    const phase = ((time - offset) % period) / period;
    // A sharp attack decaying over ~15% of the beat, like a percussive onset.
    const flux = phase < 0.15 && time >= offset ? 1 - phase / 0.15 : 0;
    const features: AudioFeatures = { ...SILENT_FEATURES, time, flux };
    tracker.push(features);
  }
}

describe('BeatTracker', () => {
  it('starts on a fallback tempo with no confidence', () => {
    const tracker = new BeatTracker();
    expect(tracker.current.bpm).toBe(FALLBACK_BPM);
    expect(tracker.current.confidence).toBe(0);
  });

  it('locks onto a 120 BPM click track', () => {
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 120, 8);

    expect(tracker.current.bpm).toBeGreaterThan(115);
    expect(tracker.current.bpm).toBeLessThan(125);
    expect(tracker.current.confidence).toBeGreaterThan(0.1);
  });

  it('locks onto a slower 90 BPM click track', () => {
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 90, 8);

    expect(tracker.current.bpm).toBeGreaterThan(86);
    expect(tracker.current.bpm).toBeLessThan(94);
  });

  it('puts the beat grid on the actual onsets', () => {
    const tracker = new BeatTracker();
    const offset = 0.2;
    feedClickTrack(tracker, 120, 8, offset);

    // Every onset sits at offset + k * 0.5s, so the phase there should be near
    // 0 (or near 1, just before the next beat).
    const phase = tracker.phaseAt(offset + 4 * 0.5);
    expect(Math.min(phase, 1 - phase)).toBeLessThan(0.15);
  });

  it('predicts the next beat ahead of the given time', () => {
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 120, 8);

    const next = tracker.nextBeatAfter(4);
    expect(next).toBeGreaterThan(4);
    expect(next - 4).toBeLessThanOrEqual(tracker.current.period + 1e-9);
  });

  it('keeps beat index and beat time consistent', () => {
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 120, 8);

    const index = tracker.beatIndexAt(5);
    const time = tracker.beatTime(index);
    expect(time).toBeLessThanOrEqual(5);
    expect(time + tracker.current.period).toBeGreaterThan(5);
  });

  it('ignores frames that fall inside a sample it already wrote', () => {
    const tracker = new BeatTracker();
    tracker.push({ ...SILENT_FEATURES, time: 0, flux: 1 });
    // 1ms later is the same 10ms envelope slot, so nothing should change.
    tracker.push({ ...SILENT_FEATURES, time: 0.001, flux: 1 });
    expect(tracker.current.confidence).toBe(0);
  });

  it('returns to the fallback tempo after a reset', () => {
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 120, 8);
    tracker.reset();
    expect(tracker.current.bpm).toBe(FALLBACK_BPM);
    expect(tracker.current.confidence).toBe(0);
  });
});
