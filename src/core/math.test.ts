import { describe, expect, it } from 'vitest';
import { amplitudeToDb, clamp, dbToAmplitude, lerp, mapRange, smoothTowards } from './math';

describe('clamp', () => {
  it('bounds the value at both ends', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('mapRange', () => {
  it('maps and clamps outside the input range', () => {
    expect(mapRange(5, 0, 10, 0, 100)).toBe(50);
    expect(mapRange(-1, 0, 10, 0, 100)).toBe(0);
    expect(mapRange(11, 0, 10, 0, 100)).toBe(100);
  });

  it('returns the low output for a degenerate input range', () => {
    expect(mapRange(3, 2, 2, 7, 9)).toBe(7);
  });
});

describe('smoothTowards', () => {
  it('closes exactly half the distance in one half-life', () => {
    expect(smoothTowards(0, 10, 0.5, 0.5)).toBeCloseTo(5, 6);
  });

  it('reaches the same place regardless of step size', () => {
    let coarse = 0;
    coarse = smoothTowards(coarse, 10, 0.5, 1);

    let fine = 0;
    for (let i = 0; i < 100; i++) fine = smoothTowards(fine, 10, 0.5, 0.01);

    expect(fine).toBeCloseTo(coarse, 6);
  });

  it('snaps immediately for a non-positive half-life', () => {
    expect(smoothTowards(0, 10, 0, 0.016)).toBe(10);
  });
});

describe('decibel conversion', () => {
  it('round-trips', () => {
    expect(dbToAmplitude(amplitudeToDb(0.25))).toBeCloseTo(0.25, 6);
  });

  it('floors silence instead of returning -Infinity', () => {
    expect(Number.isFinite(amplitudeToDb(0))).toBe(true);
  });
});

describe('lerp', () => {
  it('interpolates between the endpoints', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });
});
