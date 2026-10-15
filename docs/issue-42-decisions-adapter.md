# Issue #42: isolated Decisions adapter (commit 2)

The experimental server entry point is
[`createDecisionsClassifier`](../lib/experiments/issue-42/decisions-classifier.ts).
It exposes the existing `classify(input, signal)` proposal interface and
`classifyWithDiagnostics(input, signal)` observation boundary. There is no
production import, route, provider switch, comparison runner, or UI integration.
The immutable v1 corpus and production classifier contracts remain unchanged.

## Official contract verified October 15, 2026

Sources: [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
and [create API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

The guide documents public beta, `POST /v1/decisions`, and only `gpt-6-luna`.
The implementation uses shared **string** input and named Choice questions.
Choices carry `value` and `description`; each answer carries `name`, `choice`,
`confidence`, and a `probabilities` array of `{value, probability}` entries.
Refusal is per question, with `type: "refusal"` and the question's name.
The reference specifies ordered answers, 1–200 questions, and 2–255 options per
Choice. The adapter checks these limits before transport and requires answer
order and names to match. It abstains on any refusal or incomplete response,
including otherwise answered questions.

The reference also documents returned `model` and token `usage`. The shared
observation contract has no usage field, so this adapter does not retain usage,
raw bodies, or error messages; a later authorized measurement harness needs its
own bounded transport instrumentation. No usage, price, latency, provider access,
or semantic accuracy was measured. The guide recommends application-specific
labeled examples for thresholds. Probability and confidence are distinct;
neither is assumed to have Jev's calibration.

The official guide names only the model alias; these two sources do not establish
an immutable model snapshot pin. An exact echoed `gpt-6-luna` name verifies only
that returned identifier. Missing identity abstains as unverifiable; different
names abstain as mismatches. This cannot detect a provider silently changing
weights behind the alias. The reference and guide differ on some richer input
capabilities; the shared string input used here is supported by both.

## Request equivalence and provenance

The existing `conversationObserverState` and `conversationStateQuestions` supply
all authored criteria, descriptions, context, current-node scope, instructions,
and learner-source options. State is JSON-serialized into shared text; the exact
speaker-labeled transcript and node/revision are retained. Only the wire shape
changes from a question map/criteria map to named arrays. No factored questions
or extra model-authored fields are introduced.

When a source question offers only `none`, Decisions' two-option minimum prevents
a faithful request. The adapter abstains locally (`learner_source_unavailable`)
instead of adding a fictitious candidate. Excess question/source counts likewise
abstain locally. These are request-contract limitations, not semantic errors.

The captured lesson and transcript are cloned before awaiting transport; a
separate request copy prevents transport mutation from changing normalization.
A locator must select a substantive Child utterance in that exact snapshot,
using the existing merged-message projection. Partial or demonstrated
observations without a confident valid locator abstain as
`learner_source_unresolved`. `not_yet` carries a null locator. Structural speaker
labels are supplied attribution, not acoustic ground truth. Semantic relevance,
echoing, accepted evidence, stale identity rejection, completion policy and
transitions remain the reducer's responsibility. Objective probability or tutor
affirmation never manufactures a concept observation.

## Explicit experimental mapping

There are **no default Decisions score thresholds**. The factory accepts an
optional `mappingPolicy` with `minProbability`, `minConfidence`, and `minMargin`,
all finite numbers in [0, 1]. With no policy, valid outputs are normalized for
diagnostics and the adapter abstains as `decisions_mapping_unconfigured`.
A supplied policy is an experimental hypothesis requiring later review and
independent calibration; it is not permission to run providers or evidence of
accuracy. Tests use synthetic gates only to exercise branches.

A mapped label requires the separate confidence floor, selected probability
floor, a strict winner, and the specified margin over every competitor.
If individual prompting labels fail but their sum passes against both
non-demonstration alternatives, mapping proposes `demonstrated_unattributed`.
It never chooses independent versus prompted from that sum. Uncertain state or
wholly uncertain concepts abstain. Unlike Jev, this conservative first adapter
requires confident objective and tutor labels even in concept scenes, has no
criterion-based completion rescue, and does not emit low-confidence
`partial_uncertain`. Conversation-first tutor closure remains advisory completion
and never mastery. These mapping differences must be reported separately from
semantic disagreements in later comparisons.

Validation requires finite bounded probabilities, complete unique supplied
options, a sum within 1e-6 of one, and a selected maximum. This is a local strict
validation policy, not a documented Decisions rounding guarantee. Scores are
never rescaled and Jev's hundredth-rounding tolerance is not applied.

Transport is injected. `createDecisionsHttpTransport` optionally supplies a single
HTTP request using explicitly supplied credentials and fetch implementation; it
never reads environment files or configures itself from environment variables.
No retry or fallback occurs. Cancellation and a configurable total timeout
(default 10 seconds, including body parsing) terminate the result even if an
injected transport ignores abort. Safe diagnostic reason codes omit provider
error text and raw payloads.

## Provider-free verification and review gate

`npx vitest run tests/decisions-classifier.test.ts tests/classifier-benchmark.test.ts`
checks request equivalence across both lessons, normalization, policy isolation,
refusals and invalid/missing answers, model identity limits, cancellation/timeouts,
probability failures, source resolution and reducer identity/evidence boundaries.
All transports and credentials in these tests are synthetic.

The separate untracked `docs/issue-42-human-label-review-2026-10-15.json` remains
outside this commit. It approves recommendations for six October 14 final
snapshots only. The other 65 cases and split/grouping review remain pending;
`providerRunsAllowed` remains false. No paid provider calls or live voice sessions
are authorized or performed by this commit. Factored questions, runner,
calibration, results and migration remain later work.

Commit 2 validation: 1,108 tests passed across 53 files, including 51 new adapter
cases and the 15 immutable-corpus checks. Targeted ESLint and Prettier checks and
`git diff --check` passed. Default `npm run typecheck` reports exactly the same
seven pre-existing errors in ignored `test-results/commit3-review/app/` as before
editing. A separate TypeScript check of the repository's 148 source/type files
with ignored `test-results/` excluded passed; those files and the normal
TypeScript configuration were preserved. No Next build or live/browser session
was run. The review artifact's SHA-256 remained
`d655a9ae604f61b4f709ebff3ea95f419afede84441199f9bb9b19f3b80bae2f`.
