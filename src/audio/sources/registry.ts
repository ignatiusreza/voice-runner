import { displayCaptureSource } from './display-capture';
import { microphoneSource } from './microphone';
import { nativePlaybackSource } from './native-playback';
import type { AttachedAudioSource, AudioSourceProvider } from './types';

/**
 * Preference order for the stage source, best fidelity first.
 *
 * Direct capture of the actual playback is always preferred: it is clean, and
 * the mic is then free to hear only the player. Ambient microphone is last
 * because it hears the music *and* the player at once, which the voice
 * analyser has to untangle.
 */
export const STAGE_SOURCE_ORDER: readonly AudioSourceProvider[] = [
  nativePlaybackSource,
  displayCaptureSource,
  microphoneSource,
];

export function availableStageSources(): AudioSourceProvider[] {
  return STAGE_SOURCE_ORDER.filter((provider) => provider.isSupported());
}

/**
 * Every stage source, with a reason attached to the ones this platform cannot
 * offer. The picker shows them all: "your phone cannot share another app's
 * audio" is more useful to a player than the option silently not being there.
 */
export function describeStageSources(): {
  provider: AudioSourceProvider;
  available: boolean;
  reason?: string;
}[] {
  return STAGE_SOURCE_ORDER.map((provider) => {
    const available = provider.isSupported();
    const reason = provider.descriptor.unavailableReason;
    return available
      ? { provider, available }
      : { provider, available, ...(reason ? { reason } : {}) };
  });
}

export interface StageSourceAttempt {
  attached: AttachedAudioSource | null;
  /** Every provider that was tried and why it did not work, newest last. */
  failures: { kind: string; message: string }[];
}

/**
 * Walks the preference order until one source attaches.
 *
 * A rejection here is usually the player declining a permission prompt, not a
 * bug, so failures are collected and reported rather than thrown — the game is
 * still playable on the next source down.
 */
export async function attachBestStageSource(
  context: AudioContext,
  providers: readonly AudioSourceProvider[] = STAGE_SOURCE_ORDER,
): Promise<StageSourceAttempt> {
  const failures: { kind: string; message: string }[] = [];

  for (const provider of providers) {
    if (!provider.isSupported()) {
      failures.push({
        kind: provider.descriptor.kind,
        message: provider.descriptor.unavailableReason ?? 'Not supported on this platform.',
      });
      continue;
    }

    try {
      return { attached: await provider.attach(context), failures };
    } catch (error) {
      failures.push({
        kind: provider.descriptor.kind,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { attached: null, failures };
}
