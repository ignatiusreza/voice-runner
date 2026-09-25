import type { BeatEstimate } from '../audio/analysis/beat';
import { FALLBACK_BPM } from '../audio/analysis/beat';
import type { AudioFeatures } from '../audio/analysis/features';
import { SILENT_FEATURES } from '../audio/analysis/features';
import { Rng } from '../core/rng';
import type { ActionState } from '../input/actions';
import { IDLE_ACTIONS } from '../input/actions';
import { resolveCollisions } from './collision';
import type { StageMood } from './director';
import { StageDirector } from './director';
import type { JumpTimers, PlayerState } from './player';
import { createJumpTimers, createPlayer, updatePlayer } from './player';
import { TUNING } from './tuning';
import type { WorldSlice } from './world';
import { pruneBehind } from './world';

export type RunPhase = 'idle' | 'running' | 'over';

export interface GameSnapshot {
  phase: RunPhase;
  player: PlayerState;
  world: WorldSlice;
  mood: StageMood;
  speed: number;
  score: number;
  distance: number;
  /** Seconds the current run has lasted. */
  elapsed: number;
}

const SILENT_BEAT: BeatEstimate = {
  bpm: FALLBACK_BPM,
  period: 60 / FALLBACK_BPM,
  anchor: 0,
  confidence: 0,
  stability: 0,
};

/**
 * The simulation.
 *
 * Deliberately knows nothing about PixiJS, the DOM or the Web Audio API — it is
 * fed features and actions and hands back a snapshot. That is what lets a whole
 * run be replayed in a unit test from a recorded feature trace.
 */
export class Game {
  private readonly director: StageDirector;
  private readonly timers: JumpTimers = createJumpTimers();

  private player = createPlayer();
  private world: WorldSlice = { segments: [], obstacles: [] };
  private phase: RunPhase = 'idle';
  private score = 0;
  private startX = 0;
  private elapsed = 0;

  private features: AudioFeatures = SILENT_FEATURES;
  private beat: BeatEstimate = SILENT_BEAT;
  private actions: ActionState = IDLE_ACTIONS;

  constructor(seed: number) {
    this.director = new StageDirector(new Rng(seed));
  }

  /** Feeds the frame's audio analysis in before `update` consumes it. */
  setAudio(features: AudioFeatures, beat: BeatEstimate): void {
    this.features = features;
    this.beat = beat;
  }

  setActions(actions: ActionState): void {
    this.actions = actions;
  }

  start(): void {
    this.player = createPlayer();
    this.world = { segments: [], obstacles: [] };
    this.director.reset();
    this.timers.bufferedJumpFor = 0;
    this.timers.coyoteFor = 0;
    this.timers.sustainFor = 0;
    this.score = 0;
    this.elapsed = 0;
    this.startX = this.player.x;
    this.phase = 'running';
  }

  update(dt: number): void {
    if (this.phase !== 'running') return;
    this.elapsed += dt;

    // Generate before simulating: the player must never step into a frame's
    // worth of world that has not been laid down yet.
    this.director.update(
      this.world,
      this.player.x,
      this.features.time,
      this.features,
      this.beat,
      dt,
    );

    updatePlayer(
      this.player,
      this.actions,
      this.world.segments,
      this.director.speed,
      dt,
      this.timers,
    );

    const { hit, newlyCleared } = resolveCollisions(
      this.player,
      this.world.obstacles,
      this.world.segments,
    );
    this.score += newlyCleared.length * TUNING.scorePerObstacleCleared;

    if (hit || this.player.dead) {
      this.phase = 'over';
      return;
    }

    this.score += this.director.speed * dt * TUNING.scorePerMetre;
    pruneBehind(this.world, this.player.x - TUNING.playerScreenX - 4);
  }

  get snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      player: this.player,
      world: this.world,
      mood: this.director.mood,
      speed: this.director.speed,
      score: Math.floor(this.score),
      distance: this.player.x - this.startX,
      elapsed: this.elapsed,
    };
  }
}
