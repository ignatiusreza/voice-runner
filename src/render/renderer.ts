import { Application, Container, Graphics } from 'pixi.js';
import { clamp, mapRange } from '../core/math';
import type { GameSnapshot } from '../game/game';
import { jumpAirtime, REFERENCE_JUMP_STRENGTH } from '../game/jump';
import { TUNING } from '../game/tuning';
import type { Palette } from './palette';
import { paletteFor } from './palette';

/** Height of the visible world in metres; width follows the aspect ratio. */
const VIEW_HEIGHT_METRES = 14;
/** Where the ground baseline sits, as a fraction of screen height from the top. */
const HORIZON = 0.72;

/**
 * Draws the world in a flat vector style: solid fills, a single stroke weight,
 * no textures or bitmaps.
 *
 * Everything is redrawn from `Graphics` each frame rather than pooled into
 * sprites. At this shape count that is comfortably within budget on a phone,
 * and it keeps the art resolution-independent, which is the point of the style
 * — the same build has to look right on a 320pt phone and a 4K monitor.
 */
export class Renderer {
  readonly app = new Application();

  private readonly background = new Graphics();
  private readonly farLayer = new Graphics();
  private readonly nearLayer = new Graphics();
  private readonly terrain = new Graphics();
  private readonly obstacles = new Graphics();
  private readonly player = new Graphics();
  private readonly world = new Container();

  private pixelsPerMetre = 40;
  private groundY = 0;
  private reducedMotion = false;
  private visualCues = false;

  /**
   * Suppresses the onset flash and damps the parallax.
   *
   * The flash is the most motion-heavy thing on screen and fires several
   * times a second on busy music, which is exactly what a reduced-motion
   * preference is asking not to see.
   */
  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  /**
   * Draws a marker when an obstacle is one jump away.
   *
   * Voice control excludes some players outright, and playing muted removes the
   * musical cue everyone else gets. This restores a timing cue that does not
   * depend on hearing anything.
   */
  setVisualCues(enabled: boolean): void {
    this.visualCues = enabled;
  }

  async init(canvasParent: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x05050c,
      antialias: true,
      resizeTo: canvasParent,
      // Capping avoids burning a phone's battery rendering at 3x for flat shapes.
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    canvasParent.appendChild(this.app.canvas);

    // The loop drives rendering explicitly, so Pixi's own ticker would only
    // duplicate work at a different cadence.
    this.app.ticker.stop();

    this.world.addChild(this.farLayer, this.nearLayer, this.terrain, this.obstacles, this.player);
    this.app.stage.addChild(this.background, this.world);
    this.handleResize();
    this.app.renderer.on('resize', () => {
      this.handleResize();
    });
  }

  private handleResize(): void {
    const { height } = this.app.renderer;
    this.pixelsPerMetre = height / this.app.renderer.resolution / VIEW_HEIGHT_METRES;
    this.groundY = (height / this.app.renderer.resolution) * HORIZON;
  }

  private get screenWidth(): number {
    return this.app.renderer.width / this.app.renderer.resolution;
  }

  private get screenHeight(): number {
    return this.app.renderer.height / this.app.renderer.resolution;
  }

  /** World metres -> screen pixels, with the camera following the player. */
  private toScreenX(worldX: number, cameraX: number): number {
    return (worldX - cameraX) * this.pixelsPerMetre + TUNING.playerScreenX * this.pixelsPerMetre;
  }

  private toScreenY(worldY: number): number {
    return this.groundY - worldY * this.pixelsPerMetre;
  }

  draw(snapshot: GameSnapshot): void {
    const palette = paletteFor(snapshot.mood);
    const cameraX = snapshot.player.x;

    this.drawBackground(palette, snapshot);
    this.drawParallax(palette, cameraX, snapshot);
    this.drawTerrain(palette, cameraX, snapshot);
    this.drawObstacles(palette, cameraX, snapshot);
    this.drawPlayer(palette, snapshot);

    this.app.renderer.render(this.app.stage);
  }

