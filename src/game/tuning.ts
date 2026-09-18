/**
 * Every gameplay constant, in one place and in real units.
 *
 * World units are metres and seconds; the renderer scales them to pixels. That
 * keeps physics readable and makes the numbers portable across screen sizes,
 * which matters when the same build runs on a phone and a desktop browser.
 */
export const TUNING = {
  /** Metres per second at 120 BPM. Scroll speed tracks tempo from here. */
  baseRunSpeed: 11,
  minRunSpeed: 7,
  maxRunSpeed: 20,

  gravity: -42,
  /** Upward velocity of a full-strength jump, before strength scaling. */
  jumpVelocity: 15,
  /** A weak shout still gets this fraction of a full jump. */
  minJumpFraction: 0.45,
  /** How long a sustained note can keep adding lift after take-off. */
  maxSustainSeconds: 0.32,
  /** Upward acceleration while sustaining. Gentle — it is a glide, not a jetpack. */
  sustainAcceleration: 26,
  /** Gravity multiplier once the player stops sustaining. Snappier fall. */
  fallGravityMultiplier: 1.6,
  /** Jumps registered this long before landing still fire on touchdown. */
  jumpBufferSeconds: 0.12,
  /** Jumps still allowed this long after walking off an edge. */
  coyoteSeconds: 0.1,

  playerWidth: 0.9,
  playerHeight: 1.6,
  duckHeight: 0.8,
  /** How far from the left edge the player runs, in metres. */
  playerScreenX: 6,

  /** Horizontal extent of the visible world. Drives how far ahead to generate. */
  viewWidth: 32,
  /** Generate this many metres past the right edge so nothing pops in. */
  generationMargin: 24,

  /** Ground elevation range, in metres above the baseline. */
  minGroundHeight: 0,
  maxGroundHeight: 3.5,

  scorePerMetre: 1,
  scorePerObstacleCleared: 25,
} as const;
