import { amplitudeToDb, clamp, smoothTowards } from '../../core/math';

export interface VoiceFrame {
  time: number;
  /** Loudness of this frame in dBFS. */
  db: number;
  /** The tracked background level in dBFS — room noise plus any music. */
  floorDb: number;
  /** How far this frame stands above the background, in dB. The control signal. */
  excessDb: number;
  /** Fundamental frequency in Hz, or 0 when the frame is not voiced. */
  pitchHz: number;
  /** 0..1 confidence that `pitchHz` is a real pitch rather than noise. */
  clarity: number;
}

export interface VoiceAnalyserOptions {
  sampleRate: number;
  /** Fast, so the floor drops back as soon as the room goes quiet. */
  floorFallHalfLife?: number;
  /**
   * Slow, so a shout is never absorbed into the floor. This asymmetry is what
   * lets the player's voice be separated from music playing in the same room.
   */
  floorRiseHalfLife?: number;
  minPitchHz?: number;
  maxPitchHz?: number;
}

const DEFAULTS = {
  floorFallHalfLife: 0.4,
  floorRiseHalfLife: 4.0,
  minPitchHz: 70,
  // Above this, integer-lag quantisation starts octave-erroring. It is far
  // above any voice fundamental the duck threshold cares about, and a misread
  // scream still reads as "not low", so the game is unaffected.
  maxPitchHz: 400,
};

/** Below this the frame is silence and pitch detection is not worth running. */
const PITCH_GATE_DB = -55;
/** YIN's accept threshold on the normalised difference function. */
const YIN_THRESHOLD = 0.15;

/**
 * Extracts the control signal for voice input from raw time-domain samples.
 *
 * The hard problem this solves: the microphone hears the player *and* whatever
 * music is driving the stage. Rather than trying to separate the two sources,
 * the analyser tracks the background level asymmetrically and reports how far
 * the current frame rises above it. Music raises the floor over seconds; a
 * shout spikes over it in milliseconds.
 */
export class VoiceAnalyser {
  private readonly options: Required<VoiceAnalyserOptions>;
  private floorDb = -60;
  private initialised = false;
  private lastTime: number | null = null;

  constructor(options: VoiceAnalyserOptions) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** `samples` are time-domain values in -1..1. */
  analyse(samples: Float32Array, time: number): VoiceFrame {
    const dt = this.lastTime === null ? 1 / 60 : Math.max(time - this.lastTime, 1e-4);
    this.lastTime = time;

    const db = amplitudeToDb(rootMeanSquare(samples));

    if (!this.initialised) {
      this.floorDb = db;
      this.initialised = true;
    } else {
      const halfLife =
        db < this.floorDb ? this.options.floorFallHalfLife : this.options.floorRiseHalfLife;
      this.floorDb = smoothTowards(this.floorDb, db, halfLife, dt);
    }

    const pitch =
      db > PITCH_GATE_DB
        ? detectPitch(
            samples,
            this.options.sampleRate,
            this.options.minPitchHz,
            this.options.maxPitchHz,
          )
        : { pitchHz: 0, clarity: 0 };

    return {
      time,
      db,
      floorDb: this.floorDb,
      excessDb: db - this.floorDb,
      pitchHz: pitch.pitchHz,
      clarity: pitch.clarity,
    };
  }

  /** Seeds the floor from a calibration pass so the first run is not miscalibrated. */
  primeFloor(db: number): void {
    this.floorDb = db;
    this.initialised = true;
  }

  get backgroundDb(): number {
    return this.floorDb;
  }

  reset(): void {
    this.initialised = false;
    this.lastTime = null;
    this.floorDb = -60;
  }
}

function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/**
 * YIN pitch detection (difference function, cumulative mean normalisation,
 * absolute threshold, parabolic interpolation).
 *
 * Chosen over plain autocorrelation because it does not octave-error on the
 * loud, clipped signals a shouting player produces.
 */
