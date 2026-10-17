# Issue #42: reproducible provider comparison harness (commit 3)

This is mechanics for a later authorized experiment, with no provider results,
calibration, migration recommendation, production switch or live session. Run from
the repository root. The CLI is isolated from application routes and uses the
existing Vite SSR tooling convention, with **environment-file loading disabled**.
It does not read `.env.local`. No requests happen at import, planning or offline
execution. Do not use `next dev` to run this experiment.

```sh
# Default: deterministic plan only, zero requests, all 71 cases, one repetition.
node scripts/issue-42-provider-comparison.mjs

# Same frozen snapshot, two deterministic repetitions, provider-free synthetic responses.
node scripts/issue-42-provider-comparison.mjs --mode offline --cases oct14-engram-final --repetitions 2 --max-requests 4 --out test-results/issue-42/example-offline.json

# Optional existing review input: this will correctly report a BLOCKED review gate.
node scripts/issue-42-provider-comparison.mjs --cases oct14-engram-final --review docs/issue-42-human-label-review-2026-10-15.json
```

`--out` creates a **new** JSON file under ignored `test-results/issue-42/`; existing
files cannot be overwritten. Omitting it prints JSON. Inputs to `--review` and
`--policy` must be JSON files. No normalized real response import exists: offline
transports are always marked `synthetic_mock`, even when manually injected tests
return plausible provider-shaped answers. Historical corpus annotations are
reported as historical presence only, never replayed into fresh observations.

## Identity and parity

The loader checks v1's hard-pinned manifest hash, its checksum file, corpus,
lessons, replay references, baseline Git blobs and current baseline source bytes,
with two exact active-model compatibility exceptions described below.
It reproduces every input/question/projection hash and verifies the historical
counting source blob. Baseline PR #68 is
`fd40c9bc631770ab1220f85767ee2f6cdd56ab9a`; implementation baseline is reviewed
commit 2, `1223826b3708627bbc5326ec249e05e3a827cf9c`, which must be an ancestor.
The Decisions adapter must exactly match that commit's bytes. None of those
frozen files or production contracts are rewritten to make a check pass.

Plans record executing HEAD and parent, source dirty state (including uncommitted
harness source), exact adapter/harness/CLI source hashes, manifest/corpus/lesson
hashes, selected case input/question/projection and both wire-request hashes,
mapping-policy hash, model identifiers/endpoints, ordered case ids, repetitions,
serial arm schedule, timeout and finite maximum requests. Report envelopes record
the exact separately supplied review-file hash. A changed checkout invalidates a
plan; execution reloads and compares all these identities before dispatch.
Network execution requires committed source. Git identity alone does not pin
provider weights: both returned model identifiers must match, but these contracts
do not establish immutable weights behind a provider alias/version identifier.

Both arms use the same frozen lesson, authored node/revision and speaker-labelled
current-node snapshot. Every instruction, option, criterion and learner-source
candidate must match. Jev uses object state and question/criteria maps. Decisions
uses that state serialized as shared JSON text and equivalent named question and
choice arrays. Both wire requests are hashed; no factored or extra questions,
truncation, alternate transcript, threshold tuning or invented source candidate
is allowed. Schedule order alternates by selected-case index plus repetition
index: Jev first for even sums, Decisions first for odd sums. This controls order
reproducibly; it does not establish statistical independence.

The `jev` comparison arm remains pinned to **`jev-1.13.0`**, even though the active
app uses **`jev-1.14.0`**. `lib/experiments/issue-42/historical-v1/` contains exact
copies of the original contract, its runtime dependencies, Jev executor and
isolated reducer. `loadBenchmark()` verifies each copy against the unchanged
manifest's baseline-source hashes, and still verifies every original baseline
Git blob. The historical Decisions adapter is an exact copy of the reviewed
`EXPECTED_PARENT` blob; its public entry point only re-exports that copy and is
checked separately. The type-only events bridge does not execute runtime code.

Both request construction and response interpretation use these historical
modules. This preserves source selection, questions, projection, mapping and
reducer semantics together. Production imports none of these copies. The active
lesson, source filtering, `evidenceMessages` projection and Jev 1.14 contract are
covered by their current-contract tests rather than historical byte assertions.
Plans record actual active source hashes under `activeRuntime.sourceHashes` as
execution provenance, not a historical compatibility gate. The old active-source
exception lists no longer apply. No corpus, manifest or frozen hash changes.
Updated tooling and provenance change plan identities, so old run authorizations
do not apply to a newly generated plan.