  private drawBackground(palette: Palette, snapshot: GameSnapshot): void {
    const g = this.background.clear();
    g.rect(0, 0, this.screenWidth, this.screenHeight).fill(palette.sky);
    // A band of lighter sky at the horizon reads as depth without a gradient
    // fill, which would cost a texture upload every time the palette shifts.
    g.rect(
      0,
      this.groundY - this.screenHeight * 0.3,
      this.screenWidth,
      this.screenHeight * 0.3,
    ).fill({ color: palette.skyLow, alpha: 0.55 });

    // The sun swells on every onset. This and the ground edge below are the
    // only things on screen that move at the instant a sound happens — the
    // terrain the player is looking at was generated seconds ago, so it cannot
    // be in time with anything, and the smoothed features are by definition
    // late. A drum hit has to be visible on the frame it lands or the world
    // reads as merely audio-coloured rather than audio-driven.
    const pulse = this.reducedMotion ? 0 : snapshot.mood.pulse;
    const radius = mapRange(snapshot.mood.intensity, 0, 1, 26, 58) * (1 + pulse * 0.45);
    g.circle(this.screenWidth * 0.78, this.groundY - this.screenHeight * 0.42, radius).fill({
      color: palette.groundEdge,
      alpha: 0.22 + pulse * 0.4,
    });

    // A wash across the horizon, so the hit registers even when the sun is off
    // screen on a narrow phone.
    if (pulse > 0.05) {
      g.rect(
        0,
        this.groundY - this.screenHeight * 0.3,
        this.screenWidth,
        this.screenHeight * 0.3,
      ).fill({ color: palette.groundEdge, alpha: pulse * 0.12 });
    }
  }

  private drawParallax(palette: Palette, cameraX: number, snapshot: GameSnapshot): void {
    // Reduced motion keeps the hills but stops them reacting to the music, so
    // the horizon is scenery rather than another moving element.
    const far = this.reducedMotion ? 3 : 5.2;
    const near = this.reducedMotion ? 2 : 3.4;
    this.drawHillBand(this.farLayer, palette.farHills, cameraX * 0.25, 2.6, far, snapshot);
    this.drawHillBand(this.nearLayer, palette.nearHills, cameraX * 0.55, 1.7, near, snapshot);
  }

  /** A deterministic sawtooth ridge; `offset` scrolls it at the layer's rate. */
  private drawHillBand(
    graphics: Graphics,
    color: number,
    offset: number,
    minHeight: number,
    maxHeight: number,
    snapshot: GameSnapshot,
  ): void {
    const g = graphics.clear();
    const spacing = 6;
    const amplitude = minHeight + (maxHeight - minHeight) * clamp(snapshot.mood.weight * 2.4, 0, 1);

    g.moveTo(0, this.screenHeight);
    const first = Math.floor(offset / spacing) - 1;
    const count = Math.ceil(this.screenWidth / (spacing * this.pixelsPerMetre)) + 3;
    for (let i = 0; i <= count; i++) {
      const index = first + i;
      const worldX = index * spacing;
      const screenX = (worldX - offset) * this.pixelsPerMetre;
      // A cheap deterministic hash keeps the skyline stable as it scrolls;
      // anything random per frame would make the hills shimmer.
      const noise = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
      const peak = this.toScreenY(1 + noise * amplitude);
      g.lineTo(screenX, peak);
    }
    g.lineTo(this.screenWidth, this.screenHeight);
    g.closePath().fill(color);
  }

