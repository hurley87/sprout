# Reactive simulated-child E2E

## What it tests

Synthetic child speech travels through the browser microphone, real GPT-Live,
and the application/Jev lesson path. Run a single scenario against a configured
local app with `npm run test:live:reactive happy-path`.
**These runs invoke billed GPT-Live/Jev services where applicable.** They are
local/targeted regression experiments, not ordinary unit tests or CI jobs.

## Requirements

macOS `say`, `ffmpeg`, installed npm dependencies and Playwright Chromium
(`npx playwright install chromium`), and an app configured for GPT-Live/Jev.
Use the repository's existing local service configuration; never put credentials
in scenario definitions or artifacts. Start `npm run dev` before live execution.

## Running one scenario

```bash
npm run test:live:reactive happy-path
```

## Running a subset

```bash
npm run test:live:reactive incorrect-then-correct off-topic interruption
```

## Running the full suite

```bash
npm run test:live:reactive
```

All thirteen run sequentially. The CLI continues after failures and exits nonzero if
any run fails. The full suite is billed; choose a subset for routine validation.

## Repeating scenarios

```bash
npm run test:live:reactive happy-path --repeat 3
```

Repeated runs use labels `happy-path-1` through `happy-path-3`. Invocations reuse
labels and overwrite artifacts; use a fresh output directory to preserve evidence:

```bash
LIVE_OUT=test-results/my-validation BASE_URL=http://127.0.0.1:3000 npm run test:live:reactive happy-path
```

Defaults: `LIVE_OUT=test-results/live-reactive`, `BASE_URL=http://127.0.0.1:3000`.
The legacy fixed-timeline harness remains available separately:

```bash
npm run test:live quick_answer
```

## Test tiers

| Tier | Scope |
| --- | --- |
| 1 — deterministic unit/session | Fast, broad, injected events; no billed live model. `npm test`. |
| 2 — deterministic browser | Real browser/application with mocked provider transport. `npm run test:browser`. |
| 3 — reactive simulated-child live E2E | Synthetic spoken audio → browser microphone → real GPT-Live → real application/Jev path. |
| Future — real-child speech fixtures | Consented/de-identified speech for preschool ASR; out of scope. |

The live suite supplements deterministic tests. It cannot replace them or prove
preschool speech recognition quality.

Delayed-correction pauses are intentional waits and do not read
`CORRECTION_WINDOW_MS`; a candidate value change cannot silently shorten these
input gaps. Explicit 1000, 1500 and 2000 ms values are covered in deterministic
session tests too. The supported guarantee is limited to new transcript or
speech evidence arriving before deferred commit. Speech that begins after scene
commit is a new turn and cannot retroactively undo that commit.

## Scenario catalog

| Scenario | Child behavior | Key contract |
| --- | --- | --- |
| `happy-path` | Three correct answers | Three exactly-once scene advances after evaluation and tutor response. |
| `incorrect-then-correct` | Wrong numeric answer, then correct | Jev STAY, no premature advance, support opportunity, recovery and one advance. |
| `incorrect-dont-know-correct` | Wrong, “I don't know,” then correct | Numeric evaluation, conversational non-answer without Jev/progression, recovery. |
| `self-correction` | Wrong word followed by “no” and correct answer | One settled correction reaches Jev, one advance, no earlier tutor turn. |
| `delayed-correction` | Wrong answer, explicit 1500 ms pause, then correction | Both utterances reach the live path; no tutor acknowledgement or scene commit during the pause; corrected count advances once. |
| `corrected-to-wrong` | Initially correct answer, explicit 1000 ms pause, then wrong correction | A resolved initial Jev approval cannot acknowledge or advance before correction; final scene stays put. |
| `continuation` | “One!”, explicit 2000 ms pause, then “And two!” | No advance or tutor acknowledgement during the pause; continuation is transcribed and the current scene remains. |
| `long-pause` | Silent for 12 seconds, then correct | Bounded autonomous support opportunity, no fabricated answer, recovery. |
| `off-topic` | Dinosaur comment, then correct | Transcript and conversational response without Jev/advance, recovery. |
| `interruption` | Says “Wait!” during an observed tutor turn | Observable playback overlap, actual child transcript, no evaluation/advance/end, recovery. |
| `silence` | Silent for 30 seconds, then 12 more | Support after each interval, no transcript/evaluation/advance/unexpected end. |
| `explicit-stop` | Asks to stop | Normal session end, no progression or new tutor turn after acceptance. |
| `request-more` | Asks “Can we do more?”, then correct | Conversational non-answer without Jev/progression, numeric recovery. |

## How reactive synchronization works

