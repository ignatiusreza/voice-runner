export interface LoopCallbacks {
  /** Advances the simulation by exactly `dt` seconds. */
  update(dt: number): void;
  /** Draws the world; `alpha` is the interpolation factor into the next step. */
  render(alpha: number): void;
}

const MAX_FRAME_SECONDS = 0.25;

/**
 * Fixed-timestep simulation with a decoupled render.
 *
 * Voice input is sampled against a physics step, so the step has to be constant
 * — a variable dt would make the same shout produce a different jump height on
 * a 120Hz phone than on a 60Hz one. Excess time is carried in an accumulator and
 * the leftover fraction is handed to `render` for interpolation.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private frameHandle = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly stepSeconds = 1 / 60,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.tick);

    // A backgrounded tab resumes with a huge delta; clamping stops the
    // simulation from spiralling as it tries to catch up in one frame.
    const frameSeconds = Math.min((now - this.lastTime) / 1000, MAX_FRAME_SECONDS);
    this.lastTime = now;
    this.accumulator += frameSeconds;

    while (this.accumulator >= this.stepSeconds) {
      this.callbacks.update(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
    }

    this.callbacks.render(this.accumulator / this.stepSeconds);
  };
}
