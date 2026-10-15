# Issue #42: benchmark readiness and recommendation

This is the historical audit at commit `7262930`. See the later
[retain-Jev decision and six-snapshot diagnostic](issue-42-decision.md) for the
subsequent evidence and user decision. The inventory below is not a current
zero-observation claim.

As of October 15, 2026, **the empirical comparison is incomplete**. Recommend
**another bounded test**, beginning with the six-case diagnostic proposed below.
There is no measured basis to replace Jev, select Decisions thresholds, or claim
issue #42's success criteria. Keep the existing production selection pending
evidence; this is not an empirical endorsement of active Jev 1.14. Classification,
mapping and assessment concerns remain separate investigation topics.

## Audited boundary

Read-only orientation confirmed branch `codex/42-decisions-classifier-benchmark`
at `72629301122125b82f3280a39901cf954e319812`, parent
`d4571f27a2299b3880900794e935b2311341b32f`. This is the **executing audit commit**,
including commit 4 and both reviewed reporting fixes. The documentation commit
containing this report has that audit commit as its parent. All recorded plans
below identify the audit checkout; they must be regenerated after any commit.
They are not authorization for a future checkout.

The current [issue #42](https://github.com/hurley87/sprout/issues/42) was read on
October 15: OPEN, no comments, shared current-node classification scope. Its old
counting-only `EvaluateAnswer`/`ADVANCE-STAY` seam is superseded. Production
migration, a new 1.14 arm, live sessions and assessment fixes remain outside this
deliverable.

| Identity | Exact reference |
| --- | --- |
| Frozen PR #68 baseline | `fd40c9bc631770ab1220f85767ee2f6cdd56ab9a` |
| Direct adapter implementation baseline | `1223826b3708627bbc5326ec249e05e3a827cf9c` |
| Corpus commit | `1665e897df5221b28bcb658b0f02b2044424870d` |
| Factored implementation | `600e8dc` (ancestor of the full audit SHA above) |
| Deadline reporting fix | `d4571f2` (ancestor of audit SHA) |
| Selected-label/source stability fix | `7262930` (audit SHA) |
| Active runtime | `jev-1.14.0` |
| Historical comparison arm | `jev-1.13.0`; no 1.14 comparison arm exists |
| Decisions variants | `direct-equivalent-v1` and separate `factored-concepts-v1`, both requesting `gpt-6-luna` |

The committed [evidence inventory](issue-42-readiness-evidence.json) records exact
SHA-256 values for the frozen files, eight tool sources, two active-source
exceptions, six selected inputs/questions/projections/wire requests, question
design, grouping, audit plans and local check artifacts. It contains no transcript
or provider body. It is an audit inventory, not a run review or policy lock.
Offline mock timings vary, so their file-byte hashes are omitted; the inventory
retains deterministic source/plan identities and checked counts instead. The
plan and missing-data calibration artifacts have no timing samples and retain
their byte hashes. Regeneration is relative to the fixed audit commit.

The [immutable manifest](../tests/fixtures/classifier-benchmark-v1/manifest.json)
has SHA-256 `ceba27f934ad67b96c8ec0381f2e98156151660c5542c6cfdf3adc332e863c1c`;
the corpus hash is
`fb0e1cad8940cd96722d7912d5f368494ea6a6336ab612fca8066a5330214ad6`, and
the lessons hash is
`50977f6032a281b861b387c75937bf2de2b77404b4929aaf89947ed9e9d92128`.
The loader verifies original baseline Git objects and the historical script,
not just current files. Only the two exact `ACTIVE_MODEL_COMPATIBILITY` hashes
are accepted for active 1.14 source; all other baseline sources still match v1.
The direct adapter still matches the commit-2 Git blob byte for byte. Exact
returned model checks do not guarantee immutable provider weights or current
account availability. A 1.14 answer cannot be relabeled as 1.13 evidence.

## Available evidence and missing prerequisites

| Corpus coverage | Snapshots | Interpretation |
| --- | ---: | --- |
| Recovered historical counting | 29 | Adapted old script inputs; legacy booleans are expectations, not measurements. Issue claims 30; no 30th case or original calibration result set was located. Counting has no concept criteria. |
| Issue #57 clarification | 4 | Historical mapping references, not new paired provider results. |
| Existing Catching Unicorns excerpts | 16 | Normalized score references; some learner locators are controlled additions. Source pointers are in each frozen case. |
| October 14 requests | 12 | Early/final snapshots for six nodes; exact requested fragments, not evidence of completed/accepted calls. |
| New synthetic controls | 10 | Provisional held-out groups, visible agent-authored inputs; not a blind population sample. |

All 61 historical/recorded cases are calibration, including the entire October 14
exchange group. The ten controls must not enter fitting. The corpus does not
cover all session requests, application/synthesis/recap, acoustic events or all
source ambiguities. The [corpus documentation](issue-42-classifier-benchmark.md)
contains original source hashes and event/JSON pointers; private exports were
not reopened or copied for this report. Their previous validation is documented
there, not newly claimed here. The original October 14 export does not establish
the live checkout SHA or complete authored configuration. Its unlabelled VTT
cues are not benchmark inputs.

| Prerequisite | Current state |
| --- | --- |
| Human semantic review | Six October 14 final snapshots have approved concept recommendations and qualifications; other 65 snapshots remain pending. |
| Complete run labels / optional Choices | Missing. The six-case overlay does not adjudicate frozen aggregate objective labels, provider objective/tutor Choices or runtime completion authority. |
| Grouping and split approval | Pending, including the single October 14 exchange group and provisional held-out controls. |
| Eligible fresh observations | None in the inspected issue-42 artifacts. No paired empirical results. |
| Independent calibration review / dispatch policy / finite candidate grid | Not supplied. The six-case overlay is not a `CalibrationReview`. |
| Empirical candidate and compatible locked policy | Unavailable. No policy was fitted; no Jev gates were copied into Decisions. |
| Genuine hash-bound run authorization | Missing; current review gate is blocked. |

The user-owned `docs/issue-42-human-label-review-2026-10-15.json` remains
untracked and excluded from this commit, with SHA-256
`d655a9ae604f61b4f709ebff3ea95f419afede84441199f9bb9b19f3b80bae2f`.
It explicitly keeps `providerRunsAllowed:false`. Its approval is limited,
non-blind, and never silently promoted to execution approval. The frozen
manifest also retains `providerRunsAllowed:false`.

Eleven pre-existing local commit-3/4 JSON artifacts under ignored
`test-results/issue-42/` were inspected: seven offline reports and four plans.
All offline reports have zero fresh provider observations. They and the two new
offline check reports are **synthetic mechanics evidence**, not calibration or
semantic results. The inventory lists their filenames without duplicating bulky
result bodies. Historical annotations remain historical; fresh output is a
separate evidence category that is currently absent.

## Interpretation of the six reviewed finals

These summarize human judgments, not a scored comparison. Exact case IDs and
input hashes are in the inventory; original input text remains in the corpus.

| October 14 final case | Approved interpretation and qualification |
| --- | --- |
| Engram | Biological memory explanation demonstrates the criterion independently, before tutor acknowledgment. Prompting uncertainty and the reported floating-point demonstration boundary are mapping/attribution questions, not proof of provider inferiority. The private original scores were not re-audited here. |
| Exogram | Independent external/non-biological memory demonstration. Missing repetition of an earlier Engram definition does not erase prior-scene evidence. Current-node replay starts without that carried evidence. |
| Compare | Independent durability, shareability and revisability. Earlier definitions are not required to be repeated to preserve session evidence. |
| Exographics | All four concepts demonstrated: visual symbols independent, cultural agreement prompted, beyond-prose and abstract-concept attribution unresolved. An earlier overstatement does not erase later supported understanding. |
| Arithmetic / memory extension | Reification and memory extension demonstrated independently; discovery only partial. Tutor acceptance does not establish the stronger discovery claim. |
| Techno-literate culture | Reasonable answer to the live two-example question; social coordination independent, literacy partial under the pinned criterion including arithmetic; idea-discoverers and education not attempted. Those omissions are not incorrect understanding. |

The culture live question asks for **two examples**, while the frozen PR #68 rubric
requires **four characteristics**. Tutor acknowledgment, answering the actual
question, full rubric mastery and conversation-first scene closure must stay
distinct. This mismatch prevents an unqualified live-parity or false-negative
claim.

For each future disagreement, report these layers separately:

1. **Raw semantics:** normalized selected labels, distributions and conditional
   structure against reviewed dimensions. Aggregate objective annotations are
   not provider objective Choices; missing Choice judgments stay unscored.
2. **Mapping:** probability/confidence/margin gates and unsupported local request
   shapes. The live mapper can sum independent/prompted probabilities into
   `demonstrated_unattributed`; binary floating-point boundary behavior belongs
   to exact-score mapping reproduction, not a semantic provider verdict.
3. **Learner provenance:** substantive Child source, exact merged-message index,
   ambiguity, echo and source-confidence rejection. Valid authorship alone does
   not establish understanding. Controlled historical locators are not model
   localization measurements.
4. **Reducer acceptance:** actual proposed evidence accepted/rejected for the
   frozen node/revision/source. Offline target-render and empty-evidence setup
   is a simulation; proposal consumption is not concept mastery or UI completion.
5. **Scheduling and reporting:** request fragments, stale snapshots, explicit
   caller cancellations and deadline timeouts stay distinct. Full-conversation
   assessment uses a single-label confidence test rather than the live mapper's
   combined demonstration test; recap disagreement is not proof of semantic
   inferiority. See the pinned mapper/assessment paths in the manifest and the
   [provenance](evidence-provenance-review-2026-10-07.md) and
   [completion](completion-consistency-review-2026-10-07.md) reviews for older
   replay limitations.

## Measurement status

| Measurement | Jev 1.13 | Direct Decisions | Factored Decisions |
| --- | --- | --- | --- |
| Semantic accuracy, false mastery, missed understanding | Unmeasured | Unmeasured | Unmeasured |
| Partial/no-attempt handling, prompting attribution, learner-source accuracy | Unmeasured | Unmeasured | Unmeasured |
| Abstention, failures, timeouts, cancellations | No empirical rate | No empirical rate | No empirical rate |
| Label/source stability | Unavailable | Unavailable | Unavailable |
| Provider p50/p95 and live end-to-end latency | Unavailable | Unavailable | Unavailable |
| Provider usage and cost | Unavailable | Unavailable | Unavailable |

Active Jev 1.14 has no comparison measurements either. Zero eligible observations
does not mean zero errors, zero cost, or a successful held-out test. Synthetic
mapped proposals and mock timings cannot fill these cells. Three repetitions per
case in a later diagnostic would be descriptive only, with insufficient tail
latency samples. Stability compares selected labels and source choices, excluding
confidence/probability jitter and retaining factored conditional-stage structure;
it does not establish score or mapping stability. No general zero-false-positive
claim is justified by these cases or a small future regression sample.

## Proposed next experiment: six-case raw diagnostic

This is a reviewable **proposal, not authorization**. Use only these calibration
cases, in this order: `oct14-engram-final`, `oct14-exogram-final`,
`oct14-compare-final`, `oct14-exographics-final`, `oct14-why-exographics-final`,
`oct14-techno-literate-culture-final`. All six share `oct14-latest-demo`; none is
held out. Their existing limited approval makes them useful for investigating
known gaps, not for estimating population accuracy.

Use `factored-concepts-v1` versus historical Jev 1.13, **no Decisions policy**,
three repetitions, serial alternating arm order, 10,000 ms timeout and **36 total
requests maximum**: 18 Jev calls plus 18 first-stage Decisions calls. No policy
means no conditional prompting calls and Decisions mapping abstains. There are
no retries, fallback, discovery requests or live sessions. Failures consume the
budget; never replenish it automatically. A count cap is not a dollar budget:
pricing and authorized monetary spend require separate confirmation before a run.

This measures only raw demonstration/attempt/source selections, available usage,
transport latency and repeated-label behavior. Objective/tutor Choices require
separate explicit judgments or stay unscored. It cannot measure Decisions
prompting accuracy, calibrated proposals, false mastery awards or held-out
performance. Changed question design also prevents attributing differences to
provider alone. Direct-equivalent results remain a separate experiment; do not
pool them with factored results.

Before dispatch, a human must complete the selected cases' explicit semantic
objective/concept labels, review grouping/splits, retain genuine review provenance,
and authorize a new exact committed plan, finite request cap and spend boundary.
Do not fill missing judgments from corpus drafts. The existing six-case overlay
does not satisfy the gate. The audit plan hash
`18c4edfefe9bde7bf50b8e4a297abc99ac736897b65592c900264fbc69131ff2`
is **blocked** and specific to the audit SHA; regenerate after this commit.

Stop after that diagnostic for human review. Raw-only observations must not be
relabeled with an invented dispatch policy to fit calibration. A later calibration
run needs a separately reviewed dispatch-policy hypothesis, independently reviewed
calibration labels, finite candidate grid and separately authorized bounded plan;
conditional coverage must support candidate mapping. Fit only calibration groups,
inspect selection bias and unavailable prompting, then obtain a genuine compatible
policy lock before any held-out output. No synthetic controls or held-out cases
may enter fitting. Broader independently reviewed held-out material needs a new
versioned corpus boundary; keep v1 immutable. Existing direct held-out network
evaluation remains blocked because direct-specific fitting/locking is not
implemented. None of these future stages is approved by this report.

## Provider-free reproduction and validation

Run from the repository root with installed dependencies. These commands load no
environment files and make no provider requests. Output names must be new files
under ignored `test-results/issue-42/`; the audited files already exist locally.

```sh
node scripts/issue-42-provider-comparison.mjs --mode offline --repetitions 2 --max-requests 284 --out test-results/issue-42/commit5-7262930-direct-offline.json
node scripts/issue-42-provider-comparison.mjs --mode offline --variant factored-concepts-v1 --repetitions 2 --max-requests 426 --out test-results/issue-42/commit5-7262930-factored-offline.json
node scripts/issue-42-provider-comparison.mjs --variant factored-concepts-v1 --cases oct14-engram-final,oct14-exogram-final,oct14-compare-final,oct14-exographics-final,oct14-why-exographics-final,oct14-techno-literate-culture-final --repetitions 3 --max-requests 36 --timeout-ms 10000 --review docs/issue-42-human-label-review-2026-10-15.json --out test-results/issue-42/commit5-7262930-next-plan.json
node scripts/issue-42-calibrate-decisions.mjs --out test-results/issue-42/commit5-7262930-calibration-unavailable.json
npx vitest run tests/classifier-benchmark.test.ts tests/decisions-classifier.test.ts tests/provider-comparison.test.ts tests/factored-decisions.test.ts tests/decisions-calibration.test.ts
```

Both offline variants validated all 71 snapshots with two repetitions: 284
synthetic arm slots each, zero fresh provider observations, null empirical
latency/cost/stability. Each had six locally unsupported Decisions slots (three
snapshots repeated), which are request-shape limitations, not semantic errors.
The six-case plan made zero requests and reported its review gate blocked.
Missing-data calibration returned `calibration_unavailable` without a candidate.
All 157 targeted tests across five files passed, including deadline/cancellation,
label/source stability, calibration eligibility and lock/review gates. The Vite
test runner emitted its existing config-loader compatibility warning.

The inventory was mechanically cross-checked against those artifacts, exact
source/review/input hashes, baseline Git objects and the direct adapter byte pin.
Changed documentation formatting and `git diff --check` were checked. This
documentation-only change does not require application-wide tests or default
lint/typecheck; their previously documented ignored `test-results/` review-copy
failures were not rerun or changed. No provider calls, authenticated discovery,
credentials/env inspection, private-source reimport, live voice/browser session,
production change, push, PR or issue closure occurred.
