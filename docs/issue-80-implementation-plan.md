# Issue #80 implementation plan

Plan based on the current checkout, October 22, 2026. This document does not
claim that the feature, provider experiments, or acceptance tests are complete.

Issue: https://github.com/hurley87/sprout/issues/80

## Execution status — October 23, 2026

Implementation through commit 10 is complete at
`fa18bb45343e79aa1714baec8b10328d2b33ba2f`. Commit 11 supplies documentation,
the acceptance runbook and evidence forms; **live acceptance remains PENDING**.
The later user authorization to resume/finish remaining commits superseded the
original per-commit human stop below; sequential parent review/push remained.
The documentation completes the implementation sequence without issue closure.
The historical plan is retained as written; its live requirements have
not been waived or claimed as passed. See [validation](calculus-demo-validation.md),
[findings](issue-80-findings.md) and [commit 10 evidence](issue-80-commit10-evidence.md).

## Design boundary

Reuse `LessonRuntime`, `BrowserTransport`, the voice-demo lifecycle, authored
lesson registration, provenance patterns, and diagnostic journal. Add a bounded
calculus module, coordinated by the existing runtime. Do not copy the MAE386
runtime or generalize its sentence-rewrite feature into mathematical editing.

Use one lesson node per problem and a terminal recap. Mathematical steps live
within the current problem; they are not lesson nodes. Explicit completion,
skip, and end remain distinct from demonstrated understanding. Do not enable
MAE386's automatic tutor-closure advancement for calculus without a separate
calculus completion policy.

The pipeline is:

```text
authenticated learner words + current mathematical state
  -> proposed mathematical action
  -> source/schema/current-state validation
  -> mathematical check and separate reasoning/help assessment
  -> deterministic mathematical state
  -> publish and confirm equation display
  -> bounded tutor context describing the accepted disposition
```

Accepting an action is different from accepting its mathematics as correct.
A complete, unambiguous but incorrect expression is a visible attempted step.
An ambiguous/incomplete instruction requests clarification without adding an
invented expression. Unsupported mathematical forms remain unresolved rather
than being labelled incorrect.

Source identity includes runtime, problem/node, visit, learner turn(s), exact
quoted spans, transcript revision, and the board revision on which the proposal
was based. Models propose source locators; application code authenticates them.
Keep learner actions separate from tutor feedback. A later tutor-only transcript
revision must not erase valid pending learner work; a superseding learner revision,
board edit, problem change, or Stop must invalidate its mutation authority.

Use a small structured expression representation for the supported arithmetic,
integer powers, sine/cosine, and calculus notation. Generate display LaTeX from
validated structure. Do not evaluate arbitrary strings, use numerical spot checks
as proof, or build a general symbolic solver. Preserve supplied expressions for
display; normalization for comparison must not silently repair learner work.

## Commit protocol

Implement these commits sequentially from the latest approved SHA. Each must
compile and keep existing routes working; incomplete capabilities remain
unreachable until the calculus route is introduced. Keep each commit limited to
its listed objective. Any newly discovered prerequisite gets its own bounded
commit rather than expanding shared runtime work without review.

For every commit, record the starting SHA, resulting SHA, changed files, commands
and results, limitations, and `git status --short --branch`. Review the actual
diff and run `git diff --check`. Stop for **Approve**, **Request changes**, or
**Abort** before continuing or integrating the exact reviewed commit. This plan
does not start implementation or prescribe agent/model delegation.

Before code changes, read the applicable guides in
`node_modules/next/dist/docs/`, as required by `AGENTS.md`. Read current official
provider and rendering documentation before using new APIs; neither realtime
tool support nor a new provider output format is assumed here.

## 1. Prove the interpretation and rendering integration

**Objective:** resolve the two external integration decisions before wiring the
runtime. This is an isolated experiment, not another conversation system.

**Add:**

