import { describe, expect, it } from 'vitest';
import type { BeatEstimate } from '../audio/analysis/beat';
import type { AudioFeatures } from '../audio/analysis/features';
import { SILENT_FEATURES } from '../audio/analysis/features';
import { Rng } from '../core/rng';
import { maxJumpDistance, maxJumpHeight, StageDirector } from './director';
import { TUNING } from './tuning';
import type { WorldSlice } from './world';
import { groundHeightAt } from './world';

const STEP = 1 / 60;

function beatAt(bpm: number, confidence = 0.9): BeatEstimate {
  return { bpm, period: 60 / bpm, anchor: 0, confidence };
}

function features(overrides: Partial<AudioFeatures> = {}): AudioFeatures {
  return { ...SILENT_FEATURES, ...overrides };
}

/**
 * Runs the director for `seconds` of audio, moving the player forward at the
 * speed the director itself chose — the same coupling the real game has.
 */
function run(
  seed: number,
  audio: (time: number) => AudioFeatures,
  beat: BeatEstimate,
  seconds: number,
): { slice: WorldSlice; director: StageDirector; playerX: number } {
  const director = new StageDirector(new Rng(seed));
  const slice: WorldSlice = { segments: [], obstacles: [] };
  let playerX = 0;

  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    const time = i * STEP;
    director.update(slice, playerX, time, audio(time), beat, STEP);
    playerX += director.speed * STEP;
  }
  return { slice, director, playerX };
}

const LOUD = (): AudioFeatures => features({ energy: 0.3, bass: 0.3, brightness: 0.4, flux: 0.2 });
const QUIET = (): AudioFeatures => features({ energy: 0.02, bass: 0.02, brightness: 0.2 });

