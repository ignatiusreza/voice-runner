import './style.css';
import type { AudioFeatures } from './audio/analysis/features';
import type { VoiceFrame } from './audio/analysis/voice';
import type { AudioEngineOptions } from './audio/engine';
import { AudioEngine } from './audio/engine';
import { loadTrack, recordStream, saveTrack } from './audio/recorder';
import { createFileSource } from './audio/sources/file';
import { microphoneSource } from './audio/sources/microphone';
import { describeStageSources } from './audio/sources/registry';
import { createSyntheticSource } from './audio/sources/synthetic';
import type { AudioSourceProvider } from './audio/sources/types';
import { GameLoop } from './core/loop';
import { seedFromString } from './core/rng';
import { Game } from './game/game';
import { mergeActions } from './input/actions';
import { KeyboardInput } from './input/keyboard';
import { VoiceController } from './input/voice-controller';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';
import type { SourceChoice } from './ui/overlay';
import { Overlay } from './ui/overlay';
import type { Settings } from './ui/settings';
import {
  bestScoreFor,
  loadSettings,
  prefersReducedMotion,
  recordScore,
  saveSettings,
  SENSITIVITY_RANGE_DB,
} from './ui/settings';

const stage = requireElement('stage');
const hudRoot = requireElement('hud');
const overlayRoot = requireElement('overlay');

const audio = new AudioEngine();
const renderer = new Renderer();
const hud = new Hud(hudRoot);
const keyboard = new KeyboardInput();
const voiceController = new VoiceController();

const params = new URLSearchParams(window.location.search);

/** A per-day seed keeps a day's runs comparable while the music varies them. */
const seedKey = new Date().toDateString();
const game = new Game(seedFromString(seedKey));

let settings = loadSettings();
// Honour the system preference the first time, rather than making the player
// find the toggle.
if (!('reducedMotion' in (readStoredRaw() ?? {})) && prefersReducedMotion()) {
  settings = { ...settings, reducedMotion: true };
}
applySettings(settings);

const overlay = new Overlay(overlayRoot, settings, {
  onStart: () => void begin(),
  onRestart: restart,
  onPickSource: (id) => void switchSource(id),
  onPickFile: (file) => void switchToFile(file),
  onSettingsChange: (next) => {
    settings = next;
    saveSettings(next);
    applySettings(next);
  },
});

const demoMode = readDemoMode();
const recordSeconds = params.has('record')
  ? Number.parseFloat(params.get('record') ?? '') || 20
  : 0;
const isReplay = params.has('replay');

let started = false;
let lastVoiceFrame: VoiceFrame | null = null;
let lastFeatures: AudioFeatures | null = null;
let activeSourceId: string | null = null;

const loop = new GameLoop({
  update(dt) {
    const { features, voice } = audio.sample();
    lastVoiceFrame = voice;
    lastFeatures = features;
    game.setAudio(features, audio.beat);
    game.setActions(mergeActions([voiceController.update(voice), keyboard.poll()]));
    game.update(dt);

    if (game.snapshot.phase === 'over') showGameOver();
  },
  render() {
    const snapshot = game.snapshot;
    renderer.draw(snapshot);
    hud.update(snapshot, lastVoiceFrame);
    if (import.meta.env.DEV) recordProbe();
  },
});

overlay.showTitle();
const bestToday = bestScoreFor(seedKey);
overlay.setStatus(
  (bestToday > 0 ? `Best today: ${String(bestToday)}.\n` : '') +
    'The microphone is used for controls only. Nothing is recorded, stored or uploaded.',
);
refreshSourceList();

if (demoMode) {
  overlay.setPrimaryLabel('Run the demo track', false);
  overlay.setStatus(
    'Demo mode: a generated click track drives the stage. Space jumps, Down slides.',
  );
}

function applySettings(next: Settings): void {
  // Positive sensitivity means "react to quieter sounds", so it lowers the
  // trigger — the sign flip belongs here rather than in the player's head.
  voiceController.setTrim(-next.voiceSensitivity * SENSITIVITY_RANGE_DB);
  renderer.setReducedMotion(next.reducedMotion);
  renderer.setVisualCues(next.visualCues);
}

