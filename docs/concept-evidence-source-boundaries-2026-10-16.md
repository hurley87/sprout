# Single-message concept evidence boundaries

The recording is `sprout-catching-unicorns-469a81f7-d59f-4d53-a1a3-a336279bf334.json`.
The regression fixture contains all 20 non-null `classifier.mapping` outputs,
unchanged, paired with the exact `classifier.started` transcript for that node
and revision. It contains recorded scores, not newly generated model responses.

## Cause and scope

`conversationStateQuestions()` introduced separate source start and end Choices
to support learner explanations split by tutor interjections. Normalization
validates their options and scores; `interpretConversationOutputs()` gates both
boundaries before constructing `childMessageIndex`/`childMessageEndIndex`.
`applyConceptObservations()` then validates the actual learner source and stores
its text, provenance and prompting history. A null start is correctly rejected.

Both boundaries were required even with exactly one eligible learner message.
Engram revision 22 had demonstration/start/end probabilities .96/.99/.88;
exogram revision 34 had .98/.99/.85. Both classifications and starts passed,
but the unnecessary end decision cleared the source and prevented persistence.
These are selected-option probabilities, not the provider's separate `confidence`
field (the existing mapper gates probabilities).

The fix changes only `conversation-observer-contract.ts`:

- Determine whether the exact speaker-labelled transcript has one eligible learner
  source, using the existing source options including incomplete fragments.
  Consecutive learner fragments remain grouped as before. Assent is not evidence.
- Omit `sourceEnd` from new requests only in that case, and allow its omission in
  live normalization. Still validate older exports containing both Choices.
- With transcript proof and a confident start at that sole source, end equals
  start by construction. The redundant historical end score is unnecessary.
- With multiple eligible messages, keep the existing two-boundary questions and
  confidence gates. A matching but uncertain end choice is insufficient. Score-only
  interpretation without a transcript remains conservative. Historical source-only
  export compatibility remains unchanged.

No reducer, proposal/reference schema, global threshold, model, authored lesson,
GPT-Live prompt, UI, navigation or terminal completion changes are needed. The
reducer still rejects tutor sources, downgrades copied definitions and unresolved
intervening help, and retains accepted evidence through uncertain reclassification.
A known boundary does not establish meaning or independent understanding.

## Exact recording replay

| Evidence | Before | After |
| --- | --- | --- |
| Engram, revision 22, learner message 1 | Null source; no persisted demonstration | Demonstrated independently, original learner text, prompted=false |
| Exogram, revision 34, learner message 1 | Null source; no persisted demonstration | Demonstrated independently; retained through later uncertain classifications |
| Durability, shareability, revisability, cultural agreement | Demonstrated independently | Demonstrated independently |
| Beyond prose | Unresolved | Unresolved |
| Abstract concepts | Unresolved | Unresolved |

The existing recap projection now includes engrams and exograms in its independent
category when these valid records have been persisted. No recap delivery/completion
code was changed. This is a deterministic score replay, not a new live demo.

For beyond-prose/abstract-concepts, the single-source snapshots still fail the
concept gate (revision 206 demonstration totals .74/.88). Later snapshots have
multiple learner candidates: beyond-prose end probabilities .79/.77/.88 remain
below .90; abstract-concepts start probabilities .61/.61/.52 remain below .90.
The fix deliberately does not resolve those ambiguities or promote their scores.
A self-contained answer inside a transcript with multiple eligible learner messages
still needs a confident end; structural uniqueness cannot prove that case.

## Validation

The new tests reproduce both exact failures against the original HEAD mapper,
then pass after the fix. They also replay every recorded output through the
mapper and reducer and verify recap categorization. Controls cover optional live
ends, historical uncertain ends, low-confidence/none starts, partials, copied tutor
definitions, prompted and unattributed evidence, short ambiguous continuations,
and retained demonstrations. Existing span tests cover complete long explanations,
neutral acknowledgments, substantive intervening help, malformed boundaries and
copied multi-message definitions.

The isolated commit tree passes all 60 non-historical test files (1,182 tests),
`npm run typecheck`, and ESLint for changed TypeScript. The working-checkout
typecheck includes stale ignored review copies in `test-results/` and fails on
their existing errors; it passes with ignored `test-results/` and `.sprout-evidence/`
review copies excluded via a temporary config.

The full run also encounters three historical issue #42 guards: one benchmark
question-hash test and two suites rejecting the active contract's source hash.
All three fail against the original HEAD contract as well. Their artifacts and
compatibility hashes were left unchanged; no rebaseline was performed.
