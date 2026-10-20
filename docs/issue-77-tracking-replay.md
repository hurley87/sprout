# Issue 77: provider-free preservation replay

Baseline: `16120943cd821749dbca025d4456f53bf4c01968`, before tracking.
Implementation parent: `599a5b430b5538fdeaf0beb64d8ae72ff136de8d`.
No production code, behavior flags, policy, prompts or evaluator settings changed.

## Method and what it proves

Run the complete unit suite with `npx vitest run --config vitest.tracking-replay.config.ts`.
The test-only setup executes both the current and pinned **actual historical**
reducer on every reduction invoked by the suite. It compares complete states,
ordered effects, initialization and unchanged-state object identity. Thus the
existing regression expectations are also historical baseline checks, including
runtime-driven reductions and clock ticks, not just tracking-helper expectations.
Each stream starts at the same initial state or test fixture checkpoint. New
`proposalConsumption` metadata is observational and excluded from the comparison.

Only one historical source file is retained. Its reversible import relocation,
original SHA-256 and six unchanged transitive dependency hashes are checked by
`tracking-baseline-provenance.test.ts`; extraction details are in
`tests/fixtures/issue-77-baseline/README.md`. Tests need neither Git nor network.

`tracking-runtime-replay.test.ts` separately compares real `LessonRuntime`
orchestration with tracking enabled versus test-only no-op journal tracking
methods and no playback sink. It compares **every nontracking diagnostic**, exact
HTTP bodies/order/local request timestamps, cancellation indexes, final runtime
snapshot, all outbound commands, close count, render tokens/targets/origins and
steering. Tracking records, optional eligibility projection and the recent
diagnostics projection are excluded. Attempt UUID/wall clock are fixed.

This is not a full historical runtime or historical browser-transport comparison.
It establishes runtime tracking-on/off invariants; the historical reducer checks
establish pre-instrumentation state/effect invariants. Browser transport remains
covered separately by the existing real local WebRTC/browser tests and focused
unit tests. Nothing here tests live provider accuracy, human audibility or latency
improvement.

## Coverage and observed invariants

All files in this table run under the differential guard. The table maps reused
regressions rather than pretending the new test recreates every scenario.

| Cases | Executable coverage / preservation assertion |
| --- | --- |
| Correct, incorrect, help, unsettled | New runtime on/off matrix: same exact request sources/payloads and diagnostics; correct has two requests (child acceptance then tutor-only revalidation), one authored render request and two steering appends. Other judgments hold. `transcript-state-lesson-runtime.test.ts`, `counting-confirmation.test.ts` retain their semantic assertions. |
| Acceptance immediately followed by transition | `evidence-tracking.test.ts` checks intermediate acceptance before destination flags clear. Guard compares its historical state/effects too; new runtime case compares the requested/confirmed target and steering. |
| Tutor-only history and original attribution | `evidence-tracking.test.ts`, `lesson-runtime-scheduling.test.ts`: earlier acceptance/source remains immutable, authority suspends, same answer revalidates; no historical relabelling to a new child turn. |
| Corrections both directions, why/help after correct | `self-correction-acknowledgment.test.ts`, `completed-exchange-recovery.test.ts`, `help-request-recovery.test.ts`, `lesson-runtime-scheduling.test.ts`: same revision/audio invalidation and request/transition behavior. |
| Prompting, leakage, echo, split/spanning explanation | `lesson-concept-evidence.test.ts`, `concept-evidence-provenance.test.ts`, `concept-evidence-spans.test.ts`, `fragmented-concept-attribution.test.ts`, `evidence-tracking.test.ts`: same original quote/span, prompting history, strongest-evidence retention and echo guards. Unsupported correction/contradiction/general prompting judgments remain unknown. |
| Interrupted feedback, discarded candidates, no text | `lesson-runtime-scheduling.test.ts`, `microphone-only-stall.test.ts`, `conversation-first.test.ts`; new saved butterfly schedule checks identical request stream through recorded candidate events. Energy remains separate from speech content. |
| Late/duplicate/stale proposal or playback, stopped runtime | `transcript-state-lesson-runtime.test.ts`, `evidence-tracking.test.ts`, `browser-transport.test.ts`, `lesson-observation.test.ts`; new cancellation case settles both aborted promises late and compares cancellation indexes `[0, 1]`, and ignores post-stop playback. |
| Missing/unavailable media, blocked play | New on/off unavailable/blocked cases hold the scene and keep one steering append. Mocked playback facts do not drive media gates. `browser-transport.test.ts`, `lesson-observation.test.ts`, browser `transport-output.spec.ts` cover actual attachment fencing, absent instrumentation, rejected play and delivery history. |
| Transition/render interruption/stale callback | `lesson-runtime-scheduling.test.ts`, `transcript-state-counting-lesson.test.ts`, `catching-unicorns-presentation.test.ts`; new on/off case sends stale and duplicate confirmations and compares all steering/render identities. |
| Conversation-first concepts, closure, explicit move-on | `conversation-first.test.ts`, `catching-unicorns-closure.test.ts`, `catching-unicorns-completion-consistency.test.ts`, `learner-navigation.test.ts`: same unresolved concept ledger, navigation/closure, authored edges and steering; navigation does not manufacture mastery. Saved Catching Unicorns transcripts/scores/events are reused in those tests with their existing provenance. |
| Terminal recap, resumed output, reconfirmation, deadline | `terminal-completion.test.ts`, `terminal-recap.test.ts`, `catching-unicorns-runtime-continuation.test.ts`, `evidence-recap.test.ts`: same text/audio/quiet gates and exact terminal token/effects, without Jev recap completion classification. |
| PCM versus gates versus playback | Existing delivery tests plus the new on/off matrix retain PCM and pre-event gate facts separately. New PCM records explicitly require mocked attachment generation `1`. Every delivery record still has null response ID and unknown response completion/speech heard. |

