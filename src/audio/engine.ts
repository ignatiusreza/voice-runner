import type { BeatEstimate } from './analysis/beat';
import { FALLBACK_BPM } from './analysis/beat';
import type { AudioFeatures } from './analysis/features';
import { SILENT_FEATURES } from './analysis/features';
import type { VoiceFrame } from './analysis/voice';
import { SILENCE_DB, VoiceAnalyser } from './analysis/voice';
import { openMicrophone } from './sources/microphone';
import { attachBestStageSource } from './sources/registry';
import type { AttachedAudioSource, AudioSourceProvider } from './sources/types';
import type { AnalysisMessage } from './worklet/analysis-processor';
import processorUrl from './worklet/analysis-processor?worker&url';

/** 2048 bins at 48kHz is ~23Hz resolution and ~43ms latency. A good trade. */
const FFT_SIZE = 2048;

const SILENT_BEAT: BeatEstimate = {
  bpm: FALLBACK_BPM,
  period: 60 / FALLBACK_BPM,
  anchor: 0,
  confidence: 0,
};
/**
 * Gap between calibration samples. Background tabs clamp timers to about a
 * second, which yields few samples but still terminates — the silence filter
 * and the analyser's snap-out-of-silence behaviour cover the sparse case.
 */
const CALIBRATION_INTERVAL_MS = 16;

export interface AudioEngineOptions {
  /** Overrides the stage source preference order. Used by demo and test modes. */
  stageProviders?: readonly AudioSourceProvider[];
  /**
   * Set false to skip opening the microphone entirely. Without this, a
   * permission prompt that is never answered leaves `start` pending forever,
   * which looks to the player like the game has hung.
   */
  useMicrophone?: boolean;
}

export interface AudioEngineStatus {
  stageSourceLabel: string;
  voiceReady: boolean;
  /** Set when the stage falls back to the same mic the player talks into. */
  sharedMicrophone: boolean;
  notices: string[];
}

