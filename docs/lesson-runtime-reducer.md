# Deterministic transcript-state lesson runtime

This document retains the reducer's deterministic contract. Integration and
recovery design continue in [#56](https://github.com/hurley87/sprout/issues/56).

The pure `lib/lesson-runtime/lesson-runtime-reducer.ts` is the
authority layer. It consumes descriptive proposals and local runtime evidence,
and reads destinations exclusively from the selected lesson definition's authored
`nodes[nodeId].onSuccess` edge.
The root browser runtime supplies transcripts, local media evidence, and
render confirmation and handles the reducer's effects. The reducer itself has
no transcript accumulator, provider calls, steering sends, or persistence.

## Caller contract

Create a runtime with a unique app-owned `runtimeId` and one validated
`LessonDefinition` for each lesson start or reconnect. The runtime stores the
lesson ID and ignores reducer calls supplied with a different definition. The
initial authored scene must already be rendered. The default
sustained quiet interval is 250 ms; callers can configure a positive interval.
All events use `atMs` from the same local monotonic clock. Tick events drive the
gate; the reducer itself has no timers. Classifier results use their receipt time,
not the time their request began. Backdated and invalid times are ignored.

Capture `runtimeSource(state)` at the local event source boundary. Deliver local
`child.turn.started` before that turn's transcript, then use the new child-turn
identity for subsequent events, including `child.turn.ended`. A start immediately
invalidates semantic and audio evidence, without waiting for transcript text.
An ended turn still needs its own child transcript before it can be classified.
`transcript.updated` declares a strictly increasing safe revision and whether
the update came from the child, tutor, or an unknown source. Child and unknown
updates clear completion evidence. These are application facts, not model claims.

Capture `classificationSource(state)` alongside the exact current-node transcript
snapshot before awaiting the classifier. It returns `null` while the child is
speaking, before this visit has child transcript evidence, and outside the active
phase. Attach that captured source to `proposal.received`; do not reconstruct it
from current state when the result arrives. Both source and proposal must match
the exact current node, visit, child turn, runtime, and revision. The reducer
parses the closed proposal schema again and consumes at most one valid proposal
per revision. Abstentions and malformed/stale proposals have no effects.

## Session-local concept evidence

Nodes may optionally author `concepts` with stable criterion IDs and descriptions.
The current-node classifier receives only those current-node criteria and proposes
`not_yet`, `partial`, `demonstrated_independent`, or `demonstrated_prompted` for
each. These are interpretations, not accepted evidence. The reducer checks the
closed proposal, exact runtime/visit/turn/revision, authored criterion IDs, and
the application-captured transcript snapshot. It records a source reference to
the exact child message and preserves prompted/independent status and prompting
history in the current runtime. New runtimes start with an empty evidence map.

Only a demonstrated observation emits `concept.revealed`; partial and not-yet
states remain hidden. A child response that simply repeats or substantially
copies prior tutor wording cannot be accepted as independent evidence and is
retained as partial. This deterministic text overlap check is a guardrail, not a
semantic classifier. Classifier accuracy still needs reviewed live evaluation.

Concept nodes require an authored `completionPolicy`:

- `all_demonstrated` requires every current criterion to be demonstrated.
- `all_independent` also requires independent rather than prompted understanding.
- `allow_unresolved` permits the authored success edge with unresolved criteria;
  it does not change their evidence status or count them as mastery.

An explicit learner scene skip uses the same authored edge without accepting an
answer or emitting reveal effects. It preserves the evidence ledger, and only
criteria explicitly carried by that edge with demonstrated evidence appear in
the next node. A skip requires an explicit current `quiet` media observation
that has remained quiet for the configured drain interval. `unavailable` media
is not quiet evidence. The runtime also requires the current scene's steering
append to be acknowledged and no child speech or pending child candidate.
Rejected skip attempts leave runtime and timer/classification authority intact.
An accepted skip invalidates old classification work, then still requires exact
render confirmation before sending the next steering append; the next skip
remains unavailable until that append is acknowledged. Stopping instead ends
the runtime and preserves its evidence snapshot for a caller-owned recap; it
does not reveal unresolved canonical answers.

Normal answer progression retains the existing correct-answer,
tutor-acknowledgment, relevant-output-drain, render-confirmation, and steering
gates. Explicit skip uses quiet drain and acknowledged steering as its local
eligibility gates without turning media quiet into answer evidence. An authored edge may list `carryForwardCriteria`; only demonstrated
evidence for those IDs is copied into the target node. No carry-forward is
implicit. Counting nodes do not opt into concept evidence and retain their
existing completion path.

## Completion gate

A correct proposal with no unresolved need for help accepts an answer.
Acknowledgment requires a current tutor-authored transcript revision containing
the same child turn's answer, classified as correct with the tutor acknowledging
success. That snapshot can establish both semantic conditions even if the earlier
child-only classification was superseded or never completed. The two-step path
also works: a child revision classifies correct, then a later tutor revision again
classifies correct and acknowledging. A child-authored revision cannot establish
acknowledgment. Other tutor states do not establish acknowledgment. An `answering`
proposal or ongoing local child speech cannot establish completion authority.

Every newer transcript revision suspends both current answer and acknowledgment
authority until that exact revision is classified. A tutor-only update retains
the earlier correct revision as a candidate and retains audio for that child
turn, so revalidation can establish the subsequent acknowledgment. An incorrect,
unclear, absent, or help-needed answer clears the candidate and audio evidence.
Child speech and child/unknown transcript updates clear them immediately.

Local `output.activity` remembers candidate tutor audio from a fresh onset of
`active` after the current child turn has ended and has its own child transcript.
This can happen before or after correct classification returns. Pre-turn audio,
output starting during child speech, and PCM remaining active across that boundary
cannot satisfy this gate. Candidate audio must then become `quiet` for the
configured interval. Repeated quiet events preserve its start time; renewed
activity resets it. `unavailable` clears candidate audio and is never silence;
quiet alone after unavailable cannot restore it. A fresh quiet observation
also starts a quiet interval when no candidate tutor audio exists; only an
explicit skip can use that interval, and it does not count as answer evidence.

Both orderings work: acknowledgment followed by audio drain, and audio drain
followed by acknowledgment. In the second ordering, the still-current quiet
interval can satisfy the gate immediately when acknowledgment arrives, or a
later tick can finish it. Audio can also fully drain before correct classification;
later correct and acknowledgment classifications can use that still-current
sustained quiet. Audio alone never authorizes progression. All four conditions
must hold together for the exact latest transcript: correct, acknowledgment,
relevant audio observed, and drain.

PCM energy has no response identity and quiet may be a pause within tutor speech.
This spike's gate proves these local observations, not that the audible content
was an acknowledgment or that a provider response has definitively completed.
It intentionally fails closed when activity began before the child turn ended
with transcript evidence; that case needs a later fresh onset to obtain audio
evidence. Classifier latency does not determine whether post-child audio counts.

## Render and steering handoff

Once eligible, the reducer commits only the authored success target and enters
`rendering`. It emits `render.requested` with an exact identity: a token scoped to
the runtime and new visit, the node ID, and scene ID. Terminal success has null
node/scene IDs. The pending render also retains the originating visit identity.
No next-node steering context is available before confirmation.

`render.confirmed` must match the runtime, token, node, and scene exactly. It
activates the rendered node and emits one `steering.ready` payload containing
only that node's presentation facts, learning objective, and tutor brief.
Graph edges and future nodes are explicitly excluded. Terminal confirmation
instead emits `lesson.completed` once and enters the complete phase. Duplicate,
mismatched, previous-visit, and previous-runtime confirmations do nothing.

Stop/disconnect makes the runtime inert. Child speech, a new child/unknown
transcript revision, renewed output activity, or unavailable output during an
unconfirmed render cancels it and also stops the runtime. An unconfirmed
destination is rolled back to its originating node,
and pending terminal completion is revoked. Events from that originating visit
are recognized for this interruption; other stale events are ignored. A later
confirmation of the canceled token cannot release steering. The caller must
honor the stopped state and restart the lesson with a fresh runtime and initial
render to resume. This conservative spike does not implement render recovery.

The focused unit tests mock proposals, cover both completion orderings and
failure boundaries, and replay events deterministically without Jev/GPT-Live
calls. They establish application behavior, not classifier accuracy or browser
audio/render integration.

## Discarded microphone candidates (issue #57)

The local detector emits `microphone.activity_started` before sustained onset is
confirmed. The browser now maps this to `child.candidate.started`, not a confirmed
turn start. It still allocates a new, monotonically increasing child-turn identity,
clears semantic authority, aborts classification, and blocks progression immediately.
The reducer suspends only prior child-transcript eligibility and candidate output
observations. Tutor transcript updates can accumulate while blocked. Fresh output
onsets may be recorded against that suspended ended answer; already-active output
without prior relevant audio, and unavailable output, cannot create this evidence.

`microphone.activity_discarded` maps to `child.candidate.discarded` when suspension
is still present. It carries eligibility/audio into the new turn without restoring
accepted answer, acknowledgment, consumed revision, or the old turn identity. Quiet
drain restarts at discard. Completion needs a fresh classification of the latest
runtime/node/visit/turn/revision and a tutor-authored acknowledgment plus relevant
output drain. Stable text and quiet may already satisfy the independent tutor
scheduling gate, so this fresh request can begin immediately; it is never a replay
of an old proposal. A delayed old result cannot match the new turn. The new turn
also remains available to bind a first child transcript arriving after discard.

`microphone.speech_started` maps to `child.turn.confirmed` for a pending candidate.
It permanently revokes suspension. A newer child/unknown transcript also revokes
suspension immediately; discard then merely ends the current turn. The newly bound
child answer requires its own subsequent tutor acknowledgment and fresh relevant
output. Confirmed activity without a new child transcript remains ineligible.
Candidate onset during render handoff still stops the runtime; discard cannot
revive an unconfirmed render or release steering.

This is a bounded recovery policy, not a claim that discarded energy was noise.
Short real speech can be discarded by VAD. A later child transcript invalidates
recovered evidence, but a transcript arriving only after render confirmation is
still subject to existing visit isolation. Confirmed energy could also be non-speech;
we retain conservative invalidation without assigning an acoustic cause. The
alternative of erasing eligibility on every discarded candidate is safer about
undelivered speech but demonstrably strands valid answer evidence. Automatically
recovering confirmed activity would weaken interruption protection and is outside
this fix. Revalidation can add a classifier request for each discarded candidate;
identical exact identities are still requested at most once. No detector thresholds,
classifier questions, prompts, or timing constants changed.

### Recorded failure and remaining validation

Evidence: `sprout-lesson-26d9f7a1-07b7-4819-8db7-ea0b0ac0f1c0.json`,
`transcript-efc8mnhec5z8d24.vtt`, and the replacement
`Cap Recording - 3 October 2026.mp4` (48.988 seconds). A sampled recording frame
at 36 seconds shows two ducks, correct accepted, acknowledgment false, and relevant
tutor audio false. Runtime timestamps below use the export's monotonic clock and
are not recording offsets. Audio wording/pacing was not independently verified.

- Child `Two` arrived at 27.502 seconds in turn 5, after local speech stop.
- Candidate onset at 27.620 created turn 6 and cleared child eligibility. Tutor
  `Yes,` arrived at 27.676 while that candidate was pending. Discard at 27.805
  ended the turn without recovering eligibility in the original runtime.
- Tutor text completed at 28.475. Fresh output at 28.085 and later activity/quiet
  events never qualified because child eligibility was false.
- Another discarded candidate ran from 29.570 to 29.803. A new onset at 29.815
  was confirmed at 29.895. Child-attributed `[tongue click` fragments arrived at
  30.594 and 30.756. Their attribution/content does not establish the sound's cause.
- At 32.786 the correct/acknowledging proposal matched a child-authored revision:
  answer acceptance became true, acknowledgment and relevant audio remained false.
  Later detector events cleared acceptance. The session ended at 46.784 with
  `page_hidden`; no classifier error occurred and no butterfly transition occurred.

The tests reproduce isolated discard recovery and replay the second-scene event
sequence with mocked correct proposals. The replay still holds: the 29.570 candidate
interrupts quiet stabilization before its boundary, and confirmed activity at
29.895 invalidates suspension before revalidation can finish. This fix removes a
proven discarded-candidate dead end; it does not prove that this exact live run
would complete. A fresh authorized live rerun and independent listening are needed
to assess the later confirmed activity and conversational behavior. No paid live
lesson was started for this investigation.
