# Commit 4: fragmented concept evidence attribution

Starting commit: `de4b0b9`, branch `codex/issue-71-catching-unicorns-demo`, PR #72.

## What can be established about October 17

The original `sprout-catching-unicorns-af06ed93-d150-4dc5-935e-f2db02934db6.json`
export is absent from this workspace and the supplied attachments. The request
reports mathematics, numbers/plus, abstract concepts and numerical relationships
in the learner explanation, with shared meaning introduced by the tutor. It does
not supply raw deltas, timestamps, scores, locator choices, or proposal identities.
Consequently the exact rejected observations and precise incident root cause
cannot be established. This change does not claim to repair that historical ledger.

The new fixture is a reconstruction from that account. All wording, provider
intervals, backchannel placement, HTTP responses, confidence scores and source
indexes used in its tests are explicitly synthetic. The existing October 16
fixtures continue to supply actual recorded inputs/outputs in regression tests;
they are not relabelled as October 17 evidence.

A significant terminology correction: Jev returns four concept labels. The
application mapper creates `demonstrated_unattributed` when the independent and
prompted probabilities jointly pass the existing demonstration gate but neither
prompting label individually wins confidently. This label does **not** establish
whether a source locator succeeded. A separate `childMessageIndex: null` indicates
unresolved provenance. A positive aggregate without valid learner provenance is
not persisted. With valid provenance, existing policy can record demonstrated
understanding with unknown prompting; it never invents independent attribution.

| Possible failure | What the code/available evidence establishes |
| --- | --- |
| Jev did not recognize the concept | A below-threshold concept distribution can prevent demonstration; October 17 distributions are unavailable. |
| Jev recognized it but did not locate a source | Uncertain/none start or end yields a null source. The aggregate prompting label alone cannot distinguish this case. |
| Fragmentation or revision invalidated the selected index | Indexes belong to a grouped transcript snapshot; late ordering can change them. Old revision/turn/visit/runtime/node responses remain rejected. No October 17 index drift can be confirmed. |
| Application rejected valid source information | Current start/end spans, consecutive fragments and neutral acknowledgments already persist with valid scores. No reproducer establishes an erroneous reducer rejection for the October 17 account. |
| Learner evidence was insufficient | Tutor-provided shared meaning plus assent does not establish cultural agreement independently. Other uncertain or unresolved concepts remain unresolved. |

## Traced pipeline and narrow improvement

1. `events.ts` preserves provider delta text and start/end intervals.
2. `LessonRuntime.observeTranscript()` validates input source/intervals, sorts
   fragments by provider time, and concatenates consecutive same-speaker deltas
   within a confirmed turn. It sends the complete current-node transcript with
   the captured node/revision, not just the latest learner fragment.
3. `transcriptMessages()` groups consecutive same-speaker lines. A tutor
   backchannel remains a separate message; it is not folded into learner text.
4. Previously, the Jev state contained the literal **unindexed** transcript while
   source question options independently enumerated these grouped learner
   messages. Source selection had to reconcile that numbering with tutor context
   in a separate representation. This is a confirmed request-context gap, not
   proof that it caused any particular recorded score.
5. The concept-bearing state now also contains `evidenceMessages`, the exact
   ordered `{ messageIndex, speaker, text }` projection used by the source options
   and reducer. Source questions explicitly refer to that table and its enclosing
   `transcriptRevision`, retaining both boundaries around neutral backchannels.
   Indexes are snapshot-local, not fabricated stable provider utterance IDs.
6. Jev still makes one request, with the same model, criteria, options and gates.
   Normalization and mapping still require confident valid learner endpoints;
   multiple plausible explanations do not produce a guessed source.
7. `applyConceptObservations()` is unchanged: it validates learner provenance,
   retains complete spans and tutor prompting context, rejects tutor endpoints,
   downgrades echoes/unresolved intervening help, and preserves stronger earlier
   evidence and its original source through later uncertainty and carry-forward.

