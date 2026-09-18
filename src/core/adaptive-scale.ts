import { clamp, smoothTowards } from './math';

/**
 * Scales a feature against the loudest it has recently been.
 *
 * Absolute thresholds do not survive contact with real audio. Measured against
 * a YouTube tab, broadband energy ranged 0.0005..0.095 where the generator had
 * assumed 0.03..0.4 — so obstacle density and the entire palette sat pinned at
 * their minimum whatever the music did, and the stage stopped looking like the
 * audio. The right constants also differ per source: tab capture, a microphone
 * across a room and a decoded file are levels apart.
 *
 * Zero always maps to zero, so silence is still silence. The upper end is
 * learned, snapping up to a new peak at once and relaxing down slowly. It is
 * floored at `referencePeak` so a genuinely quiet track reads as quiet instead
 * of being stretched to full scale — without that floor, normalisation would
 * erase the difference between a lullaby and a drum solo.
 */
export class AdaptiveScale {
  private peak: number;

  /**
   * @param referencePeak Level a typical loud passage reaches. The scale never
   *   normalises against anything smaller.
   * @param relaxHalfLife Seconds for the peak to close half the distance back
   *   down once the music gets quieter.
   */
  constructor(
    private readonly referencePeak: number,
    private readonly relaxHalfLife = 10,
  ) {
    this.peak = referencePeak;
  }

  /** Feeds a sample and returns it scaled into 0..1. */
  update(value: number, dt: number): number {
    this.peak =
      value > this.peak
        ? value
        : smoothTowards(this.peak, this.referencePeak, this.relaxHalfLife, dt);
    if (this.peak < this.referencePeak) this.peak = this.referencePeak;
    return clamp(value / this.peak, 0, 1);
  }

  get currentPeak(): number {
    return this.peak;
  }

  reset(): void {
    this.peak = this.referencePeak;
  }
}
