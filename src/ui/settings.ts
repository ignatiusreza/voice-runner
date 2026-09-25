/**
 * Player settings and best scores, persisted in `localStorage`.
 *
 * Every read and write is guarded: storage throws in private windows and when
 * site data is blocked, and a game that refuses to start because it could not
 * remember a slider position would be a poor trade. Defaults are always usable.
 */
const STORAGE_KEY = 'voice-runner/settings';
const SCORES_KEY = 'voice-runner/best';

export interface Settings {
  /**
   * -1..+1, shifting how far above the background a sound must rise to count.
   *
   * Voice control is not equally easy for everyone — a quiet room, a soft
   * voice, or a cheap microphone all move the same shout by several dB. This is
   * the difference between the game being playable and not.
   */
  voiceSensitivity: number;
  /** Suppresses the onset flash and parallax movement. */
  reducedMotion: boolean;
  /** Draws a marker when an obstacle is one jump away, for playing muted. */
  visualCues: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  voiceSensitivity: 0,
  reducedMotion: false,
  visualCues: false,
};

/** dB the trigger moves by at full sensitivity, either way. */
export const SENSITIVITY_RANGE_DB = 6;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable. The setting still applies for this session.
  }
}

export function loadSettings(): Settings {
  const stored = readJson(STORAGE_KEY, DEFAULT_SETTINGS);
  return {
    voiceSensitivity: clampSensitivity(stored.voiceSensitivity),
    reducedMotion: stored.reducedMotion,
    visualCues: stored.visualCues,
  };
}

export function saveSettings(settings: Settings): void {
  writeJson(STORAGE_KEY, settings);
}

function clampSensitivity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * Whether the player has asked their system to reduce motion.
 *
 * Honoured as the default for `reducedMotion`, so the setting starts in the
 * right place rather than making them find it.
 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Best score per stage seed, so a given day's stage is comparable. */
export function bestScoreFor(seed: string): number {
  const scores = readJson<Record<string, number>>(SCORES_KEY, {});
  return scores[seed] ?? 0;
}

/** Records `score` if it beats the stored best. Returns the best after. */
export function recordScore(seed: string, score: number): number {
  const scores = readJson<Record<string, number>>(SCORES_KEY, {});
  const best = Math.max(scores[seed] ?? 0, score);
  scores[seed] = best;
  writeJson(SCORES_KEY, scores);
  return best;
}
