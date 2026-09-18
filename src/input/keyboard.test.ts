// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeyboardInput } from './keyboard';

function keyDown(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

function keyUp(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

describe('KeyboardInput', () => {
  let input: KeyboardInput;

  beforeEach(() => {
    input = new KeyboardInput();
    input.attach(window);
  });

  afterEach(() => {
    input.detach();
  });

  it('is idle before anything is pressed', () => {
    expect(input.poll()).toEqual({
      jumpPressed: false,
      jumpStrength: 0,
      sustaining: false,
      ducking: false,
    });
  });

  it('jumps on space, up and w alike', () => {
    for (const key of [' ', 'ArrowUp', 'w']) {
      keyDown(key);
      expect(input.poll().jumpPressed).toBe(true);
      keyUp(key);
      input.poll();
    }
  });

  it('reports the press exactly once, then keeps sustaining', () => {
    keyDown(' ');
    expect(input.poll().jumpPressed).toBe(true);

    const second = input.poll();
    expect(second.jumpPressed).toBe(false);
    expect(second.sustaining).toBe(true);
  });

  it('stops sustaining on key up', () => {
    keyDown(' ');
    input.poll();
    keyUp(' ');
    expect(input.poll().sustaining).toBe(false);
  });

  it('does not re-trigger from key repeat', () => {
    keyDown(' ');
    input.poll();
    // Held keys fire repeated keydown events; only the first is a new jump.
    keyDown(' ');
    expect(input.poll().jumpPressed).toBe(false);
  });

  it('ducks on down and s', () => {
    keyDown('ArrowDown');
    expect(input.poll().ducking).toBe(true);
    keyUp('ArrowDown');
    expect(input.poll().ducking).toBe(false);

    keyDown('s');
    expect(input.poll().ducking).toBe(true);
  });

  it('jumps on a pointer press', () => {
    window.dispatchEvent(new Event('pointerdown'));
    expect(input.poll().jumpPressed).toBe(true);
    window.dispatchEvent(new Event('pointerup'));
    expect(input.poll().sustaining).toBe(false);
  });

  it('ignores unrelated keys', () => {
    keyDown('q');
    const actions = input.poll();
    expect(actions.jumpPressed).toBe(false);
    expect(actions.ducking).toBe(false);
  });

  it('prevents the default so space does not scroll the page', () => {
    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops listening once detached', () => {
    input.detach();
    keyDown(' ');
    expect(input.poll().jumpPressed).toBe(false);
  });
});
