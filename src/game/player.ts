import type { ActionState } from '../input/actions';
import { jumpVelocityFor } from './jump';
import { TUNING } from './tuning';
import type { TerrainSegment } from './world';
import { groundHeightAt } from './world';

export interface PlayerState {
  /** World position of the player's centre-bottom, in metres. */
  x: number;
  y: number;
  verticalVelocity: number;
  onGround: boolean;
  ducking: boolean;
  /** Current collision height; shrinks while ducking. */
  height: number;
  /** True once the player has fallen out of the world. */
  dead: boolean;
}

export function createPlayer(): PlayerState {
  return {
    x: 0,
    y: 0,
    verticalVelocity: 0,
    onGround: true,
    ducking: false,
    height: TUNING.playerHeight,
    dead: false,
  };
}

/** Below this the player has fallen down a gap and the run is over. */
const DEATH_DEPTH = -8;

/**
 * Advances the player one fixed step.
 *
 * Two forgiveness mechanics are deliberate, and matter more here than in a
 * touch-controlled runner: voice has real latency (analysis window, the player
 * drawing breath), so a shout that lands a frame or two late still has to work.
 *  - *coyote time*: a jump just after leaving the ground still fires.
 *  - *jump buffering*: a jump just before landing fires on touchdown.
 */
export function updatePlayer(
  player: PlayerState,
  actions: ActionState,
  segments: readonly TerrainSegment[],
  speed: number,
  dt: number,
  timers: JumpTimers,
): void {
  if (player.dead) return;

  player.x += speed * dt;

  if (actions.jumpPressed) timers.bufferedJumpFor = TUNING.jumpBufferSeconds;
  timers.bufferedJumpFor = Math.max(0, timers.bufferedJumpFor - dt);
  timers.coyoteFor = player.onGround ? TUNING.coyoteSeconds : Math.max(0, timers.coyoteFor - dt);

  const canJump = player.onGround || timers.coyoteFor > 0;
  if (timers.bufferedJumpFor > 0 && canJump) {
    player.verticalVelocity = jumpVelocityFor(actions.jumpStrength);
    player.onGround = false;
    timers.bufferedJumpFor = 0;
    timers.coyoteFor = 0;
    timers.sustainFor = TUNING.maxSustainSeconds;
  }

  // A held note adds lift for a limited window. Capping it keeps the skill in
  // *when* you shout rather than in who can hold a note longest.
  if (
    !player.onGround &&
    actions.sustaining &&
    timers.sustainFor > 0 &&
    player.verticalVelocity > 0
  ) {
    player.verticalVelocity += TUNING.sustainAcceleration * dt;
    timers.sustainFor = Math.max(0, timers.sustainFor - dt);
  } else {
    timers.sustainFor = 0;
  }

  // The multiplier applies to the *fall*, which is what makes a landing feel
  // snappy. It used to apply to the climb too whenever the player was not
  // sustaining, so a tapped jump rose against 1.6x gravity and reached barely
  // 60% of its advertised height — tall blocks became unclearable without a
  // held, full-volume shout. Height now varies by take-off speed alone.
  const gravity =
    player.verticalVelocity > 0 ? TUNING.gravity : TUNING.gravity * TUNING.fallGravityMultiplier;

  if (!player.onGround) {
    player.verticalVelocity += gravity * dt;
    player.y += player.verticalVelocity * dt;
  }

  const ground = groundHeightAt(segments, player.x);
  if (ground === null) {
    // Standing over a hole: start falling even if the player was grounded.
    player.onGround = false;
    if (player.y < DEATH_DEPTH) player.dead = true;
  } else if (player.y <= ground && player.verticalVelocity <= 0) {
    player.y = ground;
    player.verticalVelocity = 0;
    player.onGround = true;
  } else if (player.y > ground) {
    player.onGround = false;
  }

  // Ducking only applies with both feet down; an airborne duck would let a
  // player cheese hanging obstacles by shrinking mid-jump.
  player.ducking = actions.ducking && player.onGround;
  player.height = player.ducking ? TUNING.duckHeight : TUNING.playerHeight;
}

export interface JumpTimers {
  bufferedJumpFor: number;
  coyoteFor: number;
  sustainFor: number;
}

export function createJumpTimers(): JumpTimers {
  return { bufferedJumpFor: 0, coyoteFor: 0, sustainFor: 0 };
}
