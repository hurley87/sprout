# Commit 2: concept evidence recognition and attribution

## Evidence and pipeline

The regression fixture extracts exact classifier inputs and normalized scores from
`sprout-catching-unicorns-61325729-348d-4c2a-8c1f-77b753d950cb.json`, recorded
October 16, 2026. `outputs` are original demo scores; `replayOutputs` are live
Jev 1.14.0 responses to the same snapshots after this change. Controls are clearly
labelled realistic authored transcripts with live responses, not demo recordings.
Tests replay frozen responses, not network calls or invented confidence scores.

The runtime orders transcript fragments by provider interval, captures the node,
revision and transcript together, and sends the full current-node snapshot to
`/api/classify`. Consecutive same-speaker fragments are grouped by
`transcriptMessages()`. The omitted words were present in the classifier input;
this was not transcript truncation. Prior-node demonstrations travel through
explicit carry-forward evidence, not inferred restatements.

`conversationStateQuestions()` asks separate concept and learner-source Choices.
Jev responses are shape/probability validated, then mapped in
`conversation-observer-contract.ts` to the proposal contract in
`conversation-state-classifier.ts`. No proposal schema change was necessary.
`applyConceptObservations()` validates the selected learner source against the
exact snapshot and stores its text, node/visit/revision, message index, and
prompting history in `conceptEvidence`. Tutor text and ambiguous source selections
cannot become accepted learner sources. The runtime export persists these records.

## Findings and changes

| Criterion | Observed original failure | Change and replay result |
| --- | --- | --- |
| External memory | Independent .59 + prompted .03, partial .37; source message 1 was clear (.96). No demonstration mapped. | Assessment-only sufficiency note accepts information outside the brain without requiring “non-biological” or an example. Replay demonstrates it independently at message 1. |
| Durability | Independent .85 + prompted .05 met the existing aggregate gate. | Still demonstrated at message 1. In the final recorded replay, prompting attribution remains unresolved; it is not guessed. |
| Shareability | Independent .79 + prompted .06 failed the gate despite source message 1 at .97. | Assess properties independently and accept “easier to share” without requiring an additional distribution example. Replay demonstrates sharing independently at message 1. |
| Revisability | Independent .88 + prompted .03 met the aggregate gate. | Replay demonstrates revision independently at message 1. |
| Visual symbols | Final scores favored partial (.55); source confidence .77 was insufficient. | Remains uncertain, not demonstrated. Writing/math/external representations alone do not automatically settle meaningful visual inscription. No criterion relaxation added. |
| Cultural agreement | Final demonstration aggregate .97, but source split .65/.34 between messages 5 and 7 prevented persistence. | Clarify shared-understanding paraphrases, neutral questions versus answer-giving, and select the earliest supporting explanation across tutor acknowledgments. Replay independently demonstrates agreement at message 5. |
| Beyond prose | Mathematics demonstrated at revision 111; final source split .50/.47 between two valid learner mentions. | Prefer the earliest sufficient source, message 1. Replay recognizes it earlier and retains it cumulatively. |
| Abstract concepts | Initially partial; final independent .91 and source message 7 at .94 passed. | Retains the supported final demonstration at message 7; early naming of math alone does not establish abstraction. |

The score failures are directly observed. The semantic causes are inferred from
rubric/context inspection and paired live replay; this is not a calibrated model
accuracy study or proof that one particular wording caused a particular score.

Concept questions previously inherited final-position/objective instructions,
including “later evidence can supersede … help,” alongside cumulative instructions.
They now use criterion-specific cumulative instructions. Source selection uses the
same criterion sufficiency and a deterministic earliest-support tie-break. These
notes live exclusively in the classifier request: authored lesson descriptions,
GPT-Live context, graph, navigation, recap UI and providers are unchanged.

The reducer previously protected tentative partials and unchanged utterances,
but a later confident partial at a different source could erase demonstration.
It now retains the strongest accepted record with its original source/attribution,
while retaining separate later attempt history. A new ambiguous source cannot
borrow an earlier source's independent attribution. Exact copied tutor definitions
are partial even when the provider proposes prompted or unattributed demonstration;
a learner's own application after answer-giving can still be demonstrated_prompted.

## Thresholds and validation

All thresholds and probability mapping are unchanged: HIGH .90, competitor
ceiling .20, minimum margin .70. Demonstration can still aggregate independent and
prompted probability while leaving attribution unresolved. Source confidence is
not pooled across utterances. No model retries, fallback or provider changes.
Live replay remains probabilistic; source/attribution uncertainty continues to
abstain rather than invent certainty. Unresolved concepts do not gate navigation.

- 18 new regression tests cover recorded exogram/comparison/exographics snapshots,
  cumulative evidence, exact learner provenance, prompted application, vague/skip/
  unanswered/copy/keyword controls, and adversarial provider copy labels.
- 58 non-experimental test files pass: 1,164 tests, including all new regressions.
- The full suite has 1,178 passing tests, one failing historical prompt-hash test,
  and two historical experiment suites rejected at initialization by frozen source
  hashes (48 skipped). These are explicit incompatibility guards for the October
  14 benchmark contract. Its immutable artifacts and Decisions adapter were not
  rewritten or rebaselined to conceal the new active classifier contract.
- The exact staged tree also passes 196 tests across seven targeted files in an
  isolated directory, without any of the pre-existing uncommitted changes.
- ESLint passes for changed TypeScript files. TypeScript passes with a temporary
  config excluding ignored `test-results/` and `.sprout-evidence/`. The repository
  `npm run typecheck` encounters unrelated stale review copies in ignored
  `test-results/commit3-review/` and `test-results/ui-review/`; those files were
  left intact.
