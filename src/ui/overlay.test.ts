// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from './overlay';
import { DEFAULT_SETTINGS } from './settings';

function build(): {
  root: HTMLElement;
  overlay: Overlay;
  handlers: {
    onStart: ReturnType<typeof vi.fn>;
    onRestart: ReturnType<typeof vi.fn>;
    onPickSource: ReturnType<typeof vi.fn>;
    onPickFile: ReturnType<typeof vi.fn>;
    onSettingsChange: ReturnType<typeof vi.fn>;
  };
} {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handlers = {
    onStart: vi.fn(),
    onRestart: vi.fn(),
    onPickSource: vi.fn(),
    onPickFile: vi.fn(),
    onSettingsChange: vi.fn(),
  };
  return { root, overlay: new Overlay(root, DEFAULT_SETTINGS, handlers), handlers };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Overlay', () => {
  it('starts the game from the title screen', () => {
    const { root, overlay, handlers } = build();
    overlay.showTitle();
    root.querySelector<HTMLButtonElement>('[data-role="primary"]')?.click();
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onRestart).not.toHaveBeenCalled();
  });

  it('restarts rather than re-running setup after a game over', () => {
    // The same button does both jobs; re-running setup on a restart used to
    // open a second AudioContext and re-prompt for screen sharing.
    const { root, overlay, handlers } = build();
    overlay.showGameOver(120, 300, 88);
    root.querySelector<HTMLButtonElement>('[data-role="primary"]')?.click();
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('celebrates a new best but not a lesser run', () => {
    const { root, overlay } = build();
    const title = (): string => root.querySelector('[data-role="title"]')?.textContent ?? '';

    overlay.showGameOver(300, 300, 90);
    expect(title()).toBe('Best yet');

    overlay.showGameOver(120, 300, 40);
    expect(title()).toBe('Run over');
  });

  it('shows a score of zero as a run, not a best', () => {
    const { root, overlay } = build();
    overlay.showGameOver(0, 0, 0);
    expect(root.querySelector('[data-role="title"]')?.textContent).toBe('Run over');
  });

  it('reveals the voice meter only while calibrating', () => {
    const { root, overlay } = build();
    // `hidden` is `boolean | "until-found"` in the DOM lib, so compare rather
    // than returning it.
    const meter = (): boolean =>
      root.querySelector<HTMLElement>('[data-role="meter-row"]')!.hidden === true;

    overlay.showTitle();
    expect(meter()).toBe(true);
    overlay.showCalibrating();
    expect(meter()).toBe(false);
    overlay.showGameOver(1, 1, 1);
    expect(meter()).toBe(true);
  });

  it('moves the meter with the voice level and clamps it', () => {
    const { root, overlay } = build();
    const fill = root.querySelector<HTMLElement>('[data-role="meter-fill"]')!;

    overlay.setVoiceLevel(13);
    expect(Number.parseFloat(fill.style.width)).toBeCloseTo(50, 0);

    overlay.setVoiceLevel(-5);
    expect(fill.style.width).toBe('0%');

    overlay.setVoiceLevel(999);
    expect(fill.style.width).toBe('100%');
  });

  it('reports the picked source', () => {
    const { root, overlay, handlers } = build();
    overlay.setSources([{ id: 'display-capture', label: 'Tab audio' }], null);
    root.querySelector<HTMLElement>('[data-source="display-capture"]')?.click();
    expect(handlers.onPickSource).toHaveBeenCalledWith('display-capture');
  });

  it('lists an unavailable source, disabled, with its reason', () => {
    // Saying why is more use to the player than the option silently missing.
    const { root, overlay } = build();
    overlay.setSources(
      [{ id: 'native-playback', label: 'Other apps', unavailable: 'Android only.' }],
      null,
    );
    const chip = root.querySelector<HTMLButtonElement>('[data-source="native-playback"]')!;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe('Android only.');
  });

  it('marks the active source', () => {
    const { root, overlay } = build();
    overlay.setSources(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      'b',
    );
    expect(root.querySelector('[data-source="b"]')?.className).toContain('is-active');
    expect(root.querySelector('[data-source="a"]')?.className).not.toContain('is-active');
  });

  it('escapes a source label rather than injecting it as markup', () => {
    const { root, overlay } = build();
    // Labels can come from a file the player picked, so the name is untrusted.
    overlay.setSources([{ id: 'file', label: '<img src=x onerror=alert(1)>' }], null);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[data-source="file"]')?.textContent).toContain('<img');
  });

  it('reports a settings change and shows it in decibels', () => {
    const { root, overlay, handlers } = build();
    overlay.showTitle();
    const slider = root.querySelector<HTMLInputElement>('[data-setting="voiceSensitivity"]')!;
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input'));

    expect(handlers.onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ voiceSensitivity: 0.5 }),
    );
    // Shown as its effect, not as an abstract slider position.
    expect(root.querySelector('[data-role="sensitivity-value"]')?.textContent).toBe('-3.0 dB');
  });

  it('reports a checkbox setting as a boolean', () => {
    const { root, handlers } = build();
    const check = root.querySelector<HTMLInputElement>('[data-setting="reducedMotion"]')!;
    check.checked = true;
    check.dispatchEvent(new Event('input'));
    expect(handlers.onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ reducedMotion: true }),
    );
  });

  it('reflects settings applied from outside', () => {
    const { root, overlay } = build();
    overlay.applySettings({ ...DEFAULT_SETTINGS, voiceSensitivity: -1, visualCues: true });
    expect(root.querySelector<HTMLInputElement>('[data-setting="visualCues"]')?.checked).toBe(true);
    expect(root.querySelector('[data-role="sensitivity-value"]')?.textContent).toBe('+6.0 dB');
  });
});
