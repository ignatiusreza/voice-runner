import { describe, expect, it } from 'vitest';
import type { BeatEstimate } from '../audio/analysis/beat';
import type { AudioFeatures } from '../audio/analysis/features';
import { SILENT_FEATURES } from '../audio/analysis/features';
import { IDLE_ACTIONS } from '../input/actions';
import { Game } from './game';

const STEP = 1 / 60;
const BEAT: BeatEstimate = { bpm: 120, period: 0.5, anchor: 0, confidence: 0.9 };

function features(time: number): AudioFeatures {
  return { ...SILENT_FEATURES, time, energy: 0.25, bass: 0.25, brightness: 0.4, flux: 0.2 };
}

/** Plays `seconds` of a run with idle input, i.e. the player never jumps. */
function playIdle(game: Game, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    game.setAudio(features(i * STEP), BEAT);
    game.setActions(IDLE_ACTIONS);
    game.update(STEP);
  }
}

describe('Game', () => {
  it('starts idle and does not simulate until started', () => {
    const game = new Game(1);
    expect(game.snapshot.phase).toBe('idle');
    playIdle(game, 1);
    expect(game.snapshot.distance).toBe(0);
  });

  it('moves the player forward once running', () => {
    const game = new Game(1);
    game.start();
    playIdle(game, 1);
    expect(game.snapshot.phase).toBe('running');
    expect(game.snapshot.distance).toBeGreaterThan(5);
  });

  it('scores distance as the run goes on', () => {
    const game = new Game(1);
    game.start();
    playIdle(game, 1);
    const early = game.snapshot.score;
    playIdle(game, 1);
    expect(game.snapshot.score).toBeGreaterThan(early);
  });

  it('ends the run when the player hits something', () => {
    const game = new Game(3);
    game.start();
    // Never jumping, the run must end on the first obstacle rather than
    // continuing through it.
    playIdle(game, 30);
    expect(game.snapshot.phase).toBe('over');
  });

  it('stops advancing once the run is over', () => {
    const game = new Game(3);
    game.start();
    playIdle(game, 30);
    const frozen = game.snapshot.distance;
    playIdle(game, 2);
    expect(game.snapshot.distance).toBe(frozen);
  });

  it('is replayable: the same seed and audio give the same run', () => {
    const first = new Game(99);
    first.start();
    playIdle(first, 8);

    const second = new Game(99);
    second.start();
    playIdle(second, 8);

    expect(second.snapshot.score).toBe(first.snapshot.score);
    expect(second.snapshot.distance).toBeCloseTo(first.snapshot.distance, 6);
  });

  it('resets cleanly when restarted', () => {
    const game = new Game(3);
    game.start();
    playIdle(game, 30);
    expect(game.snapshot.phase).toBe('over');

    game.start();
    expect(game.snapshot.phase).toBe('running');
    expect(game.snapshot.score).toBe(0);
    expect(game.snapshot.distance).toBe(0);
  });

  it('keeps the world bounded, pruning terrain the player has passed', () => {
    const game = new Game(5);
    game.start();
    // Feed a silent stage so no obstacle ends the run early.
    for (let i = 0; i < 60 * 60; i++) {
      game.setAudio({ ...SILENT_FEATURES, time: i * STEP }, BEAT);
      game.setActions(IDLE_ACTIONS);
      game.update(STEP);
    }
    expect(game.snapshot.world.segments.length).toBeLessThan(60);
  });
});
