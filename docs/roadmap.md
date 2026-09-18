# Roadmap

What exists today is a complete vertical slice: audio in, stage out, voice control, collision, scoring, death, restart. The list below is what it is not yet.

## Next

**Android playback capture plugin.** The one piece of the premise that the web platform cannot deliver. `nativePlaybackSource` is a probe-shaped stub; the Capacitor plugin behind it needs a `MediaProjection` consent flow, an `AudioPlaybackCaptureConfiguration`, and a bridge from the native record buffer into the webview's `AudioContext`. Expect the bridge to be the hard part.

**iOS audio session category.** Must allow recording while other audio plays, or opening the mic ducks the player's music — precisely what the game needs to hear. `AVAudioSession` with `.playAndRecord` and `.mixWithOthers`.

**Audio source picker.** The registry already probes and falls back; the player currently has no way to override it or to retry after declining a prompt. Needs the UI plus a `file` source entry for picking a local track.

**Handle an unanswered permission prompt.** If the player neither allows nor blocks the microphone, `getUserMedia` stays pending and the start button sits on "Starting…" forever. `?demo` sidesteps it, but the real path needs a timeout that falls through to keyboard controls with an explanation.

**Calibration UX.** Two seconds of room measurement happens silently behind the start button. It should be a visible "say something" step with live feedback, so the player learns what the meter means before it matters.

## Soon

**Persistent scores.** Local best per day-seed, then a shared board keyed on the seed so a given day's stage is comparable.

**Audio-reactive effects.** Onsets are detected and currently only place obstacles. They could also drive screen shake, a flash on the ground edge, and particle bursts — cheap in a flat vector style and a large gain in how musical the game feels.

**Tuning against real music.** `TUNING` was set analytically, not by playing. The fairness guarantees hold, but whether a run _feels_ good across genres is unknown. The `file` source exists to make this measurable: same track, same seed, compare.

**Tempo re-lock on a track change.** The tracker adapts continuously, but a hard cut between songs at very different tempi takes several seconds to settle. Detecting the discontinuity and resetting the envelope would be faster than waiting for the window to roll over.

## Later

**Difficulty ramp.** Density scales with loudness but not with elapsed distance, so a long quiet track never gets harder.

**Character and world art.** The vector style is structural — flat fills, one stroke weight, a palette derived from spectral brightness — but the character is a rounded rectangle. The palette system is the part worth keeping.

**Accessibility.** Voice control excludes some players by construction, which is why keyboard and touch are first-class rather than a debug affordance. Beyond that: a visual-only mode, adjustable trigger thresholds, and reduced-motion handling for the parallax.

**Strip source maps from native builds.** `cap sync` copies `dist/` wholesale into the APK, so the 2.2MB of `.map` files Vite emits ship inside it — about half the 4.8MB debug APK, and they publish the original source. Fine for a debug build, not for a store release: either drop `build.sourcemap` for native builds or delete the maps between `vite build` and `cap copy`.

**Beat detection on difficult material.** Generation now locks tightly to the beat _when the beat is known_ — 0.88 against a known tempo. On real music the tracker is the weak link: confidence averages around 0.40 and the tempo estimate still reports octave errors on sparse or rubato passages, which caps end-to-end sync near 0.71. Better onset detection (per-band flux with adaptive thresholds) and a proper tempo-hypothesis tracker are the next lever, not more generator tuning.

## Known deferred decisions

**TypeScript 7.** Stable since before this scaffold, but `typescript-eslint` still declares `typescript <6.1.0`, so adopting it means losing type-aware linting. Pinned at 6.0.3 until typescript-eslint ships support; revisit then.

**Renderer strategy.** Every shape is redrawn per frame. Fine at the current count, and worth revisiting only if a real device shows it in a profile — not before.
