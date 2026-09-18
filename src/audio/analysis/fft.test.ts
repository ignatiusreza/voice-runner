import { describe, expect, it } from 'vitest';
import { Fft } from './fft';

const SIZE = 2048;
const SAMPLE_RATE = 48000;

function sine(frequency: number, amplitude = 1): Float32Array {
  const out = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return out;
}

function peakBin(magnitudes: Float32Array): number {
  let best = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    if (magnitudes[i]! > magnitudes[best]!) best = i;
  }
  return best;
}

describe('Fft', () => {
  const fft = new Fft(SIZE);
  const out = new Float32Array(SIZE / 2);
  const binHz = SAMPLE_RATE / SIZE;

  it('rejects a non-power-of-two size', () => {
    expect(() => new Fft(1000)).toThrow(/power of two/);
  });

  it('puts a tone in the right bin', () => {
    for (const hz of [220, 1000, 5000]) {
      fft.magnitudes(sine(hz), out);
      expect(peakBin(out) * binHz).toBeCloseTo(hz, -2);
    }
  });

  it('reports silence at the floor', () => {
    fft.magnitudes(new Float32Array(SIZE), out);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(0);
  });

  it('stays inside 0..1', () => {
    fft.magnitudes(sine(1000, 1), out);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(1);
    }
  });

  it('reads a louder tone as a higher magnitude', () => {
    // Amplitudes chosen to sit inside the -100..-30dB window; a full-scale
    // sine pins a bin at 1.0, exactly as `getByteFrequencyData` would.
    fft.magnitudes(sine(1000, 0.001), out);
    const quiet = out[peakBin(out)]!;
    fft.magnitudes(sine(1000, 0.01), out);
    const loud = out[peakBin(out)]!;
    expect(loud).toBeGreaterThan(quiet);
    expect(quiet).toBeGreaterThan(0);
  });

  it('pins a full-scale tone at the top of the range', () => {
    fft.magnitudes(sine(1000, 1), out);
    expect(out[peakBin(out)]).toBe(1);
  });

  it('separates two tones', () => {
    const mixed = new Float32Array(SIZE);
    const a = sine(500);
    const b = sine(4000);
    for (let i = 0; i < SIZE; i++) mixed[i] = (a[i]! + b[i]!) / 2;
    fft.magnitudes(mixed, out);

    const lowBin = Math.round(500 / binHz);
    const highBin = Math.round(4000 / binHz);
    const midBin = Math.round(2000 / binHz);
    expect(out[lowBin]!).toBeGreaterThan(out[midBin]!);
    expect(out[highBin]!).toBeGreaterThan(out[midBin]!);
  });

  it('tolerates a short input without reading past its end', () => {
    expect(() => {
      fft.magnitudes(new Float32Array(16), out);
    }).not.toThrow();
  });
});
