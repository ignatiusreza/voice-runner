import { hasMicrophoneApi, isSecureContext } from '../../platform/capabilities';
import type { AttachedAudioSource, AudioSourceProvider } from './types';

/**
 * Raw microphone access.
 *
 * Used twice: always for voice control, and as the last-resort stage source
 * when nothing else can reach the audio the player is listening to. The
 * processing flags are all off — echo cancellation and noise suppression are
 * tuned to remove exactly the music the generator wants to hear, and AGC would
 * fight the analyser's own level tracking.
 */
export const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export async function openMicrophone(context: AudioContext): Promise<MediaStream> {
  if (!hasMicrophoneApi()) {
    throw new Error(
      isSecureContext()
        ? 'This device has no microphone API available.'
        : 'Microphone access needs HTTPS (or localhost). Open the game over a secure origin.',
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: MICROPHONE_CONSTRAINTS });
  // A suspended context yields all-zero analysis frames, which reads as silence
  // rather than as an error, so resume before anyone taps it.
  if (context.state === 'suspended') await context.resume();
  return stream;
}

export const microphoneSource: AudioSourceProvider = {
  descriptor: {
    kind: 'ambient-microphone',
    label: 'Room audio (microphone)',
  },

  isSupported(): boolean {
    return hasMicrophoneApi();
  },

  async attach(context: AudioContext): Promise<AttachedAudioSource> {
    const stream = await openMicrophone(context);
    const node = context.createMediaStreamSource(stream);
    return {
      descriptor: microphoneSource.descriptor,
      node,
      stream,
      detach() {
        node.disconnect();
        for (const track of stream.getTracks()) track.stop();
      },
    };
  },
};
