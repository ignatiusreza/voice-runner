/**
 * Radix-2 FFT and the spectrum shaping `AnalyserNode` applies.
 *
 * The analysis runs inside an `AudioWorkletProcessor` now, where there is no
 * `AnalyserNode` to borrow a spectrum from, so the transform has to be done by
 * hand. The output deliberately reproduces `getByteFrequencyData` — Blackman
 * window, magnitude in decibels, clamped to a fixed range and scaled to 0..1 —
 * because every downstream threshold and reference peak in the game was
 * measured against those numbers.
 */

/** Matches `AnalyserNode.minDecibels` / `maxDecibels` defaults. */
const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;

export class Fft {
  private readonly cosines: Float32Array;
  private readonly sines: Float32Array;
  private readonly reversed: Uint32Array;
  private readonly window: Float32Array;
  private readonly real: Float32Array;
  private readonly imaginary: Float32Array;

  constructor(readonly size: number) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');

    this.real = new Float32Array(size);
    this.imaginary = new Float32Array(size);
    this.cosines = new Float32Array(size / 2);
    this.sines = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosines[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sines[i] = Math.sin((-2 * Math.PI * i) / size);
    }

    // Bit-reversal permutation, precomputed so the transform itself is branchless.
    const bits = Math.log2(size);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let value = i;
      let result = 0;
      for (let bit = 0; bit < bits; bit++) {
        result = (result << 1) | (value & 1);
        value >>= 1;
      }
      this.reversed[i] = result;
    }

    // Blackman, the window `AnalyserNode` uses.
    this.window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const phase = (2 * Math.PI * i) / (size - 1);
      this.window[i] = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
    }
  }

  /**
   * Transforms `samples` and writes `size / 2` magnitudes into `out`, scaled to
   * 0..1 the way `getByteFrequencyData` would (before its 0..255 quantisation).
   */
  magnitudes(samples: Float32Array, out: Float32Array): void {
    const { size, real, imaginary, reversed, window } = this;

    for (let i = 0; i < size; i++) {
      real[reversed[i]!] = (samples[i] ?? 0) * window[i]!;
      imaginary[reversed[i]!] = 0;
    }

    for (let width = 2; width <= size; width <<= 1) {
      const half = width >> 1;
      const step = size / width;
      for (let start = 0; start < size; start += width) {
        for (let offset = 0; offset < half; offset++) {
          const twiddle = offset * step;
          const cos = this.cosines[twiddle]!;
          const sin = this.sines[twiddle]!;
          const a = start + offset;
          const b = a + half;
          const realB = real[b]! * cos - imaginary[b]! * sin;
          const imagB = real[b]! * sin + imaginary[b]! * cos;
          real[b] = real[a]! - realB;
          imaginary[b] = imaginary[a]! - imagB;
          real[a] = real[a]! + realB;
          imaginary[a] = imaginary[a]! + imagB;
        }
      }
    }

    const bins = size / 2;
    const range = MAX_DECIBELS - MIN_DECIBELS;
    for (let i = 0; i < bins; i++) {
      // Normalised by the transform size, as the Web Audio spec does before
      // converting to decibels. Dividing by the bin count instead would run
      // 6dB hot, and every threshold in the game was tuned against the
      // analyser's numbers.
      const magnitude = Math.hypot(real[i]!, imaginary[i]!) / size;
      const db = 20 * Math.log10(Math.max(magnitude, 1e-12));
      out[i] = Math.min(1, Math.max(0, (db - MIN_DECIBELS) / range));
    }
  }
}
