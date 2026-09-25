import type { BeatEstimate } from './analysis/beat';
import { FALLBACK_BPM } from './analysis/beat';
import type { AudioFeatures } from './analysis/features';
import { SILENT_FEATURES } from './analysis/features';
import type { VoiceFrame } from './analysis/voice';
import { SILENCE_DB, VoiceAnalyser } from './analysis/voice';
import { microphoneSource, openMicrophone } from './sources/microphone';
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
  stability: 0,
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
  /**
   * How long to wait for the microphone before starting without it.
   *
   * A permission prompt the player never answers leaves `getUserMedia` pending
   * for as long as the dialog is open, which used to leave the start button on
   * "Starting…" indefinitely. Setup continues after this, and the voice chain
   * is wired up later if the player does eventually allow it.
   */
  microphoneTimeoutMs?: number;
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
  private voiceSourceNode: MediaStreamAudioSourceNode | null = null;
  /**
   * Bumped whenever the microphone is released, so a `getUserMedia` call that
   * was already in flight is stopped on arrival rather than quietly re-opening
   * the mic the player just walked away from.
   */
  private micGeneration = 0;
  /** Set while the microphone is released because the page went away. */
  private micReleased = false;
  /** Set when `releaseMicrophone` suspended the context, so only it resumes it. */
  private contextSuspended = false;
  /** Voice control was asked for and not refused, so a release should restore it. */
  private wantsVoice = false;
  /** The stage was on the room mic when it was released, so restore it too. */
  private restoreStageMic = false;

  private readonly waveform = new Float32Array(FFT_SIZE);

  private voice: VoiceAnalyser | null = null;
  private micNotice: string | null = null;
  /** Fires if the microphone arrives after setup gave up waiting for it. */
  onVoiceReady: (() => void) | null = null;

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
    const { stageProviders, useMicrophone = true, microphoneTimeoutMs = 6000 } = options;
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    const notices: string[] = [];

    // Voice first: without it the game is unplayable, whereas a missing stage
    // source only costs audio-reactive level design.
    let voiceReady = false;
    if (!useMicrophone) {
      notices.push('Microphone skipped — keyboard controls only.');
    } else {
      const generation = this.micGeneration;
      this.wantsVoice = true;
      const pending = openMicrophone(context).then(
        (stream) => this.adoptMicrophone(context, stream, generation),
        (error: unknown) => {
          this.wantsVoice = false;
          this.micNotice = `Microphone unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`;
          return false;
        },
      );

      // Don't block setup on a prompt nobody has answered. If the player allows
      // it later, `adoptMicrophone` wires the voice chain up then.
      voiceReady = await Promise.race([pending, delay(microphoneTimeoutMs).then(() => false)]);
      if (!voiceReady) {
        notices.push(
          this.micNotice ??
            'Still waiting on microphone permission — starting with keyboard controls.',
        );
      }
    }

    const { attached, failures } = await attachBestStageSource(context, stageProviders);
    for (const failure of failures) notices.push(`${failure.kind}: ${failure.message}`);

    try {
      await this.ensureAnalysisNode(context);
    } catch (error) {
      notices.push(
        `Stage analysis unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (attached) this.connectStage(attached);

    this.status = {
      stageSourceLabel: attached?.descriptor.label ?? 'none — using a fixed rhythm',
      voiceReady,
      sharedMicrophone: attached?.descriptor.kind === 'ambient-microphone',
      notices,
    };
    return this.status;
  }

  /** Returns false, having stopped the stream, if it arrived after a release. */
  private adoptMicrophone(context: AudioContext, stream: MediaStream, generation: number): boolean {
    if (generation !== this.micGeneration || this.context !== context) {
      stopTracks(stream);
      return false;
    }
    this.voiceStream = stream;
    this.voiceSourceNode = context.createMediaStreamSource(stream);
    if (!this.voiceAnalyserNode) {
      this.voiceAnalyserNode = context.createAnalyser();
      this.voiceAnalyserNode.fftSize = FFT_SIZE;
      this.voiceAnalyserNode.smoothingTimeConstant = 0;
    }
    this.voiceSourceNode.connect(this.voiceAnalyserNode);
    // Keep the analyser across a release so the calibrated floor survives the
    // player switching apps and back.
    this.voice ??= new VoiceAnalyser({ sampleRate: context.sampleRate });
    const wasReady = this.status.voiceReady;
    this.status = { ...this.status, voiceReady: true };
    if (!wasReady) this.onVoiceReady?.();
    return true;
  }

  /**
   * Stops every microphone track the engine holds.
   *
   * On Android, Chrome treats an open microphone as a call: it takes audio
   * focus, which pauses whatever the player was listening to, and moves a
   * Bluetooth headset from its media profile to the call profile. Both last
   * for as long as a track is live, and a page that is hidden, backgrounded or
   * closed without stopping its tracks can leave the headset stuck there. So
   * the microphone is only held while the game is actually on screen.
   *
   * Stopping the tracks is not always enough: the context's output stream can
   * be reopened as a voice-call stream while the mic is live, and it keeps
   * the headset on the call route after the tracks are gone. So the context
   * is suspended too, which stops its output stream. The exception is tab
   * capture, which is expected to keep feeding the stage while the player
   * looks at the tab they shared.
   */
  releaseMicrophone(): void {
    this.micGeneration += 1;
    // Counts a request still in flight: its stream is stopped on arrival, so
    // it has to be re-requested on the way back.
    const hadVoice = this.wantsVoice;
    this.voiceSourceNode?.disconnect();
    this.voiceSourceNode = null;
    if (this.voiceStream) stopTracks(this.voiceStream);
    this.voiceStream = null;

    const stageOnMic = this.stageAttachment?.descriptor.kind === 'ambient-microphone';
    if (stageOnMic) {
      this.stageAttachment?.detach();
      this.stageAttachment = null;
    }

    if (hadVoice || stageOnMic) {
      this.micReleased = true;
      this.restoreStageMic ||= stageOnMic;
    }

    const context = this.context;
    if (
      context?.state === 'running' &&
      this.stageAttachment?.descriptor.kind !== 'display-capture'
    ) {
      this.contextSuspended = true;
      void context.suspend();
    }
  }

  /** Re-opens whatever `releaseMicrophone` closed. Safe to call when nothing was. */
  async reacquireMicrophone(): Promise<void> {
    const context = this.context;
    if (!context) return;
    if (this.contextSuspended) {
      this.contextSuspended = false;
      await context.resume();
    }
    if (!this.micReleased) return;
    this.micReleased = false;
    const generation = this.micGeneration;

    try {
      if (this.wantsVoice) {
        const stream = await openMicrophone(context);
        if (!this.adoptMicrophone(context, stream, generation)) return;
      }
      if (this.restoreStageMic) {
        const attached = await microphoneSource.attach(context);
        // The player may have picked another source while this was opening.
        if (generation !== this.micGeneration || this.context !== context || this.stageAttachment) {
          attached.detach();
          return;
        }
        this.restoreStageMic = false;
        this.connectStage(attached);
      }
    } catch (error) {
      // Leave it to be retried on the next return to the page.
      if (generation === this.micGeneration) this.micReleased = true;
      throw error;
    }
  }

  /** Loads the worklet once; later source swaps reuse the same node. */
  private async ensureAnalysisNode(context: AudioContext): Promise<void> {
    if (this.stageNode) return;
    await context.audioWorklet.addModule(processorUrl);
    this.stageNode = new AudioWorkletNode(context, 'stage-analysis', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.stageNode.port.onmessage = (event: MessageEvent<AnalysisMessage>): void => {
      const { features, bpm, period, anchor, confidence, stability } = event.data;
      this.stageFeatures = features;
      this.stageBeat = { bpm, period, anchor, confidence, stability };
    };
  }

  private connectStage(attached: AttachedAudioSource): void {
    this.stageAttachment = attached;
    if (this.stageNode) attached.node.connect(this.stageNode);
  }

  /**
   * Swaps the stage source without tearing down the context or the game.
   *
   * The registry picks a source automatically, but its first choice is not
   * always the one the player wants — and declining a share prompt used to
   * leave no way back except a reload.
   */
  async useStageSource(provider: AudioSourceProvider): Promise<AudioSourceProvider> {
    const context = this.context;
    if (!context) throw new Error('Audio has not been started yet.');

    const attached = await provider.attach(context);
    // Only detach the old source once the new one is live, so a failed switch
    // leaves the player with the source they already had.
    this.stageAttachment?.detach();
    await this.ensureAnalysisNode(context);
    this.connectStage(attached);
    this.restoreStageMic = false;
    this.status = { ...this.status, stageSourceLabel: attached.descriptor.label };
    return provider;
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
  async calibrate(seconds = 2, onFrame?: (frame: VoiceFrame) => void): Promise<number> {
    if (!this.voiceAnalyserNode || !this.voice) return -60;

    const samples: number[] = [];
    const deadline = performance.now() + seconds * 1000;
    while (performance.now() < deadline) {
      this.voiceAnalyserNode.getFloatTimeDomainData(this.waveform);
      const frame = this.voice.analyse(this.waveform, this.time);
      const { db } = frame;
      onFrame?.(frame);
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
    this.micGeneration += 1;
    this.micReleased = false;
    this.contextSuspended = false;
    this.wantsVoice = false;
    this.restoreStageMic = false;
    this.voiceSourceNode?.disconnect();
    this.voiceSourceNode = null;
    if (this.voiceStream) stopTracks(this.voiceStream);
    this.voiceStream = null;
    this.voice?.reset();
    this.stageFeatures = SILENT_FEATURES;
    this.stageBeat = SILENT_BEAT;
    await this.context?.close();
    this.context = null;
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
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
