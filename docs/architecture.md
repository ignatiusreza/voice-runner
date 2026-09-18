# Architecture

## The shape of a frame

```
                 ┌──────────────────────────────────────────┐
                 │              AudioContext                │
  music ────────►│  stage analyser ──► FeatureExtractor ──┐ │
  (tab / room)   │                                        │ │
                 │                     BeatTracker ◄──────┘ │
  your voice ───►│  voice analyser ──► VoiceAnalyser ─────┐ │
                 └────────────────────────────────────────┼─┘
                                                          │
   AudioFeatures + BeatEstimate ──► StageDirector          │
                                        │                  │
                                        ▼                  ▼
                                    WorldSlice        VoiceController
                                        │                  │
                                        │                  ▼
                                        │            ActionState ◄── KeyboardInput
                                        ▼                  │
                                     Game.update(dt) ◄──────┘
                                        │
                                        ▼
                                   GameSnapshot ──► Renderer + Hud
```

One `GameLoop` drives the simulation: a fixed 60Hz step with a decoupled render, so the same shout produces the same jump on a 60Hz laptop and a 120Hz phone.

The _stage_ analysis does not run on that loop. It lives in an `AudioWorkletProcessor` on the audio thread, stepping at a fixed block rate whatever the frame rate does — including when the tab is backgrounded and `requestAnimationFrame` stops entirely. Running it from `render()` meant the stage silently stopped reacting to music the moment the tab lost focus, and made every measurement depend on frame timing: one identical clip measured beat lock at 0.14 and 0.42 on consecutive runs. The main thread now only _reads_ the latest analysis. Voice input still samples per frame, which is correct — it only matters while the player is looking at the game.

## Layers

**`core/`** — the fixed-timestep loop, a seeded PRNG, and frame-rate-independent maths. No dependencies on anything.

**`audio/analysis/`** — pure signal processing. Magnitude spectra in, `AudioFeatures` out; onset envelope in, tempo and beat phase out; time-domain samples in, `VoiceFrame` out. Every one of these is a plain class taking numbers, which is why they are the best-tested part of the codebase.

**`audio/sources/`** — the platform-dependent question of _where the music comes from_, behind one `AudioSourceProvider` interface with a preference-ordered fallback chain.

**`audio/engine.ts`** — the only file that touches Web Audio directly. Owns the context, wires both chains, and exposes `sample()`.

**`game/`** — the simulation. Takes features and actions, returns a snapshot. Knows nothing about the DOM, PixiJS or Web Audio, so a full run can be replayed in a test from a recorded feature trace.

**`input/`** — voice and keyboard both produce the same `ActionState`, merged before reaching the simulation. That is not only an accessibility affordance: shouting at a laptop to reproduce a collision bug does not scale.

**`render/`** — PixiJS for the world, DOM for the HUD.

## Why the stage is generated per beat

Terrain is stored as one segment per beat, not per metre. Elevation changes, obstacle placement and colour shifts therefore land on the musical grid _by construction_, rather than being generated freely and snapped afterwards.

The generator works in time rather than distance. For a beat at audio time `t`:

```
x = playerX + runSpeed × (t − now)
```

which is exactly where the player will be when that beat sounds. Segment widths stretch to meet the next beat's position rather than being `speed × period`, because the run speed drifts between frames as the tempo estimate settles — and a sliver of a gap between two segments reads as a hole and drops the player through the floor.

### The lookahead consequence

The world is generated a fixed distance ahead of the player, so the stage reflects music from a second or two ago. This is unavoidable when generating from a live stream instead of a pre-analysed file. In practice it reads as the level _anticipating_ the music rather than lagging it, because obstacles still arrive on the beat — only their shape comes from slightly earlier material. See [ADR 0004](adr/0004-beat-locked-lookahead-generation.md).

## Fairness is enforced, not tuned

Music is not a level designer, so the generator has hard guarantees that hold regardless of what is playing:

- Never more than two loaded beats in a row; a dense passage always leaves a breather.
- Gaps are only cut when the beat is narrow enough to fit inside 60% of the current jump arc. At slow tempi a whole-beat gap can be wider than a jump can carry, so it simply isn't cut.
- Blocks are capped below the ballistic jump height at the current speed.
- Hanging obstacles always leave a slot taller than the ducked player.
- Terrain steps at most 1.2m between adjacent beats.
- The first bar is clear, so the player hears the tempo before having to react.

Each of these has a test asserting it across a range of tempi and intensities.

## Determinism

`Game` plus `StageDirector` are deterministic given a seed and a sequence of `AudioFeatures`. Two runs with the same seed and the same audio produce identical terrain, identical obstacles and identical scores — asserted in `game.test.ts` and `director.test.ts`.

This is what makes the generator testable at all. It also means a run can eventually be shared as a seed plus a feature trace rather than a video.