The saved butterfly runtime replay requests classification three times: synthetic
first and second visit completions, then the exact saved butterfly request
transcript with the saved classifier outputs (abstention). It requests exactly
two authored transitions and three steering appends; the final visit remains held.
The same ordered outcomes and timestamps occur with tracking disabled. This does
not assert those requests are unnecessary or propose a scheduling change.

## Provenance and timing limits

The new runtime matrix, classifier responses, playback callbacks and PCM signals
are synthetic except the saved butterfly `incoming` fragments/order/provider
intervals and final saved classifier outputs. Its first two visits are synthetic
setup. Fake timers reconstruct scheduling rather than network/ASR jitter. Existing
sanitized Catching Unicorns reducer checkpoints/events and reconstructed schedules
retain their original fixture descriptions; rebinding identity does not create a
new recorded provider session. Missing playback stages in old exports stay unknown.

For the synthetic counting success: child provider interval is 100–200 ms but
local receipt/turn end is 0 ms; the first request/result is local 300 ms. Tutor
provider interval is 300–400 ms with local receipt/PCM active/quiet at 300 ms;
tutor-only revalidation, render request, confirmation and next steering occur at
local 900 ms. These provider and local values deliberately are **not one clock**.
Mock browser request elapsed is 0 ms; endpoint evaluator elapsed is absent/unknown.
Play requested/resolved is synthetic at local 0 ms. Quiet and resolved play never
establish response completion or hearing. Saved mapping elapsed is fixture metadata,
not a fresh latency measurement. Exact request, event and render timing is compared
between runs; no subtraction attributes residual time to model compute/playback.

Recommendation: **no policy change from this preservation evidence**. The replay
shows the tracked paths retain baseline behavior, including known conservative
holds and revalidation. Live accuracy/audibility and response-level completion
remain outside the evidence; counting fine-grained answer independence remains
unknown. This does not establish absence of defects outside the exercised paths.

## Validation

Final validation: ordinary unit suite and differential baseline suite each passed
72 files / 1,497 tests. The isolated browser run passed all 9 checks (43.5 seconds).
Current-source TypeScript, source lint, touched-file formatting and diff checks passed.
Standard `tsc --noEmit` fails in ignored `test-results/commit3-review`; standard lint
reports 759 errors and 10,594 warnings in ignored generated/review sources. Full
repository formatting reports 47 pre-existing files. Those files were untouched.

Commands:

```sh
npm test
npx vitest run --config vitest.tracking-replay.config.ts
npx tsc --noEmit --project /tmp/sprout-77-tsconfig.json
npx eslint . --ignore-pattern 'test-results/**'
npx prettier --check tests/helpers/tracking-baseline-guard.ts tests/tracking-baseline-provenance.test.ts tests/tracking-runtime-replay.test.ts tests/fixtures/issue-77-baseline/dependencies.json vitest.tracking-replay.config.ts
git diff --check
```

The temporary TypeScript config extends the repository config, disables incremental
output, and excludes absolute `node_modules` and `test-results` paths. This validates
current source while leaving the pre-existing ignored review/generated TS files
untouched. Standard typecheck/lint include that ignored tree and are not clean
validation commands in this checkout. Repository-wide Prettier also has pre-existing
violations; touched code passes. Historical reducer bytes are intentionally ignored
by Prettier and independently hash-verified.

Browser verification copies tracked/new source (no `.env` files) into a temporary
directory, symlinks existing `node_modules`, uses port 3217, a separate `.next-replay`
output directory and `next dev --webpack`. It runs
`playwright test tests/browser/transport-output.spec.ts tests/browser/lesson-observation.spec.ts`
with provider keys blank and server reuse disabled. Webpack is required here because
Turbopack rejects the dependency symlink outside its filesystem root. No checked-in
Next/Playwright config changes, installations, existing server reuse or lock removal.