export function detectPitch(
  rawSamples: Float32Array,
  rawSampleRate: number,
  minHz: number,
  maxHz: number,
): { pitchHz: number; clarity: number } {
  // YIN is O(lagRange × windowLength), which at 48kHz is well over a million
  // operations per frame — enough to matter on a phone at 60fps. Voice pitch
  // tops out at a few hundred Hz, so the signal is decimated first: the work
  // drops with the square of the factor and nothing in the band of interest is
  // lost.
  const { samples, sampleRate } = decimate(rawSamples, rawSampleRate);

  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(samples.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxLag <= minLag) return { pitchHz: 0, clarity: 0 };

  const difference = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < samples.length; i++) {
      const delta = samples[i]! - samples[i + lag]!;
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  // Cumulative mean normalisation: turns the difference function into one where
  // a value near 0 means "strongly periodic at this lag", comparable across lags.
  const normalised = new Float32Array(maxLag + 1);
  normalised[0] = 1;
  let runningSum = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    runningSum += difference[lag]!;
    normalised[lag] = runningSum > 0 ? (difference[lag]! * (lag - minLag + 1)) / runningSum : 1;
  }

  let chosenLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalised[lag]! < YIN_THRESHOLD) {
      // Walk to the local minimum so the period is not taken one sample early.
      while (lag + 1 <= maxLag && normalised[lag + 1]! < normalised[lag]!) lag++;
      chosenLag = lag;
      break;
    }
  }

  if (chosenLag < 0) {
    // No lag passed the threshold; fall back to the global minimum and let the
    // low clarity score tell the caller not to trust it.
    let bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (normalised[lag]! < normalised[bestLag]!) bestLag = lag;
    }
    const clarity = clamp(1 - normalised[bestLag]!, 0, 1);
    if (clarity < 0.5) return { pitchHz: 0, clarity };
    chosenLag = bestLag;
  }

  const refinedLag = parabolicRefine(normalised, chosenLag, minLag, maxLag);
  return {
    pitchHz: sampleRate / refinedLag,
    clarity: clamp(1 - normalised[chosenLag]!, 0, 1),
  };
}

/**
 * Rate the pitch search runs at, in Hz.
 *
 * YIN resolves a period to integer lags, so the shortest period searched needs
 * enough samples not to octave-error — at 9.6kHz a 400Hz tone is 24 samples,
 * which is comfortable, and the cost is a 25x reduction in work.
 *
 * The box filter does not fully suppress content above the decimated Nyquist,
 * and no cheap filter would: an aliased pure tone stays a pure tone, so it will
 * always find *some* period. What matters is where it lands. Folded content
 * ends up at short lags, i.e. read as a high pitch, and the only pitch decision
 * the game makes is "is this below the duck threshold" — so a misread here
 * costs nothing. See the high-frequency case in the tests.
 */
const ANALYSIS_RATE_HZ = 9600;

/**
 * Box-filters and decimates towards `ANALYSIS_RATE_HZ`. The box filter is the
 * anti-alias stage: decimating without one folds high-frequency content down
 * into the voice band.
 */
function decimate(
  samples: Float32Array,
  sampleRate: number,
): { samples: Float32Array; sampleRate: number } {
  const factor = Math.floor(sampleRate / ANALYSIS_RATE_HZ);
  if (factor < 2) return { samples, sampleRate };

  const length = Math.floor(samples.length / factor);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    const start = i * factor;
    for (let j = 0; j < factor; j++) sum += samples[start + j]!;
    out[i] = sum / factor;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}

/** Sub-sample the minimum so pitch does not quantise to integer lags. */
function parabolicRefine(values: Float32Array, index: number, min: number, max: number): number {
  if (index <= min || index >= max) return index;
  const previous = values[index - 1]!;
  const current = values[index]!;
  const next = values[index + 1]!;
  const denominator = 2 * (2 * current - next - previous);
  if (denominator === 0) return index;
  return index + (next - previous) / denominator;
}
