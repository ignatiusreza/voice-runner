import { describe, expect, it } from 'vitest';
import type { ActionState } from '../input/actions';
import { IDLE_ACTIONS } from '../input/actions';
import { createJumpTimers, createPlayer, updatePlayer } from './player';
import { TUNING } from './tuning';
import type { TerrainSegment } from './world';

const STEP = 1 / 60;
const SPEED = 10;

function flatGround(length = 1000, height = 0): TerrainSegment[] {
  return [{ beatIndex: 0, x: -100, width: length, height, solid: true }];
}

function withGap(gapStart: number, gapWidth: number): TerrainSegment[] {
  return [
    { beatIndex: 0, x: -100, width: gapStart + 100, height: 0, solid: true },
    { beatIndex: 1, x: gapStart, width: gapWidth, height: 0, solid: false },
    { beatIndex: 2, x: gapStart + gapWidth, width: 500, height: 0, solid: true },
  ];
}

function actions(overrides: Partial<ActionState> = {}): ActionState {
  return { ...IDLE_ACTIONS, ...overrides };
}

/** Runs the simulation for `seconds`, returning the player's peak height. */
function simulate(
  segments: TerrainSegment[],
  script: (step: number) => ActionState,
  seconds: number,
): { peak: number; dead: boolean; finalY: number } {
  const player = createPlayer();
  const timers = createJumpTimers();
  let peak = 0;
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    updatePlayer(player, script(i), segments, SPEED, STEP, timers);
    peak = Math.max(peak, player.y);
  }
  return { peak, dead: player.dead, finalY: player.y };
}

describe('updatePlayer', () => {
  it('runs forward at the given speed', () => {
    const player = createPlayer();
    const timers = createJumpTimers();
    for (let i = 0; i < 60; i++)
      updatePlayer(player, IDLE_ACTIONS, flatGround(), SPEED, STEP, timers);
    expect(player.x).toBeCloseTo(SPEED, 1);
  });

  it('stays grounded without input', () => {
    const result = simulate(flatGround(), () => IDLE_ACTIONS, 1);
    expect(result.peak).toBe(0);
  });

  it('jumps higher for a stronger shout', () => {
    const weak = simulate(
      flatGround(),
      (i) => actions({ jumpPressed: i === 0, jumpStrength: 0 }),
      1.5,
    );
    const strong = simulate(
      flatGround(),
      (i) => actions({ jumpPressed: i === 0, jumpStrength: 1 }),
      1.5,
    );
    expect(strong.peak).toBeGreaterThan(weak.peak * 1.3);
  });

  it('gains extra height from a sustained note', () => {
    const tap = simulate(
      flatGround(),
      (i) => actions({ jumpPressed: i === 0, jumpStrength: 1 }),
      1.5,
    );
    const held = simulate(
      flatGround(),
      (i) => actions({ jumpPressed: i === 0, jumpStrength: 1, sustaining: true }),
      1.5,
    );
    expect(held.peak).toBeGreaterThan(tap.peak);
  });

  it('caps how long a sustain keeps lifting', () => {
    const held = simulate(
      flatGround(),
      (i) => actions({ jumpPressed: i === 0, jumpStrength: 1, sustaining: true }),
      4,
    );
    // Back on the ground despite holding the note for the whole run.
    expect(held.finalY).toBe(0);
  });

  it('lands back on the ground', () => {
    const result = simulate(
      flatGround(),
      (i) => actions({ jumpPressed: i === 0, jumpStrength: 1 }),
      2.5,
    );
    expect(result.finalY).toBe(0);
  });

  it('buffers a jump pressed just before landing', () => {
    // Jump, then press again mid-air shortly before touchdown; the buffered
    // press must fire on landing rather than being dropped.
    const player = createPlayer();
    const timers = createJumpTimers();
    const segments = flatGround();
    updatePlayer(
      player,
      actions({ jumpPressed: true, jumpStrength: 1 }),
      segments,
      SPEED,
      STEP,
      timers,
    );

    let landedOnce = false;
    let jumpedAgain = false;
    for (let i = 1; i < 200; i++) {
      const nearLanding = player.verticalVelocity < 0 && player.y < 0.6 && !landedOnce;
      updatePlayer(
        player,
        actions({ jumpPressed: nearLanding, jumpStrength: 1 }),
        segments,
        SPEED,
        STEP,
        timers,
      );
      if (nearLanding) landedOnce = true;
      if (landedOnce && player.y > 1) jumpedAgain = true;
    }
    expect(jumpedAgain).toBe(true);
  });

  it('allows a jump just after running off an edge', () => {
    const segments = withGap(12, 3);
    const player = createPlayer();
    const timers = createJumpTimers();

    let jumped = false;
    for (let i = 0; i < 300; i++) {
      // Only jump once already past the edge, inside the coyote window.
      const pastEdge = player.x > 12 && player.x < 12 + SPEED * TUNING.coyoteSeconds * 0.5;
      updatePlayer(
        player,
        actions({ jumpPressed: pastEdge && !jumped, jumpStrength: 1 }),
        segments,
        SPEED,
        STEP,
        timers,
      );
      if (pastEdge) jumped = true;
    }
    expect(player.dead).toBe(false);
  });

  it('falls to its death down an un-jumped gap', () => {
    const result = simulate(withGap(12, 8), () => IDLE_ACTIONS, 4);
    expect(result.dead).toBe(true);
  });

  it('ducks only while grounded', () => {
    const player = createPlayer();
    const timers = createJumpTimers();
    const segments = flatGround();

    updatePlayer(player, actions({ ducking: true }), segments, SPEED, STEP, timers);
    expect(player.height).toBe(TUNING.duckHeight);

    updatePlayer(
      player,
      actions({ jumpPressed: true, jumpStrength: 1, ducking: true }),
      segments,
      SPEED,
      STEP,
      timers,
    );
    updatePlayer(player, actions({ ducking: true }), segments, SPEED, STEP, timers);
    expect(player.height).toBe(TUNING.playerHeight);
  });

  it('settles onto raised terrain', () => {
    const result = simulate(flatGround(1000, 2), () => IDLE_ACTIONS, 2);
    expect(result.finalY).toBe(2);
  });

  it('stops simulating once dead', () => {
    const player = createPlayer();
    const timers = createJumpTimers();
    player.dead = true;
    const before = player.x;
    updatePlayer(player, IDLE_ACTIONS, flatGround(), SPEED, STEP, timers);
    expect(player.x).toBe(before);
  });
});
