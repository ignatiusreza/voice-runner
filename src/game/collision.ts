import type { PlayerState } from './player';
import { TUNING } from './tuning';
import type { Obstacle, TerrainSegment } from './world';
import { groundHeightAt } from './world';

export interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/**
 * The player's collision box is narrower than the drawn character.
 *
 * Runners feel unfair when the hitbox matches the art exactly: a near miss
 * reads as a miss to the player but as a hit to the engine. Shrinking it
 * horizontally makes grazes forgiving without making obstacles skippable.
 */
const HITBOX_INSET = 0.18;

export function playerBox(player: PlayerState): Box {
  const halfWidth = TUNING.playerWidth / 2 - HITBOX_INSET;
  return {
    left: player.x - halfWidth,
    right: player.x + halfWidth,
    bottom: player.y,
    top: player.y + player.height,
  };
}

export function obstacleBox(obstacle: Obstacle, segments: readonly TerrainSegment[]): Box {
  // Obstacles are authored relative to the ground beneath them, so their world
  // box has to be resolved against the terrain at their own x, not the player's.
  const ground = groundHeightAt(segments, obstacle.x + obstacle.width / 2) ?? 0;
  return {
    left: obstacle.x,
    right: obstacle.x + obstacle.width,
    bottom: ground + obstacle.bottom,
    top: ground + obstacle.bottom + obstacle.height,
  };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
}

export interface CollisionResult {
  hit: Obstacle | null;
  /** Obstacles fully passed this frame, for scoring. */
  newlyCleared: Obstacle[];
}

export function resolveCollisions(
  player: PlayerState,
  obstacles: readonly Obstacle[],
  segments: readonly TerrainSegment[],
): CollisionResult {
  const box = playerBox(player);
  const newlyCleared: Obstacle[] = [];
  let hit: Obstacle | null = null;

  for (const obstacle of obstacles) {
    // Cheap reject: obstacles are ordered by x, but not strictly enough to
    // break early, so just skip anything nowhere near the player.
    if (obstacle.x > box.right + 1) continue;

    if (!hit && overlaps(box, obstacleBox(obstacle, segments))) {
      hit = obstacle;
      continue;
    }

    if (!obstacle.cleared && obstacle.x + obstacle.width < box.left) {
      obstacle.cleared = true;
      newlyCleared.push(obstacle);
    }
  }

  return { hit, newlyCleared };
}
