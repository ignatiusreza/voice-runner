import type { BeatEstimate } from '../audio/analysis/beat';
import type { AudioFeatures } from '../audio/analysis/features';
import { AdaptiveScale } from '../core/adaptive-scale';
import { clamp, mapRange, smoothTowards } from '../core/math';
import type { Rng } from '../core/rng';
import {
  jumpDistance,
  maxFairBlockHeight,
  maxFairBlockWidth,
  maxFairGapWidth,
  REFERENCE_JUMP_STRENGTH,
} from './jump';
import { TUNING } from './tuning';
import type { Obstacle, ObstacleKind, WorldSlice } from './world';

/** How fast an onset flash fades. Short enough to read as a hit. */
const PULSE_DECAY_HALF_LIFE = 0.09;

/** Below this the tracker's phase is too rough to steer generation by. */
const PHASE_LOCK_MIN_CONFIDENCE = 0.2;
/** Seconds of phase correction allowed per second, so the slew stays invisible. */
const PHASE_SLEW_RATE = 0.2;

/** The beat time on `beat`'s grid nearest to `time`. */
function snapToBeatGrid(time: number, beat: BeatEstimate): number {
  return beat.anchor + Math.round((time - beat.anchor) / beat.period) * beat.period;
}

/** The latest beat time on `beat`'s grid at or before `time`. */
function floorToBeatGrid(time: number, beat: BeatEstimate): number {
  return beat.anchor + Math.floor((time - beat.anchor) / beat.period) * beat.period;
}

/**
 * Clear ground required after a jump hazard, as a multiple of the jump's own
 * length: the player has to land and recover before the next demand.
 */
const HAZARD_SPACING = 1.15;

const MIN_OBSTACLE_WIDTH = 0.7;
const MAX_OBSTACLE_WIDTH = 2.6;

/**
 * Largest downward terrain step that still leaves the player grounded enough to
 * duck on the following beat.
 */
const MAX_DROP_BEFORE_DUCK = 0.25;

/** Shortest block worth placing; below this it is scenery, not an obstacle. */
const MIN_BLOCK_HEIGHT = 0.45;

