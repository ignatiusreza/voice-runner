import { describe, expect, it } from 'vitest';
import type { BeatEstimate } from '../audio/analysis/beat';
import type { AudioFeatures } from '../audio/analysis/features';
import { SILENT_FEATURES } from '../audio/analysis/features';
import type { ActionState } from '../input/actions';
import { IDLE_ACTIONS } from '../input/actions';
import { Game, type GameSnapshot } from './game';
import { jumpAirtime, REFERENCE_JUMP_STRENGTH } from './jump';
import { TUNING } from './tuning';

const STEP = 1 / 60;

function beatAt(bpm: number): BeatEstimate {
  return { bpm, period: 60 / bpm, anchor: 0, confidence: 0.9, stability: 1 };
}

function loudAudio(time: number): AudioFeatures {
  return { ...SILENT_FEATURES, time, energy: 0.35, bass: 0.35, brightness: 0.4, flux: 0.25 };
}

/**
 * Plays the stage using nothing but a moderate shout.
 *
 * It never sustains and never jumps at full strength, because that is the
 * player the generator claims to design for. If this bot cannot get through,
 * the stage is unfair — which is exactly what "jumping is not far enough to
 * overcome some of the blocks" reported, and what the old formula-based
 * fairness tests failed to catch.
 */
interface Hazard {
  kind: 'jump' | 'duck';
  left: number;
  right: number;
}

function shoutBot(snapshot: GameSnapshot): ActionState {
  const { player, world, speed } = snapshot;

  // The player is a box, not a point. Reasoning about `player.x` alone leaves
  // the trailing half of the body still inside an obstacle after the centre has
  // passed it, which is a bot bug that reads convincingly like an unfair stage.
  const halfWidth = TUNING.playerWidth / 2;
  const back = player.x - halfWidth;
  const front = player.x + halfWidth;

  // Time to the apex is half the airtime; as a distance, that is how much
  // run-up a jump needs for the apex to land on the hazard.
  const runUp = speed * (jumpAirtime(REFERENCE_JUMP_STRENGTH) / 2);

  const hazards: Hazard[] = [];
  for (const obstacle of world.obstacles) {
    hazards.push({
      kind: obstacle.kind === 'hanging' ? 'duck' : 'jump',
      left: obstacle.x,
      right: obstacle.x + obstacle.width,
    });
  }
  for (const segment of world.segments) {
    // Holes are terrain rather than obstacles, so they need their own entry.
    if (!segment.solid) {
      hazards.push({ kind: 'jump', left: segment.x, right: segment.x + segment.width });
    }
  }

  let next: Hazard | null = null;
  for (const hazard of hazards) {
    if (hazard.right < back) continue;
    if (next === null || hazard.left < next.left) next = hazard;
  }
  if (!next) return IDLE_ACTIONS;

  const distance = next.left - front;

  if (next.kind === 'duck') {
    // Stay ducked until the whole body is clear, not just the centre.
    return distance <= runUp ? { ...IDLE_ACTIONS, ducking: true } : IDLE_ACTIONS;
  }

  // Aim the apex at the middle of the hazard. Jumping the instant it comes
  // within run-up puts the apex before it and lands the player on its far edge.
  const takeOffAt = runUp - (next.right - next.left) / 2;
  if (player.onGround && distance <= takeOffAt) {
    return { ...IDLE_ACTIONS, jumpPressed: true, jumpStrength: REFERENCE_JUMP_STRENGTH };
  }
  return IDLE_ACTIONS;
}

function playWithBot(seed: number, bpm: number, seconds: number): GameSnapshot {
  const game = new Game(seed);
  game.start();
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    game.setAudio(loudAudio(i * STEP), beatAt(bpm));
    game.setActions(shoutBot(game.snapshot));
    game.update(STEP);
    if (game.snapshot.phase === 'over') break;
  }
  return game.snapshot;
}

describe('stage beatability', () => {
  it('lets a moderate shout get a long way, at every tempo', () => {
    // The bug this guards against produced runs that ended inside 80m however
    // well the player reacted. The bot is a crude pilot — it does not aim for
    // frame-perfect take-offs — so the bar is a long run rather than a perfect
    // one, and one graze at the slowest run speed is expected.
    for (const bpm of [70, 90, 120, 150, 180]) {
      for (const seed of [1, 2, 3]) {
        const snapshot = playWithBot(seed, bpm, 45);
        expect(
          snapshot.distance,
          `only reached ${snapshot.distance.toFixed(0)}m at ${String(bpm)} BPM, seed ${String(seed)}`,
        ).toBeGreaterThan(100);
      }
    }
  });

  it('is survivable end to end across the common tempo range', () => {
    for (const bpm of [120, 150, 180]) {
      for (const seed of [1, 2, 3]) {
        const snapshot = playWithBot(seed, bpm, 45);
        expect(
          snapshot.phase,
          `died at ${String(bpm)} BPM, seed ${String(seed)}, after ${snapshot.distance.toFixed(0)}m`,
        ).toBe('running');
      }
    }
  });

  it('covers real ground rather than stalling', () => {
    const snapshot = playWithBot(7, 120, 45);
    expect(snapshot.distance).toBeGreaterThan(300);
  });

  it('still kills a player who does nothing', () => {
    // The bot passing must mean the stage is fair, not that it is empty.
    const game = new Game(7);
    game.start();
    for (let i = 0; i < 60 * 45; i++) {
      game.setAudio(loudAudio(i * STEP), beatAt(120));
      game.setActions(IDLE_ACTIONS);
      game.update(STEP);
      if (game.snapshot.phase === 'over') break;
    }
    expect(game.snapshot.phase).toBe('over');
  });
});
