import { clamp, lerp } from '../core/math';
import type { StageMood } from '../game/director';

export interface Palette {
  sky: number;
  skyLow: number;
  farHills: number;
  nearHills: number;
  ground: number;
  groundEdge: number;
  obstacle: number;
  obstacleEdge: number;
  player: number;
  playerAccent: number;
  ink: number;
}

/**
 * The stage's colour is the music's colour.
 *
 * Hue follows spectral brightness — dark, bass-heavy passages sit in deep blues
 * and violets, bright ones swing to warm ambers. Saturation and lightness
 * follow loudness, so a quiet passage literally drains colour out of the world.
 *
 * Everything is derived from one hue so the scene always reads as one picture,
 * which is what the flat vector style depends on.
 */
export function paletteFor(mood: StageMood): Palette {
  // 250deg (indigo) through 40deg (amber), the long way round the warm side.
  // Mood arrives already scaled to 0..1 by the director, so it is used
  // directly — the old multipliers were compensating for a feature that never
  // got near its assumed range.
  const hue = lerp(250, 400, clamp(mood.brightness, 0, 1)) % 360;
  const energy = clamp(mood.intensity, 0, 1);
  const saturation = lerp(0.22, 0.72, energy);

  return {
    sky: hsl(hue, saturation * 0.7, lerp(0.1, 0.22, energy)),
    skyLow: hsl((hue + 25) % 360, saturation * 0.8, lerp(0.16, 0.34, energy)),
    farHills: hsl((hue + 10) % 360, saturation * 0.5, lerp(0.14, 0.24, energy)),
    nearHills: hsl((hue + 18) % 360, saturation * 0.6, lerp(0.1, 0.18, energy)),
    ground: hsl((hue + 200) % 360, saturation * 0.45, lerp(0.16, 0.27, energy)),
    groundEdge: hsl((hue + 190) % 360, saturation, lerp(0.45, 0.7, energy)),
    // The obstacle hue is pushed opposite the stage hue: hazards must stay
    // legible however the palette drifts, so contrast is structural, not tuned.
    obstacle: hsl((hue + 180) % 360, lerp(0.4, 0.85, energy), 0.52),
    obstacleEdge: hsl((hue + 180) % 360, lerp(0.5, 0.95, energy), 0.74),
    player: 0xfdfdfd,
    playerAccent: hsl((hue + 150) % 360, 0.85, 0.62),
    ink: 0x0a0a12,
  };
}

/** HSL with h in degrees and s/l in 0..1, packed as 0xRRGGBB for Pixi. */
export function hsl(h: number, s: number, l: number): number {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = rgbFromSector(hp, chroma, x);
  const m = l - chroma / 2;
  return (
    (Math.round(clamp(r + m, 0, 1) * 255) << 16) |
    (Math.round(clamp(g + m, 0, 1) * 255) << 8) |
    Math.round(clamp(b + m, 0, 1) * 255)
  );
}

function rgbFromSector(hp: number, c: number, x: number): [number, number, number] {
  if (hp < 1) return [c, x, 0];
  if (hp < 2) return [x, c, 0];
  if (hp < 3) return [0, c, x];
  if (hp < 4) return [0, x, c];
  if (hp < 5) return [x, 0, c];
  return [c, 0, x];
}
