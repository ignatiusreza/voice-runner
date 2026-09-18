import { clamp } from '../../core/math';
import type { AudioFeatures } from './features';

/** Envelope resolution. 100Hz resolves a beat to 10ms, well under perception. */
const ENVELOPE_HZ = 100;
/** How much history tempo estimation looks at. Long enough for ~6 beats at 60 BPM. */
const WINDOW_SECONDS = 6;
const ENVELOPE_SIZE = ENVELOPE_HZ * WINDOW_SECONDS;

const MIN_BPM = 60;
const MAX_BPM = 200;
const MIN_LAG = Math.floor((60 / MAX_BPM) * ENVELOPE_HZ);
const MAX_LAG = Math.ceil((60 / MIN_BPM) * ENVELOPE_HZ);

/** Used until enough audio has been heard to estimate a real tempo. */
export const FALLBACK_BPM = 120;

export interface BeatEstimate {
  bpm: number;
  /** Seconds per beat. */
  period: number;
  /** A time at which a beat is known to have landed; the grid extends from it. */
  anchor: number;
  /** 0..1. Below ~0.3 the estimate is a guess and callers should ease off. */
  confidence: number;
}

/**
 * Estimates tempo and beat phase from the onset (spectral flux) envelope.
 *
 * Autocorrelation over a rolling window, then a phase search against the best
 * lag. This is deliberately not a full beat tracker: the game only needs a grid
 * stable enough to place obstacles on, and it degrades to a fixed 120 BPM grid
 * when the input is speech or noise rather than music.
 */
export class BeatTracker {
  private readonly envelope = new Float32Array(ENVELOPE_SIZE);
  /** Index just past the newest sample; the buffer is a ring. */
  private writeIndex = 0;
  private startTime: number | null = null;
  private lastSampleIndex = -1;
  private estimate: BeatEstimate = {
    bpm: FALLBACK_BPM,
    period: 60 / FALLBACK_BPM,
    anchor: 0,
    confidence: 0,
  };

  push(features: AudioFeatures): void {
    this.startTime ??= features.time;

    // Resample the irregular frame rate onto the fixed envelope grid, filling
    // any gap so a dropped frame does not shift every later sample.
    const index = Math.floor((features.time - this.startTime) * ENVELOPE_HZ);
    if (index <= this.lastSampleIndex) return;

    const gap = Math.min(index - this.lastSampleIndex, ENVELOPE_SIZE);
    for (let i = 0; i < gap; i++) {
      this.envelope[this.writeIndex] = features.flux;
      this.writeIndex = (this.writeIndex + 1) % ENVELOPE_SIZE;
    }
    this.lastSampleIndex = index;

    // Re-estimating every frame is wasted work; twice a second tracks tempo
    // changes fast enough and keeps the cost off the render budget.
    if (index % Math.floor(ENVELOPE_HZ / 2) === 0) this.reestimate(features.time);
  }

  get current(): BeatEstimate {
    return this.estimate;
  }

  /** The time of the first beat strictly after `time`. */
  nextBeatAfter(time: number): number {
    const { anchor, period } = this.estimate;
    const beatsElapsed = Math.floor((time - anchor) / period) + 1;
    return anchor + beatsElapsed * period;
  }

  /** Beat index at `time`, counting from the anchor. Negative before it. */
  beatIndexAt(time: number): number {
    return Math.floor((time - this.estimate.anchor) / this.estimate.period);
  }

  /** Start time of beat number `index`. */
  beatTime(index: number): number {
    return this.estimate.anchor + index * this.estimate.period;
  }

  /** 0 at a beat, approaching 1 just before the next one. */
  phaseAt(time: number): number {
    const { anchor, period } = this.estimate;
    const raw = ((time - anchor) / period) % 1;
    return raw < 0 ? raw + 1 : raw;
  }

