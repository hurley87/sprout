# Issue #80 findings and evidence status

October 23, 2026. Implementation is complete through commit 10,
`fa18bb45343e79aa1714baec8b10328d2b33ba2f`, on `codex/80-feasibility`.
The final documentation commit supplies the durable plan, route/setup guidance,
acceptance matrix and evidence forms. **Actual microphone acceptance, current
provider-adapter success, spoken tutor compliance, and Bill's critique remain
PENDING. Issue #80 is not accepted or closed.**

The later user instruction to finish the remaining commits superseded the
[plan's original per-commit human stop](issue-80-implementation-plan.md#commit-protocol).
Sequential parent review/push remained in force. The documentation completes the
implementation sequence; issue acceptance remains open. This procedural change
does not waive the pending live acceptance requirements.

## What the implementation establishes

The calculus route reuses the existing voice lifecycle and runtime for three
fixed problems. A server-side Responses adapter proposes bounded structured
learner actions; application code authenticates exact learner spans, runtime,
problem/visit, transcript and board revisions. Full provisional actions must be
displayed and explicitly confirmed before atomic board mutation. UI and bounded
spoken confirmation retain separate evidence. Wrong work remains visible;
correction and undo preserve immutable history. Navigation and Stop revoke stale
mutation authority. Board publication does not wait for tutor speech completion.

The batch simplification uses one `commitMathBatch` parse/review/commit operation,
with per-action staged-board review and atomic rejection. It removes acceptance
capabilities, delivery fingerprints and board delivery deduplication; pending
proposal identity/display and captured-state checks remain in the controller.
History delivery IDs remain diagnostic correlation keys. Validation input/context
now lives on each board version rather than parallel controller maps, with the
existing exported checks unchanged.

Supported mathematical comparison is deterministic and finite, preserving supplied
notation. It does not evaluate arbitrary expressions or grant official marks.
Correctness, interpretation intent, reasoning and assistance are separate;
reasoning/independent understanding remain conservative and unassessed. Tutor
recitation/praise cannot become learner work. Context instructions and safe board
mutation cannot prove that the live tutor avoids every verbal answer leak.
See the [walkthrough, domain boundary and acceptance matrix](calculus-demo-validation.md)
and [tutor synchronization contract](calculus-tutor-integration.md).

The **ordered equation list plus KaTeX** was chosen over tldraw after the
[isolated comparison](issue-80-feasibility.md#visual-and-accessibility-observations).
It preserved glyph fidelity, logical reading order, native controls and readable
horizontal overflow without camera zoom, culling, shape lifecycle or an additional
canvas dependency/licensing requirement. No spatial/freehand requirement justified
tldraw for these three problems. Production generates LaTeX from validated AST,
uses KaTeX with bounded/untrusted settings, accessible text and explicit render
fallbacks. DOM/keyboard checks and narrow-layout browser checks are available;
a real assistive-technology/screen-reader audit remains PENDING.

## Evidence ledger: do not merge these populations

| Evidence                                                                | Recorded result                                                                                                      | Limit                                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Commit 1 actual provider text spike                                     | 17/17 source-valid, faithful synthetic proposals under its earlier experimental schema                               | Small one-run sample; not production adapter schema, microphone accuracy, math grading or independence                     |
| Commit 5 actual production-adapter text replay                          | All 17 cases attempted once returned non-mutating provider-failure; diagnostic HTTP 401 `token_invalidated`          | No generated proposals; current strict schema acceptance and extraction accuracy remain PENDING                            |
| Authored deterministic fixtures and mocked provider I/O                 | Contracts, finite math, provenance, correction/history, timing and stale/duplicate lifecycle checks                  | Constructed expectations and synthetic clocks; not empirical speech/tutor evaluation                                       |
| Commit 10 final clean-source automated gate                             | 2,240 unit tests passed; one explicit live-provider replay skipped; 43 browser tests passed; lint/types/build passed | Browser uses synthetic audio/local WebRTC with injected transcripts and mock interpretation; no human recognition evidence |
| Parent independent commit 10 review                                     | Matched eight-file patch SHA-256 and reran 77 focused diagnostics/runtime tests successfully                         | Verification reported by parent; not rerun as documentation testing                                                        |
| Human microphone, actual spoken tutor, Bill learner/instructor critique | PENDING                                                                                                              | No participant evidence, live rates or live latency distributions exist                                                    |

The [feasibility record](issue-80-feasibility.md) retains historical experiments,
including earlier constraints and failures. The [commit 10 evidence note](issue-80-commit10-evidence.md)
is the source of the automated gate results above. These are historical checks,
not new tests performed for this documentation commit. No provider retry was made.
The old spike's HTTP-start-to-response-header median 2,739 ms (n=17) excludes body
parse, validation and display; it is not current-adapter or speech-to-display
latency. No numeric latency acceptance threshold has been agreed.

Live interpretation fidelity, false-commit count/rate, correction frequency,
interpretation failures and speech-to-display distribution: **PENDING/null**.
The synthetic deliberately mislabeled wrong-sign fixture shows that parser
acceptance and mathematical correctness cannot substitute for manual ground truth.
Use the [local evidence forms](calculus-demo-validation.md#human-session-and-evidence-form)
before computing rates. Bill's qualitative critique is a separate human record,
not another automated success count.

## Verification source and reproduction

Commit 10's eight-code/test-file staged binary patch SHA-256 was
`e94da514c0110ae83d8d2ab976482aa4e2223f3e1bc4d0b35bcc948b3943a61a`.
Its sorted source-manifest SHA-256 was
`9b33c2f64b634765e056f0c84ab8d66e9867c5cb1fb1d9eab2df868d33f7c4cb`.
The evidence note itself was outside that eight-file patch. Parent independently
matched the patch to the reviewed commit. Preserve these as provenance, not a
claim that this docs-only commit generated another runtime gate.

Ignored historical app/build copies under `test-results/commit3-review` and
`test-results/ui-review` can obstruct broad lint/type checks in the working
checkout. Preserve them. A clean copy of tracked source with its own dependencies
avoids those artifacts; a dependency symlink failed Turbopack filesystem-root
checks during the earlier experiment. Some historical benchmark unit tests call
`git show`, so an archive without access to Git history causes setup failures.
The commit 10 gate supplied read-only Git object access on the justified rerun.
No lint/TypeScript exclusions were changed to hide artifacts.

To reproduce the recorded source gate, start from this repository and use a new
temporary copy. This excludes local credentials and ignored outputs; Git history
is supplied only for tests. These commands are instructions, not a new recorded run:

```sh
source_repo=$(pwd)
source_git_dir=$(git rev-parse --absolute-git-dir)
source_sha=fa18bb45343e79aa1714baec8b10328d2b33ba2f
gate_dir=$(mktemp -d /tmp/sprout-calculus-gate.XXXXXX)
git archive "$source_sha" | tar -x -C "$gate_dir"
cd "$gate_dir"
npm ci
GIT_DIR="$source_git_dir" GIT_WORK_TREE="$gate_dir" npm test
npm run test:browser -- --workers=1
npm run lint
npm run typecheck
npm run build
cd "$source_repo"
git diff --check
git diff --cached --check
```

The browser config uses an isolated localhost server on port 3100 with empty
provider credential overrides and refuses server reuse; free that port without
stopping an unrelated user session. Run suites sequentially. Installing browser
binaries, if absent, is a local prerequisite (`npx playwright install chromium`).
No broad tests were rerun for the final documentation-only changes; scoped
formatting, link/path/command review and unstaged/staged whitespace checks are the
appropriate verification. Consult the final commit report for those check results.

## Remaining acceptance work

Refresh credentials locally, then perform the explicitly opted-in production
adapter text replay and record schema/output failures without silently retrying.
Run every [human matrix row](calculus-demo-validation.md#acceptance-matrix-and-evidence-classes)
at a recorded SHA with instructor ground truth; inspect proposals, exports,
corrections and media teardown. Gather Bill's dated critique and a real
assistive-technology audit. Agree latency criteria before applying a numeric
threshold. No real participation or successful live result is inferred here.

Any discovered runtime bug needs a separate bounded implementation commit with
focused regression coverage and revalidation; this findings commit contains no
application changes. The current evidence supports a reviewable implemented POC,
with live acceptance still outstanding.