describe('StageDirector', () => {
  it('generates far enough ahead that nothing pops into view', () => {
    const { slice, playerX } = run(1, LOUD, beatAt(120), 6);
    const furthest = Math.max(...slice.segments.map((s) => s.x + s.width));
    expect(furthest).toBeGreaterThanOrEqual(playerX + TUNING.viewWidth);
  });

  it('puts ground under and behind the player from the very first frame', () => {
    const director = new StageDirector(new Rng(101));
    const slice: WorldSlice = { segments: [], obstacles: [] };
    director.update(slice, 0, 0, LOUD(), beatAt(120), STEP);

    const leftmost = Math.min(...slice.segments.map((s) => s.x));
    // The player is drawn `playerScreenX` metres in from the left edge, so
    // terrain has to start behind that or the run opens on empty space.
    expect(leftmost).toBeLessThanOrEqual(-TUNING.playerScreenX);
    expect(groundHeightAt(slice.segments, 0)).not.toBeNull();
  });

  it('keeps ground under the player for the whole run', () => {
    const director = new StageDirector(new Rng(103));
    const slice: WorldSlice = { segments: [], obstacles: [] };
    let playerX = 0;

    for (let i = 0; i < 60 * 20; i++) {
      const time = i * STEP;
      director.update(slice, playerX, time, LOUD(), beatAt(120), STEP);
      // Solid ground or a deliberate gap, but never off the end of the world.
      const covered = slice.segments.some((s) => playerX >= s.x && playerX < s.x + s.width);
      expect(covered).toBe(true);
      playerX += director.speed * STEP;
    }
  });

  it('lays terrain down as a gapless, ordered chain', () => {
    const { slice } = run(2, LOUD, beatAt(128), 6);
    expect(slice.segments.length).toBeGreaterThan(5);
    for (let i = 1; i < slice.segments.length; i++) {
      const previous = slice.segments[i - 1]!;
      const current = slice.segments[i]!;
      expect(current.x).toBeGreaterThan(previous.x);
      expect(current.x).toBeCloseTo(previous.x + previous.width, 4);
    }
  });

  it('is deterministic for the same seed and the same audio', () => {
    const first = run(42, LOUD, beatAt(120), 5).slice;
    const second = run(42, LOUD, beatAt(120), 5).slice;
    expect(second.segments).toEqual(first.segments);
    expect(second.obstacles).toEqual(first.obstacles);
  });

  it('builds a different stage from a different seed', () => {
    const a = run(1, LOUD, beatAt(120), 5).slice;
    const b = run(2, LOUD, beatAt(120), 5).slice;
    expect(b.segments).not.toEqual(a.segments);
  });

  it('places more obstacles for louder music', () => {
    const loud = run(7, LOUD, beatAt(120), 10).slice;
    const quiet = run(7, QUIET, beatAt(120), 10).slice;
    expect(loud.obstacles.length).toBeGreaterThan(quiet.obstacles.length);
  });

  it('raises the terrain for bass-heavy music', () => {
    const heavy = run(3, () => features({ energy: 0.3, bass: 0.6 }), beatAt(120), 8).slice;
    const light = run(3, () => features({ energy: 0.3, bass: 0.02 }), beatAt(120), 8).slice;

    const average = (segments: typeof heavy.segments): number =>
      segments.reduce((sum, s) => sum + s.height, 0) / segments.length;

    expect(average(heavy.segments)).toBeGreaterThan(average(light.segments));
  });

  it('runs faster for faster music', () => {
    const fast = run(5, LOUD, beatAt(170), 6).director.speed;
    const slow = run(5, LOUD, beatAt(70), 6).director.speed;
    expect(fast).toBeGreaterThan(slow);
  });

  it('keeps the speed inside its bounds even at absurd tempos', () => {
    expect(run(5, LOUD, beatAt(600), 6).director.speed).toBeLessThanOrEqual(TUNING.maxRunSpeed);
    expect(run(5, LOUD, beatAt(5), 6).director.speed).toBeGreaterThanOrEqual(TUNING.minRunSpeed);
  });

  it('ignores the tempo when the estimate is not trusted', () => {
    const confident = run(5, LOUD, beatAt(180, 1), 6).director.speed;
    const unsure = run(5, LOUD, beatAt(180, 0), 6).director.speed;
    expect(unsure).toBeLessThan(confident);
  });

  it('never cuts a gap wider than a jump can carry', () => {
    // Slow tempo means wide beats, which is exactly where an unguarded
    // generator would produce an unjumpable hole.
    for (const bpm of [60, 75, 90, 120, 160, 200]) {
      const { slice, director } = run(9, LOUD, beatAt(bpm), 12);
      const gaps = slice.segments.filter((segment) => !segment.solid);
      for (const gap of gaps) {
        expect(gap.width).toBeLessThanOrEqual(0.6 * maxJumpDistance(director.speed) + 1e-6);
      }
    }
  });

  it('never places a block taller than a jump can clear', () => {
    const { slice } = run(11, LOUD, beatAt(140), 12);
    const blocks = slice.obstacles.filter((obstacle) => obstacle.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.height).toBeLessThan(maxJumpHeight());
    }
  });

  it('leaves a duckable slot under every hanging obstacle', () => {
    const { slice } = run(13, LOUD, beatAt(140), 12);
    const hanging = slice.obstacles.filter((obstacle) => obstacle.kind === 'hanging');
    expect(hanging.length).toBeGreaterThan(0);
    for (const obstacle of hanging) {
      expect(obstacle.bottom).toBeGreaterThan(TUNING.duckHeight);
    }
  });

  it('never loads three consecutive beats', () => {
    const { slice } = run(
      17,
      () => features({ energy: 0.9, bass: 0.9, flux: 0.9 }),
      beatAt(150),
      15,
    );
    const loaded = new Set<number>();
    for (const obstacle of slice.obstacles) loaded.add(obstacle.beatIndex);
    for (const segment of slice.segments) if (!segment.solid) loaded.add(segment.beatIndex);

    for (const beatIndex of loaded) {
      const runLength = loaded.has(beatIndex - 1) && loaded.has(beatIndex - 2) ? 3 : 0;
      expect(runLength).toBe(0);
    }
  });

  it('keeps the opening bar clear so the player can find the tempo', () => {
    const { slice } = run(19, LOUD, beatAt(120), 10);
    for (const obstacle of slice.obstacles) expect(obstacle.beatIndex).toBeGreaterThanOrEqual(4);
    for (const segment of slice.segments.filter((s) => !s.solid)) {
      expect(segment.beatIndex).toBeGreaterThanOrEqual(4);
    }
  });

  it('limits how sharply the terrain can step', () => {
    const { slice } = run(23, () => features({ energy: 0.8, bass: 0.9 }), beatAt(140), 12);
    const solid = slice.segments.filter((segment) => segment.solid);
    for (let i = 1; i < solid.length; i++) {
      expect(Math.abs(solid[i]!.height - solid[i - 1]!.height)).toBeLessThanOrEqual(1.2 + 1e-6);
    }
  });

  it('follows the music into a brighter palette', () => {
    const dark = run(29, () => features({ energy: 0.3, brightness: 0.05 }), beatAt(120), 6);
    const bright = run(29, () => features({ energy: 0.3, brightness: 0.9 }), beatAt(120), 6);
    expect(bright.director.mood.brightness).toBeGreaterThan(dark.director.mood.brightness);
  });

  it('recovers without a burst of stale beats after a long stall', () => {
    const director = new StageDirector(new Rng(31));
    const slice: WorldSlice = { segments: [], obstacles: [] };
    director.update(slice, 0, 0, LOUD(), beatAt(120), STEP);
    const afterFirst = slice.segments.length;

    // The tab was backgrounded for a minute; audio time jumped far ahead.
    director.update(slice, 0, 60, LOUD(), beatAt(120), STEP);

    expect(slice.segments.length - afterFirst).toBeLessThan(20);
  });

  it('starts over cleanly on reset', () => {
    const director = new StageDirector(new Rng(37));
    const slice: WorldSlice = { segments: [], obstacles: [] };
    director.update(slice, 0, 0, LOUD(), beatAt(120), STEP);
    director.reset();

    expect(director.speed).toBe(TUNING.baseRunSpeed);
    expect(director.mood.intensity).toBe(0);
  });
});
