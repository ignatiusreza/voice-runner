import { describe, expect, it } from 'vitest';
import { AdaptiveScale } from './adaptive-scale';

const STEP = 1 / 60;

function feed(scale: AdaptiveScale, value: number, seconds: number): number {
  let out = 0;
  for (let i = 0; i < seconds / STEP; i++) out = scale.update(value, STEP);
  return out;
}

describe('AdaptiveScale', () => {
  it('maps silence to zero', () => {
    expect(new AdaptiveScale(0.08).update(0, STEP)).toBe(0);
  });

  it('maps the reference peak to full scale', () => {
    expect(new AdaptiveScale(0.08).update(0.08, STEP)).toBeCloseTo(1, 6);
  });

  it('uses most of the range for material that reaches the reference', () => {
    const scale = new AdaptiveScale(0.08);
    // This is the case the fixed thresholds got wrong: real energy peaked near
    // 0.095 while the old mapping expected 0.03..0.4, so the stage never left
    // the bottom of its range.
    expect(scale.update(0.05, STEP)).toBeGreaterThan(0.5);
    expect(scale.update(0.09, STEP)).toBeGreaterThan(0.9);
  });

  it('keeps a quiet source reading as quiet', () => {
    const scale = new AdaptiveScale(0.08);
    // Without the reference floor, normalisation would stretch a lullaby to
    // full scale and erase the difference from a drum solo.
    expect(feed(scale, 0.01, 30)).toBeLessThan(0.2);
  });

  it('never exceeds full scale, however loud the input', () => {
    const scale = new AdaptiveScale(0.08);
    expect(scale.update(5, STEP)).toBe(1);
  });

  it('rescales immediately when a new peak arrives', () => {
    const scale = new AdaptiveScale(0.08);
    feed(scale, 0.08, 2);
    // A passage twice as loud must not clip everything above it to 1 forever.
    expect(scale.update(0.2, STEP)).toBeCloseTo(1, 6);
    expect(scale.update(0.1, STEP)).toBeLessThan(0.6);
  });

  it('relaxes back towards the reference once the loud passage ends', () => {
    const scale = new AdaptiveScale(0.08);
    scale.update(0.4, STEP);
    expect(scale.currentPeak).toBeCloseTo(0.4, 6);

    feed(scale, 0.05, 40);
    expect(scale.currentPeak).toBeLessThan(0.2);
  });

  it('never relaxes below the reference peak', () => {
    const scale = new AdaptiveScale(0.08);
    feed(scale, 0, 60);
    expect(scale.currentPeak).toBeCloseTo(0.08, 6);
  });

  it('returns to the reference on reset', () => {
    const scale = new AdaptiveScale(0.08);
    scale.update(0.5, STEP);
    scale.reset();
    expect(scale.currentPeak).toBe(0.08);
  });
});
