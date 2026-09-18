import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameLoop } from './loop';

/**
 * Drives `requestAnimationFrame` by hand so a frame can be advanced by an exact
 * number of milliseconds — the whole point of the loop is what it does with
 * awkward frame times, which real rAF will not reproduce on demand.
 */
class FakeClock {
  now = 0;
  private callbacks = new Map<number, FrameRequestCallback>();
  private nextHandle = 1;

  install(): void {
    vi.stubGlobal('performance', { now: () => this.now });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      const handle = this.nextHandle++;
      this.callbacks.set(handle, callback);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
      this.callbacks.delete(handle);
    });
  }

  /** Advances time by `ms` and runs whatever was scheduled for this frame. */
  advance(ms: number): void {
    this.now += ms;
    const pending = [...this.callbacks.entries()];
    this.callbacks.clear();
    for (const [, callback] of pending) callback(this.now);
  }
}

describe('GameLoop', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock();
    clock.install();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs one step per 16.67ms frame', () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() });
    loop.start();
    clock.advance(1000 / 60);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(1 / 60);
  });

  it('always steps by exactly the fixed timestep', () => {
    const steps: number[] = [];
    const loop = new GameLoop({
      update: (dt) => steps.push(dt),
      render: vi.fn(),
    });
    loop.start();
    // Deliberately awkward frame times.
    clock.advance(7);
    clock.advance(23);
    clock.advance(41);

    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step).toBe(1 / 60);
  });

  it('catches up with several steps after a slow frame', () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() });
    loop.start();
    clock.advance(50);

    expect(update).toHaveBeenCalledTimes(3);
  });

  it('clamps a huge delta instead of spiralling', () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() });
    loop.start();
    // A backgrounded tab resuming after ten seconds.
    clock.advance(10_000);

    // 0.25s clamp / (1/60) = 15 steps, not 600.
    expect(update).toHaveBeenCalledTimes(15);
  });

  it('hands render the leftover fraction of a step', () => {
    const render = vi.fn();
    const loop = new GameLoop({ update: vi.fn(), render });
    loop.start();
    // Half a step of leftover time after one full step.
    clock.advance(1000 / 60 + 1000 / 120);

    const alpha = render.mock.calls.at(-1)?.[0] as number;
    expect(alpha).toBeGreaterThan(0.4);
    expect(alpha).toBeLessThan(0.6);
  });

  it('renders once per frame even when no step ran', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ update, render });
    loop.start();
    clock.advance(4);

    expect(update).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('stops scheduling once stopped', () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() });
    loop.start();
    clock.advance(1000 / 60);
    loop.stop();
    clock.advance(1000 / 60);

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('ignores a second start while already running', () => {
    const render = vi.fn();
    const loop = new GameLoop({ update: vi.fn(), render });
    loop.start();
    loop.start();
    clock.advance(1000 / 60);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('honours a custom timestep', () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() }, 1 / 30);
    loop.start();
    clock.advance(1000 / 30);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(1 / 30);
  });
});
