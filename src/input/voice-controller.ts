import type { VoiceFrame } from '../audio/analysis/voice';
import { clamp, mapRange } from '../core/math';
import type { ActionState } from './actions';
import { IDLE_ACTIONS } from './actions';

export interface VoiceControlOptions {
  /** dB above the background at which a sound becomes a jump. */
  triggerDb?: number;
  /** dB above the background that counts as a maximum-strength jump. */
  ceilingDb?: number;
  /** dB above the background below which a held sound stops counting. */
  releaseDb?: number;
  /** Sounds below this pitch duck instead of jumping. */
  duckPitchHz?: number;
  /** Ignore pitch readings the detector is not sure about. */
  minClarity?: number;
  /** Refuses a second jump within this window; kills double-triggers on plosives. */
  retriggerSeconds?: number;
}

const DEFAULTS: Required<VoiceControlOptions> = {
  triggerDb: 9,
  ceilingDb: 26,
  releaseDb: 5,
  duckPitchHz: 130,
  minClarity: 0.6,
  retriggerSeconds: 0.18,
};

/**
 * Turns voice frames into game actions.
 *
 * Two signals carry everything:
 *  - *how far above the background* the sound is, which gates and scales jumps.
 *    Absolute loudness is useless here: the same shout is 30dB apart in a quiet
 *    room and next to a speaker playing the stage's music.
 *  - *pitch*, which chooses between jumping and ducking. Low, growly sounds
 *    duck; anything else jumps. Pitch is only trusted above a clarity floor, so
 *    a drum hit leaking into the mic does not read as a duck.
 *
 * Hysteresis (trigger above `triggerDb`, release below `releaseDb`) stops the
 * character from stuttering when a held note sits right on the threshold.
 */
export class VoiceController {
  private readonly options: Required<VoiceControlOptions>;
  private engaged = false;
  private lastJumpTime = -Infinity;

  constructor(options: VoiceControlOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  update(frame: VoiceFrame | null): ActionState {
    if (!frame) return IDLE_ACTIONS;

    const { triggerDb, ceilingDb, releaseDb, duckPitchHz, minClarity, retriggerSeconds } =
      this.options;

    const wasEngaged = this.engaged;
    this.engaged = wasEngaged ? frame.excessDb > releaseDb : frame.excessDb > triggerDb;

    if (!this.engaged) return IDLE_ACTIONS;

    const isLow = frame.clarity >= minClarity && frame.pitchHz > 0 && frame.pitchHz < duckPitchHz;
    if (isLow) {
      return { jumpPressed: false, jumpStrength: 0, sustaining: false, ducking: true };
    }

    const strength = clamp(mapRange(frame.excessDb, triggerDb, ceilingDb, 0.35, 1), 0, 1);
    const isRisingEdge = !wasEngaged && frame.time - this.lastJumpTime >= retriggerSeconds;
    if (isRisingEdge) this.lastJumpTime = frame.time;

    return {
      jumpPressed: isRisingEdge,
      jumpStrength: strength,
      // A held note keeps lift going; the simulation decides how long to honour it.
      sustaining: true,
      ducking: false,
    };
  }

  reset(): void {
    this.engaged = false;
    this.lastJumpTime = -Infinity;
  }
}
