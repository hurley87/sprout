# Observer provider feasibility

**Status: API path feasible; model suitability unverified.** Checked against the official OpenAI API documentation on 2026-09-30. This is an implementation recommendation, not a provider test. No child recording or provider request was used.

## Recommendation

Use a two-stage, server-side OpenAI path as the first provider candidate:

1. Send the saved full-session recording to the File Transcription API using `gpt-transcribe`. The current guide recommends it for recorded speech, supports WebM, and caps one file at 25 MB. If a recording exceeds that cap, compress it or split only at safe speech boundaries; splitting can lose context.
2. Send the resulting transcript together with the canonical, timestamped session evidence and scene/support context to a text model that supports Structured Outputs. Use GPT-6 Astra as the first text-stage evaluation candidate: its current model page lists Responses and Structured Outputs support, and the current structured-output guide recommends it for new projects. This is a candidate for evaluation, not a selected Observer model. Require the observation JSON Schema, then run Sprout's own runtime contract validation against the saved session record before treating any output as a proposal.

This lets the audio transcription stage analyze the actual saved mixed recording, while the text reasoning stage can consider the transcript alongside what Sprout actually recorded as displayed and supported. Keep generated Sprout text, Jev control results, and transcript-only claims distinct from delivered speech and learner evidence. Give the model the already fetched session-event IDs as an allowlist; validate every returned reference against those canonical rows. `gpt-transcribe` returns transcript text, but the current guide does not promise timed segments for it. Align that text only to existing canonical utterance events when the mapping is clear; use those events' `atMs` values for parent seeking and return uncertainty when the mapping is ambiguous. Do not invent transcript timestamps or confuse transcription offsets with the session clock.

This is a candidate architecture only. The docs establish endpoint and format compatibility, not that a model can accurately interpret a preschool child's speech, distinguish nearby speakers, align words to Sprout's event clock, or follow Sprout's conservative evidence rules.

## Why not a single native audio-and-JSON call?

OpenAI's current Chat Completions audio input accepts base64 WAV or MP3. The browser recording is WebM, so that route needs conversion first. GPT-Audio-1.5 accepts audio input through Chat Completions, but its model page says Structured Outputs are not supported. Therefore it cannot, by itself, provide the schema-constrained proposal output this contract needs. A transcription stage followed by a compatible text model is the simpler documented path. Do not assume a newer model supports every audio and structured-output feature just because both features exist in the API.

## Runtime safeguards and open gates

- Structured Outputs constrain shape, not truth. The app must still parse and validate output, reject references absent from this session, require an actually displayed scene for concrete performance claims, and preserve uncertain/empty outcomes.
- The transcription guide points to `whisper-1` for word/segment timestamps; OpenAI has announced its removal for 2027-02-26. Avoid making the long-term design depend on it. The guide's diarization alternative provides segment times and speaker labels, but its documented model is also on the announced transcription-model retirement list. Timestamp alignment to Sprout's session clock therefore remains a feasibility gate for the preferred current transcription model.
- A correct total and a spoken count sequence are separate claims. The validator rejects a counting claim unless the proposal explicitly represents an observed count sequence and total.
- Missing support events do not prove independence. A proposal may cite a saved canonical recording interval for audible help, with explicit `recording_review` provenance and recording-relative/session-relative bounds that map through the canonical start offset. Validation requires the same session, a complete record, the available recording identity, and an in-bounds interval. This validates references and clocks, not semantic truth, audibility, or speaker attribution; when those are unclear, preserve uncertainty or `not_established` support.
- Parent-added help, pointing, and touch-counting belong to a separate parent decision with explicit `parent_review` provenance. They must not rewrite the original Observer proposal.
- Before selecting a model, test with synthetic recordings only: WebM upload and size behavior, timestamp mapping, mixed speaker and interruption cases, correct totals with and without spoken counts, context/reference validation, refusal/truncation behavior, and repeatability. Assess against hand-reviewed synthetic cases; do not use provider output as ground truth.
- If later live suitability testing is approved, use purpose-built synthetic adult speech and synthetic scenes first. Actual child/session audio is outside this commit and requires a separate explicit decision.

## Official documentation

- [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text) — supported file types, 25 MB limit, and chunking guidance.
- [Audio in Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions) — native audio input format and request structure.
- [GPT-Audio-1.5 model](https://developers.openai.com/api/docs/models/gpt-audio-1.5) — audio modalities and lack of Structured Outputs support.
- [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra) — text-only modality and Structured Outputs support for the proposed second stage.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — schema constrained responses and the warning that structured shape does not prevent mistakes.
