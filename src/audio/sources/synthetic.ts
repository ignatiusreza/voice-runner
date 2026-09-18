import type { AttachedAudioSource, AudioSourceProvider } from './types';

/** Beats rendered into the loop. A whole bar keeps the seam on a beat. */
const LOOP_BEATS = 8;
const PULSE_DECAY_SECONDS = 0.12;
const TONE_HZ = 90;

export interface SyntheticTrackOptions {
  bpm?: number;
  /** Carrier frequency of the pulse, in Hz. Low reads as a kick drum. */
  toneHz?: number;
  /** Whether the track is audible, or only analysed. */
  audible?: boolean;
}

/**
 * A generated click track, rendered once and looped.
 *
 * Not a toy: it is the only source with a known tempo, which makes it what the
 * generator is tuned against and what a browser smoke test can drive the whole
 * pipeline with. It also means the game is playable on a machine with no
 * microphone and nothing playing.
 *
 * It used to schedule a fixed run of envelope events and then simply stop —
 * after thirty seconds the demo fell silent, and a measurement taken past that
 * point was reading the tracker's opinion of silence. A looping buffer cannot
 * run out.
 */
export function createSyntheticSource(options: SyntheticTrackOptions = {}): AudioSourceProvider {
  const { bpm = 120, toneHz = TONE_HZ, audible = false } = options;
  const label = `Demo track (${String(bpm)} BPM)`;

  return {
    descriptor: { kind: 'file', label },

    isSupported(): boolean {
      return true;
    },

    async attach(context: AudioContext): Promise<AttachedAudioSource> {
      if (context.state === 'suspended') await context.resume();

      const period = 60 / bpm;
      const buffer = context.createBuffer(
        1,
        Math.round(period * LOOP_BEATS * context.sampleRate),
        context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      const decay = PULSE_DECAY_SECONDS * context.sampleRate;

      for (let i = 0; i < samples.length; i++) {
        const t = i / context.sampleRate;
        const sinceBeat = t % period;
        // Exponentially decaying sawtooth: a sharp attack with harmonics
        // across the band, which is what an onset detector needs to see.
        const envelope = Math.exp((-sinceBeat * context.sampleRate) / decay);
        const phase = (t * toneHz) % 1;
        samples[i] = (2 * phase - 1) * envelope * 0.9;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = context.createGain();
      source.connect(gain);
      if (audible) gain.connect(context.destination);
      source.start();

      return {
        descriptor: { kind: 'file', label },
        node: gain,
        detach() {
          source.stop();
          source.disconnect();
          gain.disconnect();
        },
      };
    },
  };
}
