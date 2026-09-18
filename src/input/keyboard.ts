import type { ActionSource, ActionState } from './actions';

/**
 * Keyboard and touch fallback.
 *
 * Not just an accessibility affordance: shouting at a laptop to reproduce a
 * collision bug does not scale, so every voice action has a silent equivalent.
 * Space/Up jumps and sustains, Down ducks, and a touch anywhere jumps.
 */
export class KeyboardInput implements ActionSource {
  private jumpHeld = false;
  private duckHeld = false;
  private jumpQueued = false;
  private disposers: (() => void)[] = [];

  attach(target: GlobalEventHandlers = window): void {
    const onKeyDown = (event: Event): void => {
      const key = (event as KeyboardEvent).key;
      if (key === ' ' || key === 'ArrowUp' || key === 'w') {
        if (!this.jumpHeld) this.jumpQueued = true;
        this.jumpHeld = true;
        event.preventDefault();
      } else if (key === 'ArrowDown' || key === 's') {
        this.duckHeld = true;
        event.preventDefault();
      }
    };

    const onKeyUp = (event: Event): void => {
      const key = (event as KeyboardEvent).key;
      if (key === ' ' || key === 'ArrowUp' || key === 'w') this.jumpHeld = false;
      else if (key === 'ArrowDown' || key === 's') this.duckHeld = false;
    };

    const onPointerDown = (): void => {
      if (!this.jumpHeld) this.jumpQueued = true;
      this.jumpHeld = true;
    };

    const onPointerUp = (): void => {
      this.jumpHeld = false;
    };

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointerup', onPointerUp);

    this.disposers = [
      () => {
        target.removeEventListener('keydown', onKeyDown);
      },
      () => {
        target.removeEventListener('keyup', onKeyUp);
      },
      () => {
        target.removeEventListener('pointerdown', onPointerDown);
      },
      () => {
        target.removeEventListener('pointerup', onPointerUp);
      },
    ];
  }

  poll(): ActionState {
    const jumpPressed = this.jumpQueued;
    this.jumpQueued = false;
    return {
      jumpPressed,
      // Fixed strength: a key has no loudness, so it gets a solid mid jump.
      jumpStrength: this.jumpHeld || jumpPressed ? 0.75 : 0,
      sustaining: this.jumpHeld,
      ducking: this.duckHeld,
    };
  }

  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }
}