function readStoredRaw(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('voice-runner/settings');
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function readDemoMode(): AudioEngineOptions | null {
  const value = params.get('demo');
  if (value === null) return null;
  const bpm = Number.parseFloat(value);
  return {
    stageProviders: [createSyntheticSource({ bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 120 })],
    useMicrophone: false,
  };
}

function pickableSources(): { id: string; provider: AudioSourceProvider; choice: SourceChoice }[] {
  const described = describeStageSources().map(({ provider, available, reason }) => ({
    id: provider.descriptor.kind,
    provider,
    choice: {
      id: provider.descriptor.kind,
      label: provider.descriptor.label,
      ...(available ? {} : { unavailable: reason ?? 'Not available on this device.' }),
    } satisfies SourceChoice,
  }));

  return [
    ...described,
    {
      id: 'demo',
      provider: createSyntheticSource({ bpm: 120, audible: true }),
      choice: { id: 'demo', label: 'Demo click track' },
    },
  ];
}

function refreshSourceList(): void {
  overlay.setSources(
    pickableSources().map((entry) => entry.choice),
    activeSourceId,
  );
}

async function switchSource(id: string): Promise<void> {
  const entry = pickableSources().find((candidate) => candidate.id === id);
  if (!entry || !started) return;

  overlay.setStatus(`Switching to ${entry.choice.label}…`);
  try {
    await audio.useStageSource(entry.provider);
    activeSourceId = id;
    hud.setSource(entry.choice.label);
    overlay.setStatus(`Stage audio: ${entry.choice.label}`);
  } catch (error) {
    // A declined share prompt is an ordinary outcome; the previous source is
    // still attached, so say so rather than leaving a dead end.
    overlay.setStatus(
      `Kept the current source — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  refreshSourceList();
}

async function switchToFile(file: File): Promise<void> {
  if (!started) return;
  overlay.setStatus(`Loading ${file.name}…`);
  try {
    await audio.useStageSource(createFileSource(file, file.name));
    activeSourceId = 'file';
    hud.setSource(file.name);
    overlay.setStatus(`Stage audio: ${file.name}`);
  } catch (error) {
    overlay.setStatus(
      `Could not play that file — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  refreshSourceList();
}

function restart(): void {
  overlay.hide();
  voiceController.reset();
  game.start();
  loop.start();
}

async function begin(): Promise<void> {
  overlay.setPrimaryLabel('Starting…', true);

  try {
    let options: AudioEngineOptions = demoMode ?? {};
    if (isReplay) {
      const track = await loadTrack();
      if (!track) throw new Error('No clip recorded yet — run with ?record=20 first.');
      options = {
        stageProviders: [createFileSource(track.blob, `Recorded clip (${String(track.seconds)}s)`)],
        useMicrophone: false,
      };
    }

    // If the microphone arrives after setup gave up waiting, wire it in then.
    audio.onVoiceReady = (): void => {
      overlay.setStatus('Microphone connected — voice control is on.');
    };

    const engineStatus = await audio.start(options);
    hud.setSource(engineStatus.stageSourceLabel);
    activeSourceId = engineStatus.sharedMicrophone ? microphoneSource.descriptor.kind : null;

    if (engineStatus.voiceReady) {
      overlay.showCalibrating();
      const floor = await audio.calibrate(2.5, (frame) => {
        overlay.setVoiceLevel(frame.excessDb);
      });
      overlay.setStatus(
        `Background measured at ${floor.toFixed(0)} dB. Shout louder than that to jump.`,
      );
    } else {
      overlay.setStatus(
        `${engineStatus.notices[0] ?? 'No microphone.'}\nSpace jumps, Down slides.`,
      );
    }

    if (recordSeconds > 0) {
      const stream = audio.stageStream;
      if (!stream) throw new Error('This stage source cannot be recorded (no media stream).');
      overlay.setStatus(`Recording ${String(recordSeconds)}s of the shared audio…`);
      const blob = await recordStream(stream, recordSeconds);
      await saveTrack({ blob, seconds: recordSeconds, recordedAt: Date.now() });
      overlay.setPrimaryLabel('Recorded', false);
      overlay.setStatus(
        `Recorded ${(blob.size / 1024).toFixed(0)} kB. Reload with ?replay to measure against it.`,
      );
      return;
    }

    await renderer.init(stage);
    keyboard.attach(window);

    started = true;
    refreshSourceList();
    restart();
  } catch (error) {
    overlay.setPrimaryLabel('Try again', false);
    overlay.setStatus(error instanceof Error ? error.message : String(error));
  }
}

function showGameOver(): void {
  loop.stop();
  const { score, distance } = game.snapshot;
  const best = recordScore(seedKey, score);
  overlay.showGameOver(score, best, distance);
  overlay.setStatus(`Stage audio: ${audio.currentStatus.stageSourceLabel}`);
  refreshSourceList();
}

// The context is suspended when the app is backgrounded; resuming mid-run would
// hand the simulation a huge time jump, so pause the run instead. The audio
// analysis keeps going regardless — it lives on the audio thread.
//
// The microphone is let go at the same time. On Android an open mic is treated
// as a call: it pauses the player's music app and flips Bluetooth headphones
// into their call profile, and a page that goes away still holding it can
// leave the headset stuck there after the browser is closed.
if (!params.has('measure')) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      loop.stop();
      audio.releaseMicrophone();
    } else {
      if (started) void reacquireMicrophone();
      if (game.snapshot.phase === 'running') loop.start();
    }
  });
}
// `pagehide` fires on close and navigation, sometimes without a preceding
// `visibilitychange`, and is the last chance to hand the mic back.
window.addEventListener('pagehide', () => {
  audio.releaseMicrophone();
});

