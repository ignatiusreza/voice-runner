// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bestScoreFor,
  DEFAULT_SETTINGS,
  loadSettings,
  prefersReducedMotion,
  recordScore,
  saveSettings,
} from './settings';

afterEach(() => {
  // Un-stub first: one test replaces `localStorage` wholesale, and clearing
  // the stub would call a method it does not have.
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('settings', () => {
  it('starts from the defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a saved setting', () => {
    saveSettings({ ...DEFAULT_SETTINGS, voiceSensitivity: 0.5, reducedMotion: true });
    const loaded = loadSettings();
    expect(loaded.voiceSensitivity).toBe(0.5);
    expect(loaded.reducedMotion).toBe(true);
  });

  it('clamps a sensitivity outside the range', () => {
    saveSettings({ ...DEFAULT_SETTINGS, voiceSensitivity: 99 });
    expect(loadSettings().voiceSensitivity).toBe(1);
  });

  it('falls back to defaults on corrupt storage', () => {
    localStorage.setItem('voice-runner/settings', '{ not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('survives storage being unavailable entirely', () => {
    // Private windows and blocked site data throw on access; the game must
    // still start rather than refuse over a remembered slider.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => {
      saveSettings(DEFAULT_SETTINGS);
    }).not.toThrow();
  });

  it('fills in fields missing from older stored data', () => {
    localStorage.setItem('voice-runner/settings', JSON.stringify({ voiceSensitivity: 0.25 }));
    const loaded = loadSettings();
    expect(loaded.voiceSensitivity).toBe(0.25);
    expect(loaded.reducedMotion).toBe(false);
  });
});

describe('best scores', () => {
  it('starts at zero for an unseen seed', () => {
    expect(bestScoreFor('monday')).toBe(0);
  });

  it('keeps the highest score per seed', () => {
    expect(recordScore('monday', 120)).toBe(120);
    expect(recordScore('monday', 80)).toBe(120);
    expect(recordScore('monday', 300)).toBe(300);
    expect(bestScoreFor('monday')).toBe(300);
  });

  it('keeps seeds apart, so each day stands alone', () => {
    recordScore('monday', 500);
    recordScore('tuesday', 10);
    expect(bestScoreFor('monday')).toBe(500);
    expect(bestScoreFor('tuesday')).toBe(10);
  });
});

describe('prefersReducedMotion', () => {
  it('reports the system preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false when the query cannot be run', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('unsupported');
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});
