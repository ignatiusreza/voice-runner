import { describe, expect, it } from 'vitest';
import { FeatureExtractor } from './features';

const SAMPLE_RATE = 48000;
const BINS = 1024;

/** Builds a spectrum with energy only in the given frequency window. */
function spectrumInBand(lowHz: number, highHz: number, level = 1): Float32Array {
  const binHz = SAMPLE_RATE / 2 / BINS;
  const out = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const hz = i * binHz;
    if (hz >= lowHz && hz <= highHz) out[i] = level;
  }
  return out;
}

describe('FeatureExtractor', () => {
  it('attributes low-frequency energy to the bass band only', () => {
    // Fills the whole 20-250Hz band, so the band average should be near its max.
    const features = new FeatureExtractor(SAMPLE_RATE).extract(spectrumInBand(20, 250), 0);
    expect(features.bass).toBeGreaterThan(0.85);
    expect(features.mid).toBeLessThan(0.05);
    expect(features.treble).toBeLessThan(0.05);
  });

  it('reads a partly filled band proportionally', () => {
    const features = new FeatureExtractor(SAMPLE_RATE).extract(spectrumInBand(40, 200), 0);
    expect(features.bass).toBeGreaterThan(0.4);
    expect(features.bass).toBeLessThan(0.85);
  });

  it('attributes high-frequency energy to the treble band only', () => {
    const features = new FeatureExtractor(SAMPLE_RATE).extract(spectrumInBand(4000, 12000), 0);
    expect(features.treble).toBeGreaterThan(0.5);
    expect(features.bass).toBeLessThan(0.05);
  });

  it('reads brighter for a higher spectral centroid', () => {
    const extractor = new FeatureExtractor(SAMPLE_RATE);
    const dark = extractor.extract(spectrumInBand(40, 200), 0);
    extractor.reset();
    const bright = extractor.extract(spectrumInBand(6000, 12000), 0);
    expect(bright.brightness).toBeGreaterThan(dark.brightness);
  });

  it('reports flux only on growth, not on decay', () => {
    const extractor = new FeatureExtractor(SAMPLE_RATE);
    extractor.extract(spectrumInBand(40, 200, 0.1), 0);
    const rising = extractor.extract(spectrumInBand(40, 200, 0.9), 0.01);
    const falling = extractor.extract(spectrumInBand(40, 200, 0.1), 0.02);

    expect(rising.flux).toBeGreaterThan(0);
    expect(falling.flux).toBe(0);
  });

  it('has no flux on the very first frame', () => {
    expect(new FeatureExtractor(SAMPLE_RATE).extract(spectrumInBand(40, 200), 0).flux).toBe(0);
  });

  it('reports finite silence rather than -Infinity dB', () => {
    const features = new FeatureExtractor(SAMPLE_RATE).extract(new Float32Array(BINS), 0);
    expect(features.energy).toBe(0);
    expect(Number.isFinite(features.db)).toBe(true);
  });

  it('forgets the previous spectrum on reset', () => {
    const extractor = new FeatureExtractor(SAMPLE_RATE);
    extractor.extract(spectrumInBand(40, 200, 0.1), 0);
    extractor.reset();
    expect(extractor.extract(spectrumInBand(40, 200, 0.9), 0.01).flux).toBe(0);
  });
});
