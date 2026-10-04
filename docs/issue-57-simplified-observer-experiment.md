# Issue #57: isolated two-choice observer experiment

The implementation and offline comparison are ready. Whether Jev performs better
is **unmeasured**: the saved artifacts contain nine-question outputs, but no outputs
for this two-choice contract. No provider calls or live lessons were run. The
recommendation is another bounded paired evaluation, before any production decision.

## Change and contract

`lib/experiments/issue-57/simplified-observer.ts` contains an experimental classifier,
Choice response validator and mapper. No production route or runtime imports it.
The current classifier, GPT-Live prompts, authored graph, reducer, thresholds and
runtime identity/recovery protections are unchanged.

The two questions use TypeSafe's documented [Choice primitive](https://docs.typesafe.ai/primitives/choice):
each returns one option, its full distribution and provider confidence. They are
still separate model questions; exclusivity within a question does not guarantee
consistency across questions.

- `objectiveState`: `completed`, `incorrect`, `unclear_or_incomplete`,
  `unresolved_help`, `no_attempt`. Current unresolved help takes precedence;
  resolved historical help does not veto later settled success. Status questions
  do not automatically retract settled answers. Genuine renewed uncertainty does.
- `tutorState`: `confirmed_completion`, `clarifying`, `helping`, `asking`, `other`.
  Interpret the latest tutor response in context. Generic praise/thanks or supplying
  a total without settled learner evidence cannot confirm completion.

Only `completed` AND `confirmed_completion` can emit the existing closed proposal:
correct answer, no unresolved support, acknowledgment, unknown child activity, and
locally captured node/revision. Conflicting confirmation labels abstain. Other
valid pairs hold without a proposal. Neither enum contains an edge or next node.

The evidence projection is exactly A's current scene/objective/transcript/revision
plus tutor and support projections. Tests compare all 42 inputs against A's actual
mocked wire request; no transcript-matching heuristics or input ablation were added.

Both distributions must pass the existing HIGH=.90, competitor ceiling=.20 and
minimum margin=.70. Provider confidence is retained but not used as a gate. The
existing LOW=.10 is unchanged in A; B has no separate binary support probability.
This removes that independent veto structurally, but **does not establish reduced
threshold sensitivity**. Choice calibration is unproven. Ungated label eligibility
is reported separately and never emitted as evidence. Missing options, nonfinite
scores, invalid distributions (sum tolerance 1e-6), choice/argmax mismatch, substituted
models, rejected/cancelled/unreadable responses all hold. No retries.

## Offline comparison

Run `node scripts/issue-57-observer-comparison.mjs --write` to rebuild
`docs/issue-57-simplified-observer-comparison.json`. Without `--write` it prints a
compact summary. This command loads local modules through the already installed
Vite dependency; it has no paid execution mode and does not load credentials.

The shared set reuses final-node recorded/synthetic cases, clarification cases,
the earlier replay, recorded self-correction cases and primary recorded cases from
the existing evaluation plan. Identical node/transcript pairs are deduplicated;
original source identities/revisions and reviews remain attached. Synthetic
supplied probability controls from the self-correction tests are excluded.

| Evidence | Result |
| --- | --- |
| Distinct node/transcript pairs | 42 |
| Cases with historical normalized nine-question vectors | 26 |
| Historical vectors, including repeats/replays | 37 |
| Current-mapper replay: completion evidence eligible | 9 observations |
| Current-mapper replay: accepted hold | 1 observation |
| Current-mapper replay: support ambiguous | 11 observations |
| Current-mapper replay: answer no winner | 8 observations |
| Current-mapper replay: tutor no winner | 7 observations |
| Current-mapper replay: tutor margin too small | 1 observation |
| Fresh current-contract A evaluations | 0 |
| Simplified B evaluations | 0 |

These counts are **observations, not independent cases or accuracy measurements**.
Old vectors exercise current mapping only; historical prompts differ or are not
fully recoverable. They are not fresh A results. The JSON retains every transcript,
existing review, source, available normalized vector, original decision,
current-mapper decision and outcome. Missing A/B evaluations are explicitly
`not_run`/`unmeasured` with null outputs; they are not manufactured from draft labels.

