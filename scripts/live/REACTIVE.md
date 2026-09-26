# Reactive scenario helpers

Use the existing runner's observer and synthetic audio child:

```js
const speech = createSimulatedChild({ page });
const child = createReactiveChild({ speech, observer, page, lessonBehavior: countingBehavior });
const assertions = createScenarioAssertions(observer);

const wrong = await child.wrongAnswer();
const evaluation = await observer.waitForEvaluation({ after: wrong.checkpointBefore });
await assertions.evaluated({ after: wrong });
await assertions.sproutRespondedAfter(evaluation);
await assertions.sceneStayed({ after: wrong });

const correct = await child.correctAnswer();
await observer.waitForSceneAdvance({ after: correct.checkpointBefore });
await assertions.sceneAdvancedExactlyOnce({ after: correct, from: correct.scene });
```

Import `countingBehavior` from `lesson-behaviors/counting.mjs`.
Import the factories from `child.mjs`, `reactive-child.mjs` and `assertions.mjs`.
This is an API example, not an additional runnable baseline scenario.

`correctAnswer` and `wrongAnswer` read the observer snapshot at each queued action's
start. The injected `countingBehavior` adapter uses the same typed counting fixture
as production. The core child has no counting dependency. Wrong answers cycle to
the next quantity in 1–5. Speech always delegates to the existing `say` audio path.
Other primitives are `say`, `dontKnow`, `requestStop`, `requestMore`, `wait` and
`staySilent`. Wait and silence deliberately use timers; they do not wait for tutor
state. Actions are serialized so queued answers see state after earlier playback.
An unknown scene fails instead of guessing an answer. Lesson-aware actions also
fail clearly if no behavior is supplied; generic actions need no adapter.

Each action returns its type, unique per-wrapper action ID, text or duration,
chosen scene, adapter-provided scene index and expected/answer evidence when
applicable, before
cursor, after-playback cursor, and start/end epoch timestamps. Structured
`child.action.started`, `child.action.finished` or `child.action.failed` entries go
into the existing browser log, whose `at` field uses the browser clock. The audio
layer retains its synthesis and microphone playback events without duplication.
Tests may supply `record` and `sleep` fakes instead of a page and real timer.
Close the underlying speech child through the runner's existing cleanup.

`observer.snapshot()` returns the current scene, cursor and a copied event list;
`currentScene()` is a convenience accessor. Assertion methods accept `after` as
a cursor, event, or child action. Optional `through` fixes the end cursor; otherwise
they inspect through the latest snapshot. `sceneStayed` rejects any scene change,
even a change away and back. `sceneAdvancedExactlyOnce` counts all transitions in
the window, including unexpected destinations. `sceneAdvanced` checks the requested
transition without enforcing uniqueness. `evaluated` checks normalized utterance
(lowercase, trimmed and collapsed whitespace, simple terminal punctuation ignored),
scene index and optional result fields. Set `exactUtterance: true` to require strict
equality; `utterance` can explicitly override the action text. `sessionEnded`
checks a structured end event.
Failures include the expected behavior, action, window, and observed events.

Negative and exactly-once assertions are bounded observations, not claims about
future events. Establish a meaningful end boundary (evaluation and subsequent
turn, for example) before asserting. An after-playback cursor alone does not prove
that evaluation or scene advancement has completed. `sproutRespondedAfter` waits
for a new turn start and its end after the supplied checkpoint; it does not classify
the tutor's prose. Turn-end retains the observer's conservative transcript
approximation and does not prove physical remote audio completion.

The runnable baseline is described below.

## Baseline suite (Commit 5)

`npm run test:live:reactive [scenario ...] [--repeat N]` runs **billed real
GPT-Live/Jev services**, sequentially. With no names it runs all ten scenarios:
`happy-path`, `incorrect-then-correct`, `incorrect-dont-know-correct`,
`self-correction`, `long-pause`, `off-topic`, `interruption`, `silence`,
`explicit-stop`, and `request-more`. Unknown names fail with the available list.
The legacy `npm run test:live quick_answer` remains separate and unchanged.
Neither live command is part of unit/browser tests or CI.

