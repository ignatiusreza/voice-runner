import type { VoiceFrame } from '../audio/analysis/voice';
import { clamp, mapRange } from '../core/math';
import type { GameSnapshot } from '../game/game';

/**
 * The HUD is DOM, not canvas.
 *
 * Text drawn into WebGL has to be re-rasterised on every change and is invisible
 * to screen readers and to the browser's own text scaling. Keeping it in the DOM
 * over the canvas costs nothing at this update rate and keeps the game legible
 * for anyone who has bumped their system font size.
 */
export class Hud {
  private readonly score: HTMLElement;
  private readonly bpm: HTMLElement;
  private readonly source: HTMLElement;
  private readonly voiceMeter: HTMLElement;
  private readonly voiceLabel: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = `
      <div class="hud__row hud__row--top">
        <span class="hud__score" data-role="score" aria-live="off">0</span>
        <span class="hud__meta" data-role="bpm">-- BPM</span>
      </div>
      <div class="hud__row hud__row--bottom">
        <div class="hud__voice" role="img" aria-label="Voice level">
          <div class="hud__voice-fill" data-role="voice-meter"></div>
          <div class="hud__voice-threshold"></div>
        </div>
        <span class="hud__meta" data-role="voice-label">listening</span>
        <span class="hud__meta" data-role="source">audio source: --</span>
      </div>
    `;
    this.score = this.require('score');
    this.bpm = this.require('bpm');
    this.source = this.require('source');
    this.voiceMeter = this.require('voice-meter');
    this.voiceLabel = this.require('voice-label');
  }

  private require(role: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`[data-role="${role}"]`);
    if (!element) throw new Error(`HUD is missing the "${role}" element`);
    return element;
  }

  setSource(label: string): void {
    this.source.textContent = `audio source: ${label}`;
  }

  update(snapshot: GameSnapshot, voice: VoiceFrame | null): void {
    this.score.textContent = String(snapshot.score);
    this.bpm.textContent =
      snapshot.mood.confidence > 0.25 ? `${String(Math.round(snapshot.mood.bpm))} BPM` : '-- BPM';

    // The meter shows dB *above the background*, which is the signal the game
    // actually reacts to. Showing absolute level would leave the player unable
    // to tell why a shout that looked loud did not register.
    const excess = voice?.excessDb ?? 0;
    this.voiceMeter.style.width = `${String(mapRange(excess, 0, 26, 0, 100))}%`;
    this.voiceLabel.textContent = voice
      ? `${excess > 9 ? 'go' : 'listening'} · +${clamp(excess, 0, 99).toFixed(0)} dB`
      : 'no microphone';
  }
}
