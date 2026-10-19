# Grok counting experiment

**Download diagnostics** saves a local JSON snapshot of the current attempt,
including model details, status/error, current scene/proposal state, captions and
the latest 64 sanitized correlation events and up to 256 lesson decision events. It is enabled after Start and remains
available after Stop, completion or an error; Start replaces the previous attempt.
Exports omit audio, credentials, provider IDs and turn/render tokens. Caption text
is included, so review it before sharing. Downloading does not stop the session
or send diagnostics to a server.

See the [bounded paired evaluation](issue-69-grok-counting-evaluation.md) for the
fixed checklist, historical live evidence, transcript-correction blocker and
**insufficient evidence** recommendation. Earlier live results below are historical.

## Same-item settlement correction (after `3711cc3`)

The Grok adapter now tracks the current learner item's VAD-stop and proposal-validation
state. A `completed` transcription before its matching VAD stop is provisional.
The latest same-item completed text becomes eligible when VAD stops; a completed
text first received after stop is immediately eligible. Further completed replacements
before validation update the evidence without discarding that turn's original
acknowledged token. Identical repeated finals and repeated matching VAD stops are
idempotent. Interim-after-completed events retain the existing ignore policy; only
actual completed text can ground a report. Older learner items remain fenced.

No stabilization timer or provider round trip was added. Event-driven settlement
is sufficient for the observed order: VAD stop gates eligibility, the response must
have been created after that stop, and the existing bounded early-call wait still
requires actual final text. Acceptance checks the latest entire learner text,
current item/turn/scope, captured response ID and its originally bound token,
followed by the unchanged current-scene answer grammar and reducer validation.
An early response never acquires a token later. A mismatched quote, wrong object,
wrong total, help, stale/missing IDs, old token or duplicate/extra call cannot grant
success. Replacing unvalidated text does not relabel an already accepted proposal.

Once **any proposal has validated**, a changed completed learner transcription
invalidates the claimed context and revokes pending/retained success, even before
`response.done` or after the response has been replaced by its continuation. The
validation marker belongs to the learner item, not the active response. Returning
to the earlier text cannot resurrect its token. A fresh configured learner turn is
required. This preserves conservative correction behavior after acceptance.

The 64-entry session-local diagnostic ring adds `transcript.provisional`,
`transcript.provisional.replaced` and `transcript.settled.replaced` for pre-validation
evidence. Existing `transcript.final.corrected` now identifies invalidation after
validation. All entries remain closed codes and application counters; no captions,
provider IDs, tokens or credentials enter the trace. There is no diagnostic persistence
or new logging in the application.

Progression still requires one validated report from a completed response, a separate
current tutor acknowledgment, playback of that acknowledgment's own item, local
drain and 250 ms quiet, followed by exact React render confirmation. No tool can
supply acknowledgment, choose a node or award mastery. Missing-evidence timeout,
one recovery continuation, new-turn/interruption/cancellation fences and Stop remain
unchanged. Shared reducer, GPT-Live/Jev, curriculum and Catching Unicorns were not
modified. The earlier evaluation and its failed result are preserved verbatim.

### Corrective validation

The new fake-clock transport regression reproduces the evaluation's exact order:
partial completed at 8008, matching VAD stop at 9004, full completed at 9044,
identical repeats at 9057 and 9662, response creation at 9120 and correct tool call
at 9667 ms. It failed with `rejected` on the parent code; it now accepts the full
answer. It also requires an actual separate acknowledgment/audio source to drain,
then the reducer's quiet interval and exact render confirmation before the second
scene's configuration. A browser regression verifies this with real Web Audio and
React; it is provider-free and not a claim about live model reliability.

Additional fixtures cover replacement before/after VAD stop and response creation,
VAD-only promotion without a timer, identical events, wrong stop IDs, pre-stop
responses, correction before/after validation and during continuation, correct-to-wrong
and correct-to-correct revisions, supporting-text mismatch, stale tokens, wrong
response/item, new turns, cancellation, interruption, Stop and wrong-object ASR.

Final full unit suite: **1,657 tests in 72 files passed**, including 185 focused
Grok auth/proposal/transport cases. Typecheck, lint and production build passed in
an isolated tracked-source copy with identical installed dependencies and no
credential files, avoiding the workspace's historical ignored build/review copies.
All four changed TypeScript files were byte-compared with that final validation
copy. All **18 selected provider-free browser tests** passed (Grok, root Counting
and Catching Unicorns), including nine focused Grok browser cases. Changed-file
Prettier, final diff checks and the staged configured-credential scan passed;
retained provider evidence contains no opaque IDs, tokens, headers or audio.
No real-service success is inferred from those provider-free checks.

### One bounded live first-scene attempt

October 18, 2026, 16:10–16:11 America/Toronto: **one provider session, one checksum-verified
`answer-one` utterance, zero paid retries**, no other learner scenarios. Requested
and server-echoed identity: `grok-voice-3.0`. The runtime was parent `3711cc3` plus
this correction; the [sanitized live extract](evidence/issue-69-grok-settlement-live.json)
records the exact adapter source SHA-256 so it can be checked against this commit.
A temporary Playwright probe supplied only the existing adult synthetic WAV through
a silent synthetic microphone, never physical/child audio or injected provider events.
Only the first scene was exercised; no second-scene learner input was sent.

| Browser ms | Actual observation |
| --- | --- |
| 7868 | Partial completed “I see”; `transcript.provisional` |
| 8464 | Local `answer-one` playback ended |
| 9061 | Matching provider VAD stop |
| 9065 | Full completed “I see one dog.” (twice), then response creation; `transcript.settled.replaced` and `response.bound` |
| 9475 | Identical final repeated |
| 9480–9481 | One `incorrect` report quoting “I see one dog.”; rejected `unsupported incorrect answer`, **not stale context** |

