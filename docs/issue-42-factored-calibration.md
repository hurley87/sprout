# Issue #42 commit 4: factored concept evaluation and calibration mechanism

This adds the isolated **`factored-concepts-v1`** Decisions experiment. It does
not run a provider, fit a real policy, add Jev 1.14 to the comparison, or change
production. The active app remains Jev 1.14, the benchmark Jev arm remains exactly
1.13, and Decisions remains the documented `gpt-6-luna` identifier. Neither
identifier establishes immutable provider weights.

The user approved recommendations for six October 14 final snapshots only.
The other 65 labels and grouping/split review remain pending. That review file
is preserved verbatim, untracked, and is neither a run authorization nor provider
objective Choices. Calibration is **unavailable**: no eligible fresh observations,
independent calibration-label/grouping review, or locked policy is supplied.
There are no measured thresholds, accuracy, calibration, latency or cost results.
Synthetic tests establish mechanics only.

## Question design and mapping

The [official Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
and [create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
were fetched on October 15, 2026 using the OpenAI Docs skill. The implementation
uses named Choice questions with distributions and separate confidence fields.
It retains strict answer order/name/option, returned-model, distribution and
refusal validation. It does not introduce predicate support or treat a predicate
probability as confidence.

The unchanged commit-2 adapter remains the direct equivalent reference and still
passes its exact Git-blob byte check. The factored adapter is a separate file;
no compatibility exception or broad allowlist was needed. Both variants retain
the same frozen speaker-labelled input JSON, authored concept descriptions,
objective/tutor questions, and source-locator options. v1 corpus, manifest,
hashes, original baseline blobs and historical observations remain immutable.

The first factored request replaces each direct concept Choice with a named
`demonstration_<criterion>` Choice:

| Raw state | Meaning | Proposal boundary |
| --- | --- | --- |
| `demonstrated` | Accurate learner explanation in their own words | Conditional attribution, with valid source |
| `partial` | Relevant incomplete explanation | `partial`, with valid source |
| `incorrect` | Complete relevant wrong attempt | `not_yet`, null source |
| `not_attempted` | No relevant attempt | `not_yet`, null source |
| `uncertain` | Demonstration/attempt cannot be determined, including simple echo without understanding | No concept proposal |

Raw partial/incorrect/not-attempted states remain separate in diagnostics and
semantic comparisons even though the existing proposal contract cannot express
the latter two separately. No binary question erases that distinction. Tutor
affirmation, irrelevant assent or a simple echo never establishes demonstration
under the instructions. Substantive learner authorship is necessary, not proof
of semantic sufficiency. Tests cannot establish that a real model follows the
instructions; the existing reducer remains the final evidence authority.

Only a `demonstrated` winner passing the explicitly supplied probability,
confidence and margin gates **and** a valid confident learner locator is eligible
for the second request. That request contains only `prompting_<criterion>` for
eligible concepts, using the identical input. Its choices are `independent`,
`prompted`, and `unresolved`. Later tutor confirmation is distinguished from
prior scaffolding. Unseen earlier help is not inferred. An uncertain first-stage
result never triggers attribution. With no policy, only first-stage raw outputs
are obtained and mapping is unconfigured; there are no default gates.

Confident independent/prompted answers map to the corresponding proposal. Valid
but unresolved/low-confidence prompting maps to `demonstrated_unattributed` only
with separately established demonstration and learner provenance. Missing,
malformed, refused, cancelled or failed second-stage responses abstain entirely;
they do not masquerade as an unresolved attribution answer. Source failure also
abstains. Snapshot, node, revision and reducer-source validation are unchanged.
The complete two-stage classifier has a total timeout; each actual harness
transport also has a bounded timeout. There is no retry or fallback.

## Harness and compatibility

```sh
# Provider-free plans; the default still uses the direct reference.
node scripts/issue-42-provider-comparison.mjs --cases oct14-engram-final
node scripts/issue-42-provider-comparison.mjs --variant factored-concepts-v1 --cases oct14-engram-final

# Provider-free synthetic mechanics across the frozen corpus.
node scripts/issue-42-provider-comparison.mjs --mode offline --variant factored-concepts-v1
```

The direct plan/report retains schema version 1 and its existing fields and
semantics. Factored plan/report uses version 2, explicitly records variant,
`factored-mapping-v1`, a design hash, first-request hash per case and full
prompting-template hash. The design hash covers all frozen first requests and
prompting templates; adapter implementation identity is recorded separately.
Actual conditional calls retain their request hash and question names in per-call
measurements. Mapping-policy hashes include the mapping version and implementation
hash, separately from the question-design hash. New adapter/calibration/CLI files
are included in
source hashes and committed-source checks for both variants. Every changed
source or plan identity invalidates previous exact-plan authorizations.

The deterministic serial schedule still alternates Jev/Decisions by case and
repetition. A factored slot can make zero, one or two requests; its default maximum
reserves three actual calls per pair. The shared counter consumes each actual
call immediately before dispatch, including failures and conditional calls.
Exhaustion prevents dispatch and abstains; locally unsupported/pre-cancelled
inputs consume none. A counter is not a cost estimate.

Factored normalized outputs live in `factored`, never in the direct
`ConversationStateOutputs` shape. Raw equivalent-Choice equality is null for
factored comparisons; its separate semantic dimensions remain unscored without
compatible review. Raw judgments, mapping, reducer acceptance and evidence stay
separate. Per-slot latency sums actual calls; per-call latency and available usage
are retained separately. Aggregates use actual call latency samples and usage
counts. Partial usage does not become an invented complete total. Cost and live
end-to-end latency remain null. Offline outputs stay `synthetic_mock` and never
count as fresh provider measurements.

A v2 run review requires version 2, the exact variant and design hash, as well as
all existing exact-plan/input/label/grouping/authorization/budget checks. Optional
reviewed Choices must be valid questions/options for that design. A v1 review
cannot authorize v2, and vice versa. Arbitrary plan mutations fail execution's
fresh-checkout reproduction check. The existing six-case review still blocks
execution. No paid run is authorized here.

**Held-out provider evaluation requires a separately locked, compatible policy.**
This commit supports such a policy only for the factored variant. Direct plans,
offline execution and historical report identities remain reproducible, but
fresh direct held-out network evaluation is blocked until a direct-specific
calibration/lock mechanism exists; a factored policy cannot authorize it.

Changing model, design and mapping at once does not isolate a provider effect.
Direct and factored reports are separate experiments on identical input; policy
changes can also change which conditional requests occur. No question-design or
model winner is claimed.

## Explicit provider-free calibration

The [calibration module](../lib/experiments/issue-42/decisions-calibration.ts)
defines the version-1 `CalibrationData`, `CalibrationReview`, `Candidate` and
`LockedPolicy` schemas. A later operator may explicitly use the provider-free
CLI after collecting and independently reviewing eligible data:

```sh
node scripts/issue-42-calibrate-decisions.mjs --observations <normalized.json> --review <independent-review.json> --candidates <finite-grid.json> --out test-results/issue-42/<new-candidate>.json
```

This command was **not run** for this implementation. It never loads env files,
credentials or transports. No fit runs as part of planning, comparison or app
startup. Missing observations/review returns `calibration_unavailable`, without
producing a candidate or copying Jev gates. Missing/invalid candidate grids with
otherwise supplied evidence fail closed. Output is exclusive-create; an existing
frozen candidate cannot be overwritten.

`CalibrationData` contains normalized factored outputs and provenance per
observation: case/input hash, group, split, measurement kind, returned model and
original dispatch policy. The context binds corpus/manifest/grouping/design,
variant, adapter implementation hash and exact model identity/hash. Normalized values are revalidated against
the exact Choice schemas, including which conditional questions could have been
asked under the recorded dispatch gates. Synthetic observations, wrong models,
foreign inputs/options, missing/extra prompting and inconsistent provenance fail.
A provenance marker is a declaration, not cryptographic proof of provider origin.

`CalibrationReview` is a **separate** versioned independent human review with
reviewer/date, an explicit independent-label declaration, grouping approval,
the same context, and exact coverage of the observed cases. Its `cases` use the
existing closed semantic label schema, with rationale and learner indexes; drafts
and incomplete reviews are not promoted. Repeated observations may share one
reviewed case. Unresolved learner-evidence dimensions are unscored. Independent
human labels cannot be inferred from model answers or produced by this tooling.

Only `calibration` records can enter fitting or threshold selection. Held-out
records and any exchange group overlapping held-out groups are rejected, as are
review/context/split mismatches. The frozen loader already verifies the corpus's
exchange/prefix leakage boundaries. All previously viewed historical snapshots
remain calibration; synthetic held-out controls never become fitting data.

The caller supplies a finite grid (at most 10,000) of separate probability,
confidence and margin gates. `finite-grid-v1` selects lexicographically:

1. Fewest false mastery proposals, including invalid reviewed provenance.
2. Fewest missed reviewed demonstrations.
3. Fewest concept abstentions.
4. Ties prefer higher probability, confidence, then margin gates.

The candidate reports these counts and their scored denominator. This is
threshold selection, not statistical probability calibration. It never modifies
Jev gates. Calibration only includes structurally valid complete observations;
missing/failed observations and conditional selection can bias available data.
Candidate mapping cannot invent a prompting result absent under original dispatch
gates: that candidate abstains. Coverage limits and the selective observation
process must be considered before collecting more calibration data or locking.

The frozen candidate records per-input hashes/group/calibration split, full
observation/review/grid hashes, design/model/corpus/manifest/grouping identities,
mapping version, fitting procedure, selected gates, counts and evidence
limitations, all bound by `candidateHash`. These are deterministic parsed-value
hashes, not exact JSON file-byte hashes; run authorization separately retains its
existing exact review-byte hash. Locks include the full candidate, actual
reviewer/date, authorization reference, `lockedBeforeHeldOut:true` and `lockHash`.
The operator must supply genuine human lock provenance; tooling does not generate
it or infer timing/approval. A self-consistent hash alone does not authenticate a
reviewer or prove that held-out outputs were unseen.

A later factored plan accepts `--locked-policy <lock.json>` instead of a raw
`--policy`. Lock/candidate integrity, fitting inputs, calibration groups and every
context identity are validated; corpus, variant, model, design or policy mutation
is rejected. The candidate must be locked before held-out evaluation and the
resulting committed-source plan must still receive a separate genuine hash-bound
run authorization with reviewed labels/grouping and explicit finite budget.
No compatible lock or empirical candidate exists in this checkout.

## Verification and remaining work

Focused tests cover conditional calls, uncertain demonstration, attribution,
partial/no-attempt distinction, tutor-only/echo controls, provenance, refusals,
malformed responses, identities, cancellation, timeouts, variant isolation,
actual-call budgets, calibration eligibility/leakage, frozen artifacts, review
and lock mismatches, deterministic selection and missing data. Synthetic reviewer
and provider fixtures exist only in tests; they are not saved approvals or
measured calibration evidence. Full unit tests, source lint/typecheck and offline
plans are required before the local commit.

Before any paid/held-out evaluation: finish genuine independent label/grouping
review, collect explicitly authorized bounded calibration observations, fit and
review a candidate on calibration only, lock it before viewing held-out outputs,
and authorize the exact committed plan. Broader independently reviewed held-out
material and honest measurement/reporting remain future work. No commit-5
results, integration recommendation or production migration is included.

Implementation validation: all 1,198 unit tests across 57 files pass (43 new
mechanical tests). Source ESLint passes with `test-results/**` excluded, and
TypeScript passes for the repository's 157 source/type files with that ignored
folder excluded. Default `npm run typecheck` reports exactly the seven existing
review-copy errors. Default lint retains the existing 759 generated/review-copy
errors and 10,594 warnings; those files are preserved. Changed-file formatting
and `git diff --check` pass. Both 71-case offline variants execute without any
fresh provider measurements. The user-owned review file retains SHA-256
`d655a9ae604f61b4f709ebff3ea95f419afede84441199f9bb9b19f3b80bae2f`.
No provider evaluation, authenticated discovery, real calibration, live browser
or voice session was performed.
