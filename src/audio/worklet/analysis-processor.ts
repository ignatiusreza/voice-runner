import { BeatTracker } from '../analysis/beat';
import type { AudioFeatures } from '../analysis/features';
import { FeatureExtractor } from '../analysis/features';
import { Fft } from '../analysis/fft';

/**
 * Runs the stage analysis on the audio thread.
 *
 * It used to run from `render()`, which tied it to the frame rate and stopped
 * it dead whenever the tab was backgrounded — `requestAnimationFrame` simply
 * does not fire there. That made the stage stop reacting to music the moment
 * the tab lost focus, and made measurement meaningless: replaying one identical
 * clip produced beat lock of 0.14 and then 0.42 depending on when focus moved.
 *
 * An `AudioWorkletProcessor` is called at a fixed block rate by the audio
 * thread regardless of visibility or frame rate, so the analysis advances at a
 * constant, deterministic cadence.
 */

const FFT_SIZE = 2048;
/** ~93 analysis frames a second at 48kHz — comfortably above the 100Hz beat envelope. */
const HOP_SIZE = 512;

export interface AnalysisMessage {
  features: AudioFeatures;
  bpm: number;
  period: number;
  anchor: number;
  confidence: number;
}

class AnalysisProcessor extends AudioWorkletProcessor {
  private readonly fft = new Fft(FFT_SIZE);
  private readonly ring = new Float32Array(FFT_SIZE);
  private readonly frame = new Float32Array(FFT_SIZE);
  private readonly spectrum = new Float32Array(FFT_SIZE / 2);
  private readonly features = new FeatureExtractor(sampleRate);
  private readonly beats = new BeatTracker();

  private writeIndex = 0;
  private sinceHop = 0;

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    // No input yet is normal before the source connects; keep the node alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.ring[this.writeIndex] = channel[i]!;
      this.writeIndex = (this.writeIndex + 1) % FFT_SIZE;
      if (++this.sinceHop < HOP_SIZE) continue;

      this.sinceHop = 0;
      this.analyse();
    }

    return true;
  }

  private analyse(): void {
    // Copy the ring out oldest-first so the window is contiguous in time.
    for (let i = 0; i < FFT_SIZE; i++) {
      this.frame[i] = this.ring[(this.writeIndex + i) % FFT_SIZE]!;
    }

    this.fft.magnitudes(this.frame, this.spectrum);

    // `currentTime` is the audio thread's own clock, so feature timestamps and
    // the beat grid share the same timebase the sources are scheduled against.
    const features = this.features.extract(this.spectrum, currentTime);
    this.beats.push(features);
    const beat = this.beats.current;

    const message: AnalysisMessage = {
      features,
      bpm: beat.bpm,
      period: beat.period,
      anchor: beat.anchor,
      confidence: beat.confidence,
    };
    this.port.postMessage(message);
  }
}

registerProcessor('stage-analysis', AnalysisProcessor);
