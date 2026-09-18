export type ObstacleKind =
  /** Sits on the ground. Jump it. */
  | 'block'
  /** Hangs from above. Duck under it. */
  | 'hanging'
  /** A hole in the ground. Jump it, but landing early is fatal. */
  | 'gap';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** Left edge, in world metres. */
  x: number;
  width: number;
  /** Bottom edge relative to the ground under it; 0 for ground-standing kinds. */
  bottom: number;
  height: number;
  /** The beat this was placed on, so the renderer can pulse it in time. */
  beatIndex: number;
  cleared: boolean;
}

/**
 * One beat's worth of ground.
 *
 * Terrain is stored per beat rather than per metre so that everything —
 * elevation changes, obstacle placement, colour shifts — lands on the musical
 * grid by construction instead of being snapped to it afterwards.
 */
export interface TerrainSegment {
  beatIndex: number;
  /** Left edge, in world metres. */
  x: number;
  width: number;
  /** Ground elevation across this segment, in metres. */
  height: number;
  /** True when this segment is a hole rather than ground. */
  solid: boolean;
}

export interface WorldSlice {
  segments: TerrainSegment[];
  obstacles: Obstacle[];
}

/** Ground height at `x`, or `null` where there is no ground to stand on. */
export function groundHeightAt(segments: readonly TerrainSegment[], x: number): number | null {
  for (const segment of segments) {
    if (x >= segment.x && x < segment.x + segment.width) {
      return segment.solid ? segment.height : null;
    }
  }
  // Off the generated range, treat as solid baseline so the player never falls
  // through a gap caused by generation lagging rather than by level design.
  return 0;
}

/** Drops everything fully behind `x`, which is the only cleanup the world needs. */
export function pruneBehind(slice: WorldSlice, x: number): void {
  slice.segments = slice.segments.filter((segment) => segment.x + segment.width > x);
  slice.obstacles = slice.obstacles.filter((obstacle) => obstacle.x + obstacle.width > x);
}
