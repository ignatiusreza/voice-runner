import { describe, expect, it } from 'vitest';
import type { ActionState } from '../input/actions';
import { IDLE_ACTIONS } from '../input/actions';
import {
  jumpAirtime,
  jumpDistance,
  jumpPeakHeight,
  jumpVelocityFor,
  maxFairBlockHeight,
  maxFairGapWidth,
  REFERENCE_JUMP_STRENGTH,
} from './jump';
import { createJumpTimers, createPlayer, updatePlayer } from './player';
import { TUNING } from './tuning';
import type { TerrainSegment } from './world';

const STEP = 1 / 60;
const SPEED = 11;
const FLAT: TerrainSegment[] = [{ beatIndex: 0, x: -100, width: 10000, height: 0, solid: true }];

/**
 * Jumps once at `strength` and never sustains, then measures what the
 * simulation actually produced.
 *
 * These assertions are the point of this file. The generator sized obstacles
 * from closed-form physics while the simulation used different gravity on the
 * way up, and nothing compared the two — so blocks were generated 60% taller
 * than a jump could reach. Deriving both from `jump.ts` is only safe if the
 * formulas are pinned to a real simulated jump.
 */
function simulateJump(strength: number): { peak: number; airtime: number; distance: number } {
  const player = createPlayer();
  const timers = createJumpTimers();
  const jump: ActionState = { ...IDLE_ACTIONS, jumpPressed: true, jumpStrength: strength };

  const startX = player.x;
  let peak = 0;
  let steps = 0;

  updatePlayer(player, jump, FLAT, SPEED, STEP, timers);
  while (!player.onGround && steps < 1000) {
    updatePlayer(player, IDLE_ACTIONS, FLAT, SPEED, STEP, timers);
    peak = Math.max(peak, player.y);
    steps++;
  }

  return { peak, airtime: (steps + 1) * STEP, distance: player.x - startX };
}

describe('jump physics', () => {
  it('scales take-off speed with strength, with a floor for a weak shout', () => {
    expect(jumpVelocityFor(0)).toBeCloseTo(TUNING.jumpVelocity * TUNING.minJumpFraction, 6);
    expect(jumpVelocityFor(1)).toBeCloseTo(TUNING.jumpVelocity, 6);
    expect(jumpVelocityFor(0.5)).toBeGreaterThan(jumpVelocityFor(0));
  });

  it('clamps strength outside 0..1', () => {
    expect(jumpVelocityFor(-5)).toBeCloseTo(jumpVelocityFor(0), 6);
    expect(jumpVelocityFor(5)).toBeCloseTo(jumpVelocityFor(1), 6);
  });

  it('bounds the peak height a real jump reaches, from above', () => {
    for (const strength of [0.35, REFERENCE_JUMP_STRENGTH, 0.8, 1]) {
      const simulated = simulateJump(strength).peak;
      const predicted = jumpPeakHeight(strength);

      // The closed form must never promise less than the simulation delivers,
      // or the generator would size obstacles it cannot verify. Discrete
      // integration undershoots the continuous apex by about half a step of
      // take-off speed, so the gap is bounded rather than zero.
      expect(simulated).toBeLessThanOrEqual(predicted + 1e-9);
      expect(simulated).toBeGreaterThan(predicted - jumpVelocityFor(strength) * STEP);
    }
  });

  it('predicts the airtime a real jump takes', () => {
    for (const strength of [0.35, REFERENCE_JUMP_STRENGTH, 1]) {
      expect(simulateJump(strength).airtime).toBeCloseTo(jumpAirtime(strength), 1);
    }
  });

  it('predicts the distance a real jump covers', () => {
    for (const strength of [0.35, REFERENCE_JUMP_STRENGTH, 1]) {
      expect(simulateJump(strength).distance).toBeCloseTo(jumpDistance(strength, SPEED), 0);
    }
  });

  it('rises no differently whether or not the player sustains', () => {
    // Sustain is a bonus, never a requirement. The stage is sized against a
    // jump with no sustain, so the climb must not be penalised without it.
    const player = createPlayer();
    const timers = createJumpTimers();
    updatePlayer(
      player,
      { ...IDLE_ACTIONS, jumpPressed: true, jumpStrength: 1 },
      FLAT,
      SPEED,
      STEP,
      timers,
    );
    const afterTakeOff = player.verticalVelocity;
    updatePlayer(player, IDLE_ACTIONS, FLAT, SPEED, STEP, timers);
    const rise = afterTakeOff - player.verticalVelocity;
    expect(rise).toBeCloseTo(Math.abs(TUNING.gravity) * STEP, 4);
  });

  it('clears the tallest fair block with the reference jump', () => {
    const peak = simulateJump(REFERENCE_JUMP_STRENGTH).peak;
    // Not merely equal — there has to be real headroom, because the player
    // crosses the block over several frames rather than at the exact apex.
    expect(peak).toBeGreaterThan(maxFairBlockHeight() * 1.5);
  });

  it('clears the widest fair gap with the reference jump', () => {
    const distance = simulateJump(REFERENCE_JUMP_STRENGTH).distance;
    expect(distance).toBeGreaterThan(maxFairGapWidth() * 1.5);
  });

  it('clears the tallest fair block even at the weakest jump the gate allows', () => {
    // VoiceController never emits below 0.35, so that is the true worst case.
    expect(simulateJump(0.35).peak).toBeGreaterThan(maxFairBlockHeight());
  });
});
