/**
 * What the player can express, independent of how they expressed it.
 *
 * Keeping this between input and simulation is what lets the keyboard stand in
 * for the microphone in tests and on a laptop at 2am.
 */
export interface ActionState {
  /** Rising edge in the frame a jump was triggered. */
  jumpPressed: boolean;
  /**
   * Analog 0..1 for how hard the jump was asked for. A loud shout jumps higher
   * than a firm "hup", which is the whole point of voice control.
   */
  jumpStrength: number;
  /** Held while the player sustains a note — extends the jump into a glide. */
  sustaining: boolean;
  /** Held while the player makes a low sound — slides under obstacles. */
  ducking: boolean;
}

export const IDLE_ACTIONS: ActionState = {
  jumpPressed: false,
  jumpStrength: 0,
  sustaining: false,
  ducking: false,
};

export interface ActionSource {
  /** Returns this frame's actions. Must be called exactly once per frame. */
  poll(): ActionState;
}

/** Merges several sources so voice and keyboard can be live at the same time. */
export function mergeActions(states: readonly ActionState[]): ActionState {
  let jumpPressed = false;
  let jumpStrength = 0;
  let sustaining = false;
  let ducking = false;

  for (const state of states) {
    jumpPressed ||= state.jumpPressed;
    jumpStrength = Math.max(jumpStrength, state.jumpStrength);
    sustaining ||= state.sustaining;
    ducking ||= state.ducking;
  }

  return { jumpPressed, jumpStrength, sustaining, ducking };
}