- `scripts/issue-80-feasibility.mjs`
- `tests/fixtures/calculus/interpretation-cases.json`
- `docs/issue-80-feasibility.md`

The experiment takes speaker-separated recorded/example text and attempts
structured extraction using a documented available provider mechanism. Cover
complete expressions, strategy only, a missing operand, ambiguity, wrong signs,
replacement, and undo. Confirm whether the current GPT-Live integration can
produce structured proposals; if it cannot, document the smallest server-side
interpretation adapter using existing credentials. Jev's existing closed-choice
classification output is not assumed to generate arbitrary equations. Record the
chosen mechanism, model, output contract, cancellation behavior, cost/latency
observations, and failure disposition. Do not add provider credentials to files.

Compare a minimal tldraw equation-shape experiment with a simple equation list.
Use disposable experiment files; retain only a small reproducible harness if
needed. Evaluate equation fidelity, layout, updates, accessibility, and integration
cost. Record the renderer choice and dependency/licensing constraints from current
documentation. No production canvas engine in this commit.

**Verify:** run the text cases against the actual chosen provider, separately
labelled from mocks; visually inspect equation append/replace/undo with both
renderer candidates; document failures and the exact versions used. If no usable
interpretation mechanism exists, report that concrete blocker before proceeding.

**Review boundary:** extraction and renderer decisions are reviewable, with no
production runtime or existing demo behavior changes.

## 2. Author the problems and mathematical action contract

**Add:**

- `lib/calculus/problems.ts`
- `lib/calculus/math-expression.ts`
- `lib/calculus/math-action.ts`
- `tests/calculus-problems.test.ts`
- `tests/calculus-math-action.test.ts`

Author the exact three problems from #80. Include expected methods, intermediate
transformations, equivalent forms, common errors, non-leading probes, reasoning
criteria, and completion conditions. Keep answer keys private from the initial
tutor context where they would encourage completing the learner's work.

Define append/replace/undo/clarify/help/next proposals, source spans, board
revision, target logical step IDs, strategy-only observations, and independent
disposition/correctness/reasoning fields. A response may contain an ordered,
bounded action batch when a learner actually supplies several steps; applying
that batch must be atomic against its base board revision. A single expression
is still one step. Reject extra fields and invalid action combinations.

**Verify:** `npx vitest run tests/calculus-problems.test.ts tests/calculus-math-action.test.ts`.
Test all authored fixtures, malformed structures, absent operands, unsupported
operators, invalid targets, and forged source fields. Review the calculus content
and permissible alternate routes directly, not just snapshot strings.

**Review boundary:** pure data and contracts; no provider or runtime changes.

## 3. Implement bounded mathematical validation

**Add:**

- `lib/calculus/math-validator.ts`
- `tests/calculus-math-validator.test.ts`

Check expressions and transformations against each authored problem and current
work. Support a documented finite set of equivalent forms through structured
normalization and authored transformation checks. Distinguish valid, incorrect,
unsupported, and incomplete. Keep syntactic fidelity, transformation correctness,
and evidence of reasoning separate. Strategy identification alone is not an
executed derivative or proof of completion.

**Verify:** `npx vitest run tests/calculus-math-validator.test.ts`.
Include all three correct solutions, reordered products/sums, expanded versus
factored supported answers, wrong signs, missing product terms, missing chain
factors, invalid transformations, and correct finals with absent/misleading
reasoning. Explicitly test an unsupported valid form as unresolved. If supporting
alternate forms requires a symbolic backend, document the gap and revisit scope
before adding one.

**Review boundary:** deterministic mathematical checks; no network or UI.

## 4. Implement mathematical state and evidence history

**Add:**

- `lib/calculus/math-state.ts`
- `lib/calculus/math-evidence.ts`
- `tests/calculus-math-state.test.ts`
- `tests/calculus-math-evidence.test.ts`

