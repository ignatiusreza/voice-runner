# 3. Capture strategy: a fallback chain ending at the room

Date: 2026-09-18

## Status

Accepted

## Context

The premise is that stages are built from "the song playing in Spotify, a podcast player, YouTube". Actually getting at that audio is the single hardest constraint in the project, and it differs on every platform:

| Platform       | Can the game hear another app's audio?                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop web    | Yes — `getDisplayMedia({ audio: true })`, user picks a tab or the screen                                                               |
| Mobile web     | No — mobile browsers do not implement the audio half of display capture                                                                |
| Android native | Sometimes — `AudioPlaybackCapture` (API 29+), but apps can opt out with `allowAudioPlaybackCapture="false"`, and several music apps do |
| iOS native     | No — there is no public system-audio capture API at all                                                                                |

So there is no mechanism that works everywhere, and on the most important target (iOS) there is no direct mechanism at all. Designing around any single one of them would make the game not work for most players.

An obvious alternative — integrate the Spotify/YouTube SDKs and read their playback metadata — was rejected. It requires per-service auth, restricts the game to services that have been integrated, gives no access to the actual waveform (only metadata like tempo, and only for some services), and fails entirely for "a podcast" or "the radio in the kitchen".

## Decision

Define one `AudioSourceProvider` interface and probe providers in preference order, falling back until one attaches:

1. `native-playback` — Android `AudioPlaybackCapture` (plugin not yet built)
2. `display-capture` — desktop web tab/system audio
3. `ambient-microphone` — the room, heard through the microphone

The microphone fallback is the one that always works, on every platform, for every audio source, with no integration. It is worse fidelity, and it means the mic hears the music _and_ the player at once — which is a solvable problem, and is solved in `VoiceAnalyser` by tracking the background level asymmetrically rather than by trying to separate the sources.

A `file` provider also exists for a track the player supplies. It is the only source that behaves identically everywhere, which makes it the right one for tuning the generator and for automated runs.

Failures are collected rather than thrown: a declined permission prompt is a normal outcome, and the game stays playable on the next source down.

## Consequences

The game works on every target, with quality degrading rather than features disappearing. iOS gets the ambient path, which is exactly the "play music out loud and shout over it" experience the game is anyway built around.

The cost is that the ambient path couples the two chains: loud music raises the voice analyser's floor, so the player has to be louder to trigger a jump. That is the correct behaviour — it is also how it works in a noisy room in real life — but it does mean the trigger threshold is relative, never absolute, and the HUD has to show dB _above background_ rather than absolute level or players cannot tell why a shout did not register.

Android playback capture remains unimplemented; `nativePlaybackSource` exists as a probe-shaped stub so the registry, the picker UI and these notes already have the right shape when the plugin lands.
