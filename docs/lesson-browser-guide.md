# Sprout lesson: manual browser guide

This guide retains reproduction instructions and diagnostic interpretation for
[continued behavioral evaluation (#57)](https://github.com/hurley87/sprout/issues/57).

The production prototype serves the lesson only at `/`. It uses `BrowserTransport`,
the local microphone detector, PCM output observer, and supported
`session.instructions.append` command. It does not record audio or persist sessions.

`/api/live` accepts only `{ sdp }` and always uses the Sprout tutor configuration
with the initial node's context. The local-only `/api/classify` endpoint uses the
same Jev request and deterministic mapping as `jevConversationStateClassifier`,
with an additional normalized mapping diagnostic. Its questions and thresholds
are unchanged.

## Run and collect

1. Run `npm run dev` with the existing local configuration. GPT-Live needs
   `OPENAI_API_KEY`, and Jev needs `TYPESAFE_API_KEY`. Do not put credentials in
   diagnostics. No database deployment or server is needed.
2. Open <http://127.0.0.1:3000/> in a browser
   with microphone support. Keep this tab visible. Headphones can help separate
   microphone activity from tutor playback in the first attempt.
3. Click **Start lesson** and allow microphone access. One duck is rendered
   before the runtime is created and before the live connection starts. Wait for
   GPT-Live to ask how many ducks you see.
4. Say **"One"** once, then pause. Expect a natural acknowledgment. Inspect the
   current-visit transcript: the tutor's acknowledgment snapshot must still
   include `Child: One`, preceded by the tutor's question.
5. Expect Jev to propose `answerOutcome: correct`, `supportState: none`, and
   `tutorState: acknowledging` on a tutor revision. The reducer also requires the
   child turn to have ended and fresh relevant tutor output to drain. It then
   requests two ducks, receives React render confirmation, and emits the bounded
   node-2 steering context. GPT-Live should ask about the two ducks naturally.
6. Say **"Two"**, pause, then **"Three"** for the butterfly scene. The authored
   terminal edge renders a completion view and releases the connection; no
   future-node or completion teaching prompt is sent.
7. Click **Stop** if still running, then **Export diagnostics**. Save
   `sprout-lesson-<runtimeId>.json` for review. Export before
   restarting: each new attempt replaces the previous in-memory log. Refreshing
   also clears it. The export includes transcript text but no audio, credentials,
   SDP, raw Jev bodies, or durable evidence records.

For follow-up evaluation, repeat fresh attempts for these cases:

| Case | Exact manual action | Inspect |
| --- | --- | --- |
| Wrong then corrected | On one duck say "Two", wait for a reply, then "One". | No progression on the wrong answer; a new turn clears prior authority; the correction and acknowledgment can establish fresh authority. |
| Hesitation | Say "Um…", wait a few seconds, then "One". | No request while local speech is active; hesitation alone never advances. |
| Unclear | Give a deliberately unfinished answer such as "It is…". | A clarification or abstention holds the node. |
| Help | Say "I don't know; can you help me?", then count after a hint. | No progression on help alone; latest successful answer can resolve the need. |
| Acknowledgment before Jev returns | Answer briefly and let GPT-Live acknowledge immediately. | A newer tutor snapshot cancels a pending child request; the combined snapshot can establish correctness and acknowledgment; earlier post-child audio can still count. |
| Several scenes | Answer "One", "Two", "Three" in sequence. | Distinct visits and render tokens; transcript resets; each steering append follows exact render confirmation. |

For each exported attempt, also note the spoken answers, whether headphones were
used, whether anything sounded wrong or overlapped, and which visible scene held
or advanced. This JSON does not establish what a human actually heard. Early
demos exposed classification churn during longer tutor speech. Tutor utterance
stabilization substantially reduced unnecessary calls on partial fragments; a
subsequent butterfly acknowledgment still caused abstention, leading to mapping
diagnostics. The final manual run then completed the full lesson with strongly
separated correct/acknowledging probabilities. Scheduler tests do not prove live browser interaction.

The earlier butterfly reproduction remains useful in follow-up work: ask
**"What's a butterfly"**, answer **"Uh, two"**, accept counting help with
**"Yes"**, then count **"One, two. Three"**. Match the final `classifier.mapping`
for `count-3-butterflies` by revision and source to `tutor_stabilization.ready`
and `classifier.started`. Inspect `reason`, the nine `probabilities`, and `detail`
to explain acceptance or abstention. Any future threshold or question adjustment
belongs to evidence-driven follow-up evaluation.

## Explicit confirmation after counted correction (#57)

The October 3, 2026 export for runtime
`6c336585-1939-49f7-9c03-2862c283574e` and
`transcript-7npaspem5t2vw27.vtt` show a successful first-scene correction:
wrong **"Two"**, counting help, **"One"**, then **"Yes! One duck."**.
The correct/acknowledging mapping was accepted at runtime **21.059 s**;
two-duck render confirmation followed at **21.0807 s**, then steering append
at **21.081 s**.

On two ducks, **"Three"** led to counting help, then **"Uhh, one, two"**,
then **"Nice! You're counting carefully."**. That final response praised the
process without explicitly confirming the total. The latest tutor revision
was **50**, with child eligibility and relevant output drain present. At runtime
**43.309 s**, mapping abstained with `answer_no_winner`: `answerCorrect` **0.87**,
`answerUnclear` **0.53**, `tutorAcknowledging` **0.59**, and `tutorHelping` **0.06**.
No butterfly transition or classifier error occurred; `page_hidden` ended the
session at **54.0419 s**. These observations identify the missing confirmation;
they do not establish classifier calibration or why the model produced it.
Runtime times and recording offsets are separate clocks. Audio wording and pacing
were not independently verified for this change; the recording filename is reused
between demos and must be matched again before relying on it.

The tutor prompt now explicitly covers a settled total expressed by counting up
to the displayed quantity and stopping there, including after a retry or hint.
It asks for the successful number and object, such as **"Yes, two ducks!"**;
process praise may accompany that confirmation. A pause alone does not settle a
count. Ongoing counting still gets thinking time; ambiguous, interrupted or
partial attempts need clarification, wrong totals need retry, and unresolved
difficulty needs a hint without supplying the total. Shared guidance is sent in
both session setup and rendered current-node instructions. Node facts, graph
edges, classifier questions/thresholds, runtime timing and authority are unchanged.

`tests/counting-confirmation.test.ts` checks instruction construction and reducer
behavior with mock semantic observations. It does not test real GPT-Live wording
or Jev interpretation. Generic praise alone still cannot authorize completion.

**Required live validation:** with explicit authorization for a fresh live session,
repeat wrong answer → retry → counted correction, particularly **"Three"** then
**"One, two"** on two ducks. Preserve the new runtime export and separately
record what was spoken, heard and displayed. Verify an explicit successful total,
the exact runtime/node/visit/turn/revision and tutor source for the accepted
correct/no-help/acknowledging proposal, relevant audio onset and drain, transition,
render confirmation, then steering append and its acknowledgment. Repeat a partial
count with a pause, an ambiguous answer, and help that remains unresolved to check
that no total or transition is supplied prematurely. A successful rerun establishes
that case only; broader behavioral evaluation remains open.

## Confirmed local activity without a child transcript (#57)

The latest October 3 export, runtime `ef40acf8-2283-48fa-bc30-e27cb7641740`,
holds on `count-1-duck`, visit 1. The transcript records **"Two"**, counting
help, **"One"**, then **"Yes, one duck. You counted carefully."**. Unlike the
earlier missing-total finding, explicit confirmation is present here.

Child revision **22** established eligibility for turn **6** at runtime
**18.1477 s**. Turn end at **18.6009 s** scheduled classification. A candidate
at **18.6675 s** interrupted it, then discard at **18.8924 s** recovered
eligibility and rescheduled. Another candidate at **19.1258 s** interrupted
that schedule; confirmation at **19.2525 s** permanently cleared the saved
eligibility. This was turn **8**, with no new child transcript. Tutor revision
**23** had arrived at **19.2462 s**; decoded tutor PCM became active at
**19.6521 s**. Turn **8** ended at **20.9009 s** without eligibility.
Turn **9** was confirmed at **21.1499 s** and ended at **22.7085 s**, also
without a child transcript. Final tutor revision **28** arrived at **21.2567 s**.
Later discarded candidates could restore only false eligibility.

Only one classifier request ran, for the earlier wrong-answer revision **7**;
it abstained with `tutor_margin_too_small`. Neither the correction nor its
acknowledgment reached Jev. No transition/render handoff followed the initial
render. `page_hidden` ended the session at **31.3463 s**, with no runtime error.
This is a deterministic scheduling/eligibility finding, not evidence that Jev
misclassified the correction.

The accompanying `transcript-xcxdx8p9jbqfmjz.vtt` also records the correction
and explicit confirmation. The reused recording filename was rechecked: duration
**32.665333 s**, **1920 × 900**, with an audio track. A frame at recording
offset **27 s** shows one duck, visit 1, turn 10, revision 28, child eligibility
false and relevant tutor audio false. Recording offsets and runtime timestamps
remain separate clocks; audio wording/pacing was not independently verified.

The local detector establishes sustained microphone energy, not speaker identity.
Browser capture reports echo cancellation, noise suppression and automatic gain
control enabled, but those settings do not prove echo was removed. The transport
passes local detector events directly into turn arbitration; provider child
transcripts are a separate signal. Confirmed onsets correctly cancel pending
classification and drop saved candidate eligibility/audio. Tutor-only updates
cannot supply a child transcript. The output observer sees decoded remote PCM,
not which sound entered the microphone or what was played/heard. The available
signals cannot distinguish untranscribed child speech from echo or other sound.
Transcript absence alone cannot safely authorize recovery after confirmation.

The focused addition is `classifier.blocked`, emitted once when an active
confirmed turn ends without current-turn child-transcript eligibility. Its
envelope identifies the current runtime/node/visit/turn/revision; `detail` gives
`reason: missing_current_turn_child_transcript`, the stop trigger, output activity,
and `latestChildTranscript` source plus provider interval (or `null`). That prior
fragment is context, never authority for the blocked turn. A matching delayed
child transcript can still arrive and establish eligibility normally. Duplicate
stops and discarded candidates do not emit this diagnostic. No thresholds,
timings, prompts, reducer recovery rules or transition gates were changed for
this finding.

The added mocked scheduling tests reproduce the correction's timing around
discarded and confirmed candidates, hold through missing/stale child delivery,
and recover on matching late delivery only with fresh semantic acknowledgment
and relevant audio drain. They also retain render-confirmation-before-steering.
The reduced replay does not reproduce microphone acoustics, provider attribution,
GPT-Live or Jev behavior; its revision/turn counts differ from the full export.

**Next controlled validation, requiring explicit authorization:** repeat
**"Two" → retry → "One"** using headphones, keeping the child quiet after the
correction and recording a human account of any further speech/noise. Preserve
the JSON, separately named recording and VTT together. Compare confirmed onsets,
detector windows, child transcript intervals, `classifier.blocked`, output
activity, classification and transition/render/steering order. If unexplained
confirmed activity persists, compare an explicitly authorized speaker-playback
run under otherwise matching conditions. Headphone success alone supports a
playback-related hypothesis, not proof of echo or permission to ignore barge-in.
Also exercise a real interruption with delayed/missing transcript; it must hold
without restoring the earlier answer's authority. This change improves diagnosis
and regression coverage; it does not claim the live progression failure is fixed.

## Timing and diagnostic interpretation

The child path still waits **300 ms** after a snapshot stabilizes with local VAD
inactive. Tutor classification instead requires **600 ms** of transcript stability
and **500 ms** of continuous locally observed output quiet. Both conditions must
hold for the active current visit, with no child speech, current-turn child
transcript evidence and a latest tutor-authored revision. These are independent
clocks: already-quiet audio counts toward quiet even before a tutor revision
arrives, and already-stable transcript text does not restart its clock when audio
goes quiet. Resumed or unavailable output resets classification quiet. No further
quiet event is needed to release a waiting snapshot. A newer snapshot, child turn,
visit change or shutdown invalidates pending work; superseded in-flight Jev
requests are still aborted.

The defaults (`tutorTranscriptStableMs` and `tutorClassificationQuietMs`) cover
multiple samples from the existing 50 ms PCM observer; they are conservative
prototype settings, not proof of utterance completion. The classification quiet
clock belongs to `TutorStabilizationGate` and never uses the reducer's
`quietSinceMs`, `tutorOutputDrained` or `quietDrainMs`. Local VAD uses the
existing **900 ms** quiet threshold, **80 ms** sustained onset and **150 ms**
candidate-discard threshold. Candidate onset immediately starts an app-owned
child turn and clears completion authority; sustained onset does not start a
duplicate turn. A discarded candidate ends that turn, but cannot supply child
transcript evidence by itself. The reducer uses **250 ms** PCM quiet and a
**50 ms** monotonic tick while its drain gate is relevant. Classification has a
**10 s** deadline; startup has **30 s**, and steering acknowledgment has **10 s**.
These settings are in `LESSON_TIMING`, displayed in-page and exported.

Every meaningful speaker-labelled snapshot increments an app-owned revision.
Fragment timing orders the transcript, while each fragment retains its captured
runtime/visit/child-turn source. Tutor snapshots retain the preceding child
answer. A new snapshot or local child turn immediately aborts classification;
render commitment, stop and disconnect do so too. Exact transcript text and
`classificationSource(state)` are captured together before the HTTP call. The
result is delivered with that captured source, never a reconstructed one.
Abstention or a classification endpoint error leaves the session running and the
scene held; that exact revision is not retried without a meaningful new snapshot.

Use these events to explain a held scene:

- `transcript.snapshot`, `classifier.scheduled`, and `classifier.started` show
  exact input text, revision, speaker, trigger, and debounce delay.
- `tutor_stabilization.scheduled`, `.cancelled`, `.waiting_for_transcript`,
  `.waiting_for_quiet` and `.ready` show the tutor boundary's exact revision,
  elapsed transcript stability and quiet, output activity, configured thresholds,
  cancellation reason or trigger, and remaining timer delay. Only `.ready` releases
  tutor classification; `classificationSource(state)` and snapshot text are
  captured together at that point.
- `classifier.cancelled`, `.abstained`, `.error`, and `.result` show cancellation
  reasons, tentative proposals and latency. Jev provider failures are normal
  abstentions in the existing classifier; raw provider diagnostics are not exposed.
- `classifier.mapping` reports `decision`, a machine-readable abstention `reason`,
  the nine normalized question `probabilities`, unchanged `thresholds`, and
  relevant candidate/winner/competitor probabilities, margin and violated rules
  in `detail`. Its source is the exact captured runtime, visit, child turn, node
  and transcript revision. `classifier.mapping_unavailable` means the diagnostic
  was missing or invalid; proposal handling still proceeds independently.
- `runtime.event.*` and `runtime.changed` show local event acceptance and before/
  after reducer state, including child-turn evidence, accepted answer,
  acknowledgment, output activity, quiet start and drain. Repeated time-only
  ticks are omitted; changed drain state is logged.
- `output.activity` comes directly from the decoded-media observer and cannot be
  manufactured by transcript events. `unavailable` fails the drain gate closed.
- `render.requested`, `render.confirmed`, `steering.ready`, and
  `gpt_live.steering_append` expose the exact handoff and only the rendered node's
  teaching context. Initial render confirmation is marked `initial: true`.
- `gpt_live.context_appended`, `transcript.visit_boundary`, `transcript.reset`,
  and `transcript.ignored` explain the current visit's isolation and discarded
  intervals. `error` and `lesson.ended` explain shutdown.

The mapping reports the first blocked stage in answer, tutor, support, then
acknowledgment order. Answer/tutor categories require a winner at **HIGH = 0.90**,
competitors at most **COMPETITOR_CEILING = 0.20**, and a lead of at least
**MIN_MARGIN = 0.70**. Support requires **HIGH = 0.90** or **LOW = 0.10**; all
tutor categories at or below LOW still map to unknown. A deficient margin also
exceeds the competitor ceiling at these bands: the reason reports
`*_margin_too_small` when both fail, and `detail.violatedRules` records both.
Other mapping reasons distinguish no winner, a high competitor, ambiguous help,
and acknowledgment without a correct answer. Provider/input failures have a
controlled reason and `probabilities: null`, never invented scores or a raw
provider body. The isolated endpoint returns `{ proposal, diagnostic }`; only
`proposal` can reach the reducer. Diagnostics never advance, steer or retry.

Rendering is confirmed from a React effect after commit and two animation frames,
with the DOM's exact render token/node/scene checked. No confirmation is sent
from the reducer effect handler. During an unconfirmed transition, renewed
child speech, a new child transcript, active output or unavailable output obey
the reducer's interruption policy and stop the attempt. The UI restores the
origin node and requires a fresh start.

## Deliberate limits

GPT-Live transcript deltas have approximate session-relative intervals and no
provider turn IDs or transcript-complete event. App-owned VAD turns therefore
describe locally observed microphone activity, not verified provider utterance
boundaries. Already-known previous child intervals are rejected on a new turn;
arbitrarily delayed unseen text within the same visit remains a manual evaluation
concern. Echo or noise can create candidate turns. There is no transcript-only
fallback when VAD fails: that attempt cannot advance without local turn evidence.

On a visit change the buffer is cleared synchronously. New fragments are queued
until the exact steering append acknowledgment, then filtered against that
update's `start_ms` and the previous visit's known maximum transcript end. Queued
child fragments must also match the exact current app-owned turn. Missing timing
or an acknowledgment timeout stops the attempt rather than mixing scene text.
Intervals crossing the boundary are discarded wholesale. This conservative
policy may lose valid boundary speech; inspect the exported rejection reason.
Append timestamps estimate context delivery, not playback completion, and do not
prove GPT-Live followed the instruction. See the official
[GPT-Live session guide](https://developers.openai.com/api/docs/guides/live-conversations)
for transcript and append timing semantics.

The reducer's PCM gate can mistake a pause within tutor speech for drain. Tutor
output that starts before local VAD ends cannot satisfy its fresh-onset rule.
These are existing reducer contracts, visible in diagnostics, not thresholds to
silently relax during follow-up evaluation. The lesson stops at 12,000
current-node transcript characters or 256 fragments waiting for steering acknowledgment rather
than silently trimming answer evidence. Focused fake-clock unit tests and mocked
lesson runtime scheduling tests cover partial transcripts, both clock orderings,
resumed/unavailable output, revision and turn/visit invalidation, unchanged child
debounce, independent drain timing and abort of an in-flight older revision.
Generalized segmentation remains separate work. The root and removed entry points have browser smoke coverage; issue #55 records the prior live verification.

## Help request recovery follow-up (issue #57)

See [the help-case evidence and correction](issue-57-help-recovery.md) for the
`support_ambiguous` finding, learner-led hint guidance, offline checks and required
live rerun. The help case remains unverified.

## Structured browser test observation (issue #30)

Observation is disabled by default. Before navigation, Playwright's
`installLessonObserver(page)` in `tests/helpers/lesson-observer.ts` sets
`window.__SPROUT_OBSERVE_LESSON__ = true` using an init script. The lesson checks
that exact flag at mount and exposes a frozen `window.sproutLessonObservation`
facade with only `read(after?)` and `report()`. There are no runtime controls.
The flag does not enable providers or alter lesson policy.

`read()` returns `null` before an attempt starts; otherwise it returns a detached
`LessonSnapshot`, the complete diagnostic journal, and a cursor
`{ runtimeId, offset }`. `read(cursor)` returns only events strictly after that
cursor, including detector measurements logged without a React publication.
The snapshot's diagnostic preview still has the UI's 100-event limit; the separate
`events` array has no such limit. Offsets count journal entries, not timestamps.
Reads are synchronous and atomic within the browser task. Polling uses the
existing journal and introduces no subscriptions, log changes, or React updates.
All nested payloads, including reports, are cloned before crossing the bridge.

Capture a cursor **before** the action to observe, then call `waitForEvent` with
the exact production event name and runtime scope. Add visit, node, child-turn,
and transcript-revision scope where relevant. For output, use `output.activity`
with `detail: { state: "active" }`, `"quiet"`, or `"unavailable"`; quiet is an
observed PCM state, not an inferred semantic turn end. A returned cursor points
just past the matched event, allowing an ordered follow-up wait without skipping
later events in the same batch. Render identities/tokens and classifier proposal
fields are preserved verbatim in event details. The optional `detail` filter
recursively matches a subset, for example `{ identity: { token } }` for an exact
render confirmation or `{ proposal: { answerOutcome: "correct" } }` for a proposal. `read()`
also exposes the current display identity and runtime state. No semantic outcome
is inferred by the helper. All production microphone, transcript, classifier,
scene/render/steering and end diagnostics are available through the same journal.

Stop retains the final snapshot and report until restart. Restart replaces the
current attempt, and cursors from the old runtime fail explicitly. Collect the
old report before restarting. Unmount deletes the bridge and invalidates any
retained facade; reattach gets a new facade. Navigation clears in-page data.
There is no scenario timeline or artifact writer in this slice. Provider-free
browser coverage verifies mount, committed render, failure/end, and restart;
mocked runtime tests verify unpublished measurements, ordering, scoping, cleanup,
and reference isolation. Live provider behavior remains a separate tier.
