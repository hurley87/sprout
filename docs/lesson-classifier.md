# Current-node conversation-state classifier

The sole runtime classifier is
`lib/lesson-runtime/jev-conversation-state-classifier.ts`. Its shared Choice
contract, validation, thresholds, and deterministic mapper are in
`lib/lesson-runtime/conversation-observer-contract.ts`.
The stable diagnostic identifier is `conversation-state-v2`.

## Request and semantic contract

`/api/classify` accepts exactly `lessonId`, `nodeId`, `transcriptRevision`, and
`transcript`. The server resolves the application-owned lesson ID and rejects
unknown or cross-lesson nodes. It calls `classifyConversationStateWithDiagnostics`
with the resolved definition and one Jev request per classification. There is no
mode switch, fallback, or classifier configuration environment variable.
`TYPESAFE_API_KEY` remains server-only.

The model receives only authored current-node state. Presentation facts, objective
and Choice criteria come from the selected definition; authored edges and future
nodes are excluded:

```text
nodeId
scene: current-node presentation facts
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

The request does not include the runtime's accepted concept ledger or learner
explanations from previous nodes. Carry eligibility is authored context, while
actual carried evidence is checked separately by the reducer. Consequently a
current-node model assessment can describe an earlier concept as missing even
when the runtime has retained its accepted evidence. This is a context boundary,
not evidence that the learner must repeat an already accepted explanation.

Two Choice questions classify:

- `objectiveState`: completed, incorrect, unclear_or_incomplete,
  unresolved_help, no_attempt.
- `tutorState`: confirmed_completion, clarifying, helping, asking, other.

When the active node authors concept criteria, the same request adds one current
node Choice question per criterion. Its outputs distinguish not yet, partial,
independent demonstration, and prompted demonstration. Future-node criteria are
not projected. The server maps these outputs to tentative observations only;
the reducer binds them to the exact transcript source and owns accepted evidence,
reveals, and completion. Provider-free fixtures cover paraphrases, incomplete
explanations, self-correction, prompting, tutor answer leakage, and multiple
criteria. They verify wiring and reducer rules, not model semantic accuracy.

For concept scenes, instructions assess the accumulated learner explanation and
distinguish a tutor's later paraphrase from supplying an answer before the
learner attempts it. The current objective does not demand restatement of
criteria eligible for authored carry-forward. This eligibility is static lesson
context, not an assertion that the learner actually demonstrated those criteria;
the reducer still checks the retained evidence.

An uncertain global objective score can be settled by confident demonstrations
of every current criterion that is not eligible for carry-forward, together
with confident tutor confirmation. The authored `all_independent` policy still
requires independent labels. A confidently negative global objective, uncertain
tutor confirmation, or missing current criterion does not qualify. No threshold
changes are made. The reducer remains responsible for requiring all authored
criteria, including carried criteria, and for matching the current revision,
learner turn, tutor response, and drained audio before advancing. Scenes without
concepts retain their existing global objective/tutor gates.

Response validation checks the pinned model, closed option sets, finite scores,
normalized distributions, and a selected maximum. The deterministic mapper
retains the live path's existing confidence bands: HIGH 0.9,
COMPETITOR_CEILING 0.2, MIN_MARGIN 0.7. Choice confidence and normalized
probabilities are exported; thresholds are unchanged by promotion.

For scenes without concept criteria, only `completed` plus
`confirmed_completion`, after validation and confidence gates, emits the existing
correct/none/acknowledging proposal. Concept scenes additionally use the
criterion-based completion rule above and can emit individual criterion
observations while holding the scene. Invalid results abstain.
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
For concept lessons, discarded energy candidates preserve a pending missing-text
request and its tutor-audio quiet deadline. The request is deferred while a
candidate is active, then binds to the current source after discard. Confirmed
speech, late child text and visit changes still cancel it. This is conversational
recovery only: no prior answer, transcript eligibility or acknowledgment is restored.
Counting retains cancellation on candidate activity.
For semantic holds, any newer transcript revision cancels the wait so only a new
current classification can arm it again. For missing text, tutor transcript
fragments do not supply the missing child evidence. Both causes share a single
support request budget per visit. Concept scenes whose accepted ledger satisfies
their authored completion policy have a separate completion request budget, with
one second of sustained quiet. This allows fresh completion guidance after earlier
support was used while a concept was missing. It names the accepted private targets
and supersedes the earlier recovery focus. Each stage permits one request per visit,
including failed sends. Counting scenes retain their four-second single budget.
Network failures and stale classifications cannot arm
semantic recovery. The request
and its acknowledgment grant neither transcript eligibility nor completion:
fresh learner evidence, canonical classification, current tutor confirmation,
relevant audio/drain and render confirmation are still required. Failed sends
spend the corresponding stage budget and leave the scene held. Diagnostics use the
`answer_recovery.*` and `gpt_live.answer_recovery_append`
events. This recovery does not automatically restore an interrupted correct
answer, and the strict butterfly auto-completion test still distinguishes that
outcome from conversational recovery requiring a fresh child response.

## Understanding and prompting attribution

The four provider concept labels remain unchanged. Demonstrated independent and
demonstrated prompted are alternative attributions of demonstrated understanding.
The mapper sums those two probabilities to assess understanding separately, using
the same HIGH, competitor-ceiling and margin gates against partial and not-yet.
If understanding passes but neither attribution passes individually, it proposes
`demonstrated_unattributed`. The reducer records demonstrated status with null
understanding and null prompting attribution; it preserves an earlier established
attribution and its source when available. This satisfies `all_demonstrated`,
but cannot satisfy `all_independent` without earlier independent evidence.
The recap identifies demonstrated evidence with unclear prompting separately.
Mapping and diagnostic validation share the same score interpretation.

Durable tutor/checklist/recovery rules live in startup instructions, whose token
limit is separate from context appends. Per-scene updates are compact and contain
only the rendered current prompt, objective, brief and private targets. Source
provenance remains in the authored rubric and diagnostics; it is not repeated in
each append. Each update explicitly requests the displayed question aloud now,
then listening, unless the learner already began answering. See the [session
guide](https://developers.openai.com/api/docs/guides/live-conversations) for the
500-token append limit. Authored append byte-budget tests and offline tokenizer
checks guard against known context expansion; neither is the exact provider
counter nor a live speech-compliance assertion.

The Catching Unicorns tutor classifier observes the latest tutor conversational act
separately from whether every learner criterion is mastered. Explicit acceptance
with a paraphrase, added vocabulary, contrast or explanatory detail is confirmation
when no further question or retry request follows. Guidance without acceptance is
helping; earlier clarification does not change the latest act. Tutor affirmation never substitutes for learner
concept evidence or actual carry-forward evidence. All score thresholds remain
unchanged. When required concept evidence is recorded, recovery explicitly requests
brief confirmation now, allowing clarification instead for a contradictory latest
learner statement. Context acknowledgment alone is not spoken confirmation.

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


### Supporting utterances and advisory partial progress

Concept classification remains cumulative, but live requests now include one `source_<criterionId>` Choice question per criterion. It selects an application-indexed substantive learner utterance from the exact snapshot, or `none`. Source selection uses the existing confidence bands. Proposals carry `childMessageIndex`; the reducer validates the index and reads the quote itself. Tutor text, assent, filler, absent/uncertain locators, and ambiguous legacy cumulative snapshots cannot create learner evidence. Legacy proposals without locators remain usable only when there is one substantive learner utterance.

Prompting history identifies learner utterances, not repeated classifications: successive fragments update one entry, and unchanged cumulative observations preserve source and known attribution. A historical utterance first seen in a later turn uses `childTurnId: null`. Echo checks consider tutor content before the supporting learner utterance, preserving independence when a tutor later confirms it.

A uniquely winning but uncertain `partial` label maps to `partial_uncertain`. With a valid source, this records tentative partial progress with unknown understanding. Recovery can privately quote the learner's contribution for a tentative acknowledgment and focused non-leading clarification. These cues do not establish demonstration, reveal hidden answers, satisfy completion criteria, lower mastery thresholds, or overwrite accepted mastery. See [the provenance review](evidence-provenance-review-2026-10-07.md) for recorded evidence, replay annotations, checks, and live-provider limits.