This is a small source-context improvement rather than a new attribution pass or
heuristic span merger. The model now sees precisely the boundaries that its
choices will be checked against. Deterministic acceptance with identical valid
scores is intentionally unchanged. Whether the clearer context improves live
source scores requires a provider test.

## Concepts supported by the reconstructed explanation

| Concept | Controlled replay result and limitation |
| --- | --- |
| `beyond-prose` | Independent demonstration at learner message 1: mathematics as an example beyond prose. |
| `visual-symbols` | Independent demonstration at learner message 1: numbers and the plus sign as meaningful visual symbols, preserving both deltas. |
| `abstract-concepts` | Independent demonstration at learner message 3: abstraction and addition expressing numerical relationships, preserving both deltas. A separate test validates an explicit span across a neutral backchannel. |
| `cultural-agreement` | Remains unresolved when only the tutor supplies shared meaning and the learner assents. Exact repetition is partial, even with an independent or prompted label. A learner's own application after help can be prompted, never automatically independent. |

These are controlled semantic judgments applied to reconstructed speech. They do
not establish that the actual recording now produces those Jev scores, and no
historical output was rewritten. Confident sources and concept judgments are
still both required; a positive concept label is never a source-selection rule.

## Files and validation

- `lib/lesson-runtime/conversation-observer-contract.ts`: exposes the canonical
  message table for concept nodes and explains its snapshot identity in source
  questions. Counting-only request state stays unchanged. Parsing is shared for
  validation and table construction.
- `tests/fragmented-concept-attribution.test.ts`: 18 controlled regressions,
  including a runtime → real classifier wrapper → mocked Jev → mapper → reducer
  integration. Four projection/context checks fail against the starting commit;
  all 18 pass after the change. The other baseline controls already pass.
- `tests/fixtures/catching-unicorns-attribution-oct17.json`: explicitly synthetic
  provider-fragment reconstruction and expected assembled transcript.
- This document: diagnosis, evidence limits, scope and results.

The new cases cover reconstruction, consecutive fragments, neutral backchannels,
distinct answers, valid concept/source pairs, unattributed labels with no source,
tutor indexes, all five source identity dimensions, retained evidence, prompted
applications, copied tutor shared meaning, ambiguous fragment relationships, and
late-ordering index drift. Existing carry-forward coverage in
`catching-unicorns-completion-policy.test.ts` verifies retained evidence between
scenes. Existing October 16 source/span replays remain passing.

Validation performed:

- Ten targeted files: **188 tests passed**, including preceding closure,
  navigation and recovery fixes, provenance/span/source-boundary cases, current
  classifier tests, and carry-forward/completion policy tests.
- Full suite: **1,346 passed, 48 skipped**, with one frozen hash test failure and
  two frozen experiment suites failing at setup. All three guards already fail
  at the starting commit. This source-context change also changes the active
  projection hash, as expected; the frozen benchmark is not rebaselined. Historical
  issue #42 data, adapters, fixtures and compatibility guards remain unchanged.
- Scoped ESLint and `git diff --check`: passed.
- `npm run typecheck`: workspace errors remain confined to historical ignored UI
  copies under `test-results/commit3-review/app` and `test-results/ui-review/app`.
  The starting-commit archive with this change's source and tests applied passes
  typecheck using the same installed dependencies and no ignored review copies.

No reducer, evidence schema, tutor teaching instruction, authored objective,
lesson graph, navigation, audio drain, answer recovery, threshold, active model,
or provider count was changed. Commit 5 is outside scope.

## Remaining live test

Run a fresh Jev session with the same style of fragmented explanation and retain
its diagnostic export. Inspect concept probabilities independently from both
source boundary distributions, then compare the request's `evidenceMessages`
table with the accepted evidence source. Check delayed/interleaved transcript
ordering and whether cultural-agreement evidence is learner-authored or prompted.
The extra message table repeats transcript content once for concept nodes and
increases request size; latency and model interpretation remain live-provider
questions. Synthetic scores do not measure recall, accuracy, or confidence
calibration, and do not establish the original incident's root cause.