Some particularly useful historical contrasts are:

| Case | Current mapper on saved vector(s) | B |
| --- | --- | --- |
| Finished butterfly count after hint | `answer_no_winner` twice | Unmeasured |
| Older settled self-correction | `tutor_no_winner`; acknowledgment .87/.85 | Unmeasured |
| Latest settled two-duck correction | `support_ambiguous`; help .15, acknowledgment .95 | Unmeasured |
| Finished reaffirmation, “uh one” | `support_ambiguous`; help .12/.11 | Unmeasured |
| Latest settled one-duck correction | Completion evidence eligible | Unmeasured |
| Generic thanks after reaffirmation | `tutor_no_winner`; correct hold pending confirmation | Unmeasured |
| Butterfly “Is that all?” follow-up | `answer_no_winner`; review remains ambiguous | Unmeasured |

The set covers clean correct, wrong, wrong/retry/correct, self-correction,
help/learner-led count/confirmation, renewed help, incomplete count, tentative
answers, finished butterfly counting, status follow-ups, clarification/reaffirmation,
generic praise/thanks and tutor-supplied totals without learner completion.

**Improved cases:** none demonstrated. The settled butterfly count, resolved help,
self-correction and settled reaffirmation cases are candidates for fewer false
holds, but need measured B outputs. **Regressions:** unmeasured; mock acceptance
and negative-control mapping tests are not semantic evidence of no regressions.

**Remaining ambiguity:** “Is that all?” can be a status question or renewed task
doubt; fragmented “Maybe ... One” can remain tentative; a tutor confirmation plus
question can have mixed primary function; a tutor-supplied repetition is not proof
of independent mastery. Original reviewers flagged several of these as uncertain.
Do not relabel them as perfect ground truth because the new contract defines an
intended interpretation. Speaker attribution, missing words and acoustic tone
remain unverified. The compact contract cannot repair a confirmed child turn with
no fresh transcript.

## Exact bounded next evaluation, not executed

The JSON freezes full current A and candidate B questions, the pinned
`jev-1.13.0` model, contract hashes, projected input hashes and ordered request IDs.
Use identical projected state for both arms. Alternate arm order by case. Perform
two unchanged repetitions, no retries, fallback calls, option-order variants or
prompt tuning: **42 × 2 × 2 = 168 paid calls maximum**. Failed calls count toward
that cap. This two-arm plan is distinct from the prior three-arm proposal.

Before running, review ambiguous labels and freeze the reviewed expectations;
verify pricing, an explicit cost cap, request timeout and input/token bounds.
No dollar estimate is asserted without that verification. Any changes to the
cases, questions or bounds require a revised frozen plan. Paid execution requires
separate user authorization; the instruction to push does not authorize it.

Report reviewed negative false completions, resolved-case holds/abstentions,
per-state agreement, cross-question contradictions, ungated labels versus gate
failures, repeat stability, latency and cost. Separate recorded, synthetic and
unadjudicated cases. Do not tune bands on this set. Any false completion or missed
renewed help prevents recommending promotion. These small samples cannot establish
production reliability even with zero observed regressions.

Candidate completion proposals already pass through the unchanged reducer in
mocked offline tests. They require exact runtime/node/visit/child-turn/revision,
fresh current-turn evidence, interruption protection, relevant tutor audio drain,
and render confirmation before authored steering. The full existing runtime suite
adds broader coverage. Deterministic tests are not live audio/browser verification.

## Verification

The new tests validate all 25 enum pairs, strict wire normalization, probability
boundaries, identity capture, provider failures/cancellation, projection equivalence
for every case, request-plan hashes, and reducer completion protections using
synthetic supplied outputs. All repository unit tests, TypeScript checking and
ESLint pass. Formatting and diff whitespace checks pass. Production source files
remain unchanged. No new Jev semantic performance or live behavior is claimed.