Network Jev invokes the historical `executeConversationObserver`, whose model
constant is pinned to 1.13. A 1.14 response to the 1.13 arm is rejected and cannot
become a normalized 1.13 observation.
An exclusive, serial CLI transport bridge checks its exact URL, method and body,
then restores global fetch in `finally`. Native fetch is captured before the
bridge. The bridge is only for this separate CLI process, never application use
or concurrent classification. Offline Jev uses the same historical normalizer
and mapper; tests compare it to the original executor. Decisions uses the
unchanged isolated `createDecisionsClassifier`. Sole-`none` source options and
request-size limits abstain **locally**, make zero Decisions requests, and are
neither semantic errors nor successful observations.

## Human review and explicit run authorization

The immutable manifest's `providerRunsAllowed:false` remains false. It cannot be
changed or treated as automatically overridden. A later separate human-authored
`issue-42-authorized-run` artifact may authorize **only one exact hash-bound
plan** under the rule below. The existing untracked October 15 artifact is not
that artifact: it reviews six final snapshots, leaves 65 cases and grouping/split
pending, and explicitly disallows provider execution. The CLI never promotes it
or the draft labels into run approval. Its `questionResponse` annotations are
neither objective Choices nor runtime completion authority. This harness does
not import those annotations as expected provider outputs.

After source is committed, generate a plan with the intended selection, budget,
repetitions, timeout and optional policy. A real reviewer must supply a separate
JSON artifact with this structure (described rather than fabricated as an
approved example):

| Field | Required content |
| --- | --- |
| `version`, `kind` | `1`, `"issue-42-authorized-run"` |
| `planHash` | Exact generated `plan.planHash` |
| `reviewer`, `reviewedAt` | Actual reviewer identity and parseable review date |
| `lockedBeforeProviderOutputs` | `true`, reflecting actual review timing |
| `authorization` | `reference` to explicit human authorization, `providerExecution:true`, `maxRequests` equal to the plan |
| `grouping` | `approved:true`, `hash` equal to `plan.groupingHash`, after review of the corpus grouping/split assignment |
| `cases` | Exactly one entry for every selected id, no extras/duplicates |
| Each case | `caseId`, exact `inputSha256`, explicit `labels.objective` and `labels.concepts` with every authored criterion |
| Each label | All semantic dimensions, rationale and source indexes from the documented v1 label schema; **no** `reviewStatus` field |
| Optional case `choices` | Explicit reviewed question-name → allowed Choice value pairs, separately adjudicated from aggregate semantic labels |

The gate checks structure, coverage, valid semantic labels and learner-source
indexes, hashes, lock declaration and bounded authorization. It cannot authenticate
a person's identity or independently prove that their provenance/timing statement
is true. The operator must retain genuine human authorization/review provenance;
software never generates a reviewer, fills missing labels from drafts or infers
consent. Review is fixed before inspecting new outputs. Changed inputs/labels
requiring a new corpus version cannot be accommodated by rewriting v1 hashes.
Missing optional Choice judgments remain **unscored**, including objective and
tutor Choices. Aggregate objective demonstration is always unscored as a provider
objective Choice. Concept comparisons report demonstration, partially expressible
attempt, attribution and source provenance separately; `not_yet` cannot resolve
complete-wrong versus no-attempt, and unresolved prompting/evidence stays unscored.
These are descriptive disagreements, not calibrated accuracy estimates.

Only after that separate review and authorization, a later operator may invoke
`--mode network --execute --max-requests N --review <review.json>` with the same
plan arguments and explicitly provisioned `TYPESAFE_API_KEY` and
`OPENAI_API_KEY` in the process environment. No credential file is read or value
logged. Both keys are required before dispatch. The CLI does **not** load env
files. This commit does not authorize that command or any paid run.

Network requires explicit opt-in, an explicitly supplied matching finite budget,
compatible review bytes/hash and committed source. Default maximum is the planned
arm count for planning/offline; it is insufficient as implicit network opt-in.
Limits are 1–100 repetitions, 1–100,000 requests and 1–300,000 ms timeout. One
shared counter consumes budget immediately before each transport invocation,
including failed/cancelled requests. Locally unsupported/pre-cancelled cases
consume none. Exhausted slots report `budget_exhausted` without calling transport.
There is no retry, fallback, probing, credential validation request or extra call.
Ctrl-C/SIGTERM aborts the current request and cancels remaining slots. Total
request timeout includes response body parsing; abort terminates even injected
transports that ignore abort. No raw exception message or HTTP error body is
persisted. HTTP redirects are rejected in the native network transport.

