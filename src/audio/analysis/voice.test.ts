import { describe, expect, it } from 'vitest';
import { detectPitch, VoiceAnalyser } from './voice';

const SAMPLE_RATE = 48000;

function sine(frequency: number, length: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return out;
}

function noise(length: number, amplitude: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((state / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return out;
}

describe('detectPitch', () => {
  it('finds the fundamental of a clean tone', () => {
    const result = detectPitch(sine(220, 4096), SAMPLE_RATE, 70, 400);
    expect(result.pitchHz).toBeGreaterThan(215);
    expect(result.pitchHz).toBeLessThan(225);
    expect(result.clarity).toBeGreaterThan(0.8);
  });

  it('does not octave-error on a loud, clipped tone', () => {
    const clipped = sine(150, 4096, 1).map((value) => Math.max(-0.8, Math.min(0.8, value * 3)));
    const result = detectPitch(clipped, SAMPLE_RATE, 70, 400);
    expect(result.pitchHz).toBeGreaterThan(145);
    expect(result.pitchHz).toBeLessThan(156);
  });

  it('reports no pitch for noise', () => {
    const result = detectPitch(noise(4096, 0.4), SAMPLE_RATE, 70, 400);
    expect(result.pitchHz).toBe(0);
  });

  it('never reads high-frequency content as a low pitch', () => {
    // Cymbals and sibilance alias when the signal is decimated, and an aliased
    // tone will always find some period. The only thing that must hold is that
    // it never lands below the duck threshold, or music alone would make the
    // character slide. `VoiceController` ducks under 130Hz.
    for (const hz of [3000, 5000, 7000, 9000]) {
      const result = detectPitch(sine(hz, 4096), SAMPLE_RATE, 70, 400);
      if (result.pitchHz > 0) expect(result.pitchHz).toBeGreaterThan(130);
    }
  });

  it('still resolves the top of the search range after decimation', () => {
    const result = detectPitch(sine(380, 4096), SAMPLE_RATE, 70, 400);
    expect(result.pitchHz).toBeGreaterThan(365);
    expect(result.pitchHz).toBeLessThan(395);
  });

  it('returns nothing when the search range is degenerate', () => {
    expect(detectPitch(sine(220, 64), SAMPLE_RATE, 70, 400).pitchHz).toBe(0);
  });
});

describe('VoiceAnalyser', () => {
  it('tracks a steady background into the floor', () => {
    const analyser = new VoiceAnalyser({ sampleRate: SAMPLE_RATE });
    let frame = analyser.analyse(noise(2048, 0.05), 0);
    for (let i = 1; i < 300; i++) frame = analyser.analyse(noise(2048, 0.05, i), i / 60);

    // After several seconds of unchanging input the floor has caught up, so the
    // player is not "above background" just by the room being loud.
    expect(Math.abs(frame.excessDb)).toBeLessThan(2);
  });

  it('reports a shout as a large excess over a loud background', () => {
    const analyser = new VoiceAnalyser({ sampleRate: SAMPLE_RATE });
    // Settle on a loud musical background first.
    for (let i = 0; i < 300; i++) analyser.analyse(noise(2048, 0.1, i), i / 60);
    const backgroundBefore = analyser.backgroundDb;

    const shout = analyser.analyse(sine(200, 2048, 0.9), 300 / 60);

    expect(shout.excessDb).toBeGreaterThan(9);
    // One loud frame must barely move the floor, or the next shout would need
    // to be louder still — the asymmetry is the whole mechanism.
    expect(analyser.backgroundDb - backgroundBefore).toBeLessThan(1);
  });

  it('drops the floor quickly when the room goes quiet', () => {
    const analyser = new VoiceAnalyser({ sampleRate: SAMPLE_RATE });
    for (let i = 0; i < 300; i++) analyser.analyse(noise(2048, 0.2, i), i / 60);
    const loudFloor = analyser.backgroundDb;

    for (let i = 300; i < 360; i++) analyser.analyse(noise(2048, 0.001, i), i / 60);

    expect(analyser.backgroundDb).toBeLessThan(loudFloor - 15);
  });

  it('uses a primed floor instead of cold-starting', () => {
    const analyser = new VoiceAnalyser({ sampleRate: SAMPLE_RATE });
    analyser.primeFloor(-30);
    const frame = analyser.analyse(noise(2048, 0.001), 0);

    // A cold start would snap the floor onto this frame's own level; a primed
    // one stays near -30 and only decays towards it.
    expect(frame.floorDb).toBeGreaterThan(-32);
    expect(frame.floorDb).toBeLessThan(-29);
    expect(frame.floorDb).toBeGreaterThan(frame.db + 10);
  });

  it('snaps out of digital silence instead of crawling', () => {
    const analyser = new VoiceAnalyser({ sampleRate: SAMPLE_RATE });
    // A freshly opened MediaStream hands back zeroed buffers for a moment.
    for (let i = 0; i < 30; i++) analyser.analyse(new Float32Array(2048), i / 60);
    expect(analyser.backgroundDb).toBeLessThan(-90);

    // The first real audio must re-seat the floor, not be measured against the
    // silence. Crawling up from -140dB leaves the gate latched open for ~20s,
    // and because a jump needs a rising edge that means no jumps at all.
    const first = analyser.analyse(noise(2048, 0.05, 7), 30 / 60);
    expect(first.excessDb).toBeLessThan(3);
  });

  it('still treats a genuinely quiet room as a real background', () => {
    const analyser = new VoiceAnalyser({ sampleRate: SAMPLE_RATE });
    // Quiet but not digital silence: a real room floor, which must be tracked
    // rather than discarded, or a whisper would read as a shout.
    let frame = analyser.analyse(noise(2048, 0.0005), 0);
    for (let i = 1; i < 120; i++) frame = analyser.analyse(noise(2048, 0.0005, i), i / 60);
    expect(analyser.backgroundDb).toBeGreaterThan(-90);
    expect(Math.abs(frame.excessDb)).toBeLessThan(3);
  });

  it('resets back to a cold start', () => {
    const analyser = new VoiceAnalyser({ sampleRate: SAMPLE_RATE });
    analyser.primeFloor(-10);
    analyser.reset();
    const frame = analyser.analyse(noise(2048, 0.05), 0);
    expect(frame.excessDb).toBeCloseTo(0, 5);
  });
});
