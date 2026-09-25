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

  it('holds one tempo through an ambiguous pattern', () => {
    // Every other onset is weaker, so the half-tempo reading scores almost as
    // well as the true one. Picking the stronger peak per window let noise flip
    // between them; a carried-forward hypothesis should not wobble.
    const tracker = new BeatTracker();
    const period = 0.5;
    const frameRate = 120;
    const reported: number[] = [];
    for (let i = 0; i < 20 * frameRate; i++) {
      const time = i / frameRate;
      const beatIndex = Math.floor(time / period);
      const phase = (time % period) / period;
      const accent = beatIndex % 2 === 0 ? 1 : 0.82;
      const flux = phase < 0.15 ? accent * (1 - phase / 0.15) : 0;
      tracker.push({ ...SILENT_FEATURES, time, flux });
      if (time > 8) reported.push(tracker.current.bpm);
    }

    const min = Math.min(...reported);
    const max = Math.max(...reported);
    expect(max - min).toBeLessThan(6);
  });

  it('still follows a genuine tempo change', () => {
    // Inertia must not become paralysis: sustained evidence for a new tempo
    // has to win eventually.
    const tracker = new BeatTracker();
    const frameRate = 120;
    let time = 0;
    const feed = (bpm: number, seconds: number): void => {
      const period = 60 / bpm;
      for (let i = 0; i < seconds * frameRate; i++) {
        const phase = (time % period) / period;
        tracker.push({
          ...SILENT_FEATURES,
          time,
          flux: phase < 0.15 ? 1 - phase / 0.15 : 0,
        });
        time += 1 / frameRate;
      }
    };

    feed(100, 12);
    expect(tracker.current.bpm).toBeGreaterThan(95);
    expect(tracker.current.bpm).toBeLessThan(105);

    feed(150, 20);
    expect(tracker.current.bpm).toBeGreaterThan(143);
    expect(tracker.current.bpm).toBeLessThan(157);
  });

  it('reports low confidence while two tempos are still contested', () => {
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 120, 8);
    const clear = tracker.current.confidence;

    // Noise supports no tempo in particular, so nothing should pull clear.
    const noisy = new BeatTracker();
    let state = 7;
    for (let i = 0; i < 8 * 120; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      noisy.push({ ...SILENT_FEATURES, time: i / 120, flux: state / 0x7fffffff });
    }
    expect(noisy.current.confidence).toBeLessThan(clear);
  });

  it('does not keep reporting the old tempo after silence', () => {
    // Decay used to be skipped on the silent path, so accumulated support sat
    // frozen and the previous tempo still won for several windows after new
    // music started.
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 100, 12);
    expect(tracker.current.bpm).toBeGreaterThan(94);
    expect(tracker.current.bpm).toBeLessThan(106);

    let time = 12;
    for (let i = 0; i < 12 * 120; i++) {
      tracker.push({ ...SILENT_FEATURES, time, flux: 0 });
      time += 1 / 120;
    }

    const period = 60 / 170;
    for (let i = 0; i < 14 * 120; i++) {
      const phase = (time % period) / period;
      tracker.push({ ...SILENT_FEATURES, time, flux: phase < 0.15 ? 1 - phase / 0.15 : 0 });
      time += 1 / 120;
    }
    expect(tracker.current.bpm).toBeGreaterThan(160);
  });

  it('reports stability only once one tempo has held for a while', () => {
    const tracker = new BeatTracker();
    expect(tracker.current.stability).toBe(0);

    feedClickTrack(tracker, 120, 12);
    expect(tracker.current.stability).toBeGreaterThan(0.5);
  });

  it('stays unstable on noise, however periodic it briefly looks', () => {
    // This is the discriminator the phase lock depends on: noise can reach a
    // correlation comparable to sparse music, but it cannot keep the *same*
    // tempo winning window after window.
    const tracker = new BeatTracker();
    let state = 99;
    for (let i = 0; i < 20 * 120; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      tracker.push({ ...SILENT_FEATURES, time: i / 120, flux: state / 0x7fffffff });
    }
    expect(tracker.current.stability).toBeLessThan(0.5);
  });

  it('returns to the fallback tempo after a reset', () => {
    const tracker = new BeatTracker();
    feedClickTrack(tracker, 120, 8);
    tracker.reset();
    expect(tracker.current.bpm).toBe(FALLBACK_BPM);
    expect(tracker.current.confidence).toBe(0);
  });
});
