export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Maps `value` from [inMin, inMax] onto [outMin, outMax], clamped at both ends. */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, t);
}

/**
 * Frame-rate independent exponential smoothing. `halfLife` is the time in
 * seconds for the value to close half the distance to its target, which stays
 * meaningful when `dt` jitters — a raw per-frame alpha does not.
 */
export function smoothTowards(
  current: number,
  target: number,
  halfLife: number,
  dt: number,
): number {
  if (halfLife <= 0) return target;
  const t = 1 - Math.pow(0.5, dt / halfLife);
  return current + (target - current) * t;
}

export function amplitudeToDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(amplitude, 1e-7));
}

export function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20);
}
