import { amplitudeToDb, clamp, smoothTowards } from '../../core/math';

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
  /**
   * Onset strength, 0..1: spectral growth *above* its own recent baseline.
   *
   * Raw spectral flux never returns to zero on real music — sustained content
   * keeps it permanently lifted, measured at a floor of 0.16 where a synthetic
   * click track reached 0. That floor flattens the contrast the tempo tracker
   * autocorrelates over, and makes an onset flash shimmer rather than hit.
   */
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

/**
 * Upper edge of the band spectral flux is measured over, in Hz. Kick, snare and
 * most rhythmic attack live below this.
 */
const FLUX_CEILING_HZ = 2500;

/** Baseline drops quickly so a quiet passage re-sensitises the detector... */
const BASELINE_FALL_HALF_LIFE = 0.25;
/** ...and climbs slowly, so a hit stands above it rather than raising it. */
const BASELINE_RISE_HALF_LIFE = 1.5;

const MIN_FRAME_SECONDS = 1e-4;

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
  private fluxBaseline = 0;
  private previousTime: number | null = null;

  constructor(private readonly sampleRate: number) {}

  extract(magnitudes: Float32Array, time: number): AudioFeatures {
    const binHz = this.sampleRate / 2 / magnitudes.length;
    const dt =
      this.previousTime === null ? 1 / 60 : Math.max(time - this.previousTime, MIN_FRAME_SECONDS);
    this.previousTime = time;

    // Onsets are measured only up to `FLUX_CEILING_HZ`. Beats are carried by
    // percussive transients in the low and low-mid range, but four fifths of
    // the bins sit above 4.7kHz, so a broadband flux is mostly hiss and cymbal
    // wash diluting the signal the tempo tracker depends on.
    const fluxBins = Math.min(magnitudes.length, Math.ceil(FLUX_CEILING_HZ / binHz));

    let sum = 0;
    let weightedSum = 0;
    let flux = 0;
    const previous = this.previousSpectrum;

    for (let i = 0; i < magnitudes.length; i++) {
      const magnitude = magnitudes[i]!;
      sum += magnitude;
      weightedSum += magnitude * i;
      if (previous && i < fluxBins) {
        // Half-wave rectified: only growth counts as an onset, decay does not.
        const delta = magnitude - previous[i]!;
        if (delta > 0) flux += delta;
      }
    }

    // Track the level flux idles at and report only what rises above it. The
    // baseline drops quickly when the music thins out but climbs slowly, so a
    // transient stands clear of it instead of dragging it up behind itself —
    // the same asymmetry the voice analyser uses for its noise floor.
    const rawFlux = fluxBins > 0 ? flux / fluxBins : 0;
    const halfLife =
      rawFlux < this.fluxBaseline ? BASELINE_FALL_HALF_LIFE : BASELINE_RISE_HALF_LIFE;
    this.fluxBaseline = smoothTowards(this.fluxBaseline, rawFlux, halfLife, dt);
    const onset = Math.max(0, rawFlux - this.fluxBaseline);

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
      flux: clamp(onset, 0, 1),
    };
  }

  reset(): void {
    this.previousSpectrum = null;
    this.fluxBaseline = 0;
    this.previousTime = null;
  }
}