  private drawTerrain(palette: Palette, cameraX: number, snapshot: GameSnapshot): void {
    const g = this.terrain.clear();
    const pulse = this.reducedMotion ? 0 : snapshot.mood.pulse;
    for (const segment of snapshot.world.segments) {
      if (!segment.solid) continue;
      const left = this.toScreenX(segment.x, cameraX);
      const width = segment.width * this.pixelsPerMetre;
      if (left + width < -50 || left > this.screenWidth + 50) continue;

      const top = this.toScreenY(segment.height);
      g.rect(left, top, width + 1, this.screenHeight - top).fill(palette.ground);
      // A bright cap on the walkable surface is the single strongest readability
      // cue in a flat style — it tells the eye exactly where the feet land. It
      // also thickens and brightens on an onset, which puts the beat right
      // where the player is already looking.
      const capHeight = 3 + pulse * 5;
      g.rect(left, top, width + 1, capHeight).fill({
        color: palette.groundEdge,
        alpha: 0.75 + pulse * 0.25,
      });
    }
  }

  private drawObstacles(palette: Palette, cameraX: number, snapshot: GameSnapshot): void {
    const g = this.obstacles.clear();
    for (const obstacle of snapshot.world.obstacles) {
      const ground = groundUnder(snapshot, obstacle.x + obstacle.width / 2);
      const left = this.toScreenX(obstacle.x, cameraX);
      const width = obstacle.width * this.pixelsPerMetre;
      if (left + width < -50 || left > this.screenWidth + 50) continue;

      const bottom = this.toScreenY(ground + obstacle.bottom);
      const height = obstacle.height * this.pixelsPerMetre;
      const top = bottom - height;

      // One-jump-away marker: a timing cue that does not depend on hearing the
      // music, for playing muted or without voice control.
      if (this.visualCues) {
        const distance = obstacle.x - snapshot.player.x;
        const runUp = snapshot.speed * (jumpAirtime(REFERENCE_JUMP_STRENGTH) / 2);
        if (distance > 0 && distance < runUp) {
          const fade = 1 - distance / runUp;
          const markerY = this.toScreenY(ground + obstacle.bottom + obstacle.height) - 14;
          g.moveTo(left + width / 2 - 7, markerY - 9)
            .lineTo(left + width / 2 + 7, markerY - 9)
            .lineTo(left + width / 2, markerY)
            .closePath()
            .fill({ color: palette.playerAccent, alpha: 0.35 + fade * 0.55 });
        }
      }

      if (obstacle.kind === 'hanging') {
        // Drawn as a downward wedge so its silhouette reads differently from a
        // block at a glance; the player has a fraction of a second to decide.
        g.moveTo(left, top)
          .lineTo(left + width, top)
          .lineTo(left + width / 2, bottom)
          .closePath()
          .fill(palette.obstacle)
          .stroke({ width: 2, color: palette.obstacleEdge });
      } else {
        g.rect(left, top, width, height)
          .fill(palette.obstacle)
          .stroke({ width: 2, color: palette.obstacleEdge });
      }
    }
  }

  private drawPlayer(palette: Palette, snapshot: GameSnapshot): void {
    const g = this.player.clear();
    const { player } = snapshot;
    const width = TUNING.playerWidth * this.pixelsPerMetre;
    const height = player.height * this.pixelsPerMetre;
    const centreX = TUNING.playerScreenX * this.pixelsPerMetre;
    const bottom = this.toScreenY(player.y);

    g.roundRect(centreX - width / 2, bottom - height, width, height, width * 0.35)
      .fill(palette.player)
      .stroke({ width: 2, color: palette.ink });

    // The accent bar is the "mouth": it widens with how loudly the player is
    // shouting, so the control input is visible on the character itself.
    const mouthWidth = width * (0.3 + 0.5 * clamp(snapshot.mood.intensity * 2, 0, 1));
    g.roundRect(
      centreX - mouthWidth / 2,
      bottom - height * 0.62,
      mouthWidth,
      height * 0.12,
      3,
    ).fill(palette.playerAccent);
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}

function groundUnder(snapshot: GameSnapshot, x: number): number {
  for (const segment of snapshot.world.segments) {
    if (x >= segment.x && x < segment.x + segment.width) return segment.solid ? segment.height : 0;
  }
  return 0;
}
