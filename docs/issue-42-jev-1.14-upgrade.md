# Active Jev 1.14 and the frozen issue #42 baseline

On October 15, 2026, the active `JEV_MODEL` pin changes from `jev-1.13.0` to
`jev-1.14.0`. The shared constant also selects the model for existing assessment
and historical experiment callers that import it; their questions and mapping
are untouched. The issue #42 comparison is explicitly exempt: its `jev` arm
continues to request and validate **1.13**, not the active model.

## Contract compatibility and verification limits

The official [1.14 release announcement](https://typesafe.ai/blog/jev-1-14)
identifies the new model and discusses additional opt-in capabilities. The
public [SystemOne OpenAPI schema](https://api.typesafe.ai/openapi.json), inspected
October 15, still defines Choice questions as `type`, `instructions`, and a
`criteria` map. Choice answers contain `type`, `choice`, `confidence`, and a
probability map; the envelope identifies the model that answered. Sprout keeps
this text-only schema and does not enable images, box questions or extended
context headers.

Mocked tests exercise the active 1.14 request, existing probability normalization,
concept/source mapping, and reducer acceptance. Identical synthetic 1.13 and 1.14
scores produce identical decisions. Cross-version responses and aliases are
rejected; request identity is captured before awaiting transport. Existing
thresholds, rounding tolerance, prompting attribution, learner provenance,
questions, reducer, and Decisions adapter are unchanged.

These checks establish documented wire compatibility and local pipeline behavior.
No authenticated discovery, provider evaluation or live lesson was performed.
Account access, exact returned model identifiers in real responses, availability
of both versioned models, accuracy, latency and cost remain unverified. A failure
to return the requested version fails closed; no alias fallback is introduced.

## Benchmark compatibility boundary

The immutable `classifier-benchmark-v1` corpus, manifests, original Git blobs
and historical reports remain unchanged. The comparison now executes an isolated,
byte-verified Jev 1.13 contract under `lib/experiments/issue-42/historical-v1/`,
including its historical questions, projections, source selection, mapping,
executor and reducer. It does not use active lesson-runtime behavior.

Active implementation upgrades do not require modifying the frozen benchmark.
Actual active hashes are recorded under `activeRuntime.sourceHashes` as run
provenance; the former `ACTIVE_MODEL_COMPATIBILITY` exception list is obsolete.
Historical bytes still validate against their frozen hashes and original Git
objects. See [Issue #42 identity and parity](issue-42-provider-comparison.md#identity-and-parity)
for the maintained technical explanation and authorization rules.

Mocked replay verifies local contract behavior, including rejection of a 1.14
response to the 1.13 arm. It is not a live-provider accuracy measurement. Fresh
provider comparison still depends on model availability and the existing reviewed
plan/run gates. Changed tooling/provenance changes plan identities without
rewriting historical results.

## Separate 1.14 comparison arm remains future work

Adding 1.14 to the benchmark requires a separately named arm, explicit versioned
requests and returned-model checks, updated scheduling/budgets and paired-report
logic, and a fresh hash-bound review/run authorization. Reuse the same frozen
inputs, questions and mapping to isolate model version, and retain 1.13 as its
own arm. Do not relabel the existing `jev` arm or overwrite earlier results.
The older issue #57 offline projection report likewise uses its stored model
when reconstructing historical requests. Its frozen reports and contract hashes
are unchanged. Tests distinguish those historical identities from current
transport delivery on old transcript examples.

No factored questions, tuning, calibration or paid run is included here.

## Historical upgrade validation (15 October 2026)

These results predate benchmark isolation and are not current check results.

All 1,155 unit tests across 55 files pass. Full source lint passes with ignored
`test-results/**` excluded. Default `npm run lint` also scans old review copies
and their generated Next chunks there (759 errors and 10,594 warnings); those
files are preserved. Default `npm run typecheck` still reports the seven known
errors in `test-results/commit3-review/app/`; TypeScript passes with that ignored
review directory excluded. Formatting checks for formatted changed files and
`git diff --check` pass; existing runtime-file formatting is preserved.

The provider-free CLI plan validates all 71 snapshots, and offline execution
processes 142 arm slots with zero observed provider classifications. It reports
active 1.14 and comparison 1.13 separately. Frozen corpus files, historical JSON
reports, the Decisions adapter, question/threshold/mapping contract and reducer
are unchanged. The user-owned untracked six-case review remains unchanged and is
excluded from this commit. No provider evaluations, factored classification or
calibration were performed.
