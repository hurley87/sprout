# Current-node conversation-state classifier

The sole runtime classifier is
`lib/lesson-runtime/jev-conversation-state-classifier.ts`. Its shared Choice
contract, validation, thresholds, and deterministic mapper are in
`lib/lesson-runtime/conversation-observer-contract.ts`.
The stable diagnostic identifier is `conversation-state-v2`.

## Request and semantic contract

`/api/classify` accepts exactly `nodeId`, `transcriptRevision`, and `transcript`.
It directly calls `classifyConversationStateWithDiagnostics`, with one Jev
request per classification. There is no mode switch, fallback, or classifier
configuration environment variable. `TYPESAFE_API_KEY` remains server-only.

The model receives only authored current-node state:

```text
nodeId
scene: { object, quantity }
learningObjective
transcript
transcriptRevision
```

The full ordered current-node transcript supplies context. No latest-message,
preceding-attempt, or support projection enters the model input. Earlier tutor
and child messages are context for interpreting the latest relevant tutor
response; earlier tutor actions are not the current action. Speaker attribution
remains unverified evidence. The caller supplies the current-node snapshot;
the observer does not accumulate session history.

Two Choice questions classify:

- `objectiveState`: completed, incorrect, unclear_or_incomplete,
  unresolved_help, no_attempt.
- `tutorState`: confirmed_completion, clarifying, helping, asking, other.

Response validation checks the pinned model, closed option sets, finite scores,
normalized distributions, and a selected maximum. The deterministic mapper
retains the live path's existing confidence bands: HIGH 0.9,
COMPETITOR_CEILING 0.2, MIN_MARGIN 0.7. Choice confidence and normalized
probabilities are exported; thresholds are unchanged by promotion.

Only `completed` plus `confirmed_completion`, after validation and confidence
gates, emits the existing correct/none/acknowledging proposal. Other accepted
states hold the scene without a proposal. Ambiguous or invalid results abstain.
The observer cannot select destinations or grant progression by itself.

## Runtime authority and diagnostics

The reducer still checks exact runtime/visit/child-turn/revision identity,
current acknowledgment, relevant tutor audio and drain. Render confirmation
still precedes authored-edge steering. Promotion changes neither VAD,
cancellation, stabilization timing, GPT-Live prompts, nor reducer semantics.

Exports include `classifierVersion` at the top level, on classifier events, and
in normalized mapping diagnostics. Diagnostics retain both choices and their
probabilities, mapped outcome, abstention reason, elapsed time, node ID, and
transcript revision. Raw provider bodies and secrets are excluded. HTTP errors
retain safe category/status/allowlisted-code diagnostics.

The full-context live path did not use the legacy Noul-only clarification
trigger. The canonical mapper still holds on uncertain Choice evidence. The
runtime now uses a separate bounded conversational recovery policy for canonical
semantic holds as well as confirmed turns with missing text.

Confirmed microphone turns that end without a usable current child transcript,
or a canonical held/abstained classification for the exact current snapshot,
arm the recovery path. After four seconds of sustained local
tutor-audio quiet, the runtime appends one request per visit asking the child to
repeat their answer. Late child text, new speech, scene changes, Stop or disconnect
cancel the wait; active or unavailable output pauses it until quiet returns.
For semantic holds, any newer transcript revision cancels the wait so only a new
current classification can arm it again. For missing text, tutor transcript
fragments do not supply the missing child evidence. Both causes share a single
request budget per visit. Network failures and stale classifications cannot arm
semantic recovery. The request
and its acknowledgment grant neither transcript eligibility nor completion:
fresh learner evidence, canonical classification, current tutor confirmation,
relevant audio/drain and render confirmation are still required. Failed sends
spend the visit budget and leave the scene held. Diagnostics use the
`answer_recovery.*` and `gpt_live.answer_recovery_append`
events. This recovery does not automatically restore an interrupted correct
answer, and the strict butterfly auto-completion test still distinguishes that
outcome from conversational recovery requiring a fresh child response.

## Offline evidence

Historical issue #57 documents and replay results remain unchanged.
The retired nine-question observer and mapper live under
`lib/experiments/issue-57/legacy/` solely for historical comparison scripts and
fixtures; no production module imports them. The projection-A adapter keeps
narrow evidence construction only for offline comparison. Both offline arms
reuse canonical Choice criteria, normalization, mapping, and execution, so
runtime-equivalent implementations cannot diverge.

The former `simplified-full-context` name and `classifierMode` occur only in
historical evidence or rejection tests. New sessions use the version identifier.
The archived [legacy contract](issue-57-legacy-classifier-contract.md) preserves
the earlier nine-question design for provenance.

Mock provider tests establish transport, validation, and mapping; they do not
calibrate Jev accuracy. The existing offline comparison hashes verify that the
promoted full-context question contract remains identical to the measured arm.
No paid provider call or live session is required by this cleanup.
