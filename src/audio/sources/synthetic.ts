import type { AttachedAudioSource, AudioSourceProvider } from './types';

/** How far ahead pulses are scheduled. Long enough to survive a stalled tab. */
const SCHEDULE_AHEAD_SECONDS = 30;
const PULSE_DECAY_SECONDS = 0.12;

export interface SyntheticTrackOptions {
  bpm?: number;
  /** Carrier frequency of the pulse, in Hz. Low reads as a kick drum. */
  toneHz?: number;
  /** Whether the track is audible, or only analysed. */
  audible?: boolean;
}

/**
 * A generated click track.
 *
 * Not a toy: it is the only source that produces a known tempo and a known
 * envelope, which makes it what the generator is tuned against and what a
 * browser smoke test can drive the whole pipeline with. It also means the game
 * is playable — and demonstrable — on a machine with no microphone and nothing
 * playing.
 */
export function createSyntheticSource(options: SyntheticTrackOptions = {}): AudioSourceProvider {
  const { bpm = 120, toneHz = 90, audible = false } = options;

  return {
    descriptor: {
      kind: 'file',
      label: `Demo track (${String(bpm)} BPM)`,
    },

    isSupported(): boolean {
      return true;
    },

    async attach(context: AudioContext): Promise<AttachedAudioSource> {
      if (context.state === 'suspended') await context.resume();

      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = toneHz;

      const envelope = context.createGain();
      envelope.gain.value = 0;
      oscillator.connect(envelope);

      // Scheduled on the audio clock rather than with timers, so the beat grid
      // stays exact even when the main thread stutters.
      const period = 60 / bpm;
      let time = context.currentTime + 0.05;
      const until = context.currentTime + SCHEDULE_AHEAD_SECONDS;
      while (time < until) {
        envelope.gain.setValueAtTime(0.9, time);
        envelope.gain.exponentialRampToValueAtTime(0.01, time + PULSE_DECAY_SECONDS);
        time += period;
      }

      if (audible) envelope.connect(context.destination);
      oscillator.start();

      return {
        descriptor: { kind: 'file', label: `Demo track (${String(bpm)} BPM)` },
        node: envelope,
        detach() {
          oscillator.stop();
          oscillator.disconnect();
          envelope.disconnect();
        },
      };
    },
  };
}