Reusable bodies live in `reactive-scenarios.mjs`; `reactive-runner.mjs` owns
microphone/speech/behavior/assertion setup, per-scenario deadlines (120 seconds
normally, 150 for sustained silence, 180 for longer conversations), cleanup and
artifacts. `runner.mjs` retains its generic callback boundary. The happy path
covers three transitions. Numeric answer-bearing speech waits for Jev evaluation
and a subsequent tutor turn before checking progression. Nonnumeric speech uses
`waitForChildTranscript({ after: action.checkpointBefore })`, then waits for a tutor
response after that actual transcript. Its bounded window requires real child
transcript evidence, no Jev evaluation, no scene change and no unexpected session
end. Production logs `answer.skipped(no_count)` for nonnumeric speech. Silence
requires neither a transcript nor Jev. Numeric flows are unchanged. Silence waits 12
seconds (long pause) or 30 plus 12 seconds (sustained absence); these durations
are child behavior, not synchronization timers. After each silent interval,
replay a support turn that started after `checkpointBefore`, allowing it to have
occurred during the interval. `checkpointAfterPlayback` is not the lower bound.
Silence alone requires zero transcripts/evaluations and no scene advance or
unexpected session end through that support turn. No production silence threshold is
changed; lack of a support turn is a clear bounded failure.

Interruption waits for a tutor **start**, then speaks `Wait!` through macOS say
and the runtime microphone. The assertion compares browser-clock playback start
to the start/end of that same transcript-observed turn, requires GPT-Live's
`Wait` transcript, and exercises a correct answer afterward. These turns retain
the observer's transcript approximation; they do not prove physical remote audio
completion. Synthesis that misses the turn fails with timing evidence.
Self-correction requires one Jev evaluation containing the correction and ending
in the correct word/number, one advance, and no earlier tutor response. Provider
segmentation fails explicitly rather than being treated as successful.

Each scenario writes `log.json`, `timeline.txt`, `diagnostics.json`, and
`failure.txt` on failure below `LIVE_OUT` (default `test-results/live-reactive`).
Scenario and failure markers appear chronologically alongside child actions,
synthesis/playback, transcripts, Jev latency, scene transitions and session end.
If the UI diagnostic download fails, `diagnostics.json` states its unavailability.
Failures attempt normal End lesson cleanup and close speech/microphone/browser;
timeouts also prevent subsequent scenario actions. The CLI continues the selected
runs, reports each result, and exits nonzero if any fail. Repeated invocations
reuse labels, so copy artifacts or choose another LIVE_OUT to retain older runs.

The deterministic harness tests cover selection, ordering, bounded windows,
interruption timing rejection, sequential execution, error context and deadline
cancellation. Full live baseline validation and broader behavior calibration are
follow-up work; do not infer all scenarios pass from the targeted smoke subset.

### Original Commit 5 validation (2026-09-26)

Billed runs actually executed:

- `happy-path`: passed (three transitions).
- `incorrect-then-correct`: passed.
- `interruption`: initial run failed while requiring a separate tutor reply after
  the interrupt. The artifacts show overlapping playback and the `Wait` transcript,
  with Sprout continuing the existing turn. That extra reply requirement was removed
  because it is not part of the interruption contract. The revised scenario passed
  on one targeted rerun, including subsequent correct-answer progression.

Initial artifacts: `test-results/live-reactive/{scenario}/`.
Successful interruption rerun: `test-results/live-reactive-retry/interruption/`.
At that point the other seven scenarios had **not** been run live. Commit 6 may validate/calibrate
those cases, especially self-correction segmentation and silence support behavior;
no Commit 6 work is included here.

Deterministic validation: `npm test` (305 tests), `npm run test:browser`
(15 tests), `npm run lint`, `npm run typecheck`, `npm run build`, and Prettier
checks on all changed files passed. The initial browser run encountered a shared
Next dev lock; the rerun passed after the live dev server was stopped.