The synthetic source says “I see one duck.”; the final ASR said dog. The unchanged
narrow number/object grammar abstained on that report. The one permitted recovery
asked the learner to look again without giving the count or praising success.
No credit or transition occurred through the 25-second post-answer render wait.
The probe stopped and disposed the synthetic stream/browser; app track ended,
app audio context closed and output was idle. The provider socket was still CLOSING
at the bounded 1.5-second close sample; browser closure ended the attempt. Nineteen
received output packets scheduled 19 sources and produced 19 source-ended callbacks.
Those observations are not a human audible-playback or voice-quality assessment.
Usage/billing totals were unavailable; no dollar estimate or cost advantage is claimed.

**Result:** the original transcript-lifecycle rejection is fixed in the exact
provider-free replay, and the live replacement reached a bound response without
stale-context failure. **Live first-scene completion is not verified**: the single
attempt was blocked by wrong-object transcription/unsupported evidence instead.
No prompt, answer grammar or safety check was relaxed to force a pass, and no paid
retry was made. Remaining edges include ASR fidelity, arbitrary late corrections
(they still revoke accepted evidence before committed progression), provider
misordering/missing IDs (safe rejection), and semantic/acknowledgment paraphrases
outside the existing narrow recognizers. A future separately scoped live attempt
would need the full correct final transcript, accepted report and genuine drained
acknowledgment before it could establish live first-scene success. This correction
does not establish general model reliability or change the earlier insufficient-evidence
recommendation.

## Corrective review of commit 3a4bd6c (historical)

### Answer validation

The previous leakage check matched isolated quantity words, `single`/`only`, and the article phrase `a duck` anywhere in the preceding tutor message. That rejected the actual opening “Hello, friend! I see a duck on the screen. How many ducks do you see?” before a correct learner answer could count. The replacement recognizes bounded answer-giving constructions for the **current authored quantity and object**, such as “There is one duck”, “Say one duck” and a standalone total. Normal object references and counting-method language such as “one at a time” or “only look at the duck” remain eligible. Explicitly suggested/uncertain current answers such as “Maybe one duck?” conservatively abstain. This remains a narrow local grammar, not a general language classifier. Tests cover normal, leaking, ambiguous and other-scene phrasing for all three authored scenes.

### Correlation investigation