async function reacquireMicrophone(): Promise<void> {
  try {
    await audio.reacquireMicrophone();
  } catch (error) {
    overlay.setStatus(
      `Microphone unavailable: ${error instanceof Error ? error.message : String(error)}\nSpace jumps, Down slides.`,
    );
  }
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Expected an element with id "${id}"`);
  return element;
}

/* --- dev-only measurement probe ------------------------------------------ */

interface ProbeStat {
  min: number;
  max: number;
  sum: number;
  n: number;
}

const probe = new Map<string, ProbeStat>();
let syncCos = 0;
let syncSin = 0;
let syncCount = 0;
let lastCrossedBeat: number | null = null;
let flashCos = 0;
let flashSin = 0;
let flashCount = 0;
let flashArmed = true;
let loudFrames = 0;
let totalFrames = 0;

function recordFlash(): void {
  const pulse = game.snapshot.mood.pulse;
  totalFrames += 1;
  if (pulse > 0.5) loudFrames += 1;

  if (pulse > 0.6 && flashArmed) {
    flashArmed = false;
    const phase = audio.phaseAt(audio.time) * Math.PI * 2;
    flashCos += Math.cos(phase);
    flashSin += Math.sin(phase);
    flashCount += 1;
  } else if (pulse < 0.25) {
    flashArmed = true;
  }
}

function recordSync(): void {
  const snapshot = game.snapshot;
  const x = snapshot.player.x;
  const segment = snapshot.world.segments.find((s) => x >= s.x && x < s.x + s.width);
  if (!segment || lastCrossedBeat === segment.beatIndex) return;
  lastCrossedBeat = segment.beatIndex;

  const phase = audio.phaseAt(audio.time) * Math.PI * 2;
  syncCos += Math.cos(phase);
  syncSin += Math.sin(phase);
  syncCount += 1;
}

function recordProbe(): void {
  const f = lastFeatures;
  if (!f) return;
  const beat = audio.beat;
  const mood = game.snapshot.mood;
  recordSync();
  recordFlash();

  const samples: Record<string, number> = {
    energy: f.energy,
    bass: f.bass,
    brightness: f.brightness,
    flux: f.flux,
    beatConfidence: beat.confidence,
    bpm: beat.bpm,
    moodIntensity: mood.intensity,
    moodWeight: mood.weight,
    moodBrightness: mood.brightness,
    pulse: mood.pulse,
  };
  for (const [key, value] of Object.entries(samples)) {
    const stat = probe.get(key) ?? { min: Infinity, max: -Infinity, sum: 0, n: 0 };
    stat.min = Math.min(stat.min, value);
    stat.max = Math.max(stat.max, value);
    stat.sum += value;
    stat.n += 1;
    probe.set(key, stat);
  }
}

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__voiceRunner', {
    value: {
      reset: (): void => {
        probe.clear();
        syncCos = 0;
        syncSin = 0;
        syncCount = 0;
        lastCrossedBeat = null;
        flashCos = 0;
        flashSin = 0;
        flashCount = 0;
        flashArmed = true;
        loudFrames = 0;
        totalFrames = 0;
      },
      live: (): Record<string, number> => ({
        energy: +audio.stage.energy.toFixed(4),
        bass: +audio.stage.bass.toFixed(4),
        brightness: +audio.stage.brightness.toFixed(4),
        flux: +audio.stage.flux.toFixed(4),
        time: +audio.stage.time.toFixed(2),
        bpm: +audio.beat.bpm.toFixed(2),
        confidence: +audio.beat.confidence.toFixed(3),
        stability: +audio.beat.stability.toFixed(3),
      }),
      flash: (): { hits: number; onBeat: number; visibleFraction: number } => ({
        hits: flashCount,
        onBeat: flashCount === 0 ? 0 : +(Math.hypot(flashCos, flashSin) / flashCount).toFixed(3),
        visibleFraction: totalFrames === 0 ? 0 : +(loudFrames / totalFrames).toFixed(3),
      }),
      sync: (): { crossings: number; lock: number } => ({
        crossings: syncCount,
        lock: syncCount === 0 ? 0 : +(Math.hypot(syncCos, syncSin) / syncCount).toFixed(3),
      }),
      stats: (): Record<string, { min: number; mean: number; max: number }> =>
        Object.fromEntries(
          [...probe.entries()].map(([k, v]) => [
            k,
            { min: +v.min.toFixed(4), mean: +(v.sum / v.n).toFixed(4), max: +v.max.toFixed(4) },
          ]),
        ),
    },
  });
}
