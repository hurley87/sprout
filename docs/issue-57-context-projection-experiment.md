# Issue #57: transcript versus structural projections

The isolated comparison is prepared, with no provider execution. Existing results
cannot answer whether full history improves Jev: they use the historical nine-Noul
contract, not the simplified two-Choice contract with either input. Production
behavior and the baseline simplified classifier remain unchanged.

## Exact input difference

**A already includes the full ordered transcript.** It sends:

```text
nodeId, scene {object, quantity}, learningObjective,
transcript, tutorObservation, supportEvidence, transcriptRevision
```

B sends the identical current-node/visit transcript and authored facts, omitting
only `tutorObservation` and `supportEvidence`:

```text
nodeId, scene {object, quantity}, learningObjective,
transcript, transcriptRevision
```

This is an experiment about removing redundant projections and possible focal
bias, rather than adding previously absent conversation turns. In the butterfly
follow-up, A's structural `precedingChildAttempt` is “Is that all”, but its transcript
already contains the completed count and earlier tutor confirmation. B preserves
all those turns, with no structural preceding-attempt cue.

`lib/experiments/issue-57/context-projection.ts` builds closed request bodies only;
it does not make provider calls. B bypasses the projection helpers when building
the model input. It never includes the graph, edges, future scenes, previous-node
fields or provider identity claims. The supplied snapshot must belong to the
current authored node/visit; this code does not infer visit boundaries from words
or reconstruct missing speech. Existing runtime code already resets the transcript
at a committed visit boundary and rejects earlier-visit intervals/sources. That
runtime code is unchanged and is not connected to this experiment.

## Same semantic contract in both arms

The objective/tutor choices, all criterion text, model `jev-1.13.0`, probability
bands, normalization and mapper are reused unchanged. Only completed plus
confirmed-completion can emit candidate semantic evidence. Current help,
uncertainty, unfinished corrections and changed answers can invalidate settlement;
historical help alone cannot. Generic praise/thanks and tutor-supplied answers
cannot manufacture learner completion.

One shared **locator-only instruction adaptation** is necessary because the
baseline tutor instruction explicitly references a field B omits:

```text
Before:
Describe only tutorObservation.latestMessage using precedingChildAttempt
and the full transcript as context.

Both comparison arms:
Describe only the latest relevant tutor response in the ordered transcript,
using earlier child and tutor messages as context. Earlier messages are
context only, never the latest tutor action.
```

This changes no enum, criteria or semantic target and applies identically to both
arms. The original baseline questions/file remain untouched. Consequently A has
the existing input projection with this shared locator adaptation; this is not an
exact rerun of the original field-addressed prompt. The artifact records both
contracts' hashes and the exact sentence difference. Comparing arm-specific
instructions would confound the input experiment.

## Review set and bounded plan

The exact same **42 cases** from the simplified-contract experiment are reused,
in the same order, with identical inputs, revisions and existing review provenance.
No favorable new cases or transcript edits were added. Each case records both
exact projected states/hashes, existing interpretations, output slots and
comparison classification. Current output slots are empty and comparisons are
`still ambiguous` with reason `unmeasured`; this is missing evidence, not 42 model
mistakes. Historical nine-question evidence is referenced and explicitly excluded
from measured projection results.

The frozen plan is **168 fresh Jev calls maximum**:
42 cases × 2 projections × 2 unchanged repetitions. Alternate arm order by case.
No retries, fallback calls, prompt modifications, option-order variants or live
lessons. Failed attempts consume the cap. Use identical questions/model/settings
for both arms, a 10-second request timeout and a 32,768-byte serialized-request
limit. Every frozen request fits that limit. Stop on overflow; do not truncate.
Verify provider pricing and an explicit dollar cap before approval/execution.
No earlier paid-call authorization exists for this comparison. The instruction
to push authorizes the code push, not these calls.

Rebuild the offline plan/report with:

```sh
node scripts/issue-57-context-projection-comparison.mjs --write
```

The machine-readable report is
`docs/issue-57-context-projection-comparison.json`. Its ordered manifest binds each
case/arm/repetition to the exact projected-state and shared-contract hashes.

The report command has no provider execution mode. After an authorized evaluation,
it can ingest normalized results and preserve model, latency, distributions,
mapped enums, abstention reason, evidence eligibility and conditional runtime
outcome. Example invocation:

```sh
node scripts/issue-57-context-projection-comparison.mjs \
  --results normalized-results.json \
  --expectations reviewed-enums.json \
  --write
```

Schemas are recorded in the plan. Duplicate/mismatched IDs, hashes, models, invalid
probabilities and latency are rejected. Failed requests preserve a closed failure
category, null semantic output and latency; they are not retried or treated as
semantic regressions. Explicit human-reviewed enum expectations may be imported;
freeze them before calls. Original prose/draft labels are retained, never converted
into ground truth by phrase matching. Disputed cases remain unadjudicated.

Stable paired results are classified as improved/regressed only against reviewed
semantic states and accepted mapping gates. Equal accepted states/outcomes are
unchanged, which does not prove correctness. Abstentions, missing/failed outputs,
repeat instability or different judgments without adjudication remain ambiguous.
Probability differences are preserved even when mapped outcomes are unchanged.

For any measured regression, human review must identify whether earlier wrong
answers, help, tutor actions, acknowledgments or unrelated conversation dominated
the latest state. A causal contamination label cannot be inferred from distributions
alone. The current artifact leaves contamination null/unmeasured.

## Answers supported by the current evidence

| Question | Finding |
| --- | --- |
| Which cases improved? | Unmeasured; no simplified projection outputs exist. |
| Which cases regressed? | Unmeasured; zero recorded regressions is not evidence of safety. |
| Does old context contaminate judgments? | Unmeasured; inspect all five contamination categories after paired results. |
| Are tutor/support projections useful, harmful or unnecessary? | Undetermined. A already supplies the full transcript, so suppression/focal bias is a plausible hypothesis, not a finding. |
| Should full transcript alone become production input? | No production decision is supported yet. Keep production unchanged pending review. |
| Is another narrower experiment needed? | First run this prepared input-only comparison after approval. If it shows an effect, a later one-projection-at-a-time ablation can identify which helper matters. Do not add those arms to this run. |

Prioritize evolved interactions: wrong/retry/correct, self-correction,
help/settled count/acknowledgment, renewed help, partial counts, alternatives,
tutor-supplied answers, butterfly status follow-ups, child/tutor reaffirmations,
generic thanks/praise and historical help resolved by later learner success.
Interpret status questions contextually without automatically revoking settlement;
missing words, ambiguous tone and unverified attribution remain limitations.

Semantic eligibility remains conditional. The shared mapper emits the existing
closed proposal; unchanged reducer gates still require exact runtime/node/visit/
child-turn/revision, fresh current-turn evidence, interruption protection,
relevant audio drain and render confirmation before authored steering. The offline
report cannot claim an actual live runtime transition or audible behavior.

## Verification

Projection tests check all 42 cases for identical transcripts/common fields and
identical questions/model, exact B keys, baseline semantic preservation, input
validation and manifest hashes/bounds. Synthetic-result tests cover reviewed
comparison labels, ambiguous results, negative completion states, offline import,
duplicate/mismatched snapshots and provider failures. These are software tests,
not Jev performance evidence. The full unit suite, typecheck, lint and formatting
checks pass. GPT-Live prompts, production classifiers, graph/reducer, identities,
interruption/output/render protection and scheduling remain unchanged.
