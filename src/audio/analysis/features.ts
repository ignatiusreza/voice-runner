import { amplitudeToDb, clamp } from '../../core/math';

/** One analysis frame, normalised so downstream code never sees raw FFT bins. */
export interface AudioFeatures {
  /** Seconds since the analyser started. */
  time: number;
  /** Broadband loudness, 0..1. */
  energy: number;
  /** Loudness in dBFS, useful for threshold logic that should be level-aware. */
  db: number;
  /** Energy in the 20-250Hz band, 0..1 — drives terrain elevation. */
  bass: number;
  /** Energy in the 250-2000Hz band, 0..1. */
  mid: number;
  /** Energy in the 2-16kHz band, 0..1 — drives palette brightness. */
  treble: number;
  /** Normalised spectral centroid, 0..1. Bright/dark colour of the sound. */
  brightness: number;
  /** Positive spectral change since the previous frame, 0..1. Onset strength. */
  flux: number;
}

export const SILENT_FEATURES: AudioFeatures = {
  time: 0,
  energy: 0,
  db: -100,
  bass: 0,
  mid: 0,
  treble: 0,
  brightness: 0,
  flux: 0,
};

interface Band {
  readonly lowHz: number;
  readonly highHz: number;
}

const BANDS = {
  bass: { lowHz: 20, highHz: 250 },
  mid: { lowHz: 250, highHz: 2000 },
  treble: { lowHz: 2000, highHz: 16000 },
} as const satisfies Record<string, Band>;

function bandAverage(magnitudes: Float32Array, binHz: number, band: Band): number {
  const first = Math.max(1, Math.floor(band.lowHz / binHz));
  const last = Math.min(magnitudes.length - 1, Math.ceil(band.highHz / binHz));
  if (last < first) return 0;

  let sum = 0;
  for (let i = first; i <= last; i++) sum += magnitudes[i]!;
  return sum / (last - first + 1);
}

/**
 * Turns successive magnitude spectra into the feature set the game reasons
 * about. Stateful only in that spectral flux needs the previous spectrum.
 *
 * Magnitudes are expected as linear amplitudes in 0..1 (what
 * `AnalyserNode.getByteFrequencyData` gives once divided by 255).
 */
export class FeatureExtractor {
  private previousSpectrum: Float32Array | null = null;

  constructor(private readonly sampleRate: number) {}

  extract(magnitudes: Float32Array, time: number): AudioFeatures {
    const binHz = this.sampleRate / 2 / magnitudes.length;

    let sum = 0;
    let weightedSum = 0;
    let flux = 0;
    const previous = this.previousSpectrum;

    for (let i = 0; i < magnitudes.length; i++) {
      const magnitude = magnitudes[i]!;
      sum += magnitude;
      weightedSum += magnitude * i;
      if (previous) {
        // Half-wave rectified: only growth counts as an onset, decay does not.
        const delta = magnitude - previous[i]!;
        if (delta > 0) flux += delta;
      }
    }

    const energy = magnitudes.length > 0 ? sum / magnitudes.length : 0;
    const brightness = sum > 0 ? weightedSum / sum / magnitudes.length : 0;

    this.previousSpectrum = Float32Array.from(magnitudes);

    return {
      time,
      energy: clamp(energy, 0, 1),
      db: amplitudeToDb(energy),
      bass: clamp(bandAverage(magnitudes, binHz, BANDS.bass), 0, 1),
      mid: clamp(bandAverage(magnitudes, binHz, BANDS.mid), 0, 1),
      treble: clamp(bandAverage(magnitudes, binHz, BANDS.treble), 0, 1),
      brightness: clamp(brightness, 0, 1),
      flux: clamp(magnitudes.length > 0 ? flux / magnitudes.length : 0, 0, 1),
    };
  }

  reset(): void {
    this.previousSpectrum = null;
  }
}
