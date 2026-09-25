# Voice Runner

A voice-controlled side-scrolling endless runner whose stages are generated from whatever audio is playing around you — a song on Spotify, a podcast, a YouTube video, or just the room.

**Shout to jump. Hold the note to glide. Growl low to slide.**

Runs on the web, Android and iOS from one codebase.

## How it works

Two audio chains run side by side off a single `AudioContext`:

| Chain   | Source                        | Feeds                              |
| ------- | ----------------------------- | ---------------------------------- |
| Stage   | The music you're listening to | Tempo, terrain, obstacles, palette |
| Control | Your microphone               | Jump, glide, slide                 |

The stage chain extracts loudness, per-band energy, spectral brightness and onset flux, tracks the tempo, and lays the level down **one beat at a time**. A beat landing at audio time `t` is placed at the world position the player will occupy at `t`, so obstacles arrive under your feet on the beat rather than merely near it.

The control chain solves the awkward part: the microphone hears the music _and_ you. Rather than separating the sources, it tracks the background level asymmetrically — rising slowly, falling fast — and reacts to how far a sound rises _above_ that background. Music raises the floor over seconds; a shout spikes over it in milliseconds. Pitch then picks between jumping and sliding.

Full detail in [docs/architecture.md](docs/architecture.md) and the [ADRs](docs/adr/).

## Getting started

Requires Node 22.12 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The microphone needs a secure context, so use `localhost` rather than a LAN IP.

On desktop, pick **Tab or system audio** when prompted and tick "share tab audio" to feed the game the actual music. On mobile, play the music out loud and let the microphone hear the room.

No microphone? The game still runs — Space jumps, Down slides. If you never answer the permission prompt it starts without it after a few seconds, and wires the microphone in later if you do allow it.

The start panel also carries an **Audio source** picker — switch between tab audio, the room, a local file or the demo track at any time, including after declining a prompt — and **Settings** for voice sensitivity, reduced motion, and an optional marker showing when an obstacle is one jump away.

To see it working with no permissions at all, open `http://localhost:5173/?demo` (or `?demo=140` for a tempo). That drives the stage from a generated click track and skips the microphone entirely — useful for a quick look, and for tuning the generator against a known tempo.

## Commands

| Command                 | What it does                                         |
| ----------------------- | ---------------------------------------------------- |
| `npm run dev`           | Dev server with hot reload                           |
| `npm run build`         | Typecheck, then a production bundle into `dist/`     |
| `npm test`              | Unit tests                                           |
| `npm run test:coverage` | Tests with coverage gates                            |
| `npm run lint`          | ESLint, type-aware                                   |
| `npm run format`        | Prettier                                             |
| `npm run cap:sync`      | Build and push the web bundle into the native shells |

## Mobile builds

The native projects are generated rather than committed, so create them once per checkout:

```bash
npm run build
npm run cap:add:android   # needs Android Studio + JDK 21
npm run cap:add:ios       # needs Xcode, macOS only
npm run cap:sync
npm run cap:open:android  # or cap:open:ios
```

Microphone permission strings and the platform-by-platform audio capture story are in [docs/platforms.md](docs/platforms.md) — read it before the first native build, because the permission entries have to be added by hand after `cap add`.

## Project layout

```
src/
  audio/
    analysis/   Feature extraction, beat tracking, voice analysis — pure, tested
    sources/    Where stage audio comes from, per platform, with fallback
    engine.ts   Owns the AudioContext and both analysis chains
  core/         Fixed-timestep loop, seeded RNG, maths
  game/         Simulation: director, player, collision, world. No DOM, no Pixi
  input/        Voice and keyboard, both producing the same ActionState
  render/       PixiJS vector renderer and the DOM HUD
  platform/     Runtime capability detection
```

The `game/`, `core/`, `input/` and `audio/analysis/` layers know nothing about the DOM, PixiJS or Web Audio. They are fed features and actions and hand back a snapshot, which is what lets a whole run be replayed deterministically in a unit test.

## Status

Early, but playable end to end: audio in, stage out, voice control, scoring, death and restart.

What is not built yet — Android system-audio capture, a track picker, persistent scores, audio-reactive effects — is tracked in [docs/roadmap.md](docs/roadmap.md).
