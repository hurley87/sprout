# Commit 3: accepted answer acknowledgment choreography

Scope: issue #47, parent `fc1393b3ebc3c008eb72715d238dff912d10668e`.
This slice enables the complete finite acknowledgment protocol. It does not implement
wording variants, new counting play, or delivered instructional-help support from
commit 4, or the authorized live verification matrix from commit 5.

## Application contract

Accepted ADVANCE is persisted as `UNCOMMITTED`. The old displayed group remains
visible while the app permanently discards A output and plays its catalog clip.
Only an ordered, identity-matched natural end followed by an observed finite output
fence can authorize one scene commit. Every cancellation revokes the playback slot
before physical teardown; completion notifications recheck ownership before commit,
including synchronous stop/correction callbacks. A retained terminal callback or rejected old promise has
no authority over a newer owner.

The React display callback carries an attempt-specific display token through two
animation frames. Matching the scene index alone cannot authorize a question.
After current display confirmation, the app prepares and promotes fresh B, opens
its source-local microphone fence, sends one question-only instruction while output
is blocked, then permits B. A never reopens. Question authority is consumed before
sending; transport success, context acknowledgment, and provider transcript are
explicitly **delivery unknown**, not evidence that the child heard the question.
Question notifications recheck current owner, source and speech state before dispatch
and before permitting output. An interruption before dispatch preserves the pending
question for bounded fresh-source recovery; an interruption after dispatch ends with
delivery unknown, without replaying the question or reopening output.

The original response recovery deadline remains 15 seconds. Playback can restart
once with a new playback identity. Provider preparation has a five-second watchdog,
clamped to the remaining original budget, and at most two preparation attempts.
Repeated interruptions cannot create an unlimited retry loop. Missing catalog,
invalid route, completion fence failure, display timeout, readiness timeout,
promotion failure or failed question send ends safely. Stop, hide, wrap and hard
expiry revoke pending playback/display/question work. STAY and UNAVAILABLE retain
the existing response gate and conservative stale-source behavior.

Before commit, an answer-bearing correction supersedes the old immutable evaluation
and is evaluated on the old display. After commit but before question release,
child speech remains canonical with uncertain transition attribution and fragment
references in recovery state. It cannot roll back or answer an unasked question;
B neutrally clarifies the displayed group and asks the pending question once.
Transition into the last group follows this protocol; later last-group counts
retain the existing evaluator bypass and cannot advance further.

## Prompt and spoken assets

`PROMPT_VERSION` changes from `counting-jev-9` to `counting-jev-10-ack-first` because
the protocol now permits an app-owned praise-only intermediate clip and separates
accepted from committed scene state. The live model, voice, quantities, evaluator
threshold and lesson curriculum remain unchanged. Legacy combined-feedback helpers
remain for compatible historical/test callers; enabled choreography uses the new
phase-aware context and one next-group question.

Five public synthetic WAV clips cover the five advancing scenes. They were rendered
on 2026-10-02 with `gpt-4o-mini-tts`, voice `marin`, English, using exactly the
baseline acknowledgment sentences. Each render was checked by an independent
`gpt-4o-transcribe` normalized exact text comparison. The canonical catalog in
`lib/acknowledgment-catalog.ts` pins text, model, voice, instructions, date, request
ID, original render hash and finalized resource hash. The streaming WAV RIFF/data
lengths were finalized without changing PCM samples. Startup checks SHA-256,
finite bounded PCM WAV format and duration before voice connection. No TTS endpoint
or runtime generation is shipped. Generation used only these five public sentences;
no child recordings or credentials were inspected or saved.

Automatic text review is not a human listening/voice-continuity approval. Target
speaker/Bluetooth drain, timbre/prosody, loudness, pronunciation, lesson latency and
recording-verified live question delivery remain device/live acceptance gates.

## Evidence and verification boundaries

Closed `local_playback` records retain immutable full evaluation/playback identity,
text/hash, old display, requested/ready/started/media-ended and one terminal state.
Local performance time is converted to session time only with an explicit canonical
origin. Completion requires positive finite duration at most ten seconds, natural
media end and both finite output-clock observations beyond the render fence.
`choreography_phase` records retain display and pending question identities and
transition fragment joins. B context uses a separate `deliverySourceId`; it cannot
overwrite the response's original `sourceId` and invalidate #46 joins.

The same local representation has distinct acknowledgment, instructional-help and
clarification roles. Interrupted/unknown help may be reviewed as potential exposure;
this commit creates no delivered-support row, counting-mistake verdict, learning
claim, or independence claim from generated text or local audio facts. Commit 4
must wire warranted help delivery using this provenance contract.

Unit transcript fixtures now use explicit immediate playback lifecycle facts because
they have no media graph. Their source-local clocks and input fences remain production
code. Real Chromium tests use the pinned spoken WAV, HTMLAudioElement, Web Audio,
local WebRTC/RTP, provider readiness/promotion and recording. The drain correction
test holds the observed output clock while actual media ends, then interrupts before
completion; production receives no guessed extra drain delay.

Historical tests retain One → Two → Three evidence joins, delayed old speech
uncertainty, help-before-response lower bounds, cross-display correction rejection,
mixed-source identity, STAY/UNAVAILABLE gates and lifecycle bounds. Obsolete A fast
paths/combined praise expectations are replaced by acknowledgment-first/fresh-source
assertions. The fixture upload router is preserved across fresh synthetic peers.

The parent commit's two known lesson-browser failures were independently reproduced
from a `git archive` export with the same dependencies and a synthetic public Convex
URL: valid delegation failed to dispatch its linked result, and revised STAY supplied
speech on retired A. The new protocol resolves the linked accepted result on A while
still UNCOMMITTED, and the revised fixture keeps the correction on authoritative A
before B readiness. Both tests pass in this slice. No branch/worktree was changed
for that baseline comparison; the exported fixture used webpack because Turbopack
rejects an external dependency symlink.

Final checks: 915 Vitest tests pass. All 131 default Playwright tests (including the
21 lesson tests) and the separate 52-test transport configuration passed before
the final question-notification guard; all 12 affected transport/browser tests
passed again after that guard. Typecheck,
ESLint, production build using a synthetic public Convex URL, changed-file Prettier
and `git diff --check` pass. Repository-wide `format:check` retains exactly the six
parent warnings: four Convex skill YAML files and two generated Convex declarations;
these unrelated files are untouched. Parent formatting was reproduced in the same
archive export. No deployment, remote push, paid live matrix, child recording, or
physical-device acceptance was performed.
