# Acknowledgment playback completion contract

Commit 1 of [issue #47](https://github.com/hurley87/sprout/issues/47). Research
started 2026-10-01; synthetic verification completed 2026-10-02. Baseline:
`37296871e9479fa2bcc8118ae64d1d0f36cf65b6`, merging #46 through PR #51.
This slice changes documentation and a standalone fixture only. The requirements
below describe later implementation, not current production behavior.

## Decision and practical guarantee

**Select verified finite app-controlled acknowledgment audio.** GPT-Live's
continuous output has no usable per-acknowledgment completion boundary. A finite
local resource has an observable natural playback end, demonstrated in Chromium.
Permanently isolate old provider output before playing it; after completion,
commit and confirm the next scene, then use a fresh provider source seeded from
that confirmed state. Never reopen the discarded source.

The guarantee is deliberately bounded: the complete verified resource traversed
an uninterrupted browser playback route, reached its natural end, and the
browser-reported output timeline passed a conservative render fence. It does
**not** prove physical speaker output, OS volume, Bluetooth drain, child hearing,
spoken-content quality, or production integration. Browser playback completion
and acoustic completion are different claims. The mechanism is viable for
implementation; live acceptance/release remains gated on spoken assets, output
timing, voice continuity, latency, question delivery and interruption recovery.
No paid provider experiments, child recordings, credentials or deployments were
used. No evaluator or curriculum change is selected.

## Provider and checkout evidence

| Source | Finding | Limit |
| --- | --- | --- |
| [`app/api/live/route.ts`](../app/api/live/route.ts), [`lib/lesson.ts`](../lib/lesson.ts) | WebRTC `POST /v1/live/sessions`, `gpt-live-1`, client delegation, `marin`, `store: false` | Continuous voice, not an app-owned finite response |
| [`lib/events.ts`](../lib/events.ts) | Transcript deltas, delegation ID/offset, session start/close, context append acknowledgment, errors, local microphone/output activity | No acknowledgment audio identity or playback-complete event |
| [`lib/browser-transport.ts`](../lib/browser-transport.ts) | Live MediaStream on audio element; playback readiness, mute/recording gain, permanent `discardOutput()` retaining input | Mute does not clear jitter buffers; track/session closure is not successful acknowledgment |
| [`lib/session.ts`](../lib/session.ts) | ADVANCE currently commits/displays before combined acknowledgment/question feedback; replacements seed committed state | Acceptance must be separated from commit; combined feedback must be split |

Official documentation checked on 2026-10-01, plus Web Audio on 2026-10-02:

- [GPT-Live migration](https://developers.openai.com/api/docs/guides/live-migration):
  no per-spoken-response completion event. Realtime generation-end events belong
  to another API and do not establish local playback completion.
- [Managing sessions](https://developers.openai.com/api/docs/guides/live-conversations):
  verified recordings/rendered clips are the documented option for known playback
  completion and exact wording; text history can seed new sessions. Transcript
  timestamps describe approximate fragments.
- [WebSocket audio](https://developers.openai.com/api/docs/guides/voice-websockets):
  primary output chunks have no timing or audio-done event. Switching transport
  or observing an empty queue cannot establish a finite utterance boundary.
- [Delegation](https://developers.openai.com/api/docs/guides/live-delegation):
  append acknowledgments describe estimated context injection, not speech/playback.
- [Playback control](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live):
  client/relay must clear stale output; a corrective instruction or sideband alone
  cannot control playback or retract speech already heard.
- [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech):
  WAV and `marin` are supported candidates for rendered assets. A shared voice
  name does not demonstrate matching timbre, prosody, loudness or pronunciation.
- [HTML media](https://html.spec.whatwg.org/multipage/media.html#event-media-ended):
  natural `ended` marks reaching the end of a finite forward-playing resource.
  Its expected terminal `pause` can precede `ended`; pause alone is not completion.
- [Web Audio output timestamp](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp):
  `contextTime` reports output-device stream position, with estimated performance
  time. It is distinct from render-graph `currentTime`; their difference is not
  a reliable latency measurement. This cited 1.1 document is a working draft.

OpenAI docs MCP was unavailable. Its skill-directed installation command failed
on an existing Codex configuration type error. Official web documentation was
used without changing that configuration.

Rejected authorities: transcript arrival/group finalization, context acknowledgment,
output VAD quiet, guessed delays, asset download/decode completion, `play()`
resolution, provider/session/track closure, and queue emptiness without a finite
end. Silence can occur inside speech. `AudioBufferSourceNode.onended` is an
alternative requiring explicit stop classification because stop also emits it;
that alternative was not tested or selected.

## Synthetic demonstration and its limits

```sh
node scripts/acknowledgment-playback-feasibility.mjs
```

The [fixture](../scripts/acknowledgment-playback-feasibility.mjs) starts no server
and uses no production modules, microphone or API. Network requests are aborted.
It creates a 900 ms finite WAV tone with an internal 250 ms silent interval. A
real `HTMLAudioElement` feeds one gain to the local destination and a recording
mix. A continuous stale-provider tone is blocked in both destinations.

The [saved result](verification/issue-47/synthetic-playback.json) identifies the
browser, fixture version, per-page performance clock, playback token, terminal
position, render/output timestamps, callbacks, commits, display acknowledgment,
question authorization and recording spectrum. Natural completion preserves the
old group, passes the output-clock fence, then authorizes exactly one synthetic
commit, display acknowledgment and question. Final-scene completion creates no
transition/question. Interruption, supersession, stop, source retirement,
suspension, invalid media, mute, rate change and seek terminate without commit.
Retained/duplicate and dispatched synthetic callbacks cannot revive authority.
The run covers 11 scenarios on Chromium `153.0.8010.12`; its recorded fixture
SHA-256 pins the exact script used. Raw retained-callback simulations are labeled
separately from browser-dispatched trusted events.

Decoded recordings in playable cases contain the local 440 Hz signal and exclude
the blocked continuous 880 Hz signal; natural runs also preserve the internal
silence and final tone. Invalid media can fail before a recorder packet; its
recording is not asserted decodable. Timers stimulate cancellation
or fail a hang; none authorize completion. Frame callbacks poll an observed
output position, not a guessed speech delay.

This demonstrates browser media lifecycle, output-clock progression and recording
topology **only**. Tones do not verify spoken content, voice continuity, physical
speaker output, child hearing or production integration. Cancellation stimuli
are synthetic, not real microphone detection. The display and question events
belong to the fixture, not React or audible tutoring. Recovery retries and actual
source replacement are later integration tests. Headless output timestamps are
browser estimates, not an acoustic recording.

Existing evidence is reusable within its original limits:

- [Issue #36](response-gate-latency-experiment.md) pins a 9,054 ms post-commit hold
  caused by hidden generation/caption quiet, not this architecture's latency.
- `tests/browser/transport-output.spec.ts` tests real local RTP, stale buffers,
  permanent isolation and recording gates. It does not implement local clips.
- [Issue #40](issue-40-cooperation-findings.md) correlates evaluation/delegation
  identities and replacement. Transcript/decoded activity are explicitly not
  delivery/completion proof. Its ignored corrected-to-wrong transition transcript
  must remain a recovery gap, not be cited as success.
- [Startup instrumentation](lesson-startup-latency.md) defines useful replacement
  stages, not a latency bound for replacement on every accepted answer. The merged
  parent records two unresolved lesson-browser failures; retain them separately
  during later verification.

## Identity and application scene authority

Freeze #46's evaluation correlation key and response identity for each revision:

```text
evaluation = (session attempt, origin sourceId, evaluated scene index,
              transcriptRevision, answerVersion, correlationKey)
responseIdentity = fragmentKeys + sourceStatus + evaluatedScene + recognitionContext
playback = (evaluation, choreographyEpoch, playbackAttemptId, assetId/hash)
question = (evaluation, choreographyEpoch, confirmed display token, new sourceId)
```

Provider-clock values in answer versions and delegation offsets are association
inputs/identifiers, not playback timestamps. Replacement never rewrites the
originating response identity. Missing/mixed sources remain missing/mixed; do not
invent canonical fragment joins. Evaluated/displayed scene identity includes
scene ID and canonical display event/time, not just an index.

Only the app commits fixed scene changes. Until completion, snapshot, rendered
group, input attribution and trusted context retain the evaluated group. ADVANCE
initially means an **accepted decision**, recorded as `advancement_accepted` with
`applicationAction` uncommitted. Actual commit alone emits
`scene_advance_committed` and `evaluation_control.scene_commit` with
`applicationAction: ADVANCE`. STAY/UNAVAILABLE never authorize correctness praise.

## State and completion authorization

| Phase | Required event/authority | Next state |
| --- | --- | --- |
| `awaiting_answer` / `evaluating` | Existing authoritative evaluation/correction policy | `accepted_pending_ack` for ADVANCE |
| `accepted_pending_ack` | Correction/grace clear, old output permanently isolated, verified asset and local route ready | `ack_playing` |
| `ack_playing` | Matching natural finite-media end, invariants maintained | `ack_draining` |
| `ack_draining` | Output-clock fence passes; recheck full current owner/scene/lifecycle | `ack_completed` |
| `ack_completed` | Synchronous at-most-once application commit | `transition_waiting_display` |
| `transition_waiting_display` | Matching render confirmation, scene and transition epoch | `next_question_pending` |
| `next_question_pending` | Fresh source ready, confirmed-state seed, current owner, safe child/correction conditions | Release one question-only instruction per attempt |
| `next_question_released` | Normal interaction resumes on confirmed current scene | `awaiting_answer` |
| Any pending phase | Interruption/supersession/stop/failure/retirement | Explicit recovery or terminal state, never implicit completion |

Require a trusted natural `ended` from a private immutable finite asset; playback
started from zero; normal forward speed, no loop/seek; no error; continuously
unmuted element with nonzero known volume, connected local graph with intended
nonzero gain and running AudioContext; matching attempt/epoch/playback token;
authoritative accepted answer; unchanged confirmed old display; active lesson,
unexpired deadlines and no pending child activity/correction. A resolved `play()`
only starts the attempt. Unexpected pause, resource/volume/mute/rate/seek change,
suspension, output-sink change, error or timeout invalidates it. Register guards
before playback; invalidate identity before teardown enqueues callbacks. Expected
terminal pause must not preempt a legitimate natural end.

At natural end latch that context's `currentTime` as a conservative render fence.
Keep the scene and token pending until a valid advancing `getOutputTimestamp()`
reports `contextTime >= fence`, then recheck all authority synchronously before
commit. This explicitly accounts for browser-reported output progression without
adding a guessed latency sleep. Record fence, output observation and available
`baseLatency`/`outputLatency` as diagnostics, not acoustic truth. No effect node
with an unbounded tail may sit on this selected simple route. Unsupported,
zero/nonadvancing timestamps or a changed sink fail closed with bounded timeout;
do not fall back to a fixed wait. Real hardware/OS/Bluetooth behavior remains a
manual acoustic/visual gate. If browser estimates cannot meet the old-scene
audible-completion requirement on a target device, restrict the validated device
path or establish another observable drain mechanism before release.

Completion and commit are separate ordered facts; duplicate completion cannot
recommit. Display confirmation must carry transition epoch/token as well as scene
index. A stale callback for the same index cannot authorize a question. Display
timeout is failure, not confirmation. Timers can cancel/end but cannot create
completion/display facts. Stop, wrap, goodbye and hard deadlines win even when
assets or sources are already ready.

## Cancellation and recovery

| Outcome | Scene/action | Recovery |
| --- | --- | --- |
| Child activity during playback/drain | Invalidate and silence immediately; old group retained, no commit | Confirmed correction/new revision supersedes acceptance and evaluates old group. Non-answer interruption retains uncommitted decision but needs a new playback attempt after child finishes |
| Provisional activity discarded | Canceled token stays canceled | Recheck correction/grace, restart whole short acknowledgment with new token; partial audio never counts as complete |
| Superseded answer | Cancel old acknowledgment, no commit | New revision owns evaluation; linked delegation cannot cause duplicate request |
| Parent/child stop, hidden page/dispose, goodbye/hard stop | Invalidate playback, asset fetch, sources, display/question work; stop media/input | End existing attempt with its reason and recording cleanup; no replay |
| Wrap-up | Suppress uncommitted advancement/new question | Finish against currently displayed state; existing app timing remains authoritative |
| Asset/decode/play failure, stall, unexpected pause/suspension or recording-route failure | No completion/commit | One bounded retry only if active, healthy route and no new activity; new token, frozen evaluation. Otherwise end using existing failure UI; never silently advance |
| Unexpected source retirement while acknowledging | Cancel source-owned token, old group retained | Intentional healthy source recovery can reseed old state and retry once. Provider connection failure ends per PRD; no automatic reconnect |
| Interruption after commit while waiting for display/question | Preserve committed scene; no rollback | Retain transition speech. Old-display or ambiguous attribution gets neutral clarification on actual displayed group; never evaluate as answer to an unasked question or silently drop it |
| Failure after commit, before question | Scene remains committed; question explicitly pending | Healthy planned replacement may release once; connection failure ends with pending outcome recorded. Parent starts a new attempt; no implied mid-session resume |

Preserve existing 250 ms stabilization and provisional VAD grace. Acknowledgment
duration does not replace correction policy: activity before commit still belongs
to the old group and blocks authority. Apply delayed transcripts using source,
scene and timing evidence, not arrival time. Late retired-source events cannot
move/ask. Post-commit corrections never retroactively roll back the display.
The fixture proves its token cancellation; these production recovery branches
require later state-machine and real-browser tests.

## Isolation, replacement seeding and delegation

Mute provider output while evaluating; permanently discard it before local
acknowledgment, retaining microphone, recording and local detector. Local clips
use a separate gain. Quiet does not reopen discarded media.

The simple selected path prepares source B **after display confirmation**.
Preparing it earlier with next-scene context would assert an undisplayed group;
seeding the old group could create more stale speech. If intentional replacement
is necessary during acknowledgment, seed old display with the pending phase and
explicitly uncommitted outcome, no audible praise/new question. Invalidate/retry
that acknowledgment token. Provider failure still ends per PRD.

After confirmation, seed B with actual current display, frozen evaluated answer
and recognition context, committed action, completed local acknowledgment and
pending-question token. Mark acknowledgment already played; request only a
question about this display, no praise replay or new total. Child quoted speech
is a user message; app authority is developer context. Initial one-duck prompt
must not override the seed. B cannot inherit A's queued audio. At promotion,
retire A and recheck latest child activity with source/input-scene fences before
opening B. Answer-origin identity remains A; question source is B. Retained
listeners have no authority. Abandon prepared sources when their owner changes.
Retain one bounded preparation attempt and existing 30 s readiness timeout;
expiration fails rather than reopening stale output.

Delegation metadata carries no task/answer. Preserve settled-transcript/offset/age
association and one evaluator request per identity. A linked result during
acknowledgment reports accepted criterion, unchanged old display and pending
transition, not committed ADVANCE. Later confirmed display can update the same
live handle without another speaking instruction. Application fallback and
delegation share one owner. Retired handles are never sent to B; seed it with
verified state. Context acknowledgments remain estimated-injection facts.

Application question sends are at most once per attempt. This does not prove
GPT-Live asks exactly one audible question: it can ignore/repeat instructions.
Transcript arrival is not delivery. Keep pending/unknown status when delivery is
unverified. Timeout must isolate the source before one bounded recovery attempt
or end; it never establishes delivery. Live validation must establish question
behavior. If it fails, finite app-owned question assets are the narrower fallback.

## Evidence, clocks, recording and actionable help

#46's canonical fragment keys, evaluated-scene identity, recognition context and
conservative child speech envelopes remain intact. Replacement never replaces
them with evaluator confidence or playback time. Local assets have no provider
clock and cannot masquerade as `source_timeline_bound`/`source_input_bound` child
speech. Confirmed display must cover the relevant response interval; missing
identity or speech crossing a transition remains uncertain.

Later persistence adds closed local-playback timeline records: evaluation identity,
epoch, playback attempt, asset ID/hash and verified text, role (`acknowledgment`,
`instructional_help`, `clarification`), canonical display identity, states
(`requested`, `ready`, `started`, `media_ended`, `completed`, `interrupted`,
`superseded`, `stopped`, `failed`), reason and start/end/drain observations.
Generation/asset readiness is distinct from playback. Terminal outcomes are
mutually exclusive, never upgraded by late callbacks. Map `performance.now()`
through the captured canonical session origin to `atMs`; retain raw clock and
uncertainty if unavailable. AudioContext seconds, provider approximate offsets,
attempt diagnostics and recording `startOffsetMs` require explicit mappings.

Add clips to the **existing single full-session recording** using the same gain
for audible destination and mix, preserving microphone input. No stored
per-utterance recordings. Cancel/stop gates both destinations and retains partial
audio. Current provider-interval `delivered?` cannot establish clip delivery.
Introduce explicit local provenance/intervals and update validators/readers in
later commits instead of forging provider times. Recording failure marks the
record incomplete. Playback facts do not establish hearing or learning.

Warranted help must be actionable, e.g. “Point to each butterfly as you count.”
For verified finite help assets, persist playback identity, text, display and
interval; only completed playback may support a canonical `support` row claiming
the whole instruction delivered. Partial/unknown hint playback remains potential
assistance; absence of completed support does not justify independence. Observer
and parent review must see these outcomes. Provider-generated help remains
unverified until checked against recording with trustworthy alignment; transcript
or context send cannot emit delivered support. Neutral recognition clarification
is a distinct role, not counting help. Never claim seen pointing/touches.

## Voice, latency and final scene

Use a small versioned catalog of pre-rendered reviewed acknowledgments for fixed
groups, with short varied wording and no next question/quantity. `marin` is the
candidate matching configured voice; retain render/voice/content/hash provenance.
Preload/validate before enabling lessons to avoid per-answer paid generation.
Do not extract a clip from continuous Live output: that requires the missing end
boundary. No spoken asset was rendered here; generation/listening review remains
a gate. Browser speech synthesis provides a finite lifecycle but substitutes a
device voice; it is not the selected voice-consistency path.

Measure accepted decision → local start → media end → output fence → commit →
display → replacement ready → question authorization → recording-verified
question onset. Report asset startup, clip duration, replacement stages and retries
separately, including failures. Cached clips do not remove per-transition source
replacement latency/cost. Neither prior gate metrics nor this fixture establishes
acceptable lesson latency. Timeout bounds indicate failure, not speech completion.

Transition **into** the last group uses normal choreography and asks about that
display. Current last-group behavior bypasses further evaluator advancement;
preserve scope rather than fabricating accepted ADVANCE, another scene or
automatic lesson completion. Live feedback stays on that group with no total
before the child's completed count; app deadlines/stop win. The fixture final
branch only demonstrates no transition for a terminal clip, not live tutoring.

## Impact on commits 2–5 and remaining gates

The agreed later slices depend on these requirements:

- **Commit 2, cancellable playback/transport capability:** finite resource
  playback/drain, events and identity, cancellation/recording route, and targeted
  tests. Keep production lesson choreography disabled in this slice.
- **Commit 3, complete lesson choreography:** enable the controller phases and
  accepted-versus-committed distinction together with display tokens, correction,
  phase-aware replacement/delegation, permanent isolation/input fences, lifecycle
  and question recovery, and evidence integration compatible with #46. Include
  state-machine and true transport integration tests of all enabled branches.
  Read Convex guidelines and applicable skills before persistence edits. Do not
  enable a partial state machine before its replacement/lifecycle protections.
- **Commit 4, wording/help:** reviewed variants, question-only instructions,
  bounded counting play after display, actionable help with delivered-status
  integration and distinct clarification,
  allowance for intermediate praise-only acknowledgment. Preserve counting scope,
  quantities 1–5, one question at a time and no next answer disclosure.
- **Commit 5, verification:** integrated real-browser playback/recording and
  separately authorized synthetic live trials across duck → duck → butterfly →
  strawberry, delayed transcripts, interruptions/corrections before/after commit,
  retries, replacement/failure, display timeout, final scene and early stop.
  Keep the parent's unresolved browser failures visible and compare before
  attributing regressions.

Before release, demonstrate spoken asset accuracy, voice continuity, acoustic
completion while the old group remains visible on target devices, fresh-source
question delivery after confirmed display, acceptable latency, and durable
interrupted/help evidence in parent review. Tone/browser-clock results establish
a finite local mechanism only. If voice/latency/drain gates fail, evaluate finite
questions, a validated device restriction or separately scoped attributable
finite output protocol; never substitute transcript quiet or guessed delay.

## Checks for this docs slice

The standalone 11-scenario Chromium experiment passed. Six existing targeted
Vitest files passed all 124 tests: browser transport, live recording, evaluated
response identity, response-source isolation, replacement seed and replacement
input. The fixture passes ESLint and Node syntax checking; changed files pass
Prettier and whitespace checks. Production lesson behavior is unchanged; this
is not a full lesson-browser acceptance run or a paid live trial.
