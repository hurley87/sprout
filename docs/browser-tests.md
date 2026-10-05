# Browser test suites

`npm run test:browser` selects only the `browser` project. It covers the existing
lesson smoke tests and local WebRTC/Web Audio transport tests. Files under
`tests/browser/live/` are excluded, even when passed as a file filter. The server
starts with empty `OPENAI_API_KEY` and `TYPESAFE_API_KEY` overrides, so these tests
cannot use configured provider credentials. Existing local transport peers and
route mocks remain provider-free.

The separate `lesson-live` project is enabled only by deliberately selecting
`playwright.live.config.ts`, normally through `npm run test:browser:live`. It
discovers only `tests/browser/live/**/*.spec.ts` and cannot select normal browser
tests. It contains 14 cases: three complete-lesson baselines, six support cases,
and five butterfly cancellation regressions. See [live scenario scope and assertions](../tests/browser/live/README.md)
for their evidence contracts, fixture limitations and pending live validation.

## Live configuration and cost

Supply server-only `OPENAI_API_KEY` (GPT-Live access) and `TYPESAFE_API_KEY` (Jev
access) in the environment invoking Playwright, using your usual secure credential
setup. The live config checks for nonempty values before starting a server and
reports only missing variable names. It does not load `.env.local`; credentials
configured only in that file do not satisfy this check. Never put secrets in
commands, test fixtures, documentation, or `NEXT_PUBLIC_*` variables.

Live scenarios may make **billed GPT-Live and Jev calls**. Select a small
scenario or tagged subset first; the full live suite is an explicit opt-in. It
runs with one worker, no automatic retries, a two-minute timeout per test,
15-second assertion waits, and a ten-minute total run limit. Server startup is
bounded to two minutes. Do not add the live command to normal CI by default.

Both suites start a fresh local server on port 3100 and refuse to reuse an
existing server. Stop any server on that port before running tests. Run the suites
sequentially.

## Selection commands

Baseline cases share `@baseline`; support cases share `@support`; butterfly cases
share `@butterfly` and distinct audio/timing tags.

```bash
# Normal provider-free browser tests
npm run test:browser

# Discover live tests without starting a server or contacting providers
# (the invoking environment must still contain both configuration names)
npm run test:browser:live -- --list

# One scenario by file and distinctive test title
npm run test:browser:live -- scenarios.spec.ts --grep '@happy-path'

# A named subset by Playwright tag
npm run test:browser:live -- --grep '@baseline'

# All implemented live scenarios (may incur provider costs)
npm run test:browser:live
```

`--list` performs discovery only. Test modules must not initiate provider calls
during import. Missing credentials, an unknown project, or an unmatched file/title
filter should fail visibly; do not use `--pass-with-no-tests` to disguise absent
coverage.

## Controllable synthetic microphone

`tests/helpers/synthetic-microphone.ts` extends the existing transport fixture's
`getUserMedia` replacement. Install it **before navigation and before starting a
lesson**. Each document gets an audio-only replacement returning a fresh clone of
a `MediaStreamAudioDestinationNode` stream. The original destination stays alive
when the application stops a capture track. A continuous zero-valued
`ConstantSourceNode` supplies real silent audio frames between speech/noise
playback. An unconnected destination can expose a live track while sending no
WebRTC audio packets; that stalls the provider timeline and can leave steering
acknowledgments pending. Silence keeps the audio clock and microphone track alive.

```ts
const microphone = await installSyntheticMicrophone(page);
await page.goto("/");
await microphone.loadSpeech("counting"); // Decode committed PCM in the browser.
await page.getByRole("button", { name: "Start lesson", exact: true }).click();
const speech = await microphone.playSpeech("counting");
await microphone.waitForPlayback(speech.id); // "ended" or "cancelled"
const burst = await microphone.noise({ seed: 30, durationMs: 40, amplitude: 0.2 });
await microphone.waitForPlayback(burst.id);
await microphone.silence(); // Cancel any active source; keep delivering silence.
// In finally/afterEach: close the app transport, then await microphone.dispose().
```

This usage illustrates the low-level API, not a provider-free lesson scenario.
Starting an actual lesson requires the explicit live configuration described
above. The provider-free tests instead reuse the local transport fixture.

A capture-phase click listener creates/resumes the helper's AudioContext during
the trusted Start gesture, before the application's handler. Playback fails
visibly if the context is still suspended. For a custom start control, the
browser-side `window.syntheticMicrophone.resume()` can also be called from its
trusted gesture handler. Do not resume from an arbitrary evaluation and assume
that autoplay permissions are available. Fixture decoding can happen before the
click; playback cannot.

Speech/noise uses native `AudioBufferSourceNode.start()` and `onended`, at browser
audio-clock speed. Starting another source cancels the previous one; `cancel()`
stops/disconnects it and resolves its completion as `cancelled`. Noise uses a
seeded uint32 LCG at the context sample rate (same seed/options/sample rate yields
identical samples), with duration limited to 1,000 ms and amplitude in [0, 1].
`state()` reports context, source, capture track, and disposal state. `dispose()`
is idempotent: it cancels playback, stops original/capture tracks and the silent
source, disconnects the destination, closes the context, clears decoded buffers, removes the click
listener, and restores `getUserMedia`. Close the application's transport too:
it owns additional track clones, detector contexts, and peer connections.
Completion results remain available until document destruction. Navigation
creates a fresh controller; playback IDs apply only to their document.

The small initial speech set is in `tests/fixtures/speech/manifest.json`, which
records exact text, SHA-256, format, and offline generation commands. The WAV was
generated with the locally installed macOS Albert synthesizer and FFmpeg; no
child recording or provider service was used. Tests check its checksum, read the
committed file, and decode it in Chromium. Neither macOS TTS nor FFmpeg is needed
to run tests. Regeneration can differ across tool/voice versions; the committed
bytes define reproducibility, not a future voice installation.

The transport tests verify real initial silence, speech energy reaching the
production `MicrophoneTurnDetector`, confirmed onset and quiet completion, short
noise activity/discard, repeatable noise samples, cancellation followed by quiet,
and track/context teardown. A local-peer regression also verifies advancing
WebRTC sample duration and outgoing packet counts during idle silence before
speech and after cancellation. They retain real local WebRTC tutor output and do
not inject transcripts or VAD events. Detector scheduling and stream resampling
are browser-dependent: audio samples are deterministic, event timestamps are
not. These tests validate audio plumbing and current energy-based detection,
not recognition accuracy, GPT-Live/Jev behavior, child voice realism, acoustic
room noise, device processing, or lesson progression. Live scenarios reuse the read-only observation bridge and child helper;
[acceptance and pending provider coverage](issue-30-harness-acceptance.md) remain
explicit.
