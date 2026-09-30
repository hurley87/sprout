# Observer provider feasibility

**Status: API path feasible; model suitability unverified.** Checked against the official OpenAI API documentation on 2026-09-30. This is an implementation recommendation, not a provider test. No child recording or provider request was used.

## Recommendation

Use a two-stage, server-side OpenAI path as the implemented adapter candidate:

1. The internal Convex action fetches the saved full-session recording and sends it to the File Transcription API using `gpt-transcribe`. The documented provider cap is 25 MB; this adapter deliberately applies a lower 20 MiB byte limit. It uses one full recording and never creates stored per-utterance clips.
   For multipart filenames, the adapter derives the extension from the supported MIME base type and accepts the recorder's WebM/Opus and Ogg/Opus codec parameters. It preserves the saved recording MIME metadata and bytes; it does not transcode audio.
2. Send the resulting untimed transcript together with the exact claimed canonical input snapshot, including timestamped utterance, displayed-scene, support and integrity context, to the Responses API with Structured Outputs. The default candidate is `gpt-6-astra`; `OPENAI_OBSERVER_MODEL` can override it for a later evaluation. The model page lists Responses and Structured Outputs support. This confirms API/schema compatibility only, not suitability for Observer work. Sprout validates each returned proposal against the saved canonical record before publication.

The transcript can help interpret the actual saved mixed recording alongside what Sprout actually recorded as displayed and supported. Generated Sprout text, Jev control results, and transcript-only claims remain distinct from delivered speech and learner evidence. Give the model the exact claimed canonical event set as its reference allowlist. `gpt-transcribe` returns transcript text, but the current guide does not promise timed segments for it. This adapter therefore permits references only to existing canonical events; it does not emit recording-backed support citations from untimed transcription. Concrete claims must satisfy the existing canonical utterance interval and stable displayed-scene checks. Ambiguous alignment is omitted or represented as uncertainty; never invent timestamps or confuse transcription offsets with the session clock.

This is a candidate architecture only. The docs establish endpoint and format compatibility, not that a model can accurately interpret a preschool child's speech, distinguish nearby speakers, align words to Sprout's event clock, or follow Sprout's conservative evidence rules.

## Why not a single native audio-and-JSON call?

OpenAI's current Chat Completions audio input accepts base64 WAV or MP3. The browser recording is WebM, so that route needs conversion first. GPT-Audio-1.5 accepts audio input through Chat Completions, but its model page says Structured Outputs are not supported. Therefore it cannot, by itself, provide the schema-constrained proposal output this contract needs. A transcription stage followed by a compatible text model is the simpler documented path. Do not assume a newer model supports every audio and structured-output feature just because both features exist in the API.

## Runtime safeguards and open gates

- Structured Outputs constrain shape, not truth. The app must still parse and validate output, reject references absent from this session, require an actually displayed scene for concrete performance claims, and preserve uncertain/empty outcomes.
- The transcription guide points to `whisper-1` for word/segment timestamps; OpenAI has announced its removal for 2027-02-26. Avoid making the long-term design depend on it. The guide's diarization alternative provides segment times and speaker labels, but its documented model is also on the announced transcription-model retirement list. Timestamp alignment to Sprout's session clock therefore remains a feasibility gate for the preferred current transcription model.
- A correct total and a spoken count sequence are separate claims. The validator rejects a counting claim unless the canonical response contains the complete sequence from one through the displayed target quantity and the proposal represents that sequence and total.
- Missing support events do not prove independence. The proposal contract can represent recording-backed help with `recording_review` provenance and canonical clock bounds, but this provider adapter does not generate those citations: the selected transcription response is untimed and production does not emit delivered-support events. The adapter leaves help unestablished when no timestamped canonical support row exists. A later timestamp-capable path must be evaluated before enabling recording-only support citations.
- Parent-added help, pointing, and touch-counting belong to a separate parent decision with explicit `parent_review` provenance. They must not rewrite the original Observer proposal.
- Before selecting a model, test with synthetic recordings only: WebM upload and size behavior, timestamp mapping, mixed speaker and interruption cases, correct totals with and without spoken counts, context/reference validation, refusal/truncation behavior, and repeatability. Deterministic tests in this commit use mocked inputs and are not a live-provider result. Assess against hand-reviewed synthetic cases; do not use provider output as ground truth.
- Configuration is server-side only: set `OPENAI_API_KEY` for the Convex Node runtime and optionally `OPENAI_OBSERVER_MODEL` there. Set the same high-entropy `OBSERVER_SERVER_CAPABILITY` in the Next.js server runtime and Convex Node runtime. The loopback-guarded route sends it to a public Node action, which compares it inside the backend before scheduling; public attachment only persists audio. Provider calls and publication remain internal. Never set the capability or provider credentials in `NEXT_PUBLIC_*` variables. This change configures no secrets and deploys nothing; provider analysis must remain disabled until both runtimes are configured with the matching capability.
- Provider work is bounded by a 90-second timeout and a 20 MiB recording limit, under the five-minute claim lease. HTTP failures, refusal/truncation, malformed output, invalid canonical references, missing configuration and oversized recordings fail the attempt; only a validated empty proposal array is an empty successful review.
- If later live suitability testing is approved, use purpose-built synthetic adult speech and synthetic scenes first. Actual child/session audio is outside this commit and requires a separate explicit decision.

## Official documentation

- [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text) — supported file types, 25 MB limit, and chunking guidance.
- [Audio in Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions) — native audio input format and request structure.
- [GPT-Audio-1.5 model](https://developers.openai.com/api/docs/models/gpt-audio-1.5) — audio modalities and lack of Structured Outputs support.
- [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra) — text-only modality and Structured Outputs support for the proposed second stage.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — schema constrained responses and the warning that structured shape does not prevent mistakes.
