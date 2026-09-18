import type { BeatEstimate } from '../audio/analysis/beat';
import type { AudioFeatures } from '../audio/analysis/features';
import { clamp, lerp, mapRange, smoothTowards } from '../core/math';
import type { Rng } from '../core/rng';
import { TUNING } from './tuning';
import type { Obstacle, ObstacleKind, WorldSlice } from './world';

/** Ballistic peak of a full-strength jump, in metres. */
export function maxJumpHeight(): number {
  return (TUNING.jumpVelocity * TUNING.jumpVelocity) / (2 * Math.abs(TUNING.gravity));
}

/** Horizontal reach of a full-strength jump at `speed`, in metres. */
export function maxJumpDistance(speed: number): number {
  const airtime = (2 * TUNING.jumpVelocity) / Math.abs(TUNING.gravity);
  return airtime * speed;
}

/**
 * A gap may use at most this much of the available jump reach. The margin
 * covers the player mistiming the take-off by a few frames.
 */
const GAP_SAFETY_FACTOR = 0.6;

/** Floor on segment width, so a tempo glitch cannot emit a zero-width segment. */
const MIN_SEGMENT_WIDTH = 0.5;

/** How far behind the camera terrain generation starts, in metres. */
const START_MARGIN = 8;

/**
 * How far the beat clock may fall behind before generation is treated as having
 * stalled and restarted. Must exceed the lookahead, or ordinary generation —
 * which legitimately runs seconds ahead — would keep resetting itself.
 */
const STALL_SECONDS = 10;

export interface StageMood {
  /** 0..1 smoothed loudness. Drives obstacle density and parallax speed. */
  intensity: number;
  /** 0..1 smoothed spectral centroid. Drives the palette from cold to hot. */
  brightness: number;
  /** 0..1 smoothed low-band energy. Drives how hilly the terrain is. */
  weight: number;
  bpm: number;
  /** 0..1. Low means the tempo grid is a guess and the stage should calm down. */
  confidence: number;
}

/**
 * Builds the stage from the music, one beat at a time.
 *
 * The generator works in *time*, not in distance: a beat landing at audio time
 * `t` is placed at the world position the player will occupy at `t`. Obstacles
 * therefore arrive under the player exactly on the beat, which is what makes
 * the run feel choreographed rather than merely audio-coloured.
 *
 * A consequence worth stating: terrain is generated a fixed lookahead ahead of
 * the player, so the shape of the stage reflects the music of a second or two
 * ago. That reads as the level anticipating the music rather than lagging it,
 * and it is the price of generating from a live stream instead of a file.
 */
export class StageDirector {
  private smoothedIntensity = 0;
  private smoothedBrightness = 0.35;
  private smoothedWeight = 0;
  private runSpeed: number = TUNING.baseRunSpeed;

  /** Audio time of the next beat to lay down. Never rewound by tempo changes. */
  private nextBeatTime: number | null = null;
  /** Right edge of the terrain so far; the next segment starts exactly here. */
  private nextSegmentX: number | null = null;
  private nextBeatIndex = 0;
  private nextObstacleId = 1;
  /** Consecutive beats that already carry an obstacle; caps difficulty spikes. */
  private consecutiveObstacles = 0;
  private lastSegmentHeight = 0;

  constructor(private readonly rng: Rng) {}

  get mood(): StageMood {
    return {
      intensity: this.smoothedIntensity,
      brightness: this.smoothedBrightness,
      weight: this.smoothedWeight,
      bpm: this.currentBpm,
      confidence: this.currentConfidence,
    };
  }

  private currentBpm = 120;
  private currentConfidence = 0;

  get speed(): number {
    return this.runSpeed;
  }

  /**
   * Advances the smoothed mood and extends the world far enough ahead of
   * `playerX` that nothing pops into view.
   */
  update(
    slice: WorldSlice,
    playerX: number,
    now: number,
    features: AudioFeatures,
    beat: BeatEstimate,
    dt: number,
  ): void {
    // Loudness rises fast and falls slowly so a drop in the music does not
    // instantly flatten the stage; colour moves slower still, to avoid strobing.
    this.smoothedIntensity = smoothTowards(
      this.smoothedIntensity,
      features.energy,
      features.energy > this.smoothedIntensity ? 0.12 : 0.6,
      dt,
    );
    this.smoothedBrightness = smoothTowards(this.smoothedBrightness, features.brightness, 1.5, dt);
    this.smoothedWeight = smoothTowards(this.smoothedWeight, features.bass, 0.35, dt);
    this.currentBpm = beat.bpm;
    this.currentConfidence = beat.confidence;

    // Tempo sets the pace, but only as far as the estimate is trusted — a wrong
    // BPM at full authority would make the game unplayably fast or sluggish.
    const tempoSpeed = TUNING.baseRunSpeed * (beat.bpm / 120);
    const target = clamp(
      lerp(TUNING.baseRunSpeed, tempoSpeed, beat.confidence) *
        (0.9 + this.smoothedIntensity * 0.35),
      TUNING.minRunSpeed,
      TUNING.maxRunSpeed,
    );
    this.runSpeed = smoothTowards(this.runSpeed, target, 1.2, dt);

    if (this.nextBeatTime === null) {
      // Start the terrain behind the camera, not at the player's feet: the
      // player is drawn some way in from the left edge, and generating forward
      // from their position leaves the visible ground under and behind them
      // empty for the first second of a run.
      const startX = playerX - TUNING.playerScreenX - START_MARGIN;
      this.nextSegmentX = startX;
      // Back-date the beat clock to match, so the grid still lines up with the
      // music rather than being offset by however far back generation began.
      this.nextBeatTime = now - (playerX - startX) / this.runSpeed;
    }

    // After a stall (tab backgrounded, source swapped) the pointer can be far in
    // the past; skip it forward rather than generating a burst of stale beats.
    let beatTime = this.nextBeatTime;
    if (beatTime < now - STALL_SECONDS) {
      beatTime = now + beat.period * 0.5;
      this.nextSegmentX = null;
    }

    const generateUntilX = playerX + TUNING.viewWidth + TUNING.generationMargin;
    let guard = 0;
    while (guard++ < 256) {
      const x = this.nextSegmentX ?? playerX + this.runSpeed * (beatTime - now);
      if (x > generateUntilX) break;

      // The width stretches to meet where the *next* beat will land rather than
      // being `speed * period`. Speed drifts between frames, and deriving the
      // width from the two beat positions is what keeps the terrain exactly
      // contiguous — a sliver of a gap between segments reads as a hole and
      // would drop the player through the floor.
      const nextX = playerX + this.runSpeed * (beatTime + beat.period - now);
      const width = Math.max(nextX - x, MIN_SEGMENT_WIDTH);

      this.emitBeat(slice, x, width, this.nextBeatIndex);
      this.nextBeatIndex += 1;
      this.nextSegmentX = x + width;
      beatTime += beat.period;
    }

    this.nextBeatTime = beatTime;
  }