Maintain ordered logical steps, current step versions, immutable action history,
incorrect attempts, replacements, withdrawal/undo links, clarification state, and
help provenance. Define undo as reversing the latest effective learner board edit;
undoing a replacement restores its predecessor. A correction must not erase the
original attempt or inherit independent credit from an earlier correct version.

Reuse authenticated word/turn and prompting-history patterns from concept evidence
and MAE386 rewrite selection, without importing sentence-specific criteria into
math. Bind help to explicit source events and subsequent learner actions; unknown
assistance stays unknown. A neutral probe is distinguishable from answer-giving.

**Verify:** `npx vitest run tests/calculus-math-state.test.ts tests/calculus-math-evidence.test.ts`.
Exercise append -> incorrect replacement -> correction -> undo, multiple steps,
atomic action batches, duplicate delivery, stale base revisions, invalid targets,
withdrawal, hint -> answer, tutor echo/praise, and separate completion/skip status.

**Review boundary:** pure reducer and provenance; no lesson navigation changes.

## 5. Add the server-side interpretation adapter

**Add:**

- `lib/calculus/math-interpreter.ts`
- `lib/calculus/math-interpretation-contract.ts`
- `app/api/math-action/route.ts`
- `tests/calculus-math-interpreter.test.ts`
- `tests/math-action-route.test.ts`

Implement the mechanism proven in commit 1 behind a narrow, provider-independent
interface. Reuse local-request enforcement, server-only credentials, request size
limits, timeout/abort handling, and validated output patterns. Do not silently
change the existing `/api/classify` schema or ask Jev to become a math oracle.
The new route is a focused adapter, not a second voice/session service. Restrict
it to authored calculus problem IDs, even before lesson registration is added.

Input includes exact learner text and authenticated spans, clearly separated tutor
context, current problem, and compact current board state. Output proposes only
what the learner supplied. Strategy-only, incomplete, ambiguous, malformed, or
unavailable results have explicit non-mutating dispositions. Actual source
authority is checked again by the client runtime, not accepted from the provider.

**Verify:** `npx vitest run tests/calculus-math-interpreter.test.ts tests/math-action-route.test.ts`.
Mock provider I/O to test schema, source-span validation, instruction injection,
timeouts, cancellation, non-local requests, unknown problems, and oversized input.
Replay commit 1's labelled text cases against the real adapter separately; record
results without calling that microphone acceptance.

**Review boundary:** an isolated endpoint; no live lesson calls it yet.

## 6. Connect mathematical actions to the existing runtime

**Add:**

- `lib/calculus/math-controller.ts`
- `lib/lesson-runtime/calculus-lesson.ts`
- `tests/calculus-runtime.test.ts`

**Change:**

- `lib/lesson-runtime/lesson-definition.ts`
- `lib/lesson-runtime/lesson-registry.ts`
- `lib/lesson-runtime/lesson-runtime.ts`
- `lib/lesson-runtime/lesson-runtime-reducer.ts`

Add a small explicit calculus opt-in to the lesson definition and register its
three authored nodes plus terminal recap. The controller coordinates extraction,
validation, and the pure math reducer; `LessonRuntime` owns its lifecycle and
publishes its snapshot. Do not instantiate another transport or transcript store.

Trigger interpretation from settled authenticated learner contributions, with
context across fragments. Separate learner-action freshness from tutor-only
transcript updates. Apply only actions with current runtime/visit/board authority.
Invalidate pending operations on correction, problem change, restart, and Stop.

Publish committed mathematical state immediately, independently of tutor output
quiet/closure. Retain existing safety gates for problem transitions. Calculus
advancement follows explicit learner navigation or authored completion conditions,
never praise or equation equivalence alone. Unsupported math cannot produce
mastery. Preserve final board history on early Stop and skipped problems.