/**
 * Owns the `AudioContext` and both analysis chains.
 *
 * Two chains, one context:
 *   stage source -> analyser -> FeatureExtractor -> BeatTracker  (level design)
 *   microphone   -> analyser -> VoiceAnalyser                    (control)
 *
 * They stay separate even when both come from the microphone, because they want
 * opposite things: the stage chain wants smoothed spectra, the voice chain wants
 * unsmoothed time-domain samples for pitch.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private stageAttachment: AttachedAudioSource | null = null;
  private stageNode: AudioWorkletNode | null = null;
  private voiceAnalyserNode: AnalyserNode | null = null;
  private voiceStream: MediaStream | null = null;

  private readonly waveform = new Float32Array(FFT_SIZE);

  private voice: VoiceAnalyser | null = null;

  /** Latest analysis posted from the audio thread. */
  private stageFeatures: AudioFeatures = SILENT_FEATURES;
  private stageBeat: BeatEstimate = SILENT_BEAT;

  private status: AudioEngineStatus = {
    stageSourceLabel: 'not started',
    voiceReady: false,
    sharedMicrophone: false,
    notices: [],
  };

  private lastVoice: VoiceFrame | null = null;

  get currentStatus(): AudioEngineStatus {
    return this.status;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 48000;
  }

  /**
   * The stage source's underlying stream, when it has one.
   *
   * Only the capture sources do — a decoded file has no `MediaStream`. Used by
   * the dev recorder to capture a fixed clip for repeatable measurement.
   */
  get stageStream(): MediaStream | null {
    return this.stageAttachment?.stream ?? null;
  }

  /** Seconds since the context started. Shared clock for features and beats. */
  get time(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * Must be called from a user gesture — every browser blocks `AudioContext`
   * and `getUserMedia` outside one.
   */
  async start(options: AudioEngineOptions = {}): Promise<AudioEngineStatus> {
    const { stageProviders, useMicrophone = true } = options;
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    const notices: string[] = [];

    // Voice first: without it the game is unplayable, whereas a missing stage
    // source only costs audio-reactive level design.
    let voiceReady = false;
    if (!useMicrophone) {
      notices.push('Microphone skipped — keyboard controls only.');
    } else {
      try {
        this.voiceStream = await openMicrophone(context);
        const micNode = context.createMediaStreamSource(this.voiceStream);
        this.voiceAnalyserNode = context.createAnalyser();
        this.voiceAnalyserNode.fftSize = FFT_SIZE;
        this.voiceAnalyserNode.smoothingTimeConstant = 0;
        micNode.connect(this.voiceAnalyserNode);
        this.voice = new VoiceAnalyser({ sampleRate: context.sampleRate });
        voiceReady = true;
      } catch (error) {
        notices.push(
          `Microphone unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const { attached, failures } = await attachBestStageSource(context, stageProviders);
    for (const failure of failures) notices.push(`${failure.kind}: ${failure.message}`);

    if (attached) {
      this.stageAttachment = attached;
      try {
        await context.audioWorklet.addModule(processorUrl);
        this.stageNode = new AudioWorkletNode(context, 'stage-analysis', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
        });
        this.stageNode.port.onmessage = (event: MessageEvent<AnalysisMessage>): void => {
          const { features, bpm, period, anchor, confidence } = event.data;
          this.stageFeatures = features;
          this.stageBeat = { bpm, period, anchor, confidence };
        };
        attached.node.connect(this.stageNode);
      } catch (error) {
        notices.push(
          `Stage analysis unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.status = {
      stageSourceLabel: attached?.descriptor.label ?? 'none — using a fixed rhythm',
      voiceReady,
      sharedMicrophone: attached?.descriptor.kind === 'ambient-microphone',
      notices,
    };
    return this.status;
  }

  /**
   * Latest stage analysis, readable at any time.
   *
   * It advances on the audio thread, so this is meaningful whether or not the
   * render loop is running — which is what makes it measurable.
   */
  get stage(): AudioFeatures {
    return this.stageFeatures;
  }

  /** The beat grid, as last computed on the audio thread. */
  get beat(): BeatEstimate {
    return this.stageBeat;
  }

  /** 0 at a beat, approaching 1 just before the next. */
  phaseAt(time: number): number {
    const { anchor, period } = this.stageBeat;
    const raw = ((time - anchor) / period) % 1;
    return raw < 0 ? raw + 1 : raw;
  }

  /**
   * Reads the latest analysis and samples the voice chain.
   *
   * The stage half is only *read* here — it is computed on the audio thread, so
   * it keeps advancing at a fixed rate even when this is called irregularly or
   * not at all.
   */
  sample(): { features: AudioFeatures; voice: VoiceFrame | null } {
    if (this.voiceAnalyserNode && this.voice) {
      this.voiceAnalyserNode.getFloatTimeDomainData(this.waveform);
      this.lastVoice = this.voice.analyse(this.waveform, this.time);
    }

    return { features: this.stageFeatures, voice: this.lastVoice };
  }

  /**
   * Measures the room for `seconds` and seeds the voice floor with it, so the
   * first shout of a run is judged against the real background rather than
   * against the analyser's cold-start guess.
   */
  async calibrate(seconds = 2): Promise<number> {
    if (!this.voiceAnalyserNode || !this.voice) return -60;

    const samples: number[] = [];
    const deadline = performance.now() + seconds * 1000;
    while (performance.now() < deadline) {
      this.voiceAnalyserNode.getFloatTimeDomainData(this.waveform);
      const { db } = this.voice.analyse(this.waveform, this.time);
      // A just-opened stream hands back zeroed buffers for a moment. Those are
      // not a quiet room, and including them drags the median to an impossible
      // floor that the whole run is then judged against.
      if (db > SILENCE_DB) samples.push(db);
      await delay(CALIBRATION_INTERVAL_MS);
    }

    if (samples.length === 0) {
      // Nothing audible was heard at all. Leave the analyser to snap to the
      // first real frame rather than priming it with a fabricated level.
      return this.voice.backgroundDb;
    }

    // Median, not mean: a cough or a door slam during calibration would drag a
    // mean upward and leave the gate too high for the whole run.
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    this.voice.primeFloor(median);
    return median;
  }

  async stop(): Promise<void> {
    this.stageAttachment?.detach();
    this.stageAttachment = null;
    this.stageNode?.disconnect();
    this.stageNode = null;
    for (const track of this.voiceStream?.getTracks() ?? []) track.stop();
    this.voiceStream = null;
    this.voice?.reset();
    this.stageFeatures = SILENT_FEATURES;
    this.stageBeat = SILENT_BEAT;
    await this.context?.close();
    this.context = null;
  }
}

/**
 * Waits on a timer rather than a frame.
 *
 * Calibration used to await `requestAnimationFrame`, which a hidden tab never
 * fires — so starting the game and switching away hung setup indefinitely.
 * Nothing about measuring the room depends on rendering, and the analyser node
 * is fed by the audio graph either way.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
