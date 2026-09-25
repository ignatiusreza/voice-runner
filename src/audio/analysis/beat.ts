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
  /**
   * 0..1 — how long the winning tempo has held, not how periodic the signal is.
   *
   * Confidence alone cannot separate music from noise: random input reaches a
   * normalised correlation around 0.1 across the lag range, which is where
   * sparse real music sits too. What noise cannot do is keep *the same* tempo
   * winning window after window.
   */
  stability: number;
}

/**
 * Estimates tempo and beat phase from the onset (spectral flux) envelope.
 *
 * Autocorrelation over a rolling window, then a phase search against the best
 * lag. This is deliberately not a full beat tracker: the game only needs a grid
 * stable enough to place obstacles on, and it degrades to a fixed 120 BPM grid
 * when the input is speech or noise rather than music.
 */
interface TempoHypothesis {
  /** Period in envelope samples; fractional, refined against the peak shape. */
  lag: number;
  /** Accumulated support, decayed each window. */
  score: number;
}

export class BeatTracker {
  private readonly envelope = new Float32Array(ENVELOPE_SIZE);
  private hypotheses: TempoHypothesis[] = [];
  private winnerStreak = 0;
  private lastWinnerLag = 0;
  /** Index just past the newest sample; the buffer is a ring. */
  private writeIndex = 0;
  private startTime: number | null = null;
  private lastSampleIndex = -1;
  private estimate: BeatEstimate = {
    bpm: FALLBACK_BPM,
    period: 60 / FALLBACK_BPM,
    anchor: 0,
    confidence: 0,
    stability: 0,
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
    // Decay first, so it still runs on the silent paths below. Leaving the
    // scores frozen through a quiet passage meant the old tempo was still
    // being reported for several windows after new music started.
    for (const hypothesis of this.hypotheses) hypothesis.score *= HYPOTHESIS_DECAY;

    const ordered = this.orderedEnvelope();
    const mean = average(ordered);
    if (mean <= 1e-6) return;

    // Centre the envelope so autocorrelation measures periodicity rather than
    // the DC level, which would otherwise make every lag look correlated.
    const centred = new Float32Array(ordered.length);
    for (let i = 0; i < ordered.length; i++) centred[i] = ordered[i]! - mean;

    let zeroLagEnergy = 0;
    for (let i = 0; i < centred.length; i++) zeroLagEnergy += centred[i]! * centred[i]!;
    if (zeroLagEnergy <= 1e-9) return;

    const strength = new Float32Array(MAX_LAG + 1);
    const weighted = new Float32Array(MAX_LAG + 1);
    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      let score = 0;
      for (let i = lag; i < centred.length; i++) score += centred[i]! * centred[i - lag]!;
      // Normalised against the window's own energy, so the number means the
      // same thing from window to window and can be accumulated over time.
      strength[lag] = Math.max(0, score / zeroLagEnergy);
      weighted[lag] = strength[lag]! * tempoPrior(lag);
    }

    this.updateHypotheses(weighted);
    const winner = this.hypotheses[0];
    if (!winner) return;

    const period = winner.lag / ENVELOPE_HZ;
    const lag = Math.round(winner.lag);

    // Confidence measures one thing: how periodic the signal is at the winning
    // tempo. Folding in the margin over the runner-up conflated "is there a
    // beat" with "is it contested", and halved the number on exactly the
    // material where the phase lock is most needed — which then gated the lock
    // off. Stability is what the hypotheses provide; it is not this number.
    const confidence = clamp(strength[lag] ?? 0, 0, 1);

    // Find where the beats sit inside the window: the offset whose comb of
    // samples one period apart collects the most onset energy.
    //
    // The comb steps by the *fractional* period. Stepping by the rounded lag
    // drifts against the period actually reported — at lag 50.5 that is half a
    // sample per beat, some 60ms by the end of a six second window, which
    // blurs the offset and then anchors it with a spacing that never produced
    // it.
    let bestOffset = 0;
    let bestOffsetScore = -Infinity;
    for (let offset = 0; offset < lag; offset++) {
      let score = 0;
      for (let k = 0; ; k++) {
        const index = Math.round(offset + k * winner.lag);
        if (index >= ordered.length) break;
        score += ordered[index]!;
      }
      if (score > bestOffsetScore) {
        bestOffsetScore = score;
        bestOffset = offset;
      }
    }

    // A winner that is the same tempo as last window extends the streak; one
    // that jumps elsewhere restarts it.
    const held =
      this.lastWinnerLag > 0 &&
      Math.abs(Math.log2(winner.lag / this.lastWinnerLag)) < MATCH_TOLERANCE_OCTAVES;
    this.winnerStreak = held ? this.winnerStreak + 1 : 0;
    this.lastWinnerLag = winner.lag;

