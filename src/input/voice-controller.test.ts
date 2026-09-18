import { describe, expect, it } from 'vitest';
import type { VoiceFrame } from '../audio/analysis/voice';
import { VoiceController } from './voice-controller';

function frame(overrides: Partial<VoiceFrame> = {}): VoiceFrame {
  return {
    time: 0,
    db: -30,
    floorDb: -50,
    excessDb: 0,
    pitchHz: 0,
    clarity: 0,
    ...overrides,
  };
}

describe('VoiceController', () => {
  it('does nothing without a voice frame', () => {
    expect(new VoiceController().update(null).jumpPressed).toBe(false);
  });

  it('ignores sound that does not rise above the background', () => {
    const controller = new VoiceController();
    expect(controller.update(frame({ excessDb: 4 })).jumpPressed).toBe(false);
  });

  it('jumps on a shout above the trigger', () => {
    const controller = new VoiceController();
    const actions = controller.update(frame({ excessDb: 14, time: 1 }));
    expect(actions.jumpPressed).toBe(true);
    expect(actions.sustaining).toBe(true);
  });

  it('scales jump strength with how far above the background the shout is', () => {
    const quiet = new VoiceController().update(frame({ excessDb: 10, time: 1 }));
    const loud = new VoiceController().update(frame({ excessDb: 30, time: 1 }));
    expect(loud.jumpStrength).toBeGreaterThan(quiet.jumpStrength);
    expect(loud.jumpStrength).toBeLessThanOrEqual(1);
  });

  it('fires once per shout, not once per frame', () => {
    const controller = new VoiceController();
    expect(controller.update(frame({ excessDb: 14, time: 1 })).jumpPressed).toBe(true);
    expect(controller.update(frame({ excessDb: 14, time: 1.02 })).jumpPressed).toBe(false);
    expect(controller.update(frame({ excessDb: 15, time: 1.04 })).jumpPressed).toBe(false);
  });

  it('holds the action through a dip below trigger but above release', () => {
    const controller = new VoiceController();
    controller.update(frame({ excessDb: 14, time: 1 }));
    // Hysteresis: 7dB is under the 9dB trigger but over the 5dB release.
    expect(controller.update(frame({ excessDb: 7, time: 1.05 })).sustaining).toBe(true);
    expect(controller.update(frame({ excessDb: 3, time: 1.1 })).sustaining).toBe(false);
  });

  it('re-arms after the sound stops', () => {
    const controller = new VoiceController();
    controller.update(frame({ excessDb: 14, time: 1 }));
    controller.update(frame({ excessDb: 0, time: 1.3 }));
    expect(controller.update(frame({ excessDb: 14, time: 1.6 })).jumpPressed).toBe(true);
  });

  it('refuses a retrigger inside the debounce window', () => {
    const controller = new VoiceController();
    controller.update(frame({ excessDb: 14, time: 1 }));
    controller.update(frame({ excessDb: 0, time: 1.05 }));
    // Released and re-triggered within 180ms: a plosive, not a second jump.
    expect(controller.update(frame({ excessDb: 14, time: 1.1 })).jumpPressed).toBe(false);
  });

  it('ducks on a clear low pitch instead of jumping', () => {
    const controller = new VoiceController();
    const actions = controller.update(frame({ excessDb: 14, pitchHz: 95, clarity: 0.9, time: 1 }));
    expect(actions.ducking).toBe(true);
    expect(actions.jumpPressed).toBe(false);
  });

  it('jumps rather than ducks when the pitch reading is unreliable', () => {
    const controller = new VoiceController();
    // A drum hit leaking into the mic: low apparent pitch, but no clarity.
    const actions = controller.update(frame({ excessDb: 14, pitchHz: 95, clarity: 0.2, time: 1 }));
    expect(actions.ducking).toBe(false);
    expect(actions.jumpPressed).toBe(true);
  });

  it('honours custom thresholds', () => {
    const controller = new VoiceController({ triggerDb: 20 });
    expect(controller.update(frame({ excessDb: 14, time: 1 })).jumpPressed).toBe(false);
    expect(controller.update(frame({ excessDb: 22, time: 1.1 })).jumpPressed).toBe(true);
  });

  it('clears its state on reset', () => {
    const controller = new VoiceController();
    controller.update(frame({ excessDb: 14, time: 1 }));
    controller.reset();
    expect(controller.update(frame({ excessDb: 14, time: 1.01 })).jumpPressed).toBe(true);
  });
});
