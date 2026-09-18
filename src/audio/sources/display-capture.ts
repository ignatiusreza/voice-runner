import { hasDisplayCaptureApi } from '../../platform/capabilities';
import type { AttachedAudioSource, AudioSourceProvider } from './types';

/**
 * Desktop-web system/tab audio.
 *
 * `getDisplayMedia({ audio: true })` is the only standards-track way to hear
 * what another app is playing. The player picks a tab (Spotify Web, YouTube) or
 * the whole screen and ticks "share audio". Mobile browsers do not implement
 * the audio half, so this provider reports unsupported there and the registry
 * falls through to the microphone.
 */
export const displayCaptureSource: AudioSourceProvider = {
  descriptor: {
    kind: 'display-capture',
    label: 'Tab or system audio',
    unavailableReason: 'Mobile browsers cannot share another app’s audio.',
  },

  isSupported(): boolean {
    return hasDisplayCaptureApi();
  },

  async attach(context: AudioContext): Promise<AttachedAudioSource> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: true,
    });

    // The video track is only requested because Chrome refuses audio-only
    // display capture; nothing renders it, so stop it immediately.
    for (const track of stream.getVideoTracks()) {
      track.stop();
      stream.removeTrack(track);
    }

    if (stream.getAudioTracks().length === 0) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error('No audio was shared — re-pick the source and tick “Share tab audio”.');
    }

    if (context.state === 'suspended') await context.resume();
    const node = context.createMediaStreamSource(stream);

    return {
      descriptor: displayCaptureSource.descriptor,
      node,
      stream,
      detach() {
        node.disconnect();
        for (const track of stream.getTracks()) track.stop();
      },
    };
  },
};
