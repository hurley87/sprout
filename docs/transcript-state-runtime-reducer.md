# Deterministic transcript-state lesson runtime

Commit 3 adds the pure `lib/transcript-state-steering/lesson-runtime-reducer.ts`
authority layer. It consumes descriptive proposals and local runtime evidence,
and reads destinations exclusively from `COUNTING_LESSON_GRAPH[nodeId].onSuccess`.
It has no browser route, transcript accumulator, provider calls, steering sends,
production `LessonSession` changes, persistence, or Observer integration.

## Caller contract

Create a runtime with a unique app-owned `runtimeId` for each lesson start or
reconnect. The initial authored scene must already be rendered. The default
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

## Completion gate

A correct proposal with no unresolved need for help accepts an answer. It never
acknowledges and advances in the same observation. A strictly later tutor
transcript revision must again classify the latest answer as correct, with the
tutor acknowledging success. Other tutor states do not establish acknowledgment.
An `answering` proposal cannot establish completion authority during child speech.

Every newer transcript revision suspends both current answer and acknowledgment
authority until that exact revision is classified. A tutor-only update retains
the earlier correct revision as a candidate and retains audio for that child
turn, so revalidation can establish the subsequent acknowledgment. An incorrect,
unclear, absent, or help-needed answer clears the candidate and audio evidence.
Child speech and child/unknown transcript updates clear them immediately.

Local `output.activity` requires a fresh onset of `active` after correct acceptance,
then `quiet` sustained for the configured interval. Pre-answer audio and PCM that
was already active at acceptance cannot satisfy this gate. Repeated quiet events
preserve its start time; renewed activity resets it. `unavailable` clears audio
evidence and is never silence; quiet alone after unavailable cannot restore it.

Both orderings work: acknowledgment followed by audio drain, and audio drain
followed by acknowledgment. In the second ordering, the still-current quiet
interval can satisfy the gate immediately when acknowledgment arrives, or a
later tick can finish it. All four conditions must hold together for the exact
latest transcript: correct, acknowledgment, relevant audio observed, and drain.

PCM energy has no response identity and quiet may be a pause within tutor speech.
This spike's gate proves these local observations, not that the audible content
was an acknowledgment or that a provider response has definitively completed.
It intentionally fails closed when activity began before correct acceptance;
that case needs a later fresh onset to obtain audio evidence.

## Render and steering handoff

Once eligible, the reducer commits only the authored success target and enters
`rendering`. It emits `render.requested` with an exact identity: a token scoped to
the runtime and new visit, the node ID, and scene ID. Terminal success has null
node/scene IDs. The pending render also retains the originating visit identity.
No next-node steering context is available before confirmation.

`render.confirmed` must match the runtime, token, node, and scene exactly. It
activates the rendered node and emits one `steering.ready` payload containing
only that node, displayed scene facts, learning objective, and tutor brief.
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