**Verify:** `npx vitest run tests/calculus-runtime.test.ts tests/lesson-runtime-scheduling.test.ts tests/mae386-navigation-runtime.test.ts tests/browser-transport.test.ts`.
Test stop/next during pending extraction, newer learner revisions, tutor-only
updates, duplicate responses, changed target steps, interrupted speech, and a
committed step becoming observable while tutor audio is still active.

**Review boundary:** calculus is registered but has no public demo page yet;
counting and MAE386 scheduling must remain unchanged.

## 7. Add calculus tutor instructions and feedback synchronization

**Add:**

- `lib/calculus/tutor-context.ts`
- `tests/calculus-tutor-context.test.ts`

**Change:**

- `lib/lesson-runtime/calculus-lesson.ts`
- `lib/lesson-runtime/live-context.ts`
- `lib/calculus/math-controller.ts`
- `lib/lesson-runtime/lesson-runtime.ts`
- `tests/calculus-runtime.test.ts`

Make strategy-versus-execution, no invisible completion, non-leading probes,
visible errors, and assisted evidence explicit in calculus instructions. Send
bounded current-board/disposition context through the existing instruction-append
mechanism after display confirmation. Keep equation commit independent of that
append's acknowledgment or tutor response. Superseded feedback is not sent.

Clarify the realtime limitation in tests/docs: prompts and context constrain
tutor behavior, but actual spoken compliance requires live evaluation. Do not
claim that deterministic state validation alone prevents every verbal answer leak.

**Verify:** `npx vitest run tests/calculus-tutor-context.test.ts tests/calculus-runtime.test.ts`.
Check exact bounded context, no future-problem answers, clarification on a
strategy-only utterance, hint attribution, feedback for incorrect attempts,
stale feedback suppression, and no board edits/evidence from tutor recitations.

**Review boundary:** tutor behavior is added without changing other lesson prompts.

## 8. Implement the equation board presentation

**Add:**

- `components/calculus/math-whiteboard.tsx`
- `components/calculus/math-whiteboard.module.css`
- `lib/calculus/math-rendering.ts`
- `tests/calculus-math-rendering.test.ts`

**Change if required by commit 1's renderer decision:**

- `package.json`
- `package-lock.json`

Build only the chosen surface. For tldraw, add the minimum equation shape support
inside `components/calculus/`; otherwise explain the lighter surface in the
feasibility document. Logical math state owns equations; shape IDs and canvas
events never grant lesson mutation authority. Keep learner freehand input out of
scope. Render supplied expressions faithfully with provisional/incorrect status,
current work, and readable correction history. Include an accessible text form.

Expose an after-commit display confirmation keyed by board revision. Do not
confuse a requested React update or an unchanged problem render token with proof
that a new equation is visible.

**Verify:** `npx vitest run tests/calculus-math-rendering.test.ts` and
`npm run typecheck`. Visually inspect the three authored expressions, a long
product-rule line, wrong signs, replacement, undo, narrow viewport, keyboard
access, and render failures. Interactive browser coverage follows with the route.

**Review boundary:** presentation and any dependencies, separate from voice wiring.

## 9. Add the calculus demo route and controls

**Add:**

- `app/demos/calculus/page.tsx`
- `components/calculus-demo.tsx`
- `tests/browser/calculus.spec.ts`

**Change only as needed for shared presentation callbacks:**

- `components/voice-demo/use-voice-demo.ts`
- `components/voice-demo/controls.tsx`

Adapt the MAE386 shell using the shared hook and controls; do not copy its
eight-question logic, quiet-control timers, or sentence presentation. Show one
problem, live current work, step status/history, Start/Stop, help, and skip.
Support spoken replacement/undo through the action path. Connect board display
confirmation to runtime feedback. Expose `?debug=1` and a basic session export.
Keep initial prompt rendering distinct from incremental equation display.

