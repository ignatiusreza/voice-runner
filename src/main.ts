import './style.css';
import type { VoiceFrame } from './audio/analysis/voice';
import type { AudioEngineOptions } from './audio/engine';
import { AudioEngine } from './audio/engine';
import { createSyntheticSource } from './audio/sources/synthetic';
import { GameLoop } from './core/loop';
import { seedFromString } from './core/rng';
import { Game } from './game/game';
import { mergeActions } from './input/actions';
import { KeyboardInput } from './input/keyboard';
import { VoiceController } from './input/voice-controller';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';

const stage = requireElement('stage');
const overlay = requireElement('overlay');
const status = requireElement('status');
const startButton = requireElement('start') as HTMLButtonElement;

const audio = new AudioEngine();
const renderer = new Renderer();
const hud = new Hud(requireElement('hud'));
const keyboard = new KeyboardInput();
const voiceController = new VoiceController();

// A per-day seed keeps a given day's runs comparable between players while the
// music still makes each run different.
const game = new Game(seedFromString(new Date().toDateString()));

/**
 * `?demo` (optionally `?demo=140`) runs against a generated click track with no
 * microphone. It makes the game playable and demonstrable on a machine with no
 * audio permissions, and gives the generator a known tempo to be tuned against.
 */
const demoMode = readDemoMode();

if (demoMode) {
  startButton.textContent = 'Run the demo track';
  status.textContent =
    'Demo mode: a generated click track drives the stage and the microphone is not used. Space jumps, Down slides.';
}

function readDemoMode(): AudioEngineOptions | null {
  const value = new URLSearchParams(window.location.search).get('demo');
  if (value === null) return null;
  const bpm = Number.parseFloat(value);
  return {
    stageProviders: [createSyntheticSource({ bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 120 })],
    useMicrophone: false,
  };
}

// Sampling drives the beat tracker, so it must happen exactly once per frame —
// the HUD reads this rather than sampling again.
let lastVoiceFrame: VoiceFrame | null = null;

const loop = new GameLoop({
  update(dt) {
    const { features, voice } = audio.sample();
    lastVoiceFrame = voice;
    game.setAudio(features, audio.beats.current);
    game.setActions(mergeActions([voiceController.update(voice), keyboard.poll()]));
    game.update(dt);

    if (game.snapshot.phase === 'over') showGameOver();
  },
  render() {
    const snapshot = game.snapshot;
    renderer.draw(snapshot);
    hud.update(snapshot, lastVoiceFrame);
  },
});

/**
 * Whether the one-time setup has run.
 *
 * The button does double duty — first start and restart — and those must not do
 * the same thing. Re-running setup on a restart opens a second `AudioContext`,
 * re-prompts for screen sharing, and appends a second canvas over the first.
 */
let started = false;

startButton.addEventListener('click', () => {
  if (started) restart();
  else void begin();
});

function restart(): void {
  overlay.hidden = true;
  voiceController.reset();
  game.start();
  loop.start();
}

async function begin(): Promise<void> {
  startButton.disabled = true;
  startButton.textContent = 'Starting…';

  try {
    const engineStatus = await audio.start(demoMode ?? {});
    hud.setSource(engineStatus.stageSourceLabel);

    if (!engineStatus.voiceReady) {
      status.textContent =
        'No microphone, so voice control is off — use Space to jump and Down to slide.\n' +
        engineStatus.notices.join('\n');
    }

    startButton.textContent = 'Listening to the room…';
    const floor = await audio.calibrate(2);

    if (engineStatus.sharedMicrophone) {
      status.textContent =
        `Using the room through the microphone (background ${floor.toFixed(0)} dB).\n` +
        'Play your music out loud, then shout over it to jump.';
    }

    await renderer.init(stage);
    keyboard.attach(window);

    started = true;
    // Leave the button in its restart state. It is behind the hidden overlay
    // now, but a disabled button with stale text is what the player would meet
    // if anything surfaced the overlay before the first game over.
    startButton.disabled = false;
    startButton.textContent = 'Run again';
    restart();
  } catch (error) {
    startButton.disabled = false;
    startButton.textContent = 'Try again';
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function showGameOver(): void {
  loop.stop();
  const { score, distance } = game.snapshot;
  overlay.hidden = false;
  startButton.disabled = false;
  startButton.textContent = 'Run again';
  status.textContent = `${String(score)} points over ${distance.toFixed(0)} metres.`;
}

// The context is suspended when the app is backgrounded; resuming mid-run would
// hand the simulation a huge time jump, so pause the run instead.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) loop.stop();
  else if (game.snapshot.phase === 'running') loop.start();
});

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Expected an element with id "${id}"`);
  return element;
}