/** A hole may swallow at most this much of its beat, leaving ground to land on. */
const MAX_GAP_SHARE_OF_BEAT = 0.5;

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
  /**
   * 0..1 onset strength, attacking instantly and decaying in ~a tenth of a
   * second. This is the only channel that is exactly in time with the audio.
   *
   * Everything else the stage does is either smoothed over hundreds of
   * milliseconds or generated seconds ahead of the player, so nothing ever
   * responded to a sound at the moment it happened. A drum hit now moves the
   * picture on the frame it lands.
   */
  pulse: number;
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
  /**
   * Reference peaks measured from a real YouTube tab, not guessed: broadband
   * energy topped out near 0.095, the 20-250Hz band near 0.57 and the spectral
   * centroid near 0.23 over twenty seconds of music.
   */
  private readonly intensityScale = new AdaptiveScale(0.08);
  private readonly weightScale = new AdaptiveScale(0.45);
  private readonly brightnessScale = new AdaptiveScale(0.2);
  /**
   * Onset strength is measured above its own baseline now, so the numbers are
   * much smaller than raw flux: peaks near 0.09 on real music, not 0.29.
   *
   * This trades sensitivity against selectivity and was set by measurement. At
   * 0.12 the flash fired 4 times in 30s but landed on the beat (concentration
   * 0.70); at 0.04 it fired 44 times and landed anywhere (0.02). Proper
   * peak-picking — requiring a local maximum, not just a level — would beat
   * any single threshold here; see docs/roadmap.md.
   */
  private readonly onsetScale = new AdaptiveScale(0.07, 4);

  private smoothedIntensity = 0;
  private smoothedBrightness = 0.35;
  private smoothedWeight = 0;
  private pulse = 0;
  private runSpeed: number = TUNING.baseRunSpeed;

  /** Audio time of the next beat to lay down. Never rewound by tempo changes. */
  private nextBeatTime: number | null = null;
  /** Right edge of the terrain so far; the next segment starts exactly here. */
  private nextSegmentX: number | null = null;
  private nextBeatIndex = 0;
  private nextObstacleId = 1;
  /** Consecutive beats that already carry an obstacle; caps difficulty spikes. */
  private consecutiveObstacles = 0;
  /** Right edge of the last hazard the player had to jump, in world metres. */
  private lastJumpHazardEndX = -Infinity;
  private lastSegmentHeight = 0;

  constructor(private readonly rng: Rng) {}

  get mood(): StageMood {
    return {
      intensity: this.smoothedIntensity,
      brightness: this.smoothedBrightness,
      weight: this.smoothedWeight,
      bpm: this.currentBpm,
      confidence: this.currentConfidence,
      pulse: this.pulse,
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
    // Scale first, then smooth. Smoothing the raw feature and scaling after
    // would flatten the dynamics before they were ever measured.
    const intensity = this.intensityScale.update(features.energy, dt);
    const weight = this.weightScale.update(features.bass, dt);
    const brightness = this.brightnessScale.update(features.brightness, dt);

    this.smoothedIntensity = smoothTowards(
      this.smoothedIntensity,
      intensity,
      intensity > this.smoothedIntensity ? 0.12 : 0.6,
      dt,
    );
    this.smoothedBrightness = smoothTowards(this.smoothedBrightness, brightness, 0.9, dt);
    this.smoothedWeight = smoothTowards(this.smoothedWeight, weight, 0.35, dt);

    // Attack instantly, fall away fast: a hit, not a wash. Smoothing the rise
    // at all would put the flash late, which is worse than no flash.
    const onset = this.onsetScale.update(features.flux, dt);
    this.pulse =
      onset > this.pulse ? onset : smoothTowards(this.pulse, 0, PULSE_DECAY_HALF_LIFE, dt);
    this.currentBpm = beat.bpm;
    this.currentConfidence = beat.confidence;

    // The run speed is constant, deliberately.
    //
    // A segment is placed where the player is predicted to be when its beat
    // sounds, using the speed at generation time — but the player arrives
    // seconds later. Any drift in between turns into arrival-time error, and
    // even a 3% wobble over a four-second lookahead is a third of a beat at
    // 170 BPM. Measured, that alone held beat lock at 0.46.
    //
    // Tempo still drives the stage, as obstacle *spacing*: a beat occupies
    // `speed * period` metres, so faster music packs the stage more tightly.
    // That relationship is exact, where scroll speed could only ever be
    // approximate. See docs/adr/0004.
    this.runSpeed = TUNING.baseRunSpeed;

    if (this.nextBeatTime === null) {
      // Start the terrain behind the camera, not at the player's feet: the
      // player is drawn some way in from the left edge, and generating forward
      // from their position leaves the visible ground under and behind them
      // empty for the first second of a run.
      const roughStartX = playerX - TUNING.playerScreenX - START_MARGIN;
      // Snap onto the tracker's actual beat grid, and take the beat at or
      // before the rough start so terrain still begins off-screen. Seeding from
      // camera geometry alone gave the grid the right tempo at an arbitrary
      // phase that never re-synced — the stage kept time with itself rather
      // than with the music.
      const roughTime = now - (playerX - roughStartX) / this.runSpeed;
      this.nextBeatTime = floorToBeatGrid(roughTime, beat);
      // Position has to come from the same grid, or the first segment starts
      // off-beat and every width after it is measured from the wrong place.
      this.nextSegmentX = playerX + this.runSpeed * (this.nextBeatTime - now);
    } else if (beat.confidence > PHASE_LOCK_MIN_CONFIDENCE) {
      // Ease the cursor back onto the grid as the estimate improves, rather
      // than jumping: a sudden phase shift would stretch or squash one segment
      // visibly. Slewing spreads it over a second or so.
      const target = snapToBeatGrid(this.nextBeatTime, beat);
      const error = target - this.nextBeatTime;
      const maxShift = PHASE_SLEW_RATE * dt;
      this.nextBeatTime += clamp(error, -maxShift, maxShift);
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
    const previousHeight = this.lastSegmentHeight;

    // Heavier low end lifts the ground; the step is capped so terrain stays
    // runnable and does not turn into a staircase of unclearable walls.
    const desired = mapRange(this.smoothedWeight, 0, 1, minGroundHeight, maxGroundHeight);
    const jitter = this.rng.range(-0.35, 0.35) * this.smoothedIntensity;
    const height = clamp(
      clamp(desired + jitter, this.lastSegmentHeight - 1.2, this.lastSegmentHeight + 1.2),
      minGroundHeight,
      maxGroundHeight,
    );

    const kind = this.chooseObstacle(beatIndex, x, width);

    if (kind === 'gap') {
      this.emitGapBeat(slice, x, width, height, beatIndex);
      this.consecutiveObstacles += 1;
      this.lastJumpHazardEndX = x + width;
      return;
    }

    slice.segments.push({ beatIndex, x, width, height, solid: true });
    this.lastSegmentHeight = height;

    // Terrain that steps up eats into the jump. A block on a beat 1.2m above
    // the last one has to be cleared from the *lower* ground the player takes
    // off from, so the rise counts against the block's own budget — otherwise
    // the player hits its face while still climbing, which reads exactly like
    // "jumping is not far enough".
    const rise = Math.max(0, height - previousHeight);
    const budget = maxFairBlockHeight() - rise;

    // Running off a downward step puts the player in the air, and ducking needs
    // the ground — so a hanging obstacle just after a drop is unduckable and
    // therefore unavoidable. Blocks are fine there; jumping works mid-fall.
    const drop = Math.max(0, previousHeight - height);
    const duckable = drop <= MAX_DROP_BEFORE_DUCK;

    const placeable =
      kind === 'hanging' ? duckable : kind === 'block' ? budget >= MIN_BLOCK_HEIGHT : false;
    const placed =
      kind !== null && placeable ? this.buildObstacle(kind, x, width, beatIndex, budget) : null;
    if (placed) slice.obstacles.push(placed);

    if (placed === null) this.consecutiveObstacles = 0;
    else this.consecutiveObstacles += 1;
    if (placed?.kind === 'block') this.lastJumpHazardEndX = placed.x + placed.width;
  }

  /**
   * Lays a beat down as solid / hole / solid.
   *
   * A hole used to swallow the whole beat, which at anything under ~200 BPM is
   * wider than a jump can carry — so gaps had to be suppressed at most tempi to
   * stay fair. Cutting the hole *inside* the beat keeps it jumpable at every
   * tempo and keeps the beat grid intact.
   */
  private emitGapBeat(
    slice: WorldSlice,
    x: number,
    width: number,
    height: number,
    beatIndex: number,
  ): void {
    const gapWidth = Math.min(width * MAX_GAP_SHARE_OF_BEAT, maxFairGapWidth());
    const lead = (width - gapWidth) / 2;

    slice.segments.push({ beatIndex, x, width: lead, height, solid: true });
    slice.segments.push({ beatIndex, x: x + lead, width: gapWidth, height, solid: false });
    slice.segments.push({
      beatIndex,
      x: x + lead + gapWidth,
      width: width - lead - gapWidth,
      height,
      solid: true,
    });
    this.lastSegmentHeight = height;
  }

  /** Returns the obstacle kind for this beat, or null for a clear beat. */
  private chooseObstacle(beatIndex: number, x: number, segmentWidth: number): ObstacleKind | null {
    // Guaranteed breather: never more than two loaded beats in a row, whatever
    // the music is doing. Without this, a dense passage becomes unsurvivable.
    if (this.consecutiveObstacles >= 2) return null;

    // Nothing may be demanded of the player while they are still in the air
    // from the last thing that had to be jumped. Beats are the wrong unit for
    // this — at fast tempo a beat is shorter than a jump lasts, and a ducking
    // hazard landing mid-jump is unavoidable because ducking needs the ground.
    // The constraint is a distance, so it is enforced as one.
    const clearRunNeeded = jumpDistance(REFERENCE_JUMP_STRENGTH, this.runSpeed) * HAZARD_SPACING;
    if (x < this.lastJumpHazardEndX + clearRunNeeded) return null;
    // Hold the first bar clear so the player hears the tempo before reacting.
    if (beatIndex < 4) return null;

    const density = mapRange(this.smoothedIntensity, 0, 1, 0.1, 0.78);
    if (!this.rng.chance(density)) return null;

    // Bright, airy music hangs things overhead; heavy music puts them on the
    // floor. Gaps are rare and reserved for loud passages, where they read as
    // a deliberate drop rather than an accident.
    const bright = this.smoothedBrightness;
    const roll = this.rng.next();

    // The hole is cut inside the beat and sized to the jump arc, so it always
    // fits; it just needs enough beat left over for solid ground either side.
    const roomForGap = segmentWidth >= MIN_SEGMENT_WIDTH * 3;
    if (roomForGap && this.smoothedIntensity > 0.45 && roll < 0.15) return 'gap';

    return roll < 0.5 + (0.5 - bright) * 0.6 ? 'block' : 'hanging';
  }

  private buildObstacle(
    kind: Exclude<ObstacleKind, 'gap'>,
    segmentX: number,
    segmentWidth: number,
    beatIndex: number,
    heightBudget: number,
  ): Obstacle {
    // Sized against what a full-strength jump can actually clear at the current
    // speed, so a fair stage stays fair as the tempo pushes the speed up.
    // A block has to fit inside the jump arc with room either side. At slow
    // tempo the beats are long, and an unbounded share of one produced blocks
    // nearly as wide as a whole jump — clearable only by landing exactly on the
    // far edge, which is to say not clearable.
    const widest = Math.min(MAX_OBSTACLE_WIDTH, maxFairBlockWidth());
    const width = clamp(segmentWidth * this.rng.range(0.22, 0.4), MIN_OBSTACLE_WIDTH, widest);
    // Centre it in the beat so the jump happens on the beat, not on its edge.
    const x = segmentX + (segmentWidth - width) / 2;

    if (kind === 'block') {
      // The budget is already the fair ceiling for this beat, so the roll
      // spans it directly rather than being scaled down by another guess.
      const height = clamp(
        this.rng.range(MIN_BLOCK_HEIGHT, heightBudget) * (0.7 + this.smoothedIntensity),
        MIN_BLOCK_HEIGHT,
        heightBudget,
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
    this.pulse = 0;
    this.onsetScale.reset();
    this.intensityScale.reset();
    this.weightScale.reset();
    this.brightnessScale.reset();
    this.runSpeed = TUNING.baseRunSpeed;
    this.nextBeatTime = null;
    this.nextSegmentX = null;
    this.nextBeatIndex = 0;
    this.nextObstacleId = 1;
    this.consecutiveObstacles = 0;
    this.lastJumpHazardEndX = -Infinity;
    this.lastSegmentHeight = 0;
  }
}