The structured observer retains independently consumed scene, transcript,
evaluation, session-end and tutor turn events. Actions use checkpoints to bound
assertions. Numeric answers await Jev and a subsequent tutor turn before checking
progression. Nonnumeric answers wait for an actual child transcript and a tutor
response after it. Negative/exactly-once assertions describe only the observed
window, not future behavior.

Turn-end uses a conservative transcript boundary: provider gaps and an arrival
quiet fallback (2.5 seconds). It does not confirm physical audio completion.
Silence durations are intentional child behavior, not fixed response scheduling.
Support is replayed from the pre-silence checkpoint, including turns during the
silent interval; missing support fails after the bounded observer wait (30 seconds).
Overall scenario deadlines are 120 seconds, 150 for silence and 180 for longer
conversations. Deadlines abort speech and disable later scenario calls.

### Production semantic boundaries

- Numeric answer-bearing transcript → answer evaluation/Jev → deterministic
  ADVANCE or STAY.
- Nonnumeric transcript (“I don't know,” dinosaur comment, “Can we do more?”)
  → `answer.skipped(no_count)` → conversational GPT-Live response → no Jev request
  and no deterministic progression.
- Silence → no transcript → no Jev → conversational/session behavior only.

Use these boundaries when extending scenarios; do not require Jev for nonnumeric speech.

## Reading artifacts

Each attempted run leaves `LIVE_OUT/<label>/`:

- `timeline.txt`: child action intent (type, scene, expected/answer, text or
  duration), synthesis/playback boundaries, child/Sprout transcripts, observed
  tutor turns, Jev result/latency, `from → to` scenes and session events.
  Initial display is `∅ → scene`; removal at stop is `scene → ∅`.
  Failures end with `=== SCENARIO FAILED ===` and the error evidence.
- `log.json`: full raw harness evidence and metrics, scenario name/label, reactive
  mode, start timestamp, timeout, base URL origin and browser version when available.
- `diagnostics.json`: application diagnostics, or a truthful explanation when
  startup or UI download prevents collection.
- `failure.txt`: full error/stack on failure, preserving the primary failure if
  diagnostics or cleanup also fails.

Read child intent first, then what GPT-Live transcribed, what Jev decided, displayed
scene changes and the next tutor/session action. `page` times are browser arrival
measurements; `provider` times are transcript estimates with a separate origin.
Do not sort them onto one shared authoritative clock. The readable timeline
condenses events; `log.json` retains full evidence. Startup failures leave placeholders
and a final failure marker even if browser evidence is unavailable.

For explicit stop, follow the stop action → child transcript → `session.closed`
reason when supplied → session UI end/scene removal. The UI end signal alone has
no authoritative reason; consult application diagnostics if the provider reason
is absent. Scene removal is not advancement. The scenario rejects a new observed
tutor turn after acceptance; harmless transport finalization is permitted.

## Known limitations

Transcript timing is approximate. Observer turn-end is conservative and
transcript-based. Transcript overlap does not prove exact physical speaker
playback overlap. Interruption proves overlap according to observable browser/
provider timing, not acoustic laboratory timing. Synthesis that misses the turn
fails with timing evidence. Self-correction segmentation fails explicitly.
macOS synthetic speech does not test preschool ASR quality. No extra LLM is required.
Tutor response assertions establish a conversational opportunity; they do not
semantically grade prose or prove success acknowledgement quality.

## Current known product findings

The `long-pause` contract currently exposes a product behavior gap: in the observed
live run, Sprout did not autonomously offer another support turn after the child
remained silent for 12 seconds; the subsequent 30-second observer wait expired.
The scenario remains capable of failing until production silence/re-prompt behavior
is intentionally addressed. It is neither skipped nor made to pass with a fake
harness prompt. This relates to [issue #12](https://github.com/hurley87/sprout/issues/12),
“Make Sprout patient with preschool thinking pauses”; Commit 6 does not fix it.

Earlier off-topic/request-more failures came from an incorrect harness expectation
that nonnumeric speech reaches Jev, corrected in Commit 5. Their targeted reruns
passed. One missing numeric transcript did not recur; it remains evidence of live
variability rather than proof of ASR reliability. See retained validation below.

## Architecture / extending the harness

`runner.mjs` owns the generic browser/session callback boundary; the fixed timeline
adapter remains separate. `instrumentation.mjs` records structured data-channel,
evaluation and `data-scene` events. `observer.mjs` projects reusable wait signals.
`child.mjs` synthesizes with macOS `say` and plays into the runtime microphone.
`reactive-child.mjs` serializes `say`, `correctAnswer`, `wrongAnswer`, `dontKnow`,
`requestStop`, `requestMore`, `wait` and `staySilent` actions. The injected counting
adapter reads the production typed fixture; unknown scenes fail rather than guess.
`reactive-scenarios.mjs` holds the scenario bodies; `assertions.mjs` provides bounded
scene/evaluation/session/tutor checks. `reactive-runner.mjs` owns deadlines,
selection, cleanup and artifacts. No new provider/model layer is needed.

```js
const child = createReactiveChild({ speech, observer, page, lessonBehavior: countingBehavior });
const assertions = createScenarioAssertions(observer);
await observer.waitForSproutTurnEnd();
const wrong = await child.wrongAnswer();
const evaluation = await observer.waitForEvaluation({ after: wrong.checkpointBefore });
await assertions.evaluated({ after: wrong });
const response = await assertions.sproutRespondedAfter(evaluation);
await assertions.sceneStayed({ after: wrong, through: response.cursor });
```

Import factories from their named modules and `countingBehavior` from
`lesson-behaviors/counting.mjs`. Assertion `after` accepts a cursor, event or action;
`through` fixes the end window. Evaluation matches normalized utterances by default;
`exactUtterance: true` enforces strict equality. Actions expose before/after
checkpoints and chosen answer evidence. Close speech via runner cleanup.

## Historical validation before Commit 6

The following is retained evidence, not a claim that all ten currently pass.
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
This records the state before Commit 6.

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
The whole baseline has not been rerun. This records the state before Commit 6.

## Commit 6 validation and issue #30 audit (2026-09-26)

The operator reference and README now lead with actual run commands. Timelines
show readable action/synthesis/playback labels, separate provider/browser clocks,
observer-derived tutor boundaries, structured scene transitions and prominent
failure evidence. Application diagnostics add the session end reason when available.
Diagnostics export is best-effort; startup placeholders and complete primary errors
survive unreadable pages, download failures and later cleanup failures.

| Acceptance criterion | Evidence / status |
| --- | --- |
| Existing live matrix preserved | Legacy entry point, fixed timeline, audio and scenario catalog unchanged; generic runner cleanup preserves primary errors. |
| Reactive child action | Baseline scenarios await observed tutor turns before runtime speech; happy-path begins with turn-end. |
| Browser microphone path | `child.mjs` → runtime synthetic microphone/WebRTC; deterministic browser tests exercise the track. No transcript injection. |
| Reusable behavior primitives | Serialized reactive child methods; scenario bodies share audio/observer/assertion plumbing. |
| Deterministic correct/wrong helpers | Counting adapter uses production typed fixtures and current scene. |
| Ten baseline scenarios | All ten retained; explicit-stop's stale post-session button locator corrected without changing its contract. |
| Scene/Jev/session/tutor assertions | Bounded reusable assertions plus scenario-specific silence, correction, interruption and stop checks. Tutor prose is not semantically graded. |
| Readable failure artifacts | Timeline marker, full failure error, raw log, diagnostics or truthful placeholder; targeted deterministic formatting/failure tests. |
| No additional LLM | macOS speech plus deterministic fixture/action logic. |
| One/subset/full documentation | Commands, repeat labels, requirements, billing and artifact paths above. |
| Existing checks | 324 unit tests, 15 browser tests, lint, typecheck and build passed. Changed-file Prettier checks passed. |

`npm run format:check` still fails only on unchanged generated
`convex/_generated/api.d.ts` and `convex/_generated/dataModel.d.ts`. Neither was
modified to satisfy formatting.

Executed billed runs, sequentially:

| Run | Result | Evidence |
| --- | --- | --- |
| `self-correction` (once) | Passed | One Jev evaluation of `2. No, 1`, probability 0.96; one `hello-duck → duck-friends` advance. |
| `explicit-stop` (first attempt) | Failed: harness locator | Child stop transcript ended the session with application reason `child_stop`, no Jev/advance; then timed out looking for the pre-session button. |
| `explicit-stop` (one targeted rerun) | Passed after locator fix | Waited for `Start a new lesson`; stop transcript, `child_stop`, scene removal, zero Jev/advance and no later observed tutor turn. |

Initial artifacts: `test-results/live-reactive-commit6/{self-correction,explicit-stop}/`.
Successful stop rerun: `test-results/live-reactive-commit6-stop-fix/explicit-stop/`.
The earlier failed artifacts are retained. Normal transport finalization after stop
was permitted. Self-correction teardown emitted a provider context-injection error
after parent cleanup; its scenario assertions passed before cleanup. No production
behavior was changed.

Neither `long-pause` nor `silence` nor the entire baseline was rerun. The known
long-pause support gap remains a product finding associated with #12. The harness
acceptance criteria are implemented and ready for PR review; this is not a claim
that all ten live contracts pass. Closure of #30 should record that remaining
product behavior explicitly, with its follow-up tracked separately.