    // `ordered` ends at the newest sample, i.e. at `now`.
    const windowStart = now - (ordered.length - 1) / ENVELOPE_HZ;
    this.estimate = {
      bpm: 60 / period,
      period,
      anchor: windowStart + bestOffset / ENVELOPE_HZ,
      confidence,
      stability: clamp(this.winnerStreak / STABLE_WINDOWS, 0, 1),
    };
  }

  /**
   * Carries tempo candidates forward instead of picking a winner per window.
   *
   * Autocorrelation routinely scores two tempos almost equally — a tempo and
   * its double, or two plausible readings of a syncopated pattern. Choosing the
   * larger each time let noise flip the answer between windows: measured, the
   * reported tempo swung 75..200 BPM on one track, and even on a fixed
   * recording the mean moved 133 to 122 between runs. Hypotheses accumulate
   * support instead, so a reading that has been right for several seconds is
   * not displaced by one lucky window, and a genuine tempo change still wins
   * once it has been supported for long enough.
   */
  private updateHypotheses(weighted: Float32Array): void {
    const candidates: { lag: number; strength: number }[] = [];
    for (let lag = MIN_LAG + 1; lag < MAX_LAG; lag++) {
      const here = weighted[lag]!;
      // Local maxima only: the peaks are the tempo candidates, and every lag
      // near a peak would otherwise register as its own hypothesis.
      if (here <= weighted[lag - 1]! || here < weighted[lag + 1]! || here < CANDIDATE_FLOOR) {
        continue;
      }
      candidates.push({ lag: refinePeak(weighted, lag), strength: here });
    }

    // At most one candidate per hypothesis, the strongest. Adding every peak
    // within tolerance let a ragged window — several small ripples around one
    // tempo — contribute more support than a single clean peak.
    const claimed = new Set<{ lag: number; strength: number }>();
    for (const hypothesis of this.hypotheses) {
      let best: { lag: number; strength: number } | null = null;
      for (const candidate of candidates) {
        if (claimed.has(candidate)) continue;
        if (Math.abs(Math.log2(candidate.lag / hypothesis.lag)) >= MATCH_TOLERANCE_OCTAVES)
          continue;
        if (!best || candidate.strength > best.strength) best = candidate;
      }
      if (!best) continue;
      claimed.add(best);
      hypothesis.lag += (best.lag - hypothesis.lag) * LAG_TRACKING;
      hypothesis.score += best.strength;
    }

    for (const candidate of candidates) {
      if (!claimed.has(candidate)) {
        this.hypotheses.push({ lag: candidate.lag, score: candidate.strength });
      }
    }

    this.mergeHypotheses();
    this.hypotheses.sort((a, b) => b.score - a.score);
    if (this.hypotheses.length > MAX_HYPOTHESES) {
      this.hypotheses.length = MAX_HYPOTHESES;
    }
  }

  /**
   * Folds together hypotheses that have drifted within tolerance of each other.
   *
   * `LAG_TRACKING` moves hypotheses toward their candidates, so two that began
   * apart can converge on one tempo. Left as duplicates they split that tempo's
   * support between them, and a weaker rival can outrank both.
   */
  private mergeHypotheses(): void {
    const merged: TempoHypothesis[] = [];
    for (const hypothesis of this.hypotheses) {
      const twin = merged.find(
        (m) => Math.abs(Math.log2(hypothesis.lag / m.lag)) < MATCH_TOLERANCE_OCTAVES,
      );
      if (!twin) {
        merged.push(hypothesis);
        continue;
      }
      // Keep the better-supported lag and pool the support.
      const total = twin.score + hypothesis.score;
      if (total > 0) {
        twin.lag = (twin.lag * twin.score + hypothesis.lag * hypothesis.score) / total;
      }
      twin.score = total;
    }
    this.hypotheses = merged;
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
    this.hypotheses = [];
    this.winnerStreak = 0;
    this.lastWinnerLag = 0;
    this.envelope.fill(0);
    this.writeIndex = 0;
    this.startTime = null;
    this.lastSampleIndex = -1;
    this.estimate = {
      bpm: FALLBACK_BPM,
      period: 60 / FALLBACK_BPM,
      anchor: 0,
      confidence: 0,
      stability: 0,
    };
  }
}

/** How much of its support a hypothesis keeps each window. */
const HYPOTHESIS_DECAY = 0.7;
/** Peaks weaker than this are noise, not tempo candidates. */
const CANDIDATE_FLOOR = 0.02;
/** Candidates within this of a hypothesis update it rather than spawning one. */
const MATCH_TOLERANCE_OCTAVES = 0.08;
/** How fast a hypothesis follows its candidate peak. */
const LAG_TRACKING = 0.3;
/** More than this and rivals are being tracked that will never be reported. */
const MAX_HYPOTHESES = 6;
/** Windows the same tempo must lead before stability reads 1. ~3s at 2Hz. */
const STABLE_WINDOWS = 6;

/** Sub-sample peak position, so tempo is not quantised to integer lags. */
function refinePeak(values: Float32Array, index: number): number {
  const previous = values[index - 1] ?? 0;
  const current = values[index] ?? 0;
  const next = values[index + 1] ?? 0;
  const denominator = 2 * (2 * current - next - previous);
  if (denominator === 0) return index;
  return index + (next - previous) / denominator;
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