Decisions has no calibrated default mapping policy. With no `--policy`, raw
normalized classifications are reported and mapped proposals abstain as
`decisions_mapping_unconfigured`. An explicit policy JSON containing exactly
`minProbability`, `minConfidence`, `minMargin` (finite [0,1]) is an uncalibrated
experimental hypothesis. It is part of the plan/review hash. Jev keeps its pinned
production mapping. Paired raw classifications, mapped proposals, reducer
acceptance and accepted evidence remain separate, making these differences
visible. No policy recommendation or tuning is included.

## Measurements and runtime boundaries

Results keep normalized provider Choices/confidence/probabilities separate from
mapped proposals, reducer acceptance and evidence. Pair summaries compare labels
without equating different providers' probability scales; unavailable comparisons
are null. Semantic disagreements are separate fields from mapping rejection,
source provenance disagreement/failure, local unsupported input, refusal, safe
provider error categories, timeout, cancellation, budget exhaustion and stale
revision rejection. A valid normalized response rejected by mapping remains a
valid **raw** observation; neither proposal acceptance nor HTTP success is an
accuracy score. Incomplete, refused, malformed and locally unsupported cases do
not count as valid observations. Stability compares normalized label/source
selections across valid fresh repetitions of the same case within each arm; fewer
than two observations is null. Both variants exclude confidence and probability
distributions from this label-stability signature. Direct signatures include
objective, tutor, concept and source choices. Factored signatures include
objective, tutor, demonstration/attempt, conditional prompting and source choices,
with question keys and stage structure retained. An empty prompting map stays
empty, distinct from a populated conditional stage. `incorrect` and
`not_attempted` stay distinct even though both map to `not_yet`; no direct concept
Choice is manufactured. Score changes alone are stable when selections and stage
structure stay the same. This metric does not measure score stability or mapping
acceptance; score-dependent gating that changes which conditional answers exist
changes the signature.

Latency is monotonic time around the actual transport, including body parsing.
All attempts and valid normalized observations have separate fresh-provider
latency aggregates. Nearest-rank quantiles use sorted `ceil(p*n)-1`; empty samples
are null, one sample has identical p50/p95, and fewer than 20 samples is flagged
as too small to establish tail latency. Offline timings are explicitly mock-only
and excluded from provider aggregates. This is **not** learner-answer-to-UI,
whole-session, acoustic or live end-to-end latency; that field is always null.
Request count is not requests per learner turn: the corpus contains snapshots
and repeated experiments, with no complete live scheduling history.

The official [Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
was checked on October 15, 2026 for returned `model` and `usage`. Only finite,
nonnegative integer `input_tokens`, `output_tokens`, `total_tokens` are retained.
Missing/invalid usage is null. Jev usage has no verified schema here and remains
unavailable. No pricing schedule is configured/verified for this harness, so
cost is **unavailable/null**, including when usage exists. No estimated or actual
spend, free requests or zero cost is implied. Errors retain safe local categories
only; credentials, full bodies, provider error messages and raw private sources
are excluded from result artifacts.

Reducer replay explicitly initializes a fresh runtime with the authored target
node assumed initially rendered, empty carried evidence, synthetic source/visit/
turn identity, the frozen revision and last-speaker projection, unavailable audio
activity and local event time. It sends only `proposal.received` with the exact
snapshot. It reports actual reducer effects, consumption/acceptance and resulting
evidence separately. Tests include stale revisions and invalid learner locators.
It does not synthesize output-drain, quiet-time, render confirmation or transition
events. Proposal consumption can occur without accepted concept evidence.
Current-node snapshots cannot establish prior-session carried evidence, actual UI
rendering, audio completion, scene transitions, or assessment/recap consistency.
UI/audio evidence stays null. Production reducer authority is unchanged.

## Provider-free checks

```sh
npx vitest run tests/provider-comparison.test.ts tests/decisions-classifier.test.ts tests/classifier-benchmark.test.ts
```

Tests use only synthetic transports, credentials, clocks and test-only review
fixtures; those fixtures are never saved as authorization artifacts. The full
suite and focused lint/format checks apply. Default TypeScript has seven existing
errors in ignored `test-results/commit3-review/app/`; keep those copies intact
and check repository source separately with that directory excluded. No build,
voice session, calibration or paid measurement is needed to validate mechanics.

## Commit 4 extension

The default direct design and its adapter byte checks remain reproducible.
[Factored evaluation and calibration](issue-42-factored-calibration.md) adds an
explicit v2 experiment/review boundary, conditional-call accounting and an
independent provider-free calibration mechanism. New source/plan hashes require
new run authorization. Fresh held-out network evaluation now requires a compatible
locked policy; this is implemented only for the factored variant, so fresh direct
held-out network runs are blocked. No provider or empirical calibration results
are added, and the existing six-case review still does not authorize a run.