Rechecked the current official [Speech to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) and [Voice lifecycle reference](https://docs.x.ai/developers/rest-api-reference/inference/voice) on October 18, 2026. The guide still describes complete function-argument events, call outputs and continuation requests; the reference describes configuration acknowledgment, VAD boundaries and response lifecycles. Neither source justifies attaching a missing response ID to whichever response is current, or replacing a failed token with the latest token. No documented event-structure difference requiring such an adaptation was established. The existing full tool-definition envelope normalization remains unchanged.

The old single `stale context` label hid distinct checks: a continuation call, missing/invalidated turn context, unbound response, mismatched response token, model token mismatch/reuse or extra calls. The original walkthrough retained event counts, captions and a tool summary, but no sequence of token/response/turn comparisons. Its exact historical cause cannot be reconstructed conclusively. Plausible causes included a genuinely changed final transcript, a response created before matching VAD stop, or the model using a different token; none warrants weakening validation.

A new bounded first-scene synthetic probe **reproduced the same rejection and identified the cause for that probe**. Application diagnostics recorded one issued/acknowledged reservation, a successful `context.claimed` at learner turn 1, then changed final-transcript events (`transcript.final.corrected`) before rejection. The first new reservation was issued only after that exchange, not after the opening. In code, a changed final clears the claimed context and invalidates pending/retained success; a subsequent call therefore rejects with that exact reason. This is an intentional evidence safeguard, not an ID fallback to repair. The probe used a browser-generated silent stream plus one macOS-synthesized utterance, never a physical microphone or child recording; it held the first scene with no credit and stopped within its bounded wait. No raw transcript, audio, opaque IDs, credentials or token values were logged by the diagnostic probe. This reproduction supports the transcript-correction explanation but does not retroactively prove the cause of the older attempt.

The experiment now exposes a session-local, 64-entry diagnostic ring in the **Correlation diagnostics** disclosure. Each entry contains only a closed stage/reason code and application-owned sequence/visit/turn/revision counters. It distinguishes missing call/response/VAD IDs, response-ID mismatch, missing response, calls after completion, unacknowledged/missing reservations, source/turn mismatch, response-before-turn/VAD-stop ordering, changed final evidence, token mismatch/reuse and prohibited continuations/multiple calls. No provider-supplied strings or transcript text enter this trace; it is neither persisted nor sent to another service. Provider-free regressions reproduce changed-final invalidation and pre-VAD-stop response capture, and verify that identical repeated finals remain eligible. The full source/token/revision checks still reject unsupported calls; there is no arrival-time ID/token retrofit.

### Reservation lifetime

The reviewed source already had an adapter guard against issuing another token while `nextContext` existed. A completed opening, duplicate completion or playback drain did **not** reproduce token rotation in tests or the new live probe; attributing the correlation failure to rotation would be unsupported. The transport now explicitly checks an application-scoped pending/acknowledged reservation before attempting configuration, and the adapter exposes/checks that same intended-turn identity. Tutor transcript revisions cannot expire it. Speech consumes it, corrections invalidate the claimed context, and an actual subsequent turn boundary or confirmed authored scene change permits a fresh reservation. Pending duplicates cause no extra `session.update`, readiness flip or response. Regression tests assert immediate PCM admission/answer acceptance after the real-shaped opening, duplicate completion handling, one acknowledged/pending reservation per intended turn, and rotation after a genuine completed learner exchange. This adds no protocol round trip or response request.

### Readiness and validation

The first scene is ready for a **bounded adult/synthetic diagnostic walkthrough**, with strict rejection and visible reason codes. It is not live-success verified. Provider transcription revisions, token uptake, response/VAD ordering and semantic reliability remain provider-dependent; a genuinely corrected final will intentionally require a fresh configured speech turn. Three-scene progression, own-item playback drain, exact React render confirmation, next-question gating, bounded recovery and cleanup remain covered by the retained provider-free suites. The shared reducer, GPT-Live/Jev and Catching Unicorns routes are unchanged. Broad provider evaluation remains outside this corrective commit.

Final validation passed: 1,640 unit tests in 72 files, including 168 focused Grok auth/proposal/transport cases; 17 selected browser tests covering Grok, root Counting and Catching Unicorns; typecheck, lint, production build, formatting and `git diff --check`. Typecheck/lint/build/browser checks used an isolated source copy with the same installed dependencies and no credential files, avoiding existing ignored workspace artifacts and the developer-server lock. All seven changed files were byte-compared with that copy before this results paragraph was added. A local scan confirmed that configured credential values were absent from the diff. Provider-free results are separate from the bounded live diagnostic observation above.

## Full authored lesson slice (commit 3)

Current scope: `/experiments/grok-counting` can complete the existing one-duck → two-ducks → three-butterflies lesson and show a completion screen. The experiment reuses `COUNTING_LESSON`, its authored edges and the unchanged application-owned deterministic reducer. Root GPT-Live/Jev Counting, Catching Unicorns, curriculum, mastery and persistence are unchanged. There is no observer, secondary classifier or provider abstraction. Success is settled task completion, not independent mastery.

Progression coordinates prerequisites rather than relying on tool/audio event order: finalized current learner evidence, one grounded correlated proposal from a completed response, a finalized current tutor acknowledgment, playback of that acknowledgment's own response/item, actual local source drain and the reducer's 250 ms quiet safeguard. The tool never supplies tutor acknowledgment. A narrow experiment-local recognizer accepts explicit number-and-object confirmation (for example “Yes, two ducks.”); generic praise, hints, questions and unknown paraphrases abstain. The existing learner grammar now checks the authored current quantity and object. Both recognizers are deliberately conservative adapters, not general semantic accuracy claims.

The bounded adaptation is revalidation of an ordered exchange after both evidence sources settle. A previously validated learner observation remains bound to its original application source and learner revision. The adapter projects the real finalized tutor message into a fresh reducer snapshot and validates a new acknowledgment proposal; it never retags an old call. If learner finals arrive after playback began or drained, the adapter replays the actual response/item-correlated quiet/onset boundary after settlement, conservatively starting fresh quiet after projection. It cannot create audio evidence without a matching scheduled source. This keeps provider event coordination and timers isolated while preserving the shared reducer's revision, authored-edge, output-drain and render safeguards.

The reducer requests the next render only after those prerequisites. React then checks the exact rendered token, node and scene attributes (including the terminal screen) before confirming that identity. Only after confirmation does transport send current-node context and a fresh turn token. The exact session configuration echo must arrive before a single next question is requested. Completion disposes the voice connection and microphone after final acknowledgment playback, with no extra closing response. Duplicate response creation cannot replace the transport's active response identity. Old response audio/captions, consumed calls, earlier visits, changed learner finals, interruptions, cancellation and Stop cannot authorize new-scene success. Speech during an unconfirmed scene change ends the attempt with a restart status rather than confirming an interrupted render.

Missing reports hold the scene. One three-second recovery window begins only after a recognized finalized total/help request, relevant successful response completion and local playback drain; it is never a microphone-quiet timer. Finalized fillers, greetings, thinking language, interim text and unfinished responses do not start recovery. One non-leading clarification is allowed for an unresolved exchange, within the existing continuation budget. A subsequent missing report ends the attempt with a useful restart status. Missing usable acknowledgment/audio similarly cannot award success or create an extra continuation loop. Valid tool reports for new exchanges reset missing-report recovery. Stop and a standalone explicit “Move on” end this small experiment without answer credit; they do not traverse a skip graph. Broader skip semantics remain outside this spike.

### Protocol and live limits

Rechecked October 18, 2026 against the official [Speech to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) and [Voice API lifecycle reference](https://docs.x.ai/developers/rest-api-reference/inference/voice). Requests retain the documented flat function-tool definition, function outputs and per-response instructions. A live configuration probe established that this service echoes the complete definition inside a nested `function` envelope. The readiness gate now accepts either representation while still matching the full name, description, closed argument schema and all audio/VAD/transcription/instruction fields. Conflicting envelopes, altered definitions and extra tools are rejected. This is an observed echo adaptation, not an assumption that arbitrary session updates are acknowledgments.

One bounded synthetic walkthrough used macOS Samantha audio fed to a browser-generated stream, with no physical microphone/child audio. Initial readiness held correctly on the nested tool echo; a configuration-only diagnostic identified the envelope difference. After adapting the gate, a spoken attempt connected and opened with “Hello, friend! I see a duck on the screen. How many ducks do you see?” Synthetic “One duck.” ended as learner caption “One dog.” The provider emitted one `report_counting_answer` call (`incorrect`, full evidence “One dog.”), which failed application correlation (`stale context`). Recovery speech asked the learner to look at the animal again. The app remained on the first scene with no accepted answer. The attempt stopped after the bounded first-scene wait. No live three-scene/tool reliability, human listening quality or barge-in reliability is established. Repeated final-transcript events and provider event/correlation behavior still need focused live investigation; this commit does not loosen provenance to force progress. Broad provider evaluation and recommendation remain commit 4.

### Validation

Provider-free transport/browser coverage exercises all authored edges and completion, acknowledgment before/after tools, delayed final learner transcription before/after playback drain, exact response/item audio, exact render confirmation and configuration acknowledgment before next questions, wrong then correct, corrected answers, interruptions/cancellation, stale/duplicate IDs and envelopes, bounded missing-call retry, thinking pauses, move-on/Stop and cleanup. Browser tests use Chromium Web Audio and mocked provider events, not live model decisions. Final checks passed: all 1,602 unit tests in 72 files, including 130 focused Grok auth/proposal/transport cases; all 15 selected browser tests (Grok, root Counting and Catching Unicorns); typecheck, lint, production build, formatting and `git diff --check`. Typecheck/lint/build/browser runs used a clean source copy with the same installed dependencies and no credential files, avoiding existing ignored workspace artifacts and the developer-server lock. Every changed file was byte-compared with the validation copy before adding these results. A local check found no configured credential value in the diff. The live attempt above is a separate, limited observation, not evidence that these provider-free scenarios work reliably with the live model.

## Tool proposal slice (commit 2, corrected orchestration)

Current scope: `/experiments/grok-counting` still renders only `count-1-duck`, with automatic progression disabled. It now offers one client-side function, `report_counting_answer`, and displays its validation result, retained learner observation and revision-bound reducer answer state separately. There are no observer, Jev, secondary classifier, mastery, persistence or export requests. Shared lesson/reducer code, root Counting and Catching Unicorns are unchanged. Setup and microphone lifecycle remain as described below.

Protocol rechecked October 18, 2026 against the official [Speech to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) (custom function tools, function call flow, parallel calls, per-response instructions and avoiding audio overlap) and [Voice API lifecycle reference](https://docs.x.ai/developers/rest-api-reference/inference/voice). The existing acknowledgment gate now requires an echo of the single complete tool definition in addition to the previous instructions/VAD/audio/transcription fields. Object key order and added provider defaults do not invalidate the expected configuration; absent or altered required tool fields do. Startup remains exactly once.

The closed tool arguments remain `context_token`, `answer_outcome` (`none`, `correct`, `incorrect`, `unclear`), `support_state` (`none`, `needs_help`) and `supporting_text` (the entire verbatim learner utterance, at most 2,000 characters). No model-supplied identity, revision or concept fields are accepted. Each random token reserves one application-owned connection/runtime, node, visit and **next** learner turn. The token is configured in session instructions before admitting that turn's microphone audio, never injected as a `system` conversation item during generation. It is correlation data, never learner evidence.

The initial `session.update` includes the reserved token. The app waits for the exact configured instruction/tool/VAD/audio echo before enabling PCM uploads and sending the opening once. A matching VAD `speech_started.item_id` claims that acknowledged reservation; a response created after that turn's VAD stop captures the application scope and claimed token separately. A response observed before speech or VAD stop cannot later acquire that turn's identity. The finalized transcript and its revision are bound later, when they exist. No token is stamped with whichever identity happens to be current on call arrival. A tool event must match the claimed token, captured response ID and current scope. A wrong/old turn, connection, node, visit, duplicate response or call, fabricated evidence, or unacknowledged reservation cannot establish success.

A well-formed early call waits for the matching learner turn to stop and final transcription to arrive. The app holds its result for at most 1.5 seconds from receipt, including when `response.done` beats transcription. It validates against the entire exact recorded learner utterance, not interim text or tutor words. A bounded timeout rejects the call; a later final cannot resurrect its consumed ID. Interim updates after final text are ignored, while a genuinely changed final transcript invalidates the token, any pending proposal and the retained learner observation. A corrected final never retroactively relabels the old call; a fresh speech turn is required for a new report.

Matching text alone does not establish correctness. The adapter independently recognizes a deliberately narrow first-scene answer grammar: a complete stated total such as “one”, “1”, “one duck”, “I see one duck” or “there is one duck”, with ordinary terminal punctuation. Wrong simple totals can support `incorrect`; ambiguity can support `unclear`; non-answer utterances can support `none`; explicit difficulty/help language supports `needs_help`. Assent, uncertain questions, alternatives, count-plus-help, stop/move-on, wrong objects and partial quotes cannot establish success. A preceding tutor utterance supplying a total (including one/1/single/only or “a duck”) conservatively blocks echoed success. Other phrasing may abstain; this is neither a general language evaluator nor an accuracy claim. Settled counting success may follow prompting/help and does not establish independent mastery.

The unchanged deterministic reducer validates the proposal against the captured finalized snapshot. Validation returns one `function_call_output` per consumed call ID. Only a successfully completed, still-current response with exactly one validated call may establish the retained learner observation. If the exact transcript revision is still current, delivery also uses the normal `proposal.received` contract. Tutor revisions can supersede that conversation state; the adapter never retags an old proposal with their new revision or reasserts answer acceptance. Instead, the already reducer-validated learner observation remains separate, with its source and learner revision, for diagnostics. Tutor continuation therefore may display “Learner answer recorded: yes” with “Revision-bound answer: no”. Neither grants progression. New learner speech, changed final learner text, Stop or a changed connection/node/visit/turn invalidates the observation. `tutorState` remains `unknown`; no tutor acknowledgment or concept evidence is fabricated. Shared reducer code is unchanged.

After an accepted **or rejected** tool-only response completes successfully and local output is idle, the app may send exactly one `response.create` continuation for that learner turn. Accepted reports receive a normal reply; rejection recovery asks for another try/clarification without supplying the answer or implying success. Per-response instructions prohibit tools and scene changes. The application enforces the budget even if the model ignores that instruction: calls from the continuation are rejected and cannot trigger another continuation. Existing tutor audio/text suppresses extra speech. Cancellation, interruption, new learner speech, stale response identity and Stop cancel eligibility; a pending transcript must settle or time out first. Parallel calls all receive results but cannot establish success, and permit at most the same single recovery. Duplicate IDs never receive a second result. No-call responses award nothing and do not trigger recovery. The 256-unique-call connection cap still requires a manual restart when exhausted.

The next token is configured only at a completed response boundary, after any reserved continuation has finished. When spoken response generation has ended but local audio still plays, configuration acknowledgment can overlap that drain to reduce latency. Microphone uploads pause while configuration is pending; the UI shows `connecting` until the exact new echo arrives. Duplicate or obsolete acknowledgments cannot replay the opening or arm an expired reservation. Initial startup retains its original deadline; subsequent configuration waits have a 25-second deadline. Pending evidence timers are cancelled on cleanup.

Live limits: no new provider probe is claimed for this correction. The official [Speech to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) documents session instructions/tools, automatic `server_vad` response creation, function outputs, parallel call completion and per-response continuation instructions. The [Voice API reference](https://docs.x.ai/developers/rest-api-reference/inference/voice) documents configuration acknowledgment and VAD/item/response events. Neither promises that a message added during generation changes that response, nor provides a documented `create_response: false` VAD switch here; the app relies on neither. Session configuration is acknowledged **before** uploading the relevant audio; it adds one configuration round trip at a normal turn boundary, often overlapped with playback, with no secondary inference request.

A learner can still barge in before the next reservation is armed, or the server can report an in-flight VAD start across a configuration boundary. Such speech interrupts local playback and invalidates old evidence as usual but is deliberately unscoped: it cannot reuse the previous token or establish a learner observation. There is no mid-response token retrofit. Speech during a pending configuration is not buffered or uploaded; wait for `listening` in a bounded walkthrough. Out-of-order/missing item or response IDs, expired final transcription, or a provider failing to use the configured token safely abstain. Real token uptake on automatic VAD responses, event IDs/order, the 1.5-second final-transcript bound, recovery speech, interruption, and semantic reliability still require an adult/synthetic live walkthrough. This implementation is ready for that bounded verification, not evidence of live model reliability. The older live connection check below predates tools. Scene progression, no-call UX, mastery and further providers remain out of scope.

Corrective orchestration validation: all 1,582 unit tests in 72 files passed in the working repository, including 110 focused Grok auth/transport/proposal cases. The 14 selected browser tests (Grok, root Counting and Catching Unicorns) passed; after the final response-ordering guard, all five focused Grok browser cases passed again. In a clean source copy with the same installed dependencies and no environment credential files, final typecheck, lint and production build passed. All six changed source/test files were byte-compared with that copy; formatting and `git diff --check` passed. Review found no new provider/route dependencies, shared reducer changes, sensitive transcript logging or credentials in the diff. New coverage is entirely provider-free. No live tool-calling walkthrough was performed; use adult/synthetic input only, keep the first scene fixed, and verify both a valid answer and a rejected-call recovery before treating the orchestration as live-verified.

Original commit 2 validation: all 1,559 unit tests in 72 files passed in the working repository, including 87 focused Grok auth/transport/proposal cases (53 new proposal cases plus three new wire/continuation regressions). In a temporary clean source copy with the same installed dependencies and no environment credential files, typecheck, lint, production build and all 13 selected browser tests (`grok-counting`, root Counting and Catching Unicorns) passed. The six changed/new source/test files were byte-compared with that copy. Formatting and `git diff --check` passed. The copy avoids old ignored review/build artifacts and the developer server described in the historical validation notes. No new live model call, real device loss test or human listening evaluation is claimed.

## Connection slice (commit 1, historical)

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

## Recovery semantics

The experiment distinguishes three settled-response recovery reasons:

- **Missing report:** no usable counting proposal was received. The existing
  bounded learner clarification remains limited to one missing-report retry per
  scene. Only this path can report `No usable counting report`.
- **Missing tutor acknowledgment:** a correct-answer proposal was validated, but
  the current tutor response cannot establish acknowledgment. The validated
  learner observation remains recorded; the learner is not asked to repeat it.
- **Missing acknowledgment audio:** the existing recognizer accepts the tutor
  text, but real playback evidence for that response's exact tutor item is absent.
  Text or unrelated audio cannot supply that evidence.

After local audio drains, unresolved acknowledgment gets a three-second grace
period, then one tutor-only confirmation continuation if the turn's continuation
budget is unused. That continuation requests no tools or learner repetition.
There is still **one continuation total per learner turn**: if an accepted
tool-only response already needed a continuation to produce speech, there is no
second acknowledgment continuation. An unresolved completed continuation ends
with `Tutor confirmation could not be verified` (or the specific confirmation
audio error). The terminal diagnostic retains the recorded learner answer but
awards no scene progression. Stop, cancellation, changed learner evidence, and
new learner speech revoke pending progression; callbacks cannot revive it.

Acknowledgment classification is unchanged and deliberately conservative. In the
latest demo, `One duck. That's right!` still abstains. It now enters acknowledgment
recovery and, if that fails or its budget was consumed, fails gracefully with a
confirmation error instead of claiming that the accepted tool report was missing.
A subsequent genuine recognized acknowledgment must have its own correlated
real audio, local playback drain, and the reducer's quiet period before a render
can be requested. `response.done` remains generation completion only. No
acknowledgment or playback evidence is synthesized by recovery.

Recovery-commit validation: 199 focused Grok unit tests and the full 1,671-test
suite (72 files) passed in the working repository. All 13 focused provider-free
Grok browser tests, typecheck, lint, and production build passed in a clean source
copy excluding the pre-existing diagnostic-download edits. The copy avoids the
active development server and ignored review-source artifacts under `test-results`
that prevent the corresponding in-place checks. Formatting and diff checks passed.
These regressions exercise fixtures and real local Web Audio drain; no new live
Grok/classifier quality result is claimed.

## Lesson decision timeline and continuation watchdog

The version-1 JSON download preserves all existing fields and the original
64-entry `diagnostics` correlation trace. It adds `decisionTimeline` (latest 256
entries) and `decisionTimelineDropped` (number of evicted entries). Start creates
a fresh session; Stop, completion and failure preserve the buffer. A sequence
starting above 1 and the dropped count explicitly identify incomplete history.
No timeline is persisted or sent to a server.

Each timeline entry has this schema:

| Field | Meaning |
| --- | --- |
| `sequence`, `atMs` | Increasing event sequence and nondecreasing milliseconds from the session's local monotonic clock |
| `type`, `reason` | Closed application event and reason vocabularies; no provider error text or captions |
| `node`, `visit`, `turn`, `revision` | Authored node and application evidence scope at the event |
| `response`, `item` | Local numeric response/item ordinals, or null when unavailable; never provider IDs |
| `correlation` | Current response bound to the current learner turn, unbound, or absent; correlation-check reason codes explain individual envelope failures |
| `state` | Phase, retained learner acceptance, revision-bound answer acceptance, acknowledgment recognition/observation, reducer audio observation/drain, output activity, continuation used/requested, validated proposal outcome/support |

The `state` keys are `phase`, `learnerAccepted`, `answerAccepted`,
`acknowledgmentRecognized`, `acknowledgmentObserved`, `audioObserved`,
`audioDrained`, `output`, `continuationUsed`, `continuationRequested`,
`proposalOutcome`, and `proposalSupport`. The eligibility event records the
origin snapshot before the reducer commits its render request; its reason records
the actual successful reducer outcome, including the just-completed quiet period.

Events capture learner turn boundaries and provisional/settled/revised finals;
proposal receipt, validation, rejection and accepted correct observations;
response generation start/completion/cancellation; acknowledgment recognition,
abstention or awaiting evidence; real item playback start/drain/clear; recovery
request/exhaustion; continuation lifecycle; transition blocking/eligibility;
render request/confirmation; and lesson completion, Stop or failure. Repeated
unchanged acknowledgment and transition-wait decisions are suppressed. Snapshots
are copied so consumers cannot mutate retained history.

Acknowledgment events and audio events share local response/item ordinals.
`audio.started` records successful scheduling of actual PCM in Web Audio;
`audio.drained` requires every currently queued source for that item to end
naturally. An item can resume if more PCM arrives; a queue drain alone says
nothing about generation completion. `audio.cleared` records cancelled playback
and is never a natural drain. Reducer audio-drain state additionally requires its
quiet period and is separate from these local queue events. No provider
`response.done` or text-only acknowledgment creates playback evidence.

The existing exported transcript remains the sole caption copy. Timeline entries
contain no utterances, raw PCM, credentials, application tokens, provider IDs or
render identities. Earlier acceptance and failure-time learner evidence remain
visible even when terminal cleanup revokes progression authority. Long sessions
can evict earlier decisions; exported JSON explicitly reports that limitation.

Every application-requested continuation (accepted/rejected tool-only speech or
missing-report/acknowledgment recovery) gets a **15-second start deadline**. The
next newly admitted, current-turn-bound response starts a **60-second generation
completion deadline**. These conservative deadlines allow provider latency and a
short realtime tutor turn without leaving a session stuck indefinitely. Lifecycle
binding uses the existing serialized request and turn fences; it is not a claim
that xAI echoes an application request ID. New learner speech cancels the pending
binding before a VAD-generated response can be admitted. Opening questions and
ordinary VAD-generated responses do not start watchdogs.

Matching generation completion or cancellation clears the watchdog; duplicate or
unrelated lifecycle events cannot complete or reset it. Stop, interruption/new
speech, superseding responses, scene transition and connection failure also cancel
it. Neither deadline applies to local playback after generation completes.
Timeout closes the session once with `continuation-never-started` or
`continuation-incomplete`, retains prior accepted-answer diagnostics, requests no
further response or tools, and awards no success. Late events cannot reopen the
stopped session. Existing recovery/continuation limits and acknowledgment/counting
validation are unchanged.

Timeline/watchdog validation: 213 focused Grok unit tests and the full 1,685-test
suite (72 files) passed. All 15 focused provider-free browser tests passed,
including downloaded JSON for the October 18 abstention sequence, recognized
recovery/scene transition, missing audio, consumed continuation budget, and both
watchdog deadlines. Unit coverage also verifies late callbacks, duplicate
lifecycle events, interruption/Stop/connection cancellation, multi-chunk local
drain, missing reports, completed lesson events, bounded storage and defensive
snapshot/privacy behavior. Typecheck, lint and production build passed in a clean
copy to avoid the existing dev-server lock and ignored review-source artifacts.
All seven changed code/test files were byte-compared with the validated copy;
formatting and diff checks passed. Counting validation and acknowledgment grammar
were compared with the preceding commit and remain unchanged. No live provider
evaluation was run.

## Opt-in Jev tutor acknowledgment (Commit 1)

Open `/experiments/grok-counting?mode=grok-jev` for semantic acknowledgment.
`?mode=grok-only` (also the default for absent/unrecognized values) preserves the
existing regex recognition. The page displays the selected mode; diagnostics
exports include `acknowledgmentMode` and `classifierModel` (`jev-1.14.0` for Jev,
`null` for Grok-only). Grok Voice 3 still interprets the learner and proposes
`report_counting_answer`; its tool schema and counting validation are unchanged.
The GPT-Live observer, curriculum, shared reducer and Catching Unicorns are unchanged.

`POST /api/experiments/grok-counting/acknowledgment` uses the existing loopback,
same-origin and JSON guards. It accepts exactly five fields: authored `nodeId`,
`expectedAnswer` (the authored quantity and object, checked server-side), validated
`learner` utterance, finalized `tutor` utterance, and an application-generated
`requestId`. The body is limited to 12,000 bytes, each string to 2,000 characters,
and the correlation ID to 80 alphanumeric/hyphen characters. No full lesson,
conversation history, tool token, or provider response is sent to the browser.
This prototype endpoint trusts the local application to have validated the
learner; the reducer independently retains that requirement for progression.

The server reuses `evaluateNoulQuestions` in `lib/jev.ts`, with an opt-in strict
model-identity check. Existing callers retain their prior behavior and return type.
The provider must echo exactly `jev-1.14.0`; missing/substituted identity abstains.
One Noul question, `acknowledgesValidatedAnswer`, asks:

> Does this tutor utterance explicitly and correctly acknowledge the learner's
> validated answer to the current counting question?

The provider schema is `{ model: "jev-1.14.0", answers: {
acknowledgesValidatedAnswer: { noul: probability } } }`. Probability must be a
finite number in [0, 1]. Supplied utterances are evidence, never instructions.
The true criterion requires explicit confirmation of the correct number and
object, including natural paraphrases and confirmation before/after the answer.
False includes generic praise, questions, hints, uncertainty, contradictions,
answer-giving before the learner, unrelated text and incomplete acknowledgment.
Only a probability **at least 0.95** yields `acknowledging`. This is a conservative
engineering threshold intended to limit false progression, **not an empirically
calibrated threshold**. Values at most 0.05 abstain as `not-confirmed`; intermediate
values abstain as `low-confidence`. No negative outcome changes learner credit.
The browser receives only `{ requestId, outcome: "acknowledging" | "abstain",
reason, modelValidated }`, with closed reasons, never raw provider bodies or keys.

The adapter starts classification at its first event-processing tick after both
a validated correct learner proposal and a current, bound, finalized tutor item
exist. It need not wait for `response.done` or local playback drain. A continuation
can use the retained validated learner observation without another tool call.
Each request captures the response object, application scope (runtime, visit,
node, learner turn), learner revision, transcript revision, tutor item/text and a
fresh request ID. Duplicate finals reuse the same decision; corrected tutor text
aborts/replaces it. Learner speech, learner corrections, rejected source evidence,
response cancellation/supersession, scene change, Stop and failure invalidate it.
An `AbortController`, explicit local deadline race and identity checks prevent
late results from authorizing another scene, including a response that ignores
abort. All metadata stays bounded; the transcript is exported only once.

Both the server provider call and browser classification have a **five-second**
deadline (the browser includes HTTP latency). While pending, missing-acknowledgment
recovery is suppressed. Abstention, malformed output, model mismatch, unconfigured
provider, HTTP/network failure or timeout release the existing recovery policy;
there is no regex fallback. Recovery still waits for actual playback drain,
then its existing three-second delay, confirms the already validated answer
without asking the learner to repeat, and consumes the same one-continuation
budget. A failed continuation exhausts that budget instead of looping.

A current positive result sets recognition evidence only. The adapter still waits
for completed, current response generation and actual response/item-correlated
PCM, then projects `tutorState: acknowledging` through the existing reducer.
The reducer still requires validated learner evidence, local audio quiet/drain,
its quiet-period safeguard and exact React render confirmation. Jev alone cannot
supply missing audio, create tutor speech, advance a scene or award mastery.
When Jev finishes after drain, the existing projection conservatively establishes
a fresh quiet period.

The existing 256-entry decision timeline adds `classification.requested`,
`classification.completed`, `classification.cancelled`, `classification.stale`
and `classification.applied`. Closed reasons describe pending/confirmed/abstained,
provider failures, cancellation and stale/accepted reducer application. Completed
and cancelled entries carry bounded latency (0–5,000 ms) and a model-validation
boolean; response/item ordinals correlate them to actual audio events. A positive
result awaiting audio has a completed decision but no applied event. Captions,
wire IDs, request IDs, credentials and raw bodies are excluded from this trace.

Provider-free tests mock semantic outcomes, so they establish contract/lifecycle
correctness, not Jev's actual language accuracy. Commit 2 must evaluate the
positive/negative utterance set with the real pinned model, calibrate the
threshold, measure latency/deadline suitability, and examine false positives,
false negatives and recovery rates. No paid live benchmark was run here.

Commit 1 validation: 48 new provider-free unit tests, the full **1,733-test suite
(73 files)**, and all **23 focused browser tests** (including eight new Jev
scenarios) passed. Typecheck, lint and production build passed using a clean
copy without the ignored `test-results` review-source trees or developer env
files. Unit tests ran in the repository because frozen historical fixtures read
Git objects. All ten changed files were compared byte for byte with the validation
copy; code formatting and `git diff --check` passed. The first browser clock
setup reset the runtime clock after session creation; installing the test clock
before page load fixed the two test-harness failures. No production behavior was
changed to accommodate that clock setup.

## Commit 2: measured acknowledgment benchmark

The shared experiment-local expected-answer formatter now supplies `one duck`,
`two ducks`, and `three butterflies` in both browser requests and server
validation. The 0.95 threshold, question, curriculum, learner validator, tool
schema and reducer remain unchanged. A server/harness-only probability projection
supports evaluation without exposing probabilities or provider bodies in the
browser endpoint. The exact existing Grok-only regex is shared with its offline
comparison; its matching behavior is unchanged.

See the [Commit 2 report](issue-69-grok-jev-acknowledgment-benchmark.md) for the
fixed labeled dataset, opt-in commands, metric definitions, alternatives computed
from the same probabilities, actual evidence and architecture comparison.
Real Jev accepted the October 18 phrase at p=0.99 (110 ms). Across 32 eligible
text examples it accepted 13/13 positives and no negative/ambiguous case; median
latency was 136 ms and p95 273 ms. The 0.95 three-way semantic abstention rate
was 6/32; the production gate also withholds confident negatives.

The one real synthetic `grok-jev` walkthrough stopped on scene 1: Grok heard
`I see one dog.` from the existing `I see one duck.` fixture and emitted an
unsupported `incorrect` report. No validated learner answer, Jev request,
acknowledgment audio or scene transition followed. The later scenes and a fresh
Grok-only comparison were not executed. No paid retry, prompt/validation change,
threshold tuning or architecture winner is claimed. Further opt-in development
is warranted, with separate fixture/ASR/tool-grounding investigation before a
successful three-scene run.

Commit 2 validation: 290 focused Grok/Jev tests, all 1,762 unit tests (74 files),
23 provider-free browser tests, typecheck, lint, formatting and production build
passed. The isolated live walkthrough failed at the preserved first-scene
ASR/tool-report blocker; it was not retried. Source-copy validation excluded
ignored review artifacts and local credential files, and all changed files were
byte-compared with the validated copy. Historical evidence was not overwritten.

## Grounded incorrect reports versus verified success

The retained Commit 2 walkthrough exposed a validation-policy error: `incorrect`
required a match in `total`, the strict number/authored-object grammar used to
verify `correct`. Consequently Grok's matching finalized transcript and report
for `I see one dog.` were rejected as `unsupported incorrect answer`. That
historical evidence remains unchanged; no new paid evaluation was run for this fix.

Correct-answer verification is unchanged: only the strict current-scene quantity
and object, exact finalized supporting text, current response/turn/token/revision,
no unresolved help/navigation and no tutor answer leakage can establish success.
An arbitrary Grok `correct` label still cannot validate `I see one dog.`.

For `incorrect`, the application instead admits Grok's negative semantic judgment
when the same current-scope and exact-finalized-transcript checks pass, the words
do not establish the known correct current-scene answer, and there is substantive
counting-attempt evidence. The conservative admission guard requires a numeric
token (any total) or an existing zero-through-ten number word outside bracketed
annotations. It excludes empty/non-substantive text, standalone backchannels,
question-only totals, explicit background/TV/radio attribution, navigation and
unresolved help. This is an evidence-admission guard, not another semantic
classifier or a dictionary of possible wrong objects; Grok determines the
attempt's meaning. Arbitrary unmarked speech cannot be perfectly attributed by
these text guards. No expanded wrong-object vocabulary or new provider is used.
Existing `none`, `unclear` and `needs_help` checks are unchanged.

Thus `I see one dog.` and `Two ducks.` on the one-duck scene can be recorded as
incorrect, while `One duck.` with an incorrect label remains contradictory and
is rejected. Accepted negative reports retain `tutorState: unknown`, never set
`learnerAnswerAccepted` or correct-answer acceptance, and cannot request Jev
acknowledgment classification or render a new scene. Even correlated tutor
confirmation text and drained audio cannot turn the negative observation into
success. The existing accepted-tool-only continuation lets the tutor respond
naturally once, then the next attempt receives its normal new context token.
Duplicate finals/calls remain deduplicated; a correction after validation
invalidates even an accepted negative report's old context rather than relabeling
it as correct. The reducer, acknowledgment/audio lifecycle, prompts, fixtures,
Jev question/threshold and Grok tool schema are unchanged.

Provider-free transport regressions replay the retained provisional/final ASR
sequence, matching `incorrect/none` call, duplicate events, completed tool-only
response, ordinary non-success tutor continuation, local audio drain and next-turn
reservation in both `grok-only` and `grok-jev` modes. They verify the negative
report is accepted with no success, acknowledgment classifier request or scene
transition. This corrects application handling of the transcript actually received;
it does not repair the `duck` → `dog` transcription or claim a successful live
three-scene walkthrough.

Validation for the grounded-incorrect fix: 331 focused Grok/Jev tests, all 1,803
unit tests (74 files), and all 23 relevant provider-free browser tests passed.
Typecheck, lint and production build passed in the clean source copy that excludes
ignored review-source artifacts and local credential files. All four changed
files were byte-compared with that copy; formatting and diff checks passed.
The tool schema, strict correct-answer checks, and `none`/`unclear` checks were
also compared directly with the parent revision and remain byte-identical.
No paid live benchmark or new provider evidence was generated.
