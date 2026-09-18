import type { AttachedAudioSource, AudioSourceProvider } from './types';

/**
 * Android system playback capture (`AudioPlaybackCapture`, API 29+).
 *
 * The native side is not written yet — see docs/roadmap.md. This provider
 * exists so the capability probe and the source-picker UI already have the
 * right shape, and so the platform notes stay next to the code they describe:
 *
 * - Android only. iOS has no public system-audio capture at all.
 * - Needs a `MediaProjection` consent dialog, once per session.
 * - Apps opt out via `android:allowAudioPlaybackCapture="false"`, and several
 *   music apps do exactly that. The registry must always be able to fall back.
 */
interface NativePlaybackCapturePlugin {
  isAvailable(): Promise<{ available: boolean }>;
  start(): Promise<{ streamId: string }>;
  stop(): Promise<void>;
}

declare global {
  interface Window {
    VoiceRunnerPlaybackCapture?: NativePlaybackCapturePlugin;
  }
}

export const nativePlaybackSource: AudioSourceProvider = {
  descriptor: {
    kind: 'native-playback',
    label: 'Other apps’ audio (Android)',
    unavailableReason: 'Needs the Android playback-capture plugin, which is not built yet.',
  },

  isSupported(): boolean {
    return typeof window !== 'undefined' && window.VoiceRunnerPlaybackCapture !== undefined;
  },

  attach(_context: AudioContext): Promise<AttachedAudioSource> {
    return Promise.reject(
      new Error('Android playback capture is not implemented yet; falling back to the microphone.'),
    );
  },
};
