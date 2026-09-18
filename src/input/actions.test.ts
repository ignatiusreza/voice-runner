import { describe, expect, it } from 'vitest';
import type { ActionState } from './actions';
import { IDLE_ACTIONS, mergeActions } from './actions';

function actions(overrides: Partial<ActionState> = {}): ActionState {
  return { ...IDLE_ACTIONS, ...overrides };
}

describe('mergeActions', () => {
  it('is idle for no sources', () => {
    expect(mergeActions([])).toEqual(IDLE_ACTIONS);
  });

  it('lets any source trigger a jump', () => {
    const merged = mergeActions([actions(), actions({ jumpPressed: true })]);
    expect(merged.jumpPressed).toBe(true);
  });

  it('takes the strongest jump when both sources fire', () => {
    const merged = mergeActions([
      actions({ jumpPressed: true, jumpStrength: 0.4 }),
      actions({ jumpPressed: true, jumpStrength: 0.9 }),
    ]);
    expect(merged.jumpStrength).toBe(0.9);
  });

  it('holds sustain and duck if either source holds them', () => {
    const merged = mergeActions([actions({ sustaining: true }), actions({ ducking: true })]);
    expect(merged.sustaining).toBe(true);
    expect(merged.ducking).toBe(true);
  });
});
