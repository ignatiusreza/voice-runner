/**
 * Runtime feature detection for the APIs the game depends on.
 *
 * The DOM lib types `navigator.mediaDevices` as always present, but it is
 * genuinely absent on an insecure origin — which is exactly the case this game
 * hits when someone opens it over plain HTTP on a phone. Narrowing through
 * `Partial<Navigator>` keeps the checks truthful instead of asserting the
 * optimistic type away.
 */
function mediaDevices(): MediaDevices | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Partial<Navigator>).mediaDevices;
}

export function hasMicrophoneApi(): boolean {
  return typeof mediaDevices()?.getUserMedia === 'function';
}

export function hasDisplayCaptureApi(): boolean {
  return typeof mediaDevices()?.getDisplayMedia === 'function';
}

/** True in a secure context, where microphone access is permitted at all. */
export function isSecureContext(): boolean {
  return typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : false;
}

export interface PlatformSummary {
  microphone: boolean;
  displayCapture: boolean;
  secureContext: boolean;
}

export function describePlatform(): PlatformSummary {
  return {
    microphone: hasMicrophoneApi(),
    displayCapture: hasDisplayCaptureApi(),
    secureContext: isSecureContext(),
  };
}
