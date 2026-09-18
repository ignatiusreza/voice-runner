/**
 * The `AudioWorkletGlobalScope` API, which the DOM lib does not describe.
 *
 * Only the members the stage analysis processor uses are declared; these exist
 * on the audio thread, not the main thread.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

/** Sample rate of the context the worklet belongs to. */
declare const sampleRate: number;

/** The audio thread's clock, shared with `AudioContext.currentTime`. */
declare const currentTime: number;
