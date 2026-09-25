import type { Settings } from './settings';
import { SENSITIVITY_RANGE_DB } from './settings';

export interface SourceChoice {
  id: string;
  label: string;
  /** Shown greyed out with this reason when the platform cannot offer it. */
  unavailable?: string;
}

export interface OverlayHandlers {
  onStart: () => void;
  onRestart: () => void;
  onPickSource: (id: string) => void;
  onPickFile: (file: File) => void;
  onSettingsChange: (settings: Settings) => void;
}

/**
 * Everything the player sees outside the canvas.
 *
 * Kept in the DOM rather than drawn into WebGL so it stays readable at the
 * player's own font size and reachable by a screen reader — the same reasoning
 * as the HUD.
 */
export class Overlay {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lede: HTMLElement;
  private readonly status: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly meterFill: HTMLElement;
  private readonly meterRow: HTMLElement;
  private readonly sourceList: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly scoreLine: HTMLElement;
  private settings: Settings;

  constructor(root: HTMLElement, settings: Settings, handlers: OverlayHandlers) {
    this.root = root;
    this.settings = settings;
    root.innerHTML = PANEL_HTML;

    this.title = this.require('title');
    this.lede = this.require('lede');
    this.status = this.require('status');
    this.primary = this.require('primary') as HTMLButtonElement;
    this.meterFill = this.require('meter-fill');
    this.meterRow = this.require('meter-row');
    this.sourceList = this.require('sources');
    this.fileInput = this.require('file') as HTMLInputElement;
    this.scoreLine = this.require('score-line');

    this.primary.addEventListener('click', () => {
      if (this.primary.dataset.mode === 'restart') handlers.onRestart();
      else handlers.onStart();
    });

    this.sourceList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-source]');
      const id = button?.dataset.source;
      if (id) handlers.onPickSource(id);
    });

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) handlers.onPickFile(file);
    });

    for (const input of root.querySelectorAll<HTMLInputElement>('[data-setting]')) {
      input.addEventListener('input', () => {
        const key = input.dataset.setting as keyof Settings;
        const next: Settings = {
          ...this.settings,
          [key]: input.type === 'checkbox' ? input.checked : Number(input.value),
        };
        this.settings = next;
        this.syncSensitivityLabel();
        handlers.onSettingsChange(next);
      });
    }

    this.applySettings(settings);
  }

  private require(role: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`[data-role="${role}"]`);
    if (!element) throw new Error(`Overlay is missing the "${role}" element`);
    return element;
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    const sensitivity = this.root.querySelector<HTMLInputElement>(
      '[data-setting="voiceSensitivity"]',
    );
    if (sensitivity) sensitivity.value = String(settings.voiceSensitivity);
    const reduced = this.root.querySelector<HTMLInputElement>('[data-setting="reducedMotion"]');
    if (reduced) reduced.checked = settings.reducedMotion;
    const cues = this.root.querySelector<HTMLInputElement>('[data-setting="visualCues"]');
    if (cues) cues.checked = settings.visualCues;
    this.syncSensitivityLabel();
  }

  private syncSensitivityLabel(): void {
    const label = this.root.querySelector<HTMLElement>('[data-role="sensitivity-value"]');
    if (!label) return;
    // Show the effect, not the abstract number: a slider reading "-2 dB" tells
    // the player it takes a quieter sound, which "0.33" does not.
    const db = -this.settings.voiceSensitivity * SENSITIVITY_RANGE_DB;
    label.textContent = db === 0 ? 'default' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
  }

  showTitle(): void {
    this.root.hidden = false;
    this.title.textContent = 'Voice Runner';
    this.lede.innerHTML =
      'Play music anywhere — Spotify, YouTube, a podcast, the room — and the stage builds itself ' +
      'from it. <strong>Shout to jump. Growl low to slide.</strong>';
    this.primary.textContent = 'Allow microphone & run';
    this.primary.dataset.mode = 'start';
    this.primary.disabled = false;
    this.meterRow.hidden = true;
    this.scoreLine.hidden = true;
  }

  /** The calibration step: visible, with live feedback, instead of a silent wait. */
  showCalibrating(): void {
    this.root.hidden = false;
    this.title.textContent = 'Listening to the room';
    this.lede.textContent =
      'Say something at the volume you plan to play at. This sets what counts as a shout, ' +
      'so the game can tell you apart from the music.';
    this.primary.textContent = 'Calibrating…';
    this.primary.disabled = true;
    this.meterRow.hidden = false;
    this.scoreLine.hidden = true;
  }

  showGameOver(score: number, best: number, distance: number): void {
    this.root.hidden = false;
    this.title.textContent = score >= best && score > 0 ? 'Best yet' : 'Run over';
    this.lede.textContent = `${String(score)} points over ${distance.toFixed(0)} metres.`;
    this.scoreLine.hidden = false;
    this.scoreLine.textContent = `Best today: ${String(best)}`;
    this.primary.textContent = 'Run again';
    this.primary.dataset.mode = 'restart';
    this.primary.disabled = false;
    this.meterRow.hidden = true;
  }

  hide(): void {
    this.root.hidden = true;
  }

  setStatus(message: string): void {
    this.status.textContent = message;
  }

  setPrimaryLabel(label: string, disabled: boolean): void {
    this.primary.textContent = label;
    this.primary.disabled = disabled;
  }

  /** `excessDb` is how far the current sound is above the background. */
  setVoiceLevel(excessDb: number): void {
    const percent = Math.max(0, Math.min(100, (excessDb / 26) * 100));
    this.meterFill.style.width = `${String(percent)}%`;
  }

  setSources(choices: readonly SourceChoice[], activeId: string | null): void {
    this.sourceList.innerHTML = choices
      .map((choice) => {
        const active = choice.id === activeId ? ' is-active' : '';
        const disabled = choice.unavailable ? ' disabled' : '';
        const title = choice.unavailable ? ` title="${escapeHtml(choice.unavailable)}"` : '';
        return (
          `<button type="button" class="chip${active}" data-source="${escapeHtml(choice.id)}"` +
          `${disabled}${title}>${escapeHtml(choice.label)}</button>`
        );
      })
      .join('');
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

const PANEL_HTML = `
  <div class="panel">
    <h1 class="panel__title" data-role="title">Voice Runner</h1>
    <p class="panel__lede" data-role="lede"></p>

    <div class="panel__meter" data-role="meter-row" hidden>
      <div class="meter" role="img" aria-label="Voice level">
        <div class="meter__fill" data-role="meter-fill"></div>
        <div class="meter__threshold"></div>
      </div>
    </div>

    <button id="primary" class="button" type="button" data-role="primary">Start</button>
    <p class="panel__score" data-role="score-line" hidden></p>
    <p class="panel__note" data-role="status"></p>

    <details class="panel__section">
      <summary>Audio source</summary>
      <div class="chips" data-role="sources"></div>
      <label class="field">
        <span>Or play a file</span>
        <input type="file" accept="audio/*" data-role="file" />
      </label>
    </details>

    <details class="panel__section">
      <summary>Settings</summary>
      <label class="field">
        <span>Voice sensitivity <em data-role="sensitivity-value">default</em></span>
        <input type="range" min="-1" max="1" step="0.1" data-setting="voiceSensitivity" />
      </label>
      <label class="field field--check">
        <input type="checkbox" data-setting="reducedMotion" />
        <span>Reduce motion — no flashes or parallax</span>
      </label>
      <label class="field field--check">
        <input type="checkbox" data-setting="visualCues" />
        <span>Show a marker when an obstacle is one jump away</span>
      </label>
    </details>
  </div>
`;
