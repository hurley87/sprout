# Grok counting: connection slice (commit 1)

Open `/experiments/grok-counting` on local Sprout, set `XAI_API_KEY` in the server's ignored `.env.local`, restart the server if needed, and press Start. Use headphones and adult or synthetic inputs only. Stop ends the attempt; Start creates a fresh conversation. No reconnect/resumption, observer, tools, progression, mastery awards, persistence, or exports are implemented.

The experiment imports the existing Counting lesson (one duck, two ducks, three butterflies), persona and teaching guidance. Its displayed node and tutor context remain `count-1-duck`. The small emoji scene follows the existing root presentation without extracting or changing shared UI. The root lesson and Catching Unicorns are untouched.

## Protocol established from official documentation

Checked October 18, 2026:

- [Speech to Speech](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech): model selection, session/audio configuration, PCM encoding, VAD.
- [Voice API reference](https://docs.x.ai/developers/rest-api-reference/inference/voice): ephemeral credentials and event lifecycle.
- [Live interpreter cookbook](https://docs.x.ai/cookbook/examples/live-interpreter): browser subprotocol and streaming input transcription.

Server-only `POST /api/experiments/grok-counting` reuses the loopback Host + same-origin HTTP protection. It accepts only an empty, bounded JSON object and calls `POST https://api.x.ai/v1/realtime/client_secrets` with a 60-second expiry. Responses are no-store and allowlist only `value` and `expires_at`; provider failure bodies and credentials are never logged. This is a local unauthenticated prototype, not a public credential broker. The permanent key is used only inside the Next route handler.

The browser connects to `wss://api.x.ai/v1/realtime?model=grok-voice-3.0` using `xai-client-secret.<ephemeral value>` as its WebSocket subprotocol. Current docs list the versioned pin; we do not use the moving `grok-voice-latest` alias. The UI reports the requested pin separately from any `session.created` / `session.updated` `session.model` echo. An absent echo means serving identity is unverified. An echo is provider-reported identity, not independent backend attestation or a model's conversational claim about itself.

The client sends `session.update` with Eve, the fixed scene guidance, empty tools, `server_vad`, mono PCM input and output, and `grok-transcribe` input transcription. After `session.created`, it sends its configuration once. It waits for a `session.updated` whose echoed instructions, VAD, empty tools, PCM formats/rates and transcription model match that configuration before streaming microphone audio or sending the authored start instruction via `conversation.item.create` + `response.create`. No later steering is sent in this slice. The server VAD commits microphone turns and creates responses automatically.

An AudioWorklet batches mono float input into 1,024-sample chunks. The browser AudioContext requests 24 kHz; input configuration uses its actual sample rate. Samples are clipped and encoded as signed PCM16 little-endian, base64 in `input_audio_buffer.append`. Output is explicitly 24 kHz PCM16 LE, decoded from `response.output_audio.delta` (legacy `response.audio.delta` also accepted) and scheduled contiguously through Web Audio buffer sources. No alternate runtime or audio dependency is added.

Input `conversation.item.input_audio_transcription.updated` is cumulative: replace the prior caption by item ID, never concatenate revisions. `completed` replaces and finalizes it. Tutor `response.output_audio_transcript.delta` appends; `done` replaces with the final text. Legacy `response.audio_transcript.*` is accepted. Speaker labels describe transport roles, not diarization. Generated tutor captions can include unheard interrupted words; they are not proof of what played, or learner evidence.

`response.output_audio.done` and `response.done` mark generation completion, not local playback completion. Output stays playing until all scheduled sources end. On `input_audio_buffer.speech_started`, local queued audio stops immediately. VAD performs provider-side interruption; the client truncates the current item with `conversation.item.truncate` at the locally played duration and ignores delayed audio for the interrupted response. Live interruption ordering/truncation acknowledgment still needs verification.

Stop, hidden-page, pagehide, unmount, timeout, socket failure, and provider errors dispose microphone tracks, worklet port/nodes, queued output sources, AudioContext and WebSocket, and abort pending authorization. A stopped-instance fence covers every continuation and captured callback, including microphone permission granted after Stop. Startup has a 25-second deadline; authorization has a 15-second server deadline. A backed-up socket fails clearly rather than accumulating microphone data indefinitely. Restart requires an explicit new Start and obtains a new ephemeral credential.

## Validation evidence and limits

Offline unit tests cover local auth boundaries, request size/schema, missing key, expired/malformed credentials, sanitized provider failures, configuration acknowledgment, PCM input, cumulative/final transcript replacement, output draining, interrupted-response suppression/truncation, delayed microphone/auth resolution, timeout/disconnect, resource disposal, and late callbacks after Stop. Provider-free browser tests use real browser audio capture/worklets and mocked WebSocket/provider events to cover the fixed scene, captions, PCM upload, interruption, Stop/restart, pagehide, ended microphone tracks, and useful authorization errors. These fixtures are not live model evidence.

A bounded live Chromium check used the running local server and the real xAI service. macOS Samantha synthesized “One duck.” into a WAV routed through a synthetic microphone; no human or child recording was used. Observed:

- Requested `grok-voice-3.0`; server echoed `grok-voice-3.0`.
- Real microphone PCM uploads, VAD speech start/stop, cumulative/final learner transcription, two tutor responses, 17 output audio deltas with nonzero PCM, transcript deltas/finals, audio.done and response.done.
- Tutor: “Hello, friend. How many ducks do you see?”
- Learner transcription: “One dog.” (a transcription error on the synthetic “One duck.” input).
- Tutor: “I heard dog. The picture shows a duck. Can you look again?”
- Stop returned `stopped · Audio: idle`; the scene remained the first duck.

The live walkthrough lasted about 13 seconds. It establishes a real bidirectional pipeline and provider-reported model identity. It does not establish counting reliability, human-perceived sound quality, live barge-in/truncation behavior, correction reliability, long-session reliability, or tool reliability. Nonzero received audio and browser playback scheduling were observed; no claim of human listening evaluation is made. No further live calls are automatic.

The workspace contains old ignored review source/build copies under `test-results/`, which are included by its broad TypeScript/ESLint globs. Those caused initial workspace checks to fail independently of this change. An existing developer server also holds the Next dev lock. Validation uses a temporary clean copy of the tracked source plus this change, with the same installed dependencies copied locally, no credentials, and an independent browser server. This avoids altering old evidence or the user's running server. No changes to lint/typecheck configuration are needed for this experiment.

Final results: `npm test` passed 71 files / 1,497 tests (25 focused Grok auth/transport tests). In the clean validation copy, `npm run typecheck`, `npm run lint`, and `npm run build` passed; the selected Playwright suites (`grok-counting.spec.ts`, `lesson.spec.ts`, `catching-unicorns.spec.ts`) passed all 11 tests. Formatting and staged `git diff --check` passed. All eight staged files were byte-compared with the validation copy before this results paragraph was added. A local check confirmed no configured permanent provider key appears in the staged diff.


## Corrective review: readiness and microphone lifecycle

The first arbitrary `session.updated` no longer enables the session. Configuration is sent once after `session.created`; only an update echoing the intended instructions, `server_vad`, empty tools, PCM input/output rates and formats, and `grok-transcribe` enables microphone streaming and the single opening instruction/response. Default, incomplete, mismatched, premature, and duplicate events cannot create an opening response. Unacknowledged configuration retains the original startup deadline and disposes normally on timeout.

The acknowledgment gate uses provider-supported configuration echoes rather than assuming an event count or undocumented request-ID correlation. A bounded configuration-only real-service probe (no microphone audio or response creation) observed an initial `session.created` with empty instructions and disabled VAD, followed by `session.updated` echoing the supplied instructions, VAD, tools and nested audio configuration. The update omitted voice and session ID, so these are not required acknowledgment fields. Voice remains requested as Eve; the echo does not independently verify that voice selection. Official lifecycle source: [Voice API reference](https://docs.x.ai/developers/rest-api-reference/inference/voice).

Active microphone audio tracks now register `ended` listeners immediately after acquisition. Unexpected termination during startup or conversation fails the attempt with a reconnect/permission message and releases the connection, microphone, worklet and playback. Already-ended tracks are rejected immediately. Disposal removes those listeners before stopping tracks; the stopped-instance fence also ignores queued termination callbacks, keeping intentional Stop, navigation and unmount free of false microphone-disconnection errors.

New provider-free unit/browser regressions exercise premature/default/mismatched acknowledgment, successful configuration echo, duplicate events and exactly-once opening, the unchanged deadline, unexpected microphone termination, and intentional cleanup/listener removal. Browser device loss is a dispatched track event, not evidence of a physical unplug or operating-system permission revocation. The original live voice check above predates this corrective change; no new spoken walkthrough or physical device test is claimed.

Corrective-commit validation: all 1,503 unit tests in 71 files passed in the working repository (historical benchmark tests require its Git objects). The 31 focused Grok auth/transport tests passed. In a clean source copy, all 12 selected browser tests (Grok, root Counting, and Catching Unicorns), typecheck, lint, and production build passed. Formatting and `git diff --check` passed. The four changed files were byte-compared with that copy before adding this results paragraph. The initial full-suite attempt in the temporary copy could not run historical benchmark assertions without `.git`; rerunning the complete suite in the working repository passed.
