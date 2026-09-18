/**
 * Where the stage-driving audio comes from.
 *
 * No single mechanism reaches every platform (see docs/adr/0003), so the game
 * probes sources in preference order and falls back until one attaches.
 */
export type AudioSourceKind =
  /** Browser tab / system audio via `getDisplayMedia`. Desktop web only. */
  | 'display-capture'
  /** Android `AudioPlaybackCapture` through a native plugin. */
  | 'native-playback'
  /** A file the player picked, or a bundled demo track. */
  | 'file'
  /** The room, heard through the microphone. The universal fallback. */
  | 'ambient-microphone';

export interface AudioSourceDescriptor {
  kind: AudioSourceKind;
  label: string;
  /** Shown when the source is unavailable, so the UI can explain why. */
  unavailableReason?: string;
}

export interface AttachedAudioSource {
  descriptor: AudioSourceDescriptor;
  /** The node the analyser chain taps. Never connected to the destination. */
  node: AudioNode;
  /** Present when the source is a media stream, so tracks can be stopped. */
  stream?: MediaStream;
  detach(): void;
}

export interface AudioSourceProvider {
  readonly descriptor: AudioSourceDescriptor;
  /** Cheap, side-effect free check. Must not prompt for permissions. */
  isSupported(): boolean;
  /** May prompt for permission. Rejects if the player declines. */
  attach(context: AudioContext): Promise<AttachedAudioSource>;
}