  private emitBeat(slice: WorldSlice, x: number, width: number, beatIndex: number): void {
    const { minGroundHeight, maxGroundHeight } = TUNING;

    // Heavier low end lifts the ground; the step is capped so terrain stays
    // runnable and does not turn into a staircase of unclearable walls.
    const desired = mapRange(this.smoothedWeight, 0.04, 0.5, minGroundHeight, maxGroundHeight);
    const jitter = this.rng.range(-0.35, 0.35) * this.smoothedIntensity;
    const height = clamp(
      clamp(desired + jitter, this.lastSegmentHeight - 1.2, this.lastSegmentHeight + 1.2),
      minGroundHeight,
      maxGroundHeight,
    );

    const kind = this.chooseObstacle(beatIndex, width);
    const solid = kind !== 'gap';

    slice.segments.push({ beatIndex, x, width, height, solid });
    this.lastSegmentHeight = solid ? height : this.lastSegmentHeight;

    if (kind === null) {
      this.consecutiveObstacles = 0;
      return;
    }

    this.consecutiveObstacles += 1;
    if (kind !== 'gap') {
      slice.obstacles.push(this.buildObstacle(kind, x, width, beatIndex));
    }
  }

  /** Returns the obstacle kind for this beat, or null for a clear beat. */
  private chooseObstacle(beatIndex: number, segmentWidth: number): ObstacleKind | null {
    // Guaranteed breather: never more than two loaded beats in a row, whatever
    // the music is doing. Without this, a dense passage becomes unsurvivable.
    if (this.consecutiveObstacles >= 2) return null;
    // Hold the first bar clear so the player hears the tempo before reacting.
    if (beatIndex < 4) return null;

    const density = mapRange(this.smoothedIntensity, 0.03, 0.4, 0.12, 0.72);
    if (!this.rng.chance(density)) return null;

    // Bright, airy music hangs things overhead; heavy music puts them on the
    // floor. Gaps are rare and reserved for loud passages, where they read as
    // a deliberate drop rather than an accident.
    const bright = this.smoothedBrightness;
    const roll = this.rng.next();

    // A gap spans a whole beat, so at slow tempi it can be wider than a jump
    // can carry. Only cut one when it demonstrably fits inside the jump arc.
    const gapFits = segmentWidth <= GAP_SAFETY_FACTOR * maxJumpDistance(this.runSpeed);
    if (gapFits && this.smoothedIntensity > 0.25 && roll < 0.15) return 'gap';

    return roll < 0.5 + (0.5 - bright) * 0.6 ? 'block' : 'hanging';
  }

  private buildObstacle(
    kind: Exclude<ObstacleKind, 'gap'>,
    segmentX: number,
    segmentWidth: number,
    beatIndex: number,
  ): Obstacle {
    // Sized against what a full-strength jump can actually clear at the current
    // speed, so a fair stage stays fair as the tempo pushes the speed up.
    const reach = maxJumpHeight();
    const width = clamp(segmentWidth * this.rng.range(0.22, 0.4), 0.7, 2.6);
    // Centre it in the beat so the jump happens on the beat, not on its edge.
    const x = segmentX + (segmentWidth - width) / 2;

    if (kind === 'block') {
      const height = clamp(
        this.rng.range(0.7, 0.55 * reach) * (0.7 + this.smoothedIntensity),
        0.6,
        0.62 * reach,
      );
      return {
        id: this.nextObstacleId++,
        kind,
        x,
        width,
        bottom: 0,
        height,
        beatIndex,
        cleared: false,
      };
    }

    // `bottom` is measured from the ground beneath, so a fixed clearance always
    // leaves a duckable slot however high the terrain under it has risen.
    return {
      id: this.nextObstacleId++,
      kind,
      x,
      width,
      bottom: TUNING.duckHeight + 0.35,
      height: this.rng.range(1.2, 2.4),
      beatIndex,
      cleared: false,
    };
  }

  reset(): void {
    this.smoothedIntensity = 0;
    this.smoothedBrightness = 0.35;
    this.smoothedWeight = 0;
    this.runSpeed = TUNING.baseRunSpeed;
    this.nextBeatTime = null;
    this.nextSegmentX = null;
    this.nextBeatIndex = 0;
    this.nextObstacleId = 1;
    this.consecutiveObstacles = 0;
    this.lastSegmentHeight = 0;
  }
}
