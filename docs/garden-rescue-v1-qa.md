# Garden Rescue v1 QA (#108)

## Tested configuration

Tested `af75573` on `feat/108-garden-qa`, branched from main `b9f54f0`. Browser results below use provider-free tests on the test machine; real microphone and provider validation was not performed.

## What changed

| Commit | Priority | Summary |
| --- | --- | --- |
| `8f5792f` | P1 | Release a quest after a 10-second `supportCloseTimeoutMs` when the tutor stays silent after the support-limit close. Previously it could remain stuck until Stop. |
| `16ab272` | Polish | Opt-in `startButtonClassName` places Play clear of ducklings in short landscape, Garden only; adds `tests/browser/garden-rescue-layout.spec.ts`. |
| `47e468e`, `8047226` | Coverage | Provider-free edge cases, including source replacement, duplicate input, late render acknowledgment and spoken self-correction; 14 tests in `tests/garden-rescue-edge-cases.test.ts`. |
| `b03f08f` | Coverage and polish | Keyboard, screen-reader, asset-fallback and route-boundary spec; Garden-only butterfly plural label, polite quest announcements and per-object emoji fallback through opt-in CountingStage props. |
| `cf62d6d` | Coverage | Live playthrough spec and playtest protocol. |
| `7f09982` | Formatting | Format the support-close timeout guard. |
| `af75573` | P2 | Drop classifier results from a retired transport source. |

## Automated verification

| #108 area | Status and evidence |
| --- | --- |
| Direct load/reload, quest order, Play/Stop/replay, completion and partial endings | Partially covered by `tests/browser/garden-rescue.spec.ts` and `tests/browser/garden-rescue-layout.spec.ts`; integration browser rerun remains open. |
| Spoken results, help, pauses, self-correction, interruption, no transcript, stale classification, source replacement/disconnection, unavailable output, missing/late render acknowledgment and duplicate input | Partially covered by `tests/garden-rescue-edge-cases.test.ts` and `tests/browser/garden-rescue.spec.ts`; live provider behavior remains open. |
| Effect eligibility and visit isolation | Covered by provider-free tests including `tests/browser/garden-rescue.spec.ts` and `tests/garden-rescue-edge-cases.test.ts`; integration browser rerun remains open. |
| Other routes and adult demo boundaries | Partially covered by `tests/browser/garden-rescue-a11y.spec.ts`; integration browser rerun remains open. |
| Unit, browser, lint, typecheck and build checks | Partial: `npm test` ran 2,598 tests; three unrelated tests timed out under load in context-projection-experiment, decisions-calibration and provider-comparison. All 132 tests in those files passed alone. Lint, typecheck, build and Prettier on changed files passed. Full browser rerun is open. |
| Responsive presentation, keyboard, labels, reduced motion, asset failures and counts | Partially covered by `tests/browser/garden-rescue-layout.spec.ts`, `tests/browser/garden-rescue-a11y.spec.ts` and `tests/browser/garden-rescue.spec.ts`; integration browser rerun remains open. |

On `af75573`, `npm run test:browser` had 38 passes and 60 failures with audio-pipeline symptoms: `microphone.speech_started` was never observed and `outputActivity` was `unavailable`. Failures crossed Garden, calculus, transport-output, concert and halloween tests. The same failure reproduced on unmodified `main` at `tests/browser/transport-output.spec.ts:222`, indicating a Chromium fake-media environment problem on that machine at the time, not a regression. A clean full-suite integration rerun is **open**.

Earlier that day, delegated individual-branch runs passed: 23 Garden/counting-stage tests on the layout branch (three timing flakes passed on rerun), and all 13 existing Garden tests plus five new accessibility tests on the a11y branch on port 3101.

## Real playtest and measurement

The real microphone + GPT-Live + Jev playthrough was **not performed**. The live spec was written but never run: `npm run test:browser:live -- garden-rescue.spec.ts`, with provider keys in the invoking environment. The parent-observed preschool playtest, comparison with `/`, and review of a live export were also **not performed**.

Each observation below is **not performed** and should be captured on the [protocol observation sheet](garden-rescue-playtest.md#observation-sheet):

- Whether the child wants to start, continue or replay.
- Game-like versus quiz-like moments.
- Confusion about what to count.
- Dead air, awkward repeats, latency, misrecognition and correction failures.
- Hints and parent intervention.
- Whether visual rewards occurred at the right time.
- Fresh transfer attempt and the evidence it supports.
- Qualitative comparison with `/` and live export review, if performed.

## Issues found and corrections

- P1: a silent tutor after the support-limit close could leave a quest stuck until Stop. The 10-second timeout now releases it.
- P2: edge-case tests found that an in-flight classification from a retired transport source was still accepted. This is latent because BrowserTransport creates only source 1 ([tracking contract](issue-77-tracking-contract.md#L19)); the defence-in-depth fix is covered by the edge-case tests.
- Short-landscape Play placement and Garden accessibility and asset fallbacks were corrected as listed above.

## Open limitations and lower-priority ideas

- Help detection requires the literal word “help”; “I don't know” is not counted.
- Export is available only through the `?debug=1` panel. Play again sits at bottom-right in landscape celebration.
- Snapshot coalescing can leave a `world.effect` visitId null. The live spec's timing includes observer scheduling delay.
- The live spec, adult real-mic run, child playtest and live export review remain open.

## Verdict

**Refine.** Engineering is ready for a live run, but #108's ship gate of a real live playthrough and child playtest has not been met. Run the browser suite on a healthy machine, then the live spec and one adult real-mic run, followed by a parent-observed child playtest using the protocol. Then decide whether to ship.
