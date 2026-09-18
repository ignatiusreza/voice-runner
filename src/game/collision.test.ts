import { describe, expect, it } from 'vitest';
import { obstacleBox, overlaps, playerBox, resolveCollisions } from './collision';
import { createPlayer } from './player';
import { TUNING } from './tuning';
import type { Obstacle, TerrainSegment } from './world';

const FLAT: TerrainSegment[] = [{ beatIndex: 0, x: -100, width: 1000, height: 0, solid: true }];
const RAISED: TerrainSegment[] = [{ beatIndex: 0, x: -100, width: 1000, height: 2, solid: true }];

function obstacle(overrides: Partial<Obstacle> = {}): Obstacle {
  return {
    id: 1,
    kind: 'block',
    x: 10,
    width: 1,
    bottom: 0,
    height: 1.5,
    beatIndex: 0,
    cleared: false,
    ...overrides,
  };
}

describe('overlaps', () => {
  it('detects an overlap and rejects a touch at the edge', () => {
    const a = { left: 0, right: 1, bottom: 0, top: 1 };
    expect(overlaps(a, { left: 0.5, right: 1.5, bottom: 0.5, top: 1.5 })).toBe(true);
    expect(overlaps(a, { left: 1, right: 2, bottom: 0, top: 1 })).toBe(false);
  });
});

describe('playerBox', () => {
  it('is narrower than the drawn character, so grazes are forgiving', () => {
    const player = createPlayer();
    expect(playerBox(player).right - playerBox(player).left).toBeLessThan(TUNING.playerWidth);
  });

  it('shrinks while ducking', () => {
    const player = createPlayer();
    player.height = TUNING.duckHeight;
    expect(playerBox(player).top - playerBox(player).bottom).toBe(TUNING.duckHeight);
  });
});

describe('obstacleBox', () => {
  it('sits on the terrain beneath it, not on the baseline', () => {
    const box = obstacleBox(obstacle(), RAISED);
    expect(box.bottom).toBe(2);
    expect(box.top).toBe(3.5);
  });
});

describe('resolveCollisions', () => {
  it('reports no hit when the player is clear', () => {
    const player = createPlayer();
    player.x = 5;
    expect(resolveCollisions(player, [obstacle()], FLAT).hit).toBeNull();
  });

  it('hits a block the player runs into', () => {
    const player = createPlayer();
    player.x = 10.5;
    expect(resolveCollisions(player, [obstacle()], FLAT).hit).not.toBeNull();
  });

  it('lets a high enough jump clear a block', () => {
    const player = createPlayer();
    player.x = 10.5;
    player.y = 2;
    expect(resolveCollisions(player, [obstacle()], FLAT).hit).toBeNull();
  });

  it('hits a hanging obstacle when standing but not when ducking', () => {
    const hanging = obstacle({ kind: 'hanging', bottom: TUNING.duckHeight + 0.35, height: 2 });
    const player = createPlayer();
    player.x = 10.5;

    expect(resolveCollisions(player, [hanging], FLAT).hit).not.toBeNull();

    player.height = TUNING.duckHeight;
    expect(resolveCollisions(player, [hanging], FLAT).hit).toBeNull();
  });

  it('marks an obstacle cleared once, after the player passes it', () => {
    const target = obstacle();
    const player = createPlayer();
    player.x = 20;

    const first = resolveCollisions(player, [target], FLAT);
    expect(first.newlyCleared).toHaveLength(1);
    expect(target.cleared).toBe(true);

    expect(resolveCollisions(player, [target], FLAT).newlyCleared).toHaveLength(0);
  });

  it('reports only the first of several overlapping obstacles', () => {
    const player = createPlayer();
    player.x = 10.5;
    const result = resolveCollisions(
      player,
      [obstacle({ id: 1 }), obstacle({ id: 2, x: 10.2 })],
      FLAT,
    );
    expect(result.hit?.id).toBe(1);
  });
});
