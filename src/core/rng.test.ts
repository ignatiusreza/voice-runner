import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from './rng';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const first = Array.from({ length: 20 }, () => a.next());
    const second = Array.from({ length: 20 }, () => b.next());
    expect(first).toEqual(second);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays within [0, 1)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('returns integers inside the inclusive bounds', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const value = rng.int(3, 5);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('picks only from the given array', () => {
    const rng = new Rng(11);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });

  it('rejects picking from an empty array', () => {
    expect(() => new Rng(1).pick([])).toThrow(/empty/);
  });

  it('honours the requested probability, roughly', () => {
    const rng = new Rng(4242);
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (rng.chance(0.25)) hits++;
    expect(hits / 10000).toBeGreaterThan(0.22);
    expect(hits / 10000).toBeLessThan(0.28);
  });
});

describe('seedFromString', () => {
  it('is stable and case sensitive', () => {
    expect(seedFromString('runner')).toBe(seedFromString('runner'));
    expect(seedFromString('runner')).not.toBe(seedFromString('Runner'));
  });
});
