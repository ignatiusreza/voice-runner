# Platform notes

## What each target can actually hear

|                     | Microphone | Another app's audio    | Notes                                                                    |
| ------------------- | ---------- | ---------------------- | ------------------------------------------------------------------------ |
| Desktop web         | Yes        | Yes, `getDisplayMedia` | Player picks a tab or screen and ticks "share audio"                     |
| Mobile web          | Yes        | No                     | Mobile browsers implement display capture without audio                  |
| Android (Capacitor) | Yes        | Sometimes              | `AudioPlaybackCapture`, API 29+, apps can opt out — plugin not yet built |
| iOS (Capacitor)     | Yes        | No                     | No public system-audio capture API exists                                |

The fallback chain in `src/audio/sources/registry.ts` handles all of this; see [ADR 0003](adr/0003-audio-capture-strategy.md). In practice mobile players use the ambient path: play the music out loud, shout over it.

## Android Chrome: the microphone is a call

Chrome on Android treats an open microphone as a voice call. While any mic track is live it takes audio focus, so a podcast or music app playing alongside is paused, and a Bluetooth headset is moved from its media profile (A2DP) to its call profile (HFP/SCO) — low-quality mono, with the mic in the headset rather than the phone. None of this is controllable from a web page; turning off `echoCancellation` does not avoid it.

What the game can control is how long it holds the mic. `AudioEngine.releaseMicrophone()` stops every mic track when the page is hidden (`visibilitychange`) or closed (`pagehide`), and `reacquireMicrophone()` re-opens it on return, keeping the calibrated voice floor. A page that went away still holding a track could leave the headset stuck in the call profile even after the browser was closed; if that happens, turning Bluetooth off and on (or reconnecting the headset) restores media audio.

The practical consequence for mobile web: the ambient path needs the music playing out loud through the phone speaker or another device. Music in Bluetooth headphones can't reach the mic anyway, and the other app is paused regardless. Playback capture in the native Android build is the only way around this.

## Secure context

`getUserMedia` requires HTTPS or `localhost`. Opening the dev server on a LAN IP from a phone will fail with no microphone — `capabilities.ts` detects this and the start screen says so rather than reporting a generic error. For device testing, use a tunnel or `adb reverse tcp:5173 tcp:5173`.

Capacitor serves from `https://localhost` on Android and `capacitor://localhost` on iOS, both of which are secure contexts, so native builds are unaffected.

## Android

After `npm run cap:add:android`, add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

`android/` is gitignored, so this has to be re-applied whenever the project is regenerated. That is a deliberate trade — committing generated native projects makes Capacitor upgrades painful — but it is the step most likely to be forgotten.

Requires JDK 21 and Android Studio. Minimum SDK 23 (Capacitor 8's default); playback capture, when built, will need API 29+ with a runtime fallback below that.

## iOS

After `npm run cap:add:ios`, add to `ios/App/App/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Voice Runner uses the microphone to hear your voice as controls and the music around you to build the stage.</string>
```

App Store review rejects microphone permission strings that do not explain the use concretely, so keep this specific.

Requires Xcode and macOS. iOS 14+.

The audio session needs to allow recording while other audio plays, or starting the mic will duck or stop the player's music — the exact thing the game depends on hearing. This is not yet configured; see the roadmap.

## Performance

The renderer redraws every shape each frame rather than pooling sprites. At the current shape count (a few hundred `Graphics` primitives) that is comfortably inside a phone's frame budget, and it keeps the art resolution-independent. If the count grows substantially, the terrain and parallax layers are the ones to convert to cached geometry.

Device pixel ratio is capped at 2. Flat vector shapes gain nothing visible at 3x and it costs a large fraction of the fill rate on a high-DPI phone.
