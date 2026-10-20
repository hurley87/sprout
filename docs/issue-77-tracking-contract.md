# Evidence, feedback, and delivery tracking (#77)

Design for [issue #77](https://github.com/hurley87/sprout/issues/77), checked against
parent `96af7a04daaf27e1c07e4f291b0c220d4924f567`. Implementations for commits 2
and 3 are described below; replay analysis remains follow-up work.
**Current** below describes baseline behavior; **proposed** means additive,
attempt-local observation. Optional policy work is separate. No tracking field may authorize progression, schedule Jev, or alter
an authored edge.

## Current lifecycle and identities

Paths below are relative to the repository; named functions/types are the source
anchors. `R` means `lib/lesson-runtime/lesson-runtime.ts`, `D` means
`lib/lesson-runtime/lesson-runtime-reducer.ts`.

| Boundary | Current identity and behavior | Source anchor |
| --- | --- | --- |
| Attempt / transport | `R` allocates a UUID `runtimeId` and local clock relative to `performance.now()`. `BrowserTransport` owns `activeSourceId`; its sole created source currently has ID `1`. Remote replacement within that source has no exported generation ID. Restart requires a fresh runtime. | `R: LessonRuntime`, `now`; `lib/browser-transport.ts: createSource`, `emit`, `connectSource`, `retireSource` |
| Provider input | `parseProviderEvent` retains optional `eventId`, transcript `speaker`, `delta`, `startMs`, `endMs`. Transport adds `sourceId` locally. Neither response ID nor final-transcript/completion markers exist in this union. Provider intervals and local receipt time are different clocks. | `lib/events.ts: ProviderEvent`, `parseProviderEvent` |
| Learner turn | Local microphone candidate/confirmed/end events drive reducer turn identity. Counting candidates allocate a new turn and suspend prior eligibility/audio for possible discard recovery. Conversation-first candidates defer the new turn until confirmation/text; they block finish immediately. Confirmed turns invalidate current authority. Energy does not prove speech content. | `R: receive`; `D: child.candidate.started`, `child.turn.started`, `child.turn.confirmed`, `child.candidate.discarded` |
| Transcript | `R` captures `RuntimeSource` (`runtimeId`, `visitId`, `childTurnId`) on receipt, fences old provider intervals/visits/turns, queues text pending steering acknowledgment, and sorts accepted fragments by provider start then local order. Changed assembled text increments the attempt-wide `revision`; `transcript.snapshot` stores full text and the triggering interval. Tutor is provider speaker `sprout`, normalized to `tutor` / `Tutor`. | `R: receive`, `observeTranscript`; `D: RuntimeSource`, `transcript.updated` |
| Jev request | Capture `ClassificationSource` (runtime/visit/turn **plus node/revision**) with the exact transcript before awaiting `/api/classify`. `lastClassifiedKey` prevents another request for that exact identity. Child snapshots debounce 300 ms; tutor scheduling uses the existing stabilization gate (600 ms stable text, 500 ms quiet). Steering, speaking, missing current-turn text and phase can block scheduling; conversation rechecks have explicit exceptions. | `R: scheduleClassification`, `syncTutorStabilization`, `classify`; `lib/lesson-runtime/tutor-stabilization.ts`; `D: classificationSource` |
| Jev result | Journal `classifier.started`, mapping (or mapping-unavailable), result/held/abstained/error/cancelled with the **captured** source. `elapsedMs` on result measures browser request elapsed time; mapping diagnostic has endpoint elapsed time. Mapping `decision: accepted` means a semantic mapping passed, not reducer acceptance. Aborted work may return without a result entry. | `R: classify`, `cancelClassification`; `lib/lesson-runtime/live-classification-diagnostic.ts: LiveClassificationDiagnostic` |
| Reducer consumption | A proposal must pass shape, authored node/criteria, exact runtime/visit/turn/node/revision, transcript and phase/speech checks; `consumedRevision` prevents duplicate consumption. Consumption can yield a hold, partial concept evidence or closure, rather than an accepted answer. Invalid/stale proposals return unchanged state. | `D: reduceLessonRuntime`, `proposal.received`; `lib/lesson-runtime/conversation-state-classifier.ts: parseConversationStateProposal` |
| Answer / tutor revision | On the counting path, correct + no help + not answering sets `answerAccepted` and retains/sets `acceptedAnswerRevision`. A tutor-authored exact snapshot classified acknowledging can also set acknowledgment. **Every new transcript revision clears current answer/acknowledgment and consumption.** Tutor-only text can retain the earlier correct revision/audio as candidates. Child/unknown text clears them. A nonqualifying consumed proposal clears current answer/audio evidence. | `D: transcript.updated`, `proposal.received`, `clearedEvidence` |
| Concept evidence | Authored criterion IDs/descriptions and selected learner messages support `ConceptEvidenceRecord`, separately from answer flags. `applyConceptObservations` validates snapshot-local indexes/spans, records quote/revision and prompting history, guards copied tutor wording, and retains strongest accepted evidence. `not_yet`, tentative partial, unresolved attribution and later prompted attempts do not simply erase prior independent demonstration. New runtime starts empty; carry-forward must be authored. | `lib/lesson-runtime/concept-evidence.ts: ConceptEvidenceReference`, `applyConceptObservations`; `D: requestAuthoredTransition`; `lib/lesson-runtime/lesson-definition.ts: LessonNodeDefinition` |
| Media | Local `output.activity` is `active`, `quiet`, or `unavailable`. Fresh post-answer onset can set `tutorOutputObserved` independently of classifier latency. Quiet plus elapsed drain can set `tutorOutputDrained`; unavailable clears observation. These names describe reducer gates, **not response playback completion**. | `lib/output-activity.ts: OutputActivityObserver`; `D: output.activity`, `outputHasDrained` |
| Transition / render | `finish` checks current semantics, authored policy and media drain. Optional presentation confirmation exposes `transitionReady`. `requestAuthoredTransition` follows only `onSuccess`, increments visit, records `pendingRender.origin`, and emits `render.requested` with token/node/scene (terminal node/scene are null). This commits a destination request, not confirmed presentation. Exact `render.confirmed` activates it and emits `steering.ready`, or terminal `lesson.completed`. | `D: finish`, `requestAuthoredTransition`, `render.confirmed`; `R: dispatch`, `confirmRendered`, `appendSteering` |

`R.dispatch` already journals `runtime.event.*` with the event and an `accepted`
boolean meaning **state object changed**, plus `runtime.changed` before/after and
all effects. That boolean is not an answer verdict or a rejection explanation.
Effects are logged after reduction: their journal envelope can describe the new
visit, so attribution must use `pendingRender.origin` / the captured pre-event
source. `render.confirmed` logging precedes reducer consumption; check the reducer
result/effect before claiming the scene activated. `lessonComplete` may already be
true in `rendering`; confirmed terminal completion is phase `complete` and the
`lesson.completed` effect.

## Proposed smallest observation contract

Reuse `DiagnosticJournal.append/observe/report`, `LessonRuntime.observe/report`,
and the opt-in `attachLessonObservation` bridge in
`lib/lesson-runtime/browser-observation.ts`. Keep existing events and report fields;
add typed tracking details and an optional snapshot projection. The complete
journal is the history; avoid a second mutable acceptance ledger or persistence.
The UI's last 100 diagnostics are insufficient for history. Full cursor reads and
exports already clone observations and have no transition authority.

Illustrative TypeScript below is **proposed**, not an existing public API. Referenced
runtime types are the current definitions in the source anchors above. Every new
name is observational; no field is read by the reducer's policy.

```ts
type TrackingOrigin = {
  source: ClassificationSource; // captured original source, never rebuilt on receipt
  sceneId: string; // authored presentation.sceneId ?? source.nodeId
  transportSourceId: number | null; // local activeSourceId; null if not captured
  providerEventId: string | null; // only for a fact triggered by an identified event
  providerInterval: { startMs: number; endMs: number } | null; // triggering text only
};
type TrackingRef = { runtimeId: string; offset: number }; // journal event index

type TrackingDetail =
  | {
      kind: "evidence";
      origin: TrackingOrigin;
      proposal: ConversationStateProposal | null;
      consumption: "consumed" | "ignored" | "not_dispatched";
      answerAccepted: boolean; // reducer acceptance at this boundary, before transition clearing
      acceptedAnswerRevision: number | null;
      conceptEvidence: LessonRuntimeState["conceptEvidence"]; // resulting ledger
      prior: TrackingRef | null; // prior related evidence record, if established
      subject: "answer_authority" | "concept_evidence" | "source_validity";
      criterionId: string | null; // authored ID for a concept-specific change
      change:
        | "observed"
        | "authority_suspended"
        | "superseded"
        | "revoked";
      reason: string | null; // known mechanical reason only; null = unknown
    }
  | {
      kind: "feedback";
      origin: TrackingOrigin;
      tutorMessageIndex: number | null; // exact request projection, not response ID
      semantic: ConversationStateProposal["tutorState"] | null;
      mapping: LiveClassificationDiagnostic | null;
      evidence: TrackingRef | null; // correlated learner record, if known
    }
  | {
      kind: "delivery";
      origin: TrackingOrigin;
      feedback: TrackingRef | null; // temporal correlation only
      pcm: "active" | "quiet" | "unavailable" | null;
      playbackFact:
        | "play_requested"
        | "play_resolved"
        | "play_rejected"
        | "playing"
        | "waiting"
        | "paused"
        | "ended"
        | "teardown"
        | null;
      responseId: null; // unavailable in current boundary
      responseComplete: "unknown";
      speechHeard: "unknown";
    };
```

`TrackingRef.offset` is a **proposed** zero-based index in this runtime's complete
journal, not the cursor's next offset and not a provider ID. Existing envelopes
supply `atMs`, wall `timestamp`, runtime/visit/turn/node/revision/speaker. Add typed
`tracking.*` records through the same append path; preserve the captured origin
inside detail even when the envelope reflects later state. For nonclassification
facts, construct the origin from the **pre-event** runtime and local revision;
retain a historical origin when linking back to old evidence. Do not stamp an old
answer with a new child turn.

| Field / projection | Provenance and missing-data rule |
| --- | --- |
| `source`, `sceneId`, `transportSourceId` | Existing `ClassificationSource` / `RuntimeSource`, authored node presentation, and `BrowserTransport.activeSourceId`; proposed capture into tracking. No provider turn identity. Scene is resolved from the origin node, not post-transition state. Historical exports may lack transport identity: null, never guess `1`. |
| `providerEventId`, `providerInterval` | Existing optional `ProviderEvent.eventId` and transcript interval; proposed retention at receipt, null for local events or composite snapshots without a single triggering provider event. They identify the trigger, not the entire accumulated evidence or a tutor response. Never assign a request snapshot the last packet's identity as if it owned all its words. |
| `proposal`, `consumption` | Existing parsed proposal and reducer guards / `consumedRevision`; proposed explicit observation of consumption. State-change `accepted` alone is insufficient. Null proposal distinguishes abstention/hold from invalid HTTP/schema failure through existing classifier events. Specific rejection reasons are not currently exported. |
| `answerAccepted`, `acceptedAnswerRevision`, `conceptEvidence` | Exact reducer result. Include pre/post runtime events when reduction immediately requests a transition and clears flags; record the accepted intermediate answer/concept outcome at its reducer branch if needed. Never infer “not accepted” solely from the cleared destination state. |
| Supporting learner text / criteria | For concepts, reuse `ConceptEvidenceReference`: original runtime/node/visit/revision, learner index/quote, optional inclusive span/messages, and nullable turn. Historical/spanning sources can have null turn. Snapshot indexes are not stable message IDs; preserve the original snapshot and reference. Authored objective and optional `concepts` ID/description/policy come from `LessonDefinition`; attach/project them with the snapshot. Counting has no concept source locator: retain the exact classified transcript as support, with fine-grained answer attribution/independence unavailable. |
| `prior`, `subject`, `criterionId`, `change`, `reason` | Proposed links and vocabulary derived from the actual event/guard and before/after values. Scope each change to answer authority, a specific concept record, or source validity; never revoke the whole learner history by implication. Use existing mechanical reasons (`newer_transcript_snapshot`, `child_turn_started`, `node_visit_changed`, etc.) where present; explain additional proposed reasons at their emitting branch. Unknown reasons remain null. |
| `semantic`, `mapping`, tutor index, `evidence` | Existing proposal tutor state and validated `LiveClassificationDiagnostic` (including normalized labels/probabilities, mapping decision/reason and elapsed time). Resolve latest tutor index using `transcriptMessages` in the exact request snapshot. Null if absent; evidence link is correlation, not a claim the tutor addressed that answer. |
| `pcm`, `feedback`, playback facts | PCM is current `OutputActivityEvent`; all added playback facts are proposed instrumentation at `attachPlayback`, audio-element callbacks and teardown. `play_resolved` is a resolved play promise; `playing` is an element event. Neither proves words heard or identifies a response. `ended` on a stream is not a response end. No callback means unknown, not quiet or completed. |
| Current eligibility / transition | Read the existing runtime snapshot (`phase`, `consumedRevision`, answer/ack flags, concept ledger, quiet/audio gates, `transitionReady`, `pendingRender`) and existing transition/render events. Reuse `hasCurrentCompletionEvidence`, `meetsAuthoredCompletionPolicy` and existing gate results for explanation; do not create a second eligibility engine. Preserve origin plus destination `RenderIdentity` on request, and require exact confirmation/effect for committed presentation. |

History records **what was accepted at that time**. A tutor-only revision records
`authority_suspended` with a proposed reason such as `tutor_revision_revalidation`;
it must not say the learner was wrong or that independent concept evidence was
revoked. A later same-answer revalidation links to the earlier observation rather
than counting a new attempt. `superseded` denotes a newer source/judgment replacing
a current candidate; `revoked` requires a known invalidation of that specific
claim. Mechanical context invalidation is not semantic incorrectness. The current
concept merger deliberately retains strongest evidence; this work must not add
concept revocation policy that the merger does not implement.

Examples (schematic observations, not fabricated session findings):

- Counting: source `(runtime A, visit 1, turn 3, node ducks, revision 8)` yields
  correct/no-help and an accepted answer. Tutor revision 9 clears current flags;
  append suspension linked to revision 8, retain its original source. Jev at
  revision 9 may revalidate correct + acknowledging. Media quiet can satisfy the
  existing drain gate, while `responseComplete` and `speechHeard` remain unknown.
- Concept: criterion `exogram-durability` may reference learner message 2 at
  revision 12 with `understanding: independent`. A later tutor paraphrase is
  neither a new learner attempt nor retroactive prompting. If the supporting
  explanation spans messages, retain the complete span and nullable turn; do not
  substitute the latest learner assent for the original source.
- Child “No, three”: retain the earlier accepted record, suspend current authority
  at the new turn/text, and record the next evaluation separately. Label a
  semantic correction only when supported by existing observations/review; the
  receipt of new words itself is only a mechanical source change.

## Commit 2 implementation

`evidence-tracking.ts` now projects typed `tracking.evidence` and `tracking.feedback`
records into the complete `DiagnosticJournal`, available through existing
`LessonRuntime.observe/report` and the observation bridge. The journal remains the
only history. `prior` and feedback `evidence` use its zero-based offsets; feedback
links the exact dispatched proposal observation, including an ignored duplicate,
rather than searching backward for an accepted answer. Links correlate observations;
they do not assert that tutor text addressed a particular learner utterance.

Each evaluation retains its captured classification/transport origin, exact request
transcript, authored objective, concepts and completion policy. Composite snapshots
have null provider packet/interval fields. The resulting concept ledger retains its
existing quote/span, prompting history and independent/prompted attribution; counting
attribution and independence remain `unknown`. Feedback preserves the validated
mapping (including Jev labels/probabilities), proposed tutor state and snapshot-local
tutor index; correction, contradiction and general prompting remain `unknown`.

Additive `proposalConsumption` reducer result metadata distinguishes consumption
from ignoring and captures answer/acknowledgment/concept results **before** `finish`
can clear flags during a transition. Reasons identify the actual existing boundary:
`runtime_event_ineligible`, `inactive_or_source_mismatch`,
`classification_source_mismatch`, `proposal_guard_rejected`, or
`revision_already_consumed`. Grouped reasons intentionally do not claim which
individual semantic guard failed. A consumed nonqualifying answer has
`nonqualifying_answer_judgment` at the existing clearing branch. States, effects,
guard evaluation order and policy outcomes are unchanged.
Tutor revisions suspend current answer authority with `tutor_revision_revalidation`;
other mechanical invalidations use the triggering event type or `node_visit_changed`.
A transition immediately following acceptance records both acceptance and
supersession. Historical sources remain unchanged, including after a new child turn.

Optional `evidenceEligibility` in snapshots/reports projects the existing
`hasCurrentCompletionEvidence` and `meetsAuthoredCompletionPolicy` predicates,
phase, `transitionReady` and pending render. These are current gates, not a new
advancement evaluator; audio and speech gates remain in the runtime state. No
tracking history is consulted by progression. Consumers must tolerate absent
tracking records and eligibility fields in older exports. Playback instrumentation,
delivery claims and broad replay analysis are outside this commit.

## Commit 3 implementation

A dedicated optional `BrowserTransport.setPlaybackDiagnosticSink` exports
`play_requested`, promise resolution/rejection, audio-element `playing`,
`waiting`, `paused`, `ended`, and explicit attachment `teardown` facts.
Instrumentation is independent of microphone diagnostics and does not add
`ProviderEvent` variants. The runtime tolerates older transport doubles without
the sink or attachment getter. No remote attachment means no playback facts.

Each remote-track attachment has a monotonically increasing local
`attachmentGeneration`, unrelated to provider response identity. Playback
callbacks and promises capture the transport source, remote stream and generation.
Replacement and stop unregister listeners; saved callbacks and late promise
settlements are fenced. Element listeners also check the currently attached
stream and reject events whose creation timestamp predates attachment. Element
facts describe the shared element at observation time; the browser provides no
per-response identity or proof that an element event belongs to particular words.

`LessonRuntime` captures playback's runtime origin at `play_requested` and retains
it through later facts and teardown, even across learner turns. This conservative
attachment origin must not be read as the source of all speech on the stream.
PCM delivery records instead capture the original pre-dispatch runtime exchange,
actual provider-boundary source ID (null if missing), nullable attachment
generation and the existing pre-event `outputActivity`, `tutorOutputObserved`
and `tutorOutputDrained` gate values separately. The existing `output.activity`
and reducer diagnostics still record the normal event and resulting gate changes.

Typed `tracking.delivery` records share the complete journal and observe/report
exports. A `feedback` journal reference is `inferred_temporal` only, using a
previously observed feedback record with a tutor message in the same
runtime/node/visit/turn, known
transport source and no newer transcript revision. Missing correlation stays null;
classification that arrives later does not retroactively rewrite media history.
Playback facts use their captured attachment origin rather than being relabelled
as feedback in a newer exchange. Reports and cursor reads clone delivery details.

Every delivery record keeps `responseId: null`, `responseComplete: "unknown"`
and `speechHeard: "unknown"`. Quiet, a resolved play promise, an element/stream
end or teardown never upgrades those fields. Uninstrumented history remains
unknown. Tracking does not dispatch reducer events, request classifications,
schedule Jev, or change playback, thresholds, media gates or transition policy.

## Observation limits and invalidation

Jev currently exposes tutor Choice labels `confirmed_completion`, `clarifying`,
`helping`, `asking`, `other`, mapped to proposal states `acknowledging`,
`clarifying`, `helping`, `asking`, `unknown`. The proposal type also permits
`listening`, but this mapper does not produce it. There is no dedicated tutor
**correction**, **contradiction**, or **prompting/answer-leakage** judgment.
Concept prompted/independent observations and deterministic echo/span guards are
narrower evidence about learner sources, not a general tutor feedback classifier.
Keep these categories unknown unless existing evidence or explicit human review
supports them. Do not add model questions, thresholds or a second classifier.

`OutputActivityObserver` samples decoded remote PCM every 50 ms with a fixed
energy floor through a zero-gain sink, independently of the playback element.
Quiet can be a pause inside a response. The transport calls `audio.play`
and fails on rejection; commit 3 journals the available promise/element facts,
but per-response start, drain, cancellation and speech heard remain unavailable.
Track replacement emits unavailable and increments the local attachment generation.
Source retirement/stop proves teardown, not that any particular response was
cancelled before/after delivery. Do not infer provider response-finished support.

Keep three levels explicit: observed PCM/element event; inferred temporal
association with a source/visit/turn/tutor snapshot; unknown response completion
and audibility. No timer, text arrival, play promise, or PCM quiet interval
upgrades the last level. Missing playback instrumentation in old sanitized exports
cannot be reconstructed by replay.

Duplicate provider IDs and nonactive transport sources are dropped before current
runtime journaling; invalid transcript intervals/visit/turn sources have explicit
`transcript.ignored` reasons. Aborts, duplicate proposal consumption, stale
runtime/visit/turn/revision, new learner turns, unavailable media, replacement and
stopping must never relabel an old result as current. Add rejection diagnostics at
existing decision boundaries if required; do not change which events are dropped.
Interrupted unconfirmed ordinary renders stop and roll back to origin; terminal
recap output resumption instead suspends confirmation and issues a fresh token
after drain. Keep these existing special cases.

## Behavior-preserving follow-up and verification

Minimum later implementation: add the typed observation projection and journal
records at existing transcript/classifier/reducer boundaries, including answer
acceptance before immediate transition clearing; add source-fenced local playback
facts in `BrowserTransport`; expose them through current observe/report paths.
Retain original source references and inspect acceptance history from journal
records. Determine whether explicit reducer rejection reasons require additive
result metadata; do not duplicate guards in a competing evaluator. Optional report
fields must remain readable when absent in older exports. No changes to scheduling,
evaluator settings, advancement, concept merging, audio gates or render handoff.

Counting requires exact current answer + tutor acknowledgment + relevant PCM/drain.
Concept nodes additionally use authored completion policy where applicable;
conversation-first Catching Unicorns separates closure/navigation from mastery and
can advance unresolved concepts, including a current explicit learner move-on
request with quiet but no fresh tutor onset. Brief learner backchannels and
microphone-only recovery have their existing special handling. Terminal recap
uses accepted-evidence text checking, fresh output and at least 1,500 ms quiet,
exact render confirmation and a 60-second failure deadline, without Jev completion
classification. Tracking must describe each path without applying counting rules
to all lessons. Post-conversation assessment is not live mastery authority.

| Subsequent verification case | Required observable distinction / invariant |
| --- | --- |
| Correct / incorrect / help / uncertain | Mapping acceptance, reducer consumption and answer acceptance stay separate; no new transition or changed Jev request count. |
| Tutor-only recheck after correct | Earlier acceptance/source survives in history; latest flags still reset and require existing revalidation. Measure extra requests without assuming they are unnecessary. |
| Prompting, copied answer, contradictory tutor text | Preserve actual concept source/attribution and existing guards; unsupported tutor categories stay unknown. No added semantic judgments. |
| Self-correction / changed transcript / split explanation | Preserve original quote/span and new revision separately; stale results never overwrite current state or manufacture independent mastery. |
| “Why?” after correct | Record the new turn and suspended authority, then fresh feedback/evaluation; explore conversational opportunity without automatically retaining counting advancement authority. |
| Interrupted feedback / discarded candidate / no transcript | Record PCM and playback facts separately from turn/content; retain baseline suspension, discard and conversation recheck behavior. No assumption about the acoustic cause. |
| Late / duplicate / aborted / replaced source | Original identity and known ignore/cancel reason remain inspectable; no current acceptance from stale work or old attachment callbacks. |
| Quiet pause / unavailable / missing playback / blocked play | Preserve existing gate decisions; delivery completion/heard remain unknown. Quiet alone cannot claim a delivered response. |
| Transition / render interruption / duplicate confirmation | Compare requested target/token/origin, confirmed activation and steering separately; no stale token releases steering. Include recap resumption/reconfirmation. |
| Conversation-first / concept / skip / recap | Same baseline closure, unresolved criteria, carry-forward, skip and terminal outcomes; navigation never counts as mastery. |

Replay existing sanitized counting and Catching Unicorns fixtures with identical
lesson/evaluator settings. Compare ordered Jev request source keys, cancellations,
reducer decisions/effects, targets and confirmation identities before/after;
normalize attempt UUID/clock offsets where necessary. Deterministic doubles prove
tracking preserves orchestration, not live Jev accuracy or audibility. Report
answer-end (provider interval versus local receipt separately), browser request
elapsed, endpoint evaluator elapsed, PCM onset/quiet, any actual playback facts,
render request/confirmation and steering timing. Endpoint elapsed is not necessarily
pure model compute; do not subtract unrelated clocks or assign all residual time
to generation/playback. Mark absent stages unknown. No new real-audio benefit may
be claimed without a human-reviewed authorized walkthrough.

Unresolved: response-level delivery/completion is unavailable; counting
fine-grained answer/independence attribution is unavailable; existing concept
retention does not model every possible later contradiction. Old exports cannot
fill these gaps. After tracking/replay, recommend **adopt / refine / defer / no
change** for policy based on actual traces, including the possibility of no
meaningful behavioral defect. Any later experiment must be minimal, opt-in on the
existing counting path and separately reviewed. No broad orchestration rewrite,
durable learner memory, Grok migration, model change or behavioral policy change
is part of this contract.
