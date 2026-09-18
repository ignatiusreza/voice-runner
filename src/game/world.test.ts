import { describe, expect, it } from 'vitest';
import type { Obstacle, TerrainSegment, WorldSlice } from './world';
import { groundHeightAt, pruneBehind } from './world';

const SEGMENTS: TerrainSegment[] = [
  { beatIndex: 0, x: 0, width: 5, height: 1, solid: true },
  { beatIndex: 1, x: 5, width: 5, height: 0, solid: false },
  { beatIndex: 2, x: 10, width: 5, height: 2, solid: true },
];

describe('groundHeightAt', () => {
  it('returns the height of the segment under the point', () => {
    expect(groundHeightAt(SEGMENTS, 2)).toBe(1);
    expect(groundHeightAt(SEGMENTS, 12)).toBe(2);
  });

  it('returns null over a hole', () => {
    expect(groundHeightAt(SEGMENTS, 7)).toBeNull();
  });

  it('uses the segment boundaries half-open, so there is no overlap', () => {
    expect(groundHeightAt(SEGMENTS, 5)).toBeNull();
    expect(groundHeightAt(SEGMENTS, 4.999)).toBe(1);
  });

  it('falls back to solid baseline outside the generated range', () => {
    // Generation lagging must never read as a hole and kill the player.
    expect(groundHeightAt(SEGMENTS, -10)).toBe(0);
    expect(groundHeightAt(SEGMENTS, 500)).toBe(0);
  });
});

describe('pruneBehind', () => {
  it('drops only what is entirely behind the cutoff', () => {
    const obstacles: Obstacle[] = [
      { id: 1, kind: 'block', x: 0, width: 1, bottom: 0, height: 1, beatIndex: 0, cleared: true },
      { id: 2, kind: 'block', x: 11, width: 1, bottom: 0, height: 1, beatIndex: 2, cleared: false },
    ];
    const slice: WorldSlice = { segments: [...SEGMENTS], obstacles };

    pruneBehind(slice, 6);

    expect(slice.segments.map((segment) => segment.beatIndex)).toEqual([1, 2]);
    expect(slice.obstacles.map((obstacle) => obstacle.id)).toEqual([2]);
  });

  it('keeps a segment the cutoff falls inside', () => {
    const slice: WorldSlice = { segments: [...SEGMENTS], obstacles: [] };
    pruneBehind(slice, 2);
    expect(slice.segments).toHaveLength(3);
  });
});