  private reestimate(now: number): void {
    const ordered = this.orderedEnvelope();
    const mean = average(ordered);
    if (mean <= 1e-6) return;

    // Centre the envelope so autocorrelation measures periodicity rather than
    // the DC level, which would otherwise make every lag look correlated.
    const centred = new Float32Array(ordered.length);
    for (let i = 0; i < ordered.length; i++) centred[i] = ordered[i]! - mean;

    let bestLag = 0;
    let bestScore = 0;
    let bestRawScore = 0;
    let zeroLagEnergy = 0;
    for (let i = 0; i < centred.length; i++) zeroLagEnergy += centred[i]! * centred[i]!;
    if (zeroLagEnergy <= 1e-9) return;

    // Once a tempo is held with some confidence, staying there is preferred.
    // Without this the estimate flip-flops between half, true and double time
    // from window to window — measured swinging 75..200 BPM on one track — and
    // a grid whose spacing changes every half second cannot feel in time.
    const lockedLag =
      this.estimate.confidence > INERTIA_MIN_CONFIDENCE
        ? (60 / this.estimate.bpm) * ENVELOPE_HZ
        : null;

    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      let score = 0;
      for (let i = lag; i < centred.length; i++) score += centred[i]! * centred[i - lag]!;
      // Biased estimator (divide by the full window, not the overlap). The
      // unbiased form inflates long lags, which is exactly how a tracker ends
      // up reporting half the real tempo.
      const raw = score / centred.length;
      let weighted = raw * tempoPrior(lag);
      if (lockedLag !== null) weighted *= inertiaPrior(lag, lockedLag);
      if (weighted > bestScore) {
        bestScore = weighted;
        bestRawScore = raw;
        bestLag = lag;
      }
    }

    if (bestLag === 0) return;

    const period = bestLag / ENVELOPE_HZ;
    // Confidence measures how periodic the signal is, so it uses the unweighted
    // correlation. Including the priors made a lag that only won *because* of
    // them report low confidence, which then gated the phase lock off.
    const confidence = clamp((bestRawScore * centred.length) / zeroLagEnergy, 0, 1);

    // Find where the beats sit inside the window: the offset whose comb of
    // samples one period apart collects the most onset energy.
    let bestOffset = 0;
    let bestOffsetScore = -Infinity;
    for (let offset = 0; offset < bestLag; offset++) {
      let score = 0;
      for (let i = offset; i < ordered.length; i += bestLag) score += ordered[i]!;
      if (score > bestOffsetScore) {
        bestOffsetScore = score;
        bestOffset = offset;
      }
    }

    // `ordered` ends at the newest sample, i.e. at `now`.
    const windowStart = now - (ordered.length - 1) / ENVELOPE_HZ;
    const anchor = windowStart + bestOffset / ENVELOPE_HZ;

    // Ease onto a nearby tempo rather than snapping; a step change in period
    // shifts every future beat at once. A distant tempo is a genuine change of
    // material, so take that immediately.
    const previous = this.estimate.period;
    const nearby = Math.abs(Math.log2(period / previous)) < PERIOD_SMOOTHING_OCTAVES;
    const settled = nearby ? previous + (period - previous) * PERIOD_SMOOTHING : period;

    this.estimate = {
      bpm: 60 / settled,
      period: settled,
      anchor,
      confidence,
    };
  }

  /** Copies the ring buffer out oldest-first. */
  private orderedEnvelope(): Float32Array {
    const out = new Float32Array(ENVELOPE_SIZE);
    for (let i = 0; i < ENVELOPE_SIZE; i++) {
      out[i] = this.envelope[(this.writeIndex + i) % ENVELOPE_SIZE]!;
    }
    return out;
  }

  reset(): void {
    this.envelope.fill(0);
    this.writeIndex = 0;
    this.startTime = null;
    this.lastSampleIndex = -1;
    this.estimate = {
      bpm: FALLBACK_BPM,
      period: 60 / FALLBACK_BPM,
      anchor: 0,
      confidence: 0,
    };
  }
}

/** Below this the held tempo is not trusted enough to bias the next estimate. */
const INERTIA_MIN_CONFIDENCE = 0.25;
/** Width of the stay-put preference around the held tempo, in octaves. */
const INERTIA_OCTAVES = 0.25;
/** Tempo changes within this much of the held one are eased into, not snapped. */
const PERIOD_SMOOTHING_OCTAVES = 0.2;
const PERIOD_SMOOTHING = 0.25;

/**
 * Keeps the estimate near the tempo already being tracked. Narrower than the
 * global prior, so it resists octave flips without freezing out a real change.
 */
function inertiaPrior(lag: number, lockedLag: number): number {
  const octaves = Math.log2(lag / lockedLag) / INERTIA_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

/** Centre of the tempo prior, in BPM, and its width in octaves. */
const PREFERRED_BPM = 120;
const PRIOR_OCTAVES = 0.9;

/**
 * A periodic signal correlates just as well at twice its true period, so raw
 * autocorrelation picks half-tempo about as often as the right answer. Weighting
 * by a log-normal prior around a comfortable walking tempo breaks the tie the
 * way a listener would.
 */
function tempoPrior(lag: number): number {
  const bpm = (60 * ENVELOPE_HZ) / lag;
  const octaves = Math.log2(bpm / PREFERRED_BPM) / PRIOR_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

function average(values: Float32Array): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  return sum / values.length;
}