### First Commit 5 amendment validation (2026-09-26)

Separated `spokenNonAnswer` from `silentOpportunity`. That amendment incorrectly
assumed spoken non-answers should reach Jev; the expectation is superseded below.
Production schedules transcript evaluation but explicitly skips Jev when
`mentionsNumber(text)` is false. Silence replays support from `checkpointBefore`, including support
during the timer, and rejects transcripts, evaluations, scene changes and session
end through that support. Updated `incorrect-dont-know-correct`, `off-topic`,
`request-more`, `long-pause` and `silence`; production behavior is unchanged.

Deterministic validation passed: 314 unit tests, 15 browser tests, lint, typecheck,
and build. Changed-file Prettier checks passed. `npm run format:check` was run and
failed only on unchanged generated `convex/_generated/api.d.ts` and
`convex/_generated/dataModel.d.ts`; those files are outside this amendment.
New tests cover spoken evaluation/transcript requirements and response boundaries,
all three spoken scenario flows, replaying support before the silence timer ends,
and rejection of transcripts, evaluations, advancement and session end in silence.

Executed exactly this billed subset once, sequentially:
`incorrect-dont-know-correct off-topic request-more long-pause`.
All four failed; assertions were retained:

- `incorrect-dont-know-correct`: initial `Two!` playback produced no child
  transcript/evaluation within the evaluation timeout; did not reach `dontKnow`.
- `off-topic`: GPT-Live transcribed the dinosaur sentence and Sprout responded,
  but no Jev evaluation arrived within 30 seconds.
- `request-more`: GPT-Live transcribed the request and Sprout responded,
  but no Jev evaluation arrived within 30 seconds.
- `long-pause`: no new tutor support turn arrived within the 30-second observer
  wait after the 12-second silent interval, using the pre-silence boundary.

Artifacts for each are retained at
`test-results/live-reactive-commit5-fix/{scenario}/` (log, timeline, diagnostics,
and failure). The off-topic/request-more failures reflected the harness's incorrect
Jev expectation, not a production failure. The numeric transcription and silence
support failures remain separate unverified issues. No full baseline rerun or production fix was made.
Commit 6 has not started.

### Transcript-boundary amendment validation (2026-09-26)

Added `observer.waitForChildTranscript()` with the same independent consumption,
explicit `after`, retained replay and bounded timeout behavior as other waits.
`spokenNonAnswer` now waits for the actual child transcript, then a tutor response
starting after that transcript. Through the response it requires real transcript
evidence, zero evaluations, no scene change and no unexpected session end.
Production's nonnumeric `answer.skipped(no_count)` path does not send Jev requests.
Numeric correct/wrong/self-correction contracts and pre-silence replay are unchanged.

317 unit tests and 15 browser tests passed, along with lint, typecheck, build and
changed-file Prettier checks. Tests explicitly cover child transcript consumption,
replay and timeouts; transcript-bound tutor responses; rejection of evaluations and
session ends for spoken non-answers; and numeric evaluation counts of 2/1/1 for
`incorrect-dont-know-correct`/`off-topic`/`request-more`. Silence replay and negative
assertion tests remain intact. Full `format:check` still flags only the two unchanged
generated Convex files documented above.

Reran exactly `incorrect-dont-know-correct off-topic request-more`, once each,
sequentially, against real billed GPT-Live/Jev. **All three passed**, including
subsequent numeric-answer evaluation and progression. Artifacts are preserved at
`test-results/live-reactive-commit5-transcript-fix/{scenario}/`. The earlier numeric
transcription failure did not recur in this run. Earlier off-topic/request-more
failures were caused by the harness expectation that nonnumeric speech reaches
Jev; this amendment corrects that assumption. No previous artifacts were erased.
`long-pause` was not rerun; silence support remains a separate behavior question.
The whole baseline has not been rerun. Commit 6 has not started.
