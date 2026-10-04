# Issue #57: opening hesitation and later settlement

Status: uncommitted prompt candidate with offline regressions. No fresh semantic
replay, live lesson, microphone session or provider request was run. The previous
15-case v2 evaluation remains evidence for the **baseline**, not this candidate.

## Evidence available in this checkout

The checkout is `main`, HEAD `3ccb0231e30d7f9ab082e9df4f5228af1feba42b`.
All prior uncommitted work was preserved. Issue #57 was read through GitHub's
read-only issue endpoint. Its tuning policy requires a concrete observed failure
and a smallest correction, while preserving application transition authority.

The named primary export,
`/Users/davidhurley/Downloads/sprout-lesson-4667a7f1-0d3f-4437-8298-eae7186ef4df.json`,
was absent. A filename search in Downloads, this checkout and Codex documents
found no copy. Its hash, full transcripts, event indices, exact serialized request
states and complete nine-probability vectors could **not** be verified. No
recording was supplied. Audible/visible behavior and speaker attribution remain
unverified. The following is the task's supplied evidence, not a fresh export
inspection:

| Reported point             | Identity / scores                                                        | Reported behavior                                                                            |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 20.398 s                   | Visit 1, child turn 2, rev 16; correct .96, acknowledgment .98, help .12 | `support_ambiguous`; eligible current child text and relevant drain; clarification scheduled |
| 24.399 / 25.320 s          | Same clarification                                                       | Sent / acknowledged                                                                          |
| 29.744 s                   | Rev 28 after the clarification question; help .12                        | Still ambiguous                                                                              |
| 37.473 s                   | Turn 3, rev 39; correct .98, acknowledgment .98, help .07                | Accepted after reaffirmation and fresh confirmation                                          |
| 37.500 / 47.866 / 57.538 s | Subsequent progression                                                   | Two ducks / three butterflies / terminal render and lesson completion                        |

The supplied opening exchange is `Child: I think maybe`, `Child: One`, then
`Tutor: Yes! One duck. You got it.` Recovery is `Child: Yeah, one duck.`, then
`Tutor: Yes, one duck. You got it.` These excerpts validate neither the exact full
snapshot nor why Jev returned .12. The reported run supports recovery through
reaffirmation and eventual completion while exposing unnecessary initial support
ambiguity; it does not identify an acoustic or model root cause.

## Small candidate

The current structural parser groups consecutive child fragments literally as
`I think maybe\nOne`. Neither words nor bracket markers are removed. The existing
contract already permits a hesitant settled correct total, temporal support
resolution and completion without a special phrase. The new two-sentence
addition to `supportScope` distinguishes an opening tentative fragment superseded
by a later settled intelligible total, even within the same grouped child block,
from uncertainty still attached to the final total. It explicitly retains tentative
final questions, continuing uncertainty, alternatives, unfinished counting and
renewed help, and says tutor confirmation cannot settle these by itself.

This is a semantic clarification, not a phrase matcher or a no-help override.
Whether the model was carrying opening hesitation into the final support judgment
is a hypothesis. Improving .12 into the existing no-help band remains unverified.
Correctness never forces no-help; tutor praise alone never establishes settlement;
current support remains separate from independent mastery.

Only `needsHelp.instructions` changes relative to the retained v2 contract. All
other eight questions, support true/false criteria, projection, model, thresholds,
GPT-Live guidance and runtime/reducer source remain untouched by this slice.
Existing identity matching, stale rejection, immediate interruption protection,
fresh relevant acknowledgment, audio drain and render-before-steering remain
required. Four eligible seconds, one clarification per visit, cancellation/local
invalidation and no identical-snapshot retry loops remain intact.

## Concrete review artifacts and offline checks

The [candidate patch](issue-57-support-temporal-candidate.patch) is relative to
the retained v2 source, whose SHA-256 matches its saved 15-case results:
`f436952f76e0c96aa8a807960133b00f75a24880ff0dd9faf8ea82306a7f06d0`.
The [review set](issue-57-support-temporal-review-set.json) captures that full
nine-question baseline, baseline/candidate source hashes and ten literal expected
wire states. The two reported exchanges are explicitly **excerpts**, not complete
recorded request states. Eight synthetic contrasts cover tentative final question,
continuing uncertainty, alternatives, unfinished count, renewed help, uncertain
supplied repetition, split bracketed help and hesitation alone. Their review text
expresses expected interpretations, not calibrated ground truth.

`tests/support-temporal-settlement.test.ts` verifies exact wire states/full question
contract, one mocked call per input, baseline isolation and current source hash.
Its .12 mapping regression combines the three supplied scores with explicitly
synthetic competitors; it is not a reconstructed nine-score export. It confirms
that high correctness/acknowledgment still cannot bypass support ambiguity and
that no automatic retry occurs. These are deterministic checks, not real semantic
evaluation. Existing saved v2 mappings and reducer/audio/render regressions remain
covered without claiming those scores were produced by this candidate.

## Bounded paired comparison, requiring explicit authorization

No prior paid authorization carries forward; earlier budgets are exhausted.
Do not run this plan until explicitly authorized. Restore the missing export
first to make its exact snapshots reviewable.

1. Extract the exact classifier requests at revisions 16, 28 and 39, their event
   indices, full normalized mappings and runtime/node/visit/child-turn identities.
   Verify the export hash and literal projection. Replace the two excerpt slots
   and the hesitation-only slot with those three full recorded states; keep the
   other seven contrasts. Preserve excerpt provenance rather than claim it was
   originally a full snapshot. Review these replacements before any paid call.
2. Use those ten states plus all 15 unchanged states in
   `issue-57-support-candidate-v2-results.json`: **25 unique inputs, 50 requests
   total**, one baseline and one candidate request per input, no retries or extra
   repetitions. Compare both new observations to the saved v2 baseline where
   available; do not credit ordinary score variability to the wording.
3. Reconstruct the exact baseline source by reversing the saved candidate patch
   on a temporary copy and verify the baseline hash. Use its captured full
   questions versus the current candidate questions, and identical state/model
   (`jev-1.13.0`) in each pair through `evaluateNoulQuestions`. Do not swap or
   restart the running application or overwrite the retained worktree. Alternate
   pair order across cases. Provision credentials via an approved environment
   without reading, printing or logging env files/values.
4. Record only case/contract hashes, normalized probabilities, mapping outcomes,
   timing and failures; no raw response body or authorization headers. Abort on
   contract mismatch, cancellation or provider failure; do not spend unused
   calls on retries. Stop after this fixed comparison, regardless of outcome.
5. Target: rev 16 reaches settled-correct/no-help/relevant-acknowledgment with all
   existing bands. Preserve settled-help and previous v2 target/control behavior;
   renewed help, uncertainty, unfinished counting and supplied tentative repetition
   remain completion-ineligible. Inspect rev 28 as its own full question contract,
   never manufacture acknowledgment or assume a grouped tutor block's function.
   Any control regression rejects the candidate; do not tune repeatedly inside
   this budget. A single pair per state does not establish general calibration.
6. A separately authorized recorded live lesson must still verify audible tutor
   behavior, attribution, interruption around clarification send/acknowledgment,
   relevant audio drain, render-before-steering and full completion. Provider
   interpretation and actual conversational races cannot be established offline.

## Verification

Full suite: **500 tests passed**. Typecheck and lint passed. Changed-file formatting
and `git diff --check` passed. Repository-wide formatting retains the pre-existing
failure in untouched `tests/transcript-state-tutor-stabilization.test.ts`.
No commits, pushes, deployments, merges, issue-status changes or persistence were
added. Primary-export verification and real paired/live validation remain open.
