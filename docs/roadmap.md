# Roadmap

What exists today is a complete vertical slice: audio in, stage out, voice control, collision, scoring, death, restart. The list below is what it is not yet.

## Next

**Android playback capture plugin.** The one piece of the premise that the web platform cannot deliver. `nativePlaybackSource` is a probe-shaped stub; the Capacitor plugin behind it needs a `MediaProjection` consent flow, an `AudioPlaybackCaptureConfiguration`, and a bridge from the native record buffer into the webview's `AudioContext`. Expect the bridge to be the hard part.

**iOS audio session category.** Must allow recording while other audio plays, or opening the mic ducks the player's music — precisely what the game needs to hear. `AVAudioSession` with `.playAndRecord` and `.mixWithOthers`.

## Soon

**More onset-driven reaction.** Onsets now swell the sun, wash the horizon and thicken the ground edge on the frame they land — the only channel that can be exactly in time, since terrain is generated seconds ahead and the smoothed features are late by construction. Screen shake, particle bursts and an obstacle that flashes as it passes are the obvious next additions.

**Obstacles are still placed by a weighted coin flip.** `rng.chance(density)` decides whether a beat carries one, so no specific obstacle corresponds to a specific sound. Tying the choice to onset strength is the natural fix, but it runs into the lookahead: a beat is generated 2.4-4s before the player reaches it, and a live stream cannot be read ahead, so the onset that would justify the obstacle has not happened yet. Options are a shorter lookahead (less warning, tighter correspondence) or holding a bank of obstacle "slots" that a later onset fills in as it scrolls.

**Tuning against real music.** `TUNING` was set analytically, not by playing. The fairness guarantees hold, but whether a run _feels_ good across genres is unknown. The `file` source exists to make this measurable: same track, same seed, compare.

**Tempo re-lock on a track change.** The tracker adapts continuously, but a hard cut between songs at very different tempi takes several seconds to settle. Detecting the discontinuity and resetting the envelope would be faster than waiting for the window to roll over.

## Later

**Character and world art.** The vector style is structural — flat fills, one stroke weight, a palette derived from spectral brightness — but the character is a rounded rectangle. The palette system is the part worth keeping.

**Accessibility, continued.** Keyboard and touch are first-class, the voice trigger is adjustable, reduced motion suppresses the flash and damps the parallax, and an optional marker warns when an obstacle is one jump away. Still missing: a screen-reader description of the run, remappable keys, and a colour-blind check on the obstacle/terrain contrast, which is currently guaranteed only by hue opposition.

**Strip source maps from native builds.** `cap sync` copies `dist/` wholesale into the APK, so the 2.2MB of `.map` files Vite emits ship inside it — about half the 4.8MB debug APK, and they publish the original source. Fine for a debug build, not for a store release: either drop `build.sourcemap` for native builds or delete the maps between `vite build` and `cap copy`.

**Tempo tracking is still the weakest link.** The tracker carries multiple tempo hypotheses now, which stopped it flip-flopping between a tempo and its double — mean BPM over a fixed clip went from 8.3% apart between identical runs to 3.8%. It is not solved: on sparse material confidence sits near 0.10 and two readings stay contested for long stretches. Scoring hypotheses against predicted onset _positions_ rather than only autocorrelation peaks is the next step, since a hypothesis that predicts where the next beat lands is testable in a way a correlation peak is not.

**Beat detection on difficult material.** Generation now locks tightly to the beat _when the beat is known_ — 0.88 against a known tempo. On real music the tracker is the weak link: confidence averages around 0.40 and the tempo estimate still reports octave errors on sparse or rubato passages, which caps end-to-end sync near 0.71. Better onset detection and a proper tempo-hypothesis tracker are the next lever, not more generator tuning.

Measurement used to be the obstacle and no longer is: `?record` captures a clip and `?replay` feeds it back, and with the analysis on the audio thread two runs over the same clip now agree to within a percent. That is what makes the work above tractable.

## Known deferred decisions

**TypeScript 7.** Stable since before this scaffold, but `typescript-eslint` still declares `typescript <6.1.0`, so adopting it means losing type-aware linting. Pinned at 6.0.3 until typescript-eslint ships support; revisit then.

**Renderer strategy.** Every shape is redrawn per frame. Fine at the current count, and worth revisiting only if a real device shows it in a profile — not before.
