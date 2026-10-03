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
