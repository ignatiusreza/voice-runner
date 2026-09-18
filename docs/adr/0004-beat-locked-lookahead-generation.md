# 4. Beat-locked generation with a time-based lookahead

Date: 2026-09-18

## Status

Accepted

## Context

The stage is generated from live audio, but it has to be generated _ahead_ of the player — roughly 50 metres, so nothing pops into view. At 11 m/s that is about four and a half seconds of world.

Live audio cannot be read four seconds early. So whatever the generator places at the right edge of the screen must be shaped by music that is playing _now_, and the player will reach it several seconds later. There are three ways to handle this:

**Delay the audio.** Buffer the music, analyse it, and play it back a few seconds late so the level and the sound line up exactly. Correct, and impossible for the two main cases: display-capture and ambient mic are both things the player is already hearing live. Delaying our copy does not delay theirs.

**Accept the offset and place obstacles freely.** Simple, but it throws away the thing that makes an audio-reactive runner feel good. Obstacles that merely correlate loosely with the music read as noise.

**Accept the offset, but lock placement to the predicted beat grid.** The tempo is estimated and the beat phase tracked, so future beat times are known even though future _audio_ is not. Place each beat's segment at the world position the player will occupy when that beat sounds.

## Decision

The third. For a beat at audio time `t`:

```
x = playerX + runSpeed × (t − now)
```

Generation advances a `nextBeatTime` cursor by the current beat period, never rewinding it, so a tempo re-estimate changes only future spacing rather than retroactively shifting placed terrain.

Segment widths are derived from the distance to the _next_ beat's position, not from `speed × period`. The run speed drifts frame to frame as the tempo estimate settles, and computing width independently of position lets a sliver of gap open between consecutive segments — which `groundHeightAt` reports as a hole, dropping the player through the floor. Deriving width from the two positions makes contiguity exact by construction.

Tempo estimation weights the autocorrelation by a log-normal prior around 120 BPM, and uses the biased estimator. Without both, a periodic signal correlates just as well at twice its true period and the tracker reports half tempo — which it did, until a test caught it.

## Consequences

Obstacles arrive under the player _on the beat_, which is what makes a run feel choreographed. The stage's shape reflects music from one or two seconds earlier, which reads as anticipation rather than lag.

When the tempo estimate is poor — speech, ambient noise, an arrhythmic podcast — confidence drops, the run speed stops following the estimate, and the grid degrades to a steady 120 BPM. The game becomes a plain runner rather than a broken one.

Run speed is coupled to tempo, which means generation and simulation are coupled: tests that exercise the director must move the player at the speed the director itself chose, or they test a configuration that cannot occur.
