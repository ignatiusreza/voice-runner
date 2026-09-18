import { clamp, lerp } from '../core/math';
import { TUNING } from './tuning';

/**
 * What a jump can actually reach.
 *
 * These exist because the generator and the simulation must agree. They did
 * not: obstacles were sized against `v²/2g` while the simulation climbed
 * against `1.6g`, so the tallest blocks needed a perfect full-volume sustained
 * shout to clear and were unclearable with anything less. Every bound the
 * generator uses is now derived here, from the same constants the physics step
 * uses, and a test asserts these match a real simulated jump.
 *
 * All of it assumes *no* sustain. Sustain is a bonus the player earns by
 * holding a note; the stage must be beatable without it.
 */

/** Take-off speed for a jump of the given strength, in metres per second. */
export function jumpVelocityFor(strength: number): number {
  return TUNING.jumpVelocity * lerp(TUNING.minJumpFraction, 1, clamp(strength, 0, 1));
}

const ASCENT_GRAVITY = Math.abs(TUNING.gravity);
const DESCENT_GRAVITY = Math.abs(TUNING.gravity) * TUNING.fallGravityMultiplier;

/** Peak height above the take-off point, in metres. */
export function jumpPeakHeight(strength: number): number {
  const v = jumpVelocityFor(strength);
  return (v * v) / (2 * ASCENT_GRAVITY);
}

/**
 * Time from take-off back to the starting height, in seconds.
 *
 * Gravity is asymmetric — the fall is faster than the rise — so this is not
 * simply `2v/g`, and treating it as such overstated jump range by about 12%.
 */
export function jumpAirtime(strength: number): number {
  const v = jumpVelocityFor(strength);
  return v / ASCENT_GRAVITY + v / Math.sqrt(ASCENT_GRAVITY * DESCENT_GRAVITY);
}

/** Horizontal distance covered by a jump at `speed`, in metres. */
export function jumpDistance(strength: number, speed: number): number {
  return jumpAirtime(strength) * speed;
}

/**
 * The jump the stage is designed around.
 *
 * `VoiceController` maps 9-26dB above background onto strength 0.35-1, so a
 * firm but unremarkable shout lands near here. Sizing obstacles against a
 * full-strength jump instead is what made the stage unfair: the player only
 * reaches that by being at maximum volume.
 */
export const REFERENCE_JUMP_STRENGTH = 0.6;

/** Fraction of the reference jump's height an obstacle may consume. */
export const CLEARANCE_FACTOR = 0.55;

/** A block may span at most this fraction of the jump that has to clear it. */
export const MAX_BLOCK_SHARE_OF_JUMP = 0.28;

/**
 * Horizontal bounds are measured at the *slowest* the player can run.
 *
 * Obstacles are generated seconds before they are reached, and the run speed
 * follows the tempo in between — so an obstacle sized against the speed at
 * generation time can be met at a lower one, with a correspondingly shorter
 * jump. Sizing against `minRunSpeed` makes the bound hold whatever the speed
 * does afterwards.
 */
function worstCaseJumpDistance(): number {
  return jumpDistance(REFERENCE_JUMP_STRENGTH, TUNING.minRunSpeed);
}

/** Tallest block that is fair at the current design point, in metres. */
export function maxFairBlockHeight(): number {
  return jumpPeakHeight(REFERENCE_JUMP_STRENGTH) * CLEARANCE_FACTOR;
}

/** Widest block that still leaves room to take off and land, in metres. */
export function maxFairBlockWidth(): number {
  return worstCaseJumpDistance() * MAX_BLOCK_SHARE_OF_JUMP;
}

/** Widest hole that is fair, in metres. */
export function maxFairGapWidth(): number {
  return worstCaseJumpDistance() * CLEARANCE_FACTOR;
}
