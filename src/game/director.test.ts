import { describe, expect, it } from 'vitest';
import type { BeatEstimate } from '../audio/analysis/beat';
import type { AudioFeatures } from '../audio/analysis/features';
import { SILENT_FEATURES } from '../audio/analysis/features';
import { Rng } from '../core/rng';
import { StageDirector } from './director';
import { maxFairBlockHeight, maxFairBlockWidth, maxFairGapWidth } from './jump';
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

  it('holds the run speed constant, whatever the music does', () => {
    // Placement predicts where the player will be when a beat sounds, using the
    // speed at generation time. Any drift before they arrive is arrival-time
    // error, and measured that alone capped beat lock at 0.46.
    for (const bpm of [60, 120, 200]) {
      for (const audio of [LOUD, QUIET]) {
        expect(run(5, audio, beatAt(bpm), 8).director.speed).toBe(TUNING.baseRunSpeed);
      }
    }
  });

  it('packs the stage more tightly for faster music', () => {
    // Tempo drives the stage through beat *spacing* now, which is exact, rather
    // than through scroll speed, which could only ever be approximate.
    const beatWidth = (bpm: number): number => {
      const { slice } = run(5, LOUD, beatAt(bpm), 8);
      const solid = slice.segments.filter((s) => s.solid);
      return solid.reduce((sum, s) => sum + s.width, 0) / solid.length;
    };
    expect(beatWidth(180)).toBeLessThan(beatWidth(90));
  });

  it('never cuts a gap wider than a jump can carry, at any tempo', () => {
    // Slow tempo means wide beats, which is exactly where an unguarded
    // generator would produce an unjumpable hole.
    for (const bpm of [60, 75, 90, 120, 160, 200]) {
      const { slice } = run(9, LOUD, beatAt(bpm), 12);
      const gaps = slice.segments.filter((segment) => !segment.solid);
      for (const gap of gaps) {
        expect(gap.width).toBeLessThanOrEqual(maxFairGapWidth() + 1e-6);
      }
    }
  });

  it('still cuts gaps at slow tempos rather than suppressing them', () => {
    // A whole-beat hole cannot be jumped below ~200 BPM, so sizing the hole to
    // the beat quietly removed the obstacle type from most music. Holes are
    // deliberately rare, so this needs a long run to sample any.
    const { slice } = run(9, LOUD, beatAt(90), 60);
    expect(slice.segments.some((segment) => !segment.solid)).toBe(true);
  });

  it('leaves solid ground either side of every hole', () => {
    const { slice } = run(9, LOUD, beatAt(90), 60);
    const ordered = [...slice.segments].sort((a, b) => a.x - b.x);
    const holes = ordered.filter((s) => !s.solid);
    expect(holes.length).toBeGreaterThan(0);
    for (const hole of holes) {
      const index = ordered.indexOf(hole);
      expect(ordered[index - 1]?.solid).toBe(true);
      expect(ordered[index + 1]?.solid).toBe(true);
    }
  });

  it('never places a block taller or wider than a reference jump can clear', () => {
    const { slice } = run(11, LOUD, beatAt(140), 12);
    const blocks = slice.obstacles.filter((obstacle) => obstacle.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.height).toBeLessThanOrEqual(maxFairBlockHeight() + 1e-6);
      expect(block.width).toBeLessThanOrEqual(maxFairBlockWidth() + 1e-6);
    }
  });

  it('charges a terrain step against the block on top of it', () => {
    // A block on a beat that also rises has to be cleared from the lower ground
    // the player took off from, so the two heights share one budget.
    const { slice } = run(11, () => features({ energy: 0.6, bass: 0.9 }), beatAt(120), 20);
    const byBeat = new Map<number, number>();
    for (const segment of slice.segments) {
      if (segment.solid) byBeat.set(segment.beatIndex, segment.height);
    }
    for (const block of slice.obstacles.filter((o) => o.kind === 'block')) {
      const here = byBeat.get(block.beatIndex);
      const before = byBeat.get(block.beatIndex - 1);
      if (here === undefined || before === undefined) continue;
      const rise = Math.max(0, here - before);
      expect(rise + block.height).toBeLessThanOrEqual(maxFairBlockHeight() + 1e-6);
    }
  });

  it('never hangs an obstacle right after a downward step', () => {
    // Running off a drop puts the player in the air, and ducking needs the
    // ground — so a hanging obstacle there cannot be avoided at all.
    const { slice } = run(11, () => features({ energy: 0.8, bass: 0.9 }), beatAt(180), 30);
    const heights = new Map<number, number>();
    for (const segment of slice.segments) {
      if (segment.solid) heights.set(segment.beatIndex, segment.height);
    }
    const hanging = slice.obstacles.filter((o) => o.kind === 'hanging');
    expect(hanging.length).toBeGreaterThan(0);
    for (const obstacle of hanging) {
      const here = heights.get(obstacle.beatIndex);
      const before = heights.get(obstacle.beatIndex - 1);
      if (here === undefined || before === undefined) continue;
      expect(before - here).toBeLessThanOrEqual(0.25 + 1e-6);
    }
  });

  it('locks the beat grid to the tracker phase, not to the camera', () => {
    // The generator used to seed its cursor from camera geometry, so the stage
    // had the right tempo at an arbitrary phase and never re-synced — the map
    // kept time with itself instead of with the music.
    const period = 0.5;
    for (const anchor of [0, 0.13, 0.37, 0.49]) {
      const director = new StageDirector(new Rng(5));
      const slice: WorldSlice = { segments: [], obstacles: [] };
      const now = 3;
      director.update(slice, 0, now, LOUD(), { bpm: 120, period, anchor, confidence: 0.9 }, STEP);

      // A segment starting at x is reached at now + (x - playerX)/speed, and
      // that arrival time has to sit on the tracker's grid.
      const speed = director.speed;
      for (const segment of [...slice.segments].sort((a, b) => a.x - b.x).slice(0, 6)) {
        const arrival = now + segment.x / speed;
        const offGrid = Math.abs(arrival - anchor) % period;
        const distanceToBeat = Math.min(offGrid, period - offGrid);
        expect(
          distanceToBeat,
          `anchor ${String(anchor)}, segment at ${segment.x.toFixed(2)}`,
        ).toBeLessThan(0.02);
      }
    }
  });

  it('leaves a full jump of clear ground after anything that must be jumped', () => {
    const { slice } = run(11, LOUD, beatAt(160), 20);
    const jumpHazards = [
      ...slice.obstacles
        .filter((o) => o.kind === 'block')
        .map((o) => ({ left: o.x, right: o.x + o.width })),
      ...slice.segments.filter((s) => !s.solid).map((s) => ({ left: s.x, right: s.x + s.width })),
    ].sort((a, b) => a.left - b.left);

    for (let i = 1; i < jumpHazards.length; i++) {
      const gap = jumpHazards[i]!.left - jumpHazards[i - 1]!.right;
      // Otherwise the next hazard arrives while the player is still airborne.
      expect(gap).toBeGreaterThan(0);
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