**Verify:** `npx playwright test tests/browser/calculus.spec.ts --workers=1`.
Use existing local WebRTC/provider mocks to exercise all three problems,
strategy-only clarification, incomplete speech, an incorrect step, replacement,
undo, help provenance, next, and Stop. Assert that equations display before tutor
feedback completes, and that microphone tracks close on Stop, unmount, and hide.
Run the MAE386 browser test if shared hook/control behavior changes.

**Review boundary:** a usable end-to-end demo with deterministic provider fixtures;
no claim yet about actual microphone accuracy.

## 10. Complete diagnostics and adversarial regression coverage

**Add:**

- `lib/calculus/math-diagnostics.ts`
- `tests/calculus-diagnostics.test.ts`

**Change:**

- `lib/lesson-runtime/diagnostic-journal.ts`
- `lib/lesson-runtime/lesson-runtime.ts`
- `lib/calculus/math-controller.ts`
- `components/calculus-demo.tsx`
- `tests/calculus-runtime.test.ts`
- `tests/browser/calculus.spec.ts`

Export raw learner text/revision and exact source spans; action proposal and
disposition; before/after board revisions; immutable history; math validation;
reasoning/help assessment; and separate timings for speech end, transcript
availability, interpretation, state commit, actual equation display, and tutor
completion. Core action history is introduced in commit 4; this commit makes its
diagnostic projection complete. Preserve unavailable timestamps as unavailable.

Provide reviewable false-commit/correction annotations for labelled evaluation
cases. Do not infer that a commit was faithful merely because the runtime accepted
it. Define speech-end-to-display per action, including which source speech end
anchors a multi-turn proposal; log later corrections as separate actions.

Expand race cases to rapid next/Stop, repeated transcript fragments, delayed
responses, rejected edits, wrong problem/visit, ambiguous sine/sign and powers,
tutor praise, tutor-supplied answers, and unsupported equivalent expressions.

**Verify:** focused calculus tests, then the full regression gate once:

```sh
npm test
npm run test:browser -- --workers=1
npm run lint
npm run typecheck
npm run build
git diff --check
```

Inspect an exported deterministic session for complete provenance, consistent
board revisions, valid timings, and secret scrubbing. Distinguish synthetic
transcript tests from audio-recognition evidence.

**Review boundary:** full automated regression evidence and an inspectable export.

## 11. Perform real microphone acceptance and record findings

**Add:**

- `docs/calculus-demo-validation.md`
- `docs/issue-80-findings.md`
- Sanitized, explicitly selected evidence under `docs/evidence/`, if appropriate.

**Change:**

- `docs/README.md`
- `README.md`

Run the issue's actual microphone matrix at a recorded SHA: correct solutions
for all three problems; strategy only; incomplete and ambiguous expressions;
wrong signs/derivatives; correction and undo; alternate forms and missing
reasoning; hints and tutor echoes; pauses; stale responses; rapid next/Stop;
early exit and media teardown. Review intended math against displayed math,
not just correctness against the answer key.

Report scenario counts, false commits, correction frequency, interpretation
failures, speech-end-to-display timing distributions with sample counts, and
conversational behavior. Agree any numeric latency target before using it as a
pass threshold. Keep Bill's learner/instructor critique separate from automated
results. Record whether tldraw was justified and any limitations of the authored
validator or provider interpretation.

**Verify:** inspect exports and the board during real sessions; record each
scenario as pass/fail/unverified with evidence and SHA. Human microphone testing
and Bill's feedback require their participation. If unavailable, keep the issue
incomplete and list those pending checks explicitly. Live failures become small
fix commits with focused regression cases and revalidation before acceptance;
do not bury runtime changes inside the findings commit.

**Review boundary:** accept the POC only when the issue's requirements are
supported by both automated checks and the required real-session evidence.

## Scope held throughout

No new database, accounts, persistent profiles, arbitrary problem ingestion,
handwriting, provider migration, general canvas framework, or broad runtime
rewrite. No symbolic backend unless the alternate-form spike establishes a
specific need. Existing counting and MAE386 behavior remains a regression boundary.
