# Jev answer evaluation: can it drive scene advancement?

Findings for [issue #3](https://github.com/hurley87/sprout/issues/3). The [GPT-Live baseline](gpt-live-baseline.md) is the frozen comparison point and is not restated here.

Issue #2 established that GPT-Live-only lesson control is unreliable: whether the model delegated to advance the scene varied run to run with identical input, and the one real interactive session never delegated at all. This experiment tests one narrow hypothesis:

> Can Jev reliably decide whether the learner correctly counted the objects currently displayed, so the application can advance the scene itself?

Everything else stays where it was. GPT-Live still owns the conversation, personality, pacing and scaffolding. Silence handling, stopping, wrap-up and the time limit remain application-owned and deterministic.

## Verdict

**Keep Jev for the narrow answer-to-scene advancement decision. Keep GPT-Live responsible for conversation and scaffolding. The application owns deterministic lesson state and now synchronizes approved advancement with GPT-Live's speaking state so scene changes do not interrupt an active turn.** Evaluator availability and latency remain operational weaknesses, distinct from Jev's semantic decision quality.

The original `counting-jev-1` experiment established whether to keep the narrow Jev responsibility: all 41 correct answers advanced, there were no false advances in the tested non-correct cases, consistency was strong, and the original decision-quality and latency criteria were met. It also exposed the mid-sentence synchronization seam. `counting-jev-2` introduced a pause/release prompt contract that improved synchronization but did not guarantee it in its manual run. The final app-level deferred-advance path handles an approved result that arrives while Sprout is substantively speaking.

The final fresh interactive run reached all six scenes, showed both successful immediate and deferred advances, and recorded neutral recovery after evaluator timeouts. A later instrumented live run showed Jev completing every observed request in 222–405 ms, with the fixed 1.5 s settle wait accounting for most normal answer-to-decision time; it also observed the app correctly discarding a stale evaluation of an incomplete utterance. Both are individual sessions and cannot establish a success rate or validate preschool speech. See [Final interactive run](#final-interactive-run) and [Latest instrumented live run](#latest-instrumented-live-run).

The pre-registered keep criteria belong specifically to `counting-jev-1`: correct-answer advancement of at least 90%, no false advancements, added median latency at most about 2.5 s, and no new scene/speech desync failures. That original experiment met those criteria.

## What was built

One semantic decision is delegated, behind one seam. [`lib/answer.ts`](../lib/answer.ts) holds the question, the criteria, the threshold, the settle rule and the `EvaluateAnswer` type; nothing in the lesson knows which model answers. [`lib/jev.ts`](../lib/jev.ts) is the server-side TypeSafe client, reached through [`/api/evaluate`](../app/api/evaluate/route.ts) so the credential never enters the browser. Removing Jev means deleting those three files and restoring one branch in [`lib/session.ts`](../lib/session.ts).

```mermaid
sequenceDiagram
    participant Child
    participant App as LessonSession
    participant Jev
    participant Screen
    participant GPT as GPTLive
    Child->>App: transcript deltas
    Child->>GPT: number or count aloud
    GPT-->>Child: wait for the application's current answer decision
    Note over GPT,App: transport gate enforces the wait; prompt is defense in depth
    App->>App: utterance settles (1.5 s of no new delta)
    App->>Jev: displayed scene + utterance, one Noul question
    Jev-->>App: probability
    alt current negative result
        App->>GPT: release pause with stayContext(current scene)
        GPT-->>Child: help or clarify on current scene
    else unavailable or timeout
        App->>GPT: neutral recovery; no correctness claim
        GPT-->>Child: invite a neutral retry on current scene
    else current probability >= 0.90
        App->>App: defer approved advance through correction and bounded VAD protection
        App->>Screen: commit next scene exactly once
        Screen-->>App: displayed, after paint
        Note over App,Screen: Learner-side protection controls scene commit; provider timing cannot delay the UI
        App->>App: keep GPT-Live muted while speculative output is active
        App->>App: wait for safe provider-output boundary after display
        App->>GPT: append advanceContext(new scene)
        App->>GPT: unblock playback
        GPT-->>Child: celebrate briefly, invite count on new scene
    else stale result
        App->>App: no new instruction
    end
```

GPT-Live no longer has a scene capability. The prompt asks Sprout to wait after a number or count until the app reports its decision, as defense in depth. The application gate enforces this independently of model cooperation. The current application decision controls semantic authority; hidden provider output is used only to find a safe audio boundary. `stayContext(...)` and unavailable recovery release the gate with current-scene context; unavailable wording never implies the count was wrong or right.

For a current approved answer, the app defers scene commit only for learner-side correction protection and bounded VAD grace. Once that protection completes, it commits and displays the next scene even if GPT-Live is still generating speculative hidden output. Playback remains gated until provider output reaches a safe quiet boundary; only then does the app append `advanceContext(...)` and unblock audio. Output transcript length and content do not determine ADVANCE or scene-commit authority; hidden output is used only for safe audio-release timing.

### The question

Type `noul`, id `countedDisplayed`, asked of `jev-1.13.0`:

> Did the learner correctly count the objects currently displayed?

with criteria:

- **true**: "The learner's final answer gives the same total as the displayed quantity, either by naming that total or by counting up to it and stopping there. A self-correction counts: judge only the answer they settled on."
- **false**: "The final answer gives a different number, gives no total at all, is a guess the learner is asking about rather than stating, says they do not know, or is about something other than counting what is displayed."

The state is only what the decision needs, for example:

```json
{
  "displayed": { "object": "butterflies", "quantity": 3, "description": "3 butterflies" },
  "learnerUtterance": "One, two, three!"
}
```

The displayed scene is derived on the server from the scene index, so a compromised or confused client cannot describe a scene that is not on screen. The probability is used only as a control signal. It is written to in-tab diagnostics as `answer.evaluated` and is never stored as a learner assessment; the [architecture document](architecture.md#5-observation-and-review-rules) reserves learning conclusions for the Observer and parent review.

The model version is pinned rather than `jev-latest`, because the threshold below is calibrated against it.

### The threshold: 0.90

Chosen **before** any comparison run, from a labeled text-only calibration set (`npm run test:jev`, 30 utterances, 5 runs each, 150 calls). Full output in `test-results/jev-calibration/results.json`.

| Group | Probability range |
| --- | --- |
| Should advance (12 cases: plain totals, counting sequences, hesitant answers, self-corrections) | 0.96 – 0.99 |
| Must not advance (18 cases: wrong totals, "I don't know", "One?", thinking noises, off topic, Sprout's own speech echoed back) | 0.01 – 0.81 |

Any threshold in (0.81, 0.96] separates the set; 0.90 sits in the middle with margin on both sides. Repeat spread within a case was at most 0.06, and usually 0.00–0.01.

Two calibration cases are worth naming. "A duck!" scored 0.80–0.81, the highest non-advancing value: it implies one duck without stating a total, and it is the case that ruled out a 0.80 threshold. "I see 1 duck on the screen. How many can you count?", Sprout's own sentence in case it is echoed into the input transcript, scored 0.62–0.67 — below the threshold, but the smallest safety margin among the clearly-wrong cases.

### Knowing when an answer is finished

GPT-Live emits no authoritative turn-completed event, only `session.input_transcript.delta` fragments, so the application defines completeness itself. An utterance is judged complete once **1.5 s** passes with no new fragment; every fragment restarts the wait. This matters: the transcript regularly splits one answer across fragments with Sprout talking in between, and fragment-level evaluation would judge "Two?" before hearing "No, wait. One!".

Four further guards stop a decision from being applied to the wrong moment:

- Each `(utterance start, text)` version is evaluated at most once, so an unchanged answer is never re-judged. A revision is a new version and is judged again.
- A result is discarded as stale if, while it was in flight, the child said more, the scene changed, or the lesson left the active state.
- Nothing is evaluated while a scene is waiting to be displayed, on the last scene, during wrap-up or goodbye, or when the transcript guard has recognised a stop request.
- Evaluation now has a bounded **1.5 s** interactive timeout (see the 2026-10-01 update below). The historical experiments used 4 s, increased from the original 3 s after live Jev responses approached the old limit. Timeout, cancellation and request failure are represented as unavailable outcomes, distinct from a completed negative decision. Unavailable means no advance and neutral recovery, not incorrect-answer scaffolding.

In the 36 sessions, 17 of the 70 evaluations were built from speech that arrived as more than one transcript row, each judged once as joined text. There were no duplicate evaluations and no partial-utterance evaluations.

## Results

The original `counting-jev-1` experiment used 36 real sessions on 2026-09-23, headless Chromium 153, against real `gpt-live-1` and real `jev-1.13.0`. It is the experiment that established whether to keep the narrow Jev responsibility and to which the pre-registered keep criteria apply. The later `counting-jev-2` experiment used the same real models and synthetic-child method—macOS text-to-speech on a fixed timeline fed in as a fake microphone, which cannot react to Sprout—to test synchronization separately. Run with `node scripts/live-matrix.mjs <scenario> --repeat N`.

### Original `counting-jev-1` experiment: advancement

| | Evaluations | Advanced |
| --- | --- | --- |
| Correct count | 41 | **41 (100%)** |
| Wrong total, "I don't know", off topic, acknowledgements, thinking noises | 25 | **0** |
| Ambiguous: right number, wrong object ("Three butterflies" with 3 strawberries shown) | 4 | 0 |

Probabilities were bimodal with a wide empty band. Everything that advanced scored **0.92 or above**; everything that did not scored **0.50 or below**. No evaluation landed between 0.51 and 0.91. The threshold could have been anywhere in that range without changing a single outcome.

### Consistency across equivalent inputs

| Scenario | Runs | Advanced | Probabilities |
| --- | --- | --- | --- |
| "One!" repeated identically | 5 | 5 | 0.98 every time |
| "One duck." | 2 | 2 | 0.99, 0.99 |
| "There's one!" | 2 | 2 | 0.98, 0.98 |
| "Just one." | 2 | 2 | 0.97, 0.98 |
| "I count one!" | 2 | 2 | 0.98, 0.99 |
| "Two? No, wait. One!" | 3 | 3 | 0.97, 0.92, 0.97 |
| "One! No, three." | 2 | 0 | 0.16, 0.11 |
| "Five!" | 3 | 0 | 0.02, 0.02, 0.02 |
| "Umm... I don't know." | 3 | 0 | 0.03, 0.03, 0.02 |
| `progression` (multi-scene) | 3 | 3 scenes each | identical pattern all three runs |

Transcription varied between runs of the same script — "One!" came through as `One` in three runs and `1` in two — and the probability was 0.98 in all five. Self-correction worked in both directions: the answer settled on is the one judged.

### Original `counting-jev-1` latency

| Interval | Median | Range |
| --- | --- | --- |
| Jev call, browser to browser | 276 ms | 152 – 519 ms |
| Decision to new scene on screen | 272 ms | 153 – 376 ms |
| **Child's last word to new scene** | **1777 ms** | 1659 – 1882 ms |

About 1.5 s of that 1.8 s is the application's own settle wait, not the model. In these original runs, the wait was usually filled by GPT-Live speaking early. The historical `counting-jev-2` runs below measured longer pauses and included slow Jev responses. A later instrumented live run and standalone benchmark both showed fast Jev requests; the earlier 2–4 second spikes and timeouts remain unexplained and appear intermittent, not representative of normal latency in those later samples.

### Original `counting-jev-1` scene and speech coordination

Across all 41 advances, the instruction telling GPT-Live about the new scene was sent **0–35 ms after** the scene reached the DOM, median 11 ms, and never before it. Sprout never named a quantity or object that was not on screen. The clearest example is the ambiguity case: with strawberries displayed, the child said "Three butterflies", Jev returned 0.48, the scene stayed put, and Sprout said "I hear you, and I'm still seeing strawberries here. Can we count the strawberries one at a time?"

### Full-length lesson

The 5½-minute `time_limit` run advanced five times and reached **all six scenes**; the #2 baseline reached four. Wrap-up at 4:31, goodbye at 5:01, "Bye for now!" spoken, closed at 5:09 — unchanged from the baseline. On the final scene the child counted "one two three four five" and, correctly, no evaluation was made: there is nothing to advance to.

## Original comparison with the #2 baseline

| | #2 (GPT-Live decides) | Original `counting-jev-1` (Jev decides) |
| --- | --- | --- |
| Correct answer advances | 2 of 4 progression runs cleanly; 0 in the real interactive run | 41 of 41 |
| Same input, same outcome? | No: one run refused for 90 s, one never delegated | Yes: 0.98 in all five identical runs |
| Advances on a wrong answer | Observed: accepted "two ducks" with one shown | None in 29 opportunities |
| Scenes reached in 5½ minutes | 4 of 6 | 6 of 6 |
| Speech naming an undisplayed scene | Observed ("Now there are two ducks" with no scene request) | None |
| Added latency | None | ~1.8 s from last word to new scene, of which ~0.3 s is Jev |
| Prompt stability | Fragile: version 3 dropped delegation to 0 of 9 | Not applicable; the model no longer makes this decision |

In the original Jev comparison, baseline problems 1 (unreliable advancement) and 2 (speech/scene desync) were addressed. The synthetic `counting-jev-2` batch improved the successful advance path, but three `correct_once` attempts failed to advance; that batch did not establish the final behavior or the end-to-end success rate. Problem 3 (no initiative after silence) and problem 5 (occasionally deferred greeting) are untouched and out of scope here. In the original `counting-jev-1` runs, problem 4 (pedagogical drift, recounting correct answers) was partly masked: Sprout sometimes started a recount and the advance overrode it. The final deferred-advance behavior is described and evidenced below.

## Before and after synchronization

With `counting-jev-1`, GPT-Live usually answered a correct count while the app waited for the utterance to settle. Advances then interrupted a real sentence. Two recorded examples were:

- `quick_answer`: "Nice counting! Let's try that duck again — Yay, you counted it just right! Now there are some ducks on the screen."
- `explicit_stop`: "Thanks. Can you count again with me, nice — Hey! Nice counting! Now there are some ducks on the screen."

The new `counting-jev-2` prompt asks Sprout to wait after a number or count until the app explicitly reports whether the scene changed. The app uses `stayContext(...)` to release a held non-advance turn, and `advanceContext(...)` after a confident advance has been displayed. The new live-matrix measures the text received between the last learner transcript delta and the app's decision/instruction as `sproutBeforeDecision` and `sproutWordsBeforeDecision`.

| New live scenario | Runs | Successful advances | Sprout before each advance instruction |
| --- | --- | --- | --- |
| `correct_once`, one exploratory run + five concurrent repeats + three serial repeats | 9 attempts | 6 | Five silent; one said only "Oh!" (1 word) |
| `progression`, run serially | 3 | 9 (three per run) | Silent on all nine (0 words each) |

Thus **15 of 15 successful advances had no meaningful Sprout turn in progress**: 14 had `sproutWordsBeforeDecision = 0`, and one had `= 1`, a neutral "Oh!". No advancing instruction interrupted a sentence or question in these synthetic runs. All three progression runs reached the picnic scene. A separate `self_corrected_to_right` run also advanced with 0 words before the instruction. This was evidence about prompt behavior under the synthetic harness, not proof of synchronization in an interactive lesson. The final app-level protection is described below.

For those 15 advances, the median time from the last learner transcript delta to the app's advance instruction was **3,546 ms** (range 1,778–4,496 ms), and to the first Sprout transcript delta was **4,531 ms** (range 905–5,120 ms). The 905 ms case was the one-word "Oh!"; otherwise the first Sprout word followed the instruction. The scene appeared a median **3,522 ms** after the learner's last delta, with the instruction **2–32 ms after** it reached the DOM (median 17 ms). Successful Jev calls took a median **2,017 ms** (range 270–2,967 ms), substantially slower than the 276 ms median in the original batch. The 1.5 s settle rule is unchanged. This is real dead air after many counts, unlike the original runs, and the slower live service contributed to it.

This follow-up does not independently establish the original >=90% advancement or <=~2.5 s latency gates. Three of the nine `correct_once` attempts did not advance: two heard the answer but logged no completed `/api/evaluate` response, and one had no provider transcript at all. The two with speech remained on the original scene and sent `stayContext(...)`; one also attempted an unsolicited delegation, which the app refused. These attempts are excluded from the 15-advance speech classification, but remain failures of end-to-end advancement in this sample. The live-matrix cannot distinguish a timed-out/aborted request from another fetch rejection when no response is logged. They are not evidence of a mid-sentence advance.

The historical non-advance runs below used the superseded `counting-jev-2` brief-acknowledgment heuristic. They are retained as experiment records; their `holding()` and `BRIEF_ACK_WORDS` behavior is not part of the current implementation or its correctness contract.

## Final interactive run

A fresh real interactive lesson was run on 2026-09-23 in Chrome 153 using `gpt-live-1` and `jev-1.13.0`. The exported diagnostic file is `sprout-attempt-1790195825512.json` (created 2026-09-23 20:37:05 UTC); it contains 286 events across a 171-second live session. Transcript timing is approximate, the provider could not verify audio playback or speaker identity, and its input side labels the other speaker as `child_or_nearby_speaker`. The run is useful as interactive evidence, but those limits mean transcript attribution is not ground truth.

**Historical sequencing note:** This run predates the issue #21 follow-up that decoupled scene commit from provider-output quiet. Its 5,190 ms wait for a quiet boundary before displaying the next scene is preserved below as an observation of the then-current implementation; it is superseded by the current ordering above, where learner-side protection controls scene commit and provider-output quiet controls only audio release.

| Observation | Jev outcome and latency | Scene / synchronization | Sprout and recovery |
| --- | --- | --- | --- |
| Initial "One" on 1 duck | Two evaluations timed out at 4,006 ms each; a later 0.98 result for the now-stale "One" was discarded (3,236 ms) | Scene stayed on 1 duck during both timeout recoveries and the stale result | App sent neutral wording: evaluation did not complete, correctness is unknown, and the child should try counting again. Sprout then invited another count; no incorrect-answer claim was present. |
| Revised "There's one duck" on 1 duck | 0.99, 2,539 ms | Advanced to 2 ducks; the display event preceded the new-scene instruction | Immediate advance. |
| Repeated "One, two" sequence on 2 ducks | One request timed out at 4,002 ms; further requests included timeout/cancellation; a completed result was 0.82 at 3,843 ms | The completed 0.82 result stayed on the 2-duck scene and released GPT-Live with current-scene context | This is evidence for a completed negative Jev decision staying put. The recognized phrase itself totals two, so it is not evidence that an intentionally wrong answer was tested. |
| "Sure. One, two" on 2 ducks | 0.96, 2,565 ms | Advanced to butterfly-garden; display preceded new-scene context | Immediate advance. |
| "One, two, three" on 3 butterflies | 0.98, 3,468 ms | Advanced to picnic (3 strawberries); display preceded new-scene context | Immediate advance; subjective dead air was not separately recorded. |
| "One, two, three" on 3 strawberries | 0.98, 2,309 ms | Approval was deferred while Sprout had already emitted 50 transcript characters. App logged `advance.deferred`, waited **5,190 ms** for an output transcript quiet boundary, then logged one release and displayed 4 ducks. The new-scene instruction followed the display. | This is the observed substantive-speech protection path: scene did not change during Sprout's turn and advanced once after the transcript went quiet. |
| "One, two, three, four" on 4 ducks | 0.98, 2,516 ms | Advanced to 5 butterflies; display preceded new-scene context | Immediate advance. The run reached all six scenes. |

This run directly observed normal successful advances, several consecutive correct count sequences across scenes, a completed negative Jev decision, multiple unavailable/timeout recoveries, and one deferred advance after Sprout had begun speaking. It confirms that the 4-second timeout is separately reported as unavailable (observed at 4,002–4,006 ms), that unavailable checks keep the scene unchanged, and that the neutral recovery instruction explicitly says not to tell the learner they were right or wrong. It also confirms display-before-context ordering for the observed advances.

The run did **not** include a clear intentionally incorrect answer or an explicit self-correction; the 0.82 result followed a transcript that read as a correct count, so it must not be described as an incorrect-answer test. It also does not establish whether the deferral felt awkward or had dead air to a listener: transcript diagnostics are approximate and no audio delivery/playback is verified. A second targeted interactive run is still needed for those specific cases. No timeout was forced; natural evaluator timeouts were observed.

## Verification

- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm test` — 3 files and 124 tests passed.
- `npm run build` — pass.
- `npm run test:browser` — could not start its configured Next.js server because another dev server was already running from this checkout (PID 51077); no browser tests ran in this invocation.
- `npm run format:check` — pass.

### Interactive timeout recovery (2026-10-01)

`EVALUATION_TIMEOUT_MS` in `lib/answer.ts` changes from 4,000 to 1,500 ms.
The browser request and application session use that same constant. The session
also settles a still-pending evaluator at the deadline, then aborts the request;
it does not depend on abort settling the evaluator promise. Results completed
before the deadline retain the existing probability, latency and scene policy.

The latest demo reported successful calls around 250 ms and a butterfly timeout
at 4,001 ms. Inspection of the saved September 30 issue-40 targeted runs and
retries found 21 non-stale successful evaluations: minimum 143 ms, median 234 ms,
p95 272 ms, maximum 310 ms, with no timeout in those artifacts. The separate
September 23 route benchmark had p95 309 ms and maximum 380 ms.
1,500 ms leaves headroom above these samples while prioritizing a conversational
retry over waiting for historical intermittent multi-second successes. These
samples are not a service latency guarantee; slower successes now fall back.

Timeout commits `UNAVAILABLE`, preserves the scene, and sends the existing
instruction to ask the same counting question without judging the previous
answer right or wrong. The scene/revision/answer-version guards still apply.
Each evaluation settles once; any subsequent result is logged as
`answer.result_ignored` with `STALE` and the original correlation key, and never
re-enters the decision path or overwrites its evaluation record. Cancellation
clears the deadline without committing timeout recovery.

Diagnostics record start and `timeout_deadline_at` on `answer.requesting`, actual
occurrence and elapsed time on `answer.timeout`, final `UNAVAILABLE` and
`latency_ms` on `answer.evaluated`, and `timeout_to_release_ms` on
`answer.response_gate_released`. Deadlines use the existing session clock.

Focused tests in `tests/evaluate.test.ts` and `tests/session.test.ts` cover 250 ms
and just-before-deadline success, a hanging butterfly evaluation, neutral retry,
prompt gate release, cancellation, and late ADVANCE both before and after a
newer retry. `tests/session-output-discard.test.ts` also exercises an actual
deadline while stale Live output is discarded: recovery uses a fresh instructed
source and late success cannot advance the scene.

Evaluator waiting is bounded at 1.5 s on an executing browser event loop.
Existing independent holds remain: transcript fallback before evaluation,
child activity, output transcript quiet, and preparation of a fresh Live source.
The gate's unchanged 15-second recovery budget still stops the lesson if these
holds cannot recover. No billed live rerun or acoustic timing claim is included.
The standalone diagnostic benchmark retains its historical 4-second probe budget.

### Other limitations

- Preschool speech, real-child turn-taking and echo handling remain unvalidated. The interactive session used a nearby-speaker transcript channel with unverified attribution, not a documented real-child validation. Whether Jev's probabilities hold up on genuine preschool transcription is the main open question.
- The final interactive evidence is one session. It did not clearly exercise an intentionally wrong answer or a self-correction, and it does not measure subjective awkwardness or dead air.
- Jev/provider latency is variable. The natural timeouts observed here consumed about 4 s, after the existing 1.5 s settle window; worst-case answer handling can therefore feel slow. The 4 s evaluator timeout is still bounded, not a guarantee that every request succeeds.
- Speaker attribution is the provider's. If Sprout's own speech is transcribed as input, it is evaluated as if the child said it. Calibration shows Sprout's typical prompt scoring 0.62–0.67, below the threshold but by less margin than anything else tested.
- The threshold is tied to `jev-1.13.0`. Unpinning the model invalidates it.
- Provider and transcript failures remain possible; unavailable means the app cannot use this response to decide correctness.
- The refusal path was not exercised in the original 36 sessions. One new correct-answer attempt did make an unsolicited delegation; the app refused it. That attempt did not receive a completed Jev result and did not advance.
- The 150 calibration calls and original 70 live evaluations, plus these synchronization runs, all came from one day; this says nothing about drift over weeks.

## Future Jev ideas, deliberately not in this change

Recorded so they are not lost, not proposed:

- A second Noul for "has the learner gone quiet without answering?", to trigger the application-owned re-engagement nudge that baseline problem 3 needs. This needs a silence signal the transcript does not currently provide.
- Flagging exchanges where Sprout's speech contradicts the displayed scene, as evidence-quality metadata for the Observer.
- A `choice` question distinguishing "counted aloud with a total" from "named the total", which [CONTEXT.md](../CONTEXT.md) treats as different evidence. This is an Observer concern, after the session and behind parent review, not a runtime control signal.

None of these should be added without their own experiment. `choice` and `score` remain unused: the Noul separation was wide enough that nothing here demanded them.

## New latency benchmark (2026-09-23; separate from the answer experiment)

`npm run benchmark:jev` made five warm-up calls on each path, then 50 measured calls on each path. It tested five representative scene/utterance pairs, ten measured repetitions per pair, sequentially and in alternating direct/local-route pairs. The direct path sent the same pinned `jev-1.13.0` Noul question and scene state to `https://api.typesafe.ai/v1/systemone`; the local path sent the same scene/utterance to `/api/evaluate`. Each request had a 4,000 ms timeout. Latency spans the outbound request and reading/parsing its response. Successful-request latency statistics exclude failures and timeouts, which are counted separately. The 1,500 ms transcript settle wait is **excluded** from both paths and is application latency. The script saves safe per-request status, probability, latency and outcome records in the ignored `test-results/jev-latency/results.json`; it never saves credentials or raw provider responses.

This run used the local development server, loaded the existing local app environment, and captured results on 2026-09-23. It is a point-in-time measurement of text evaluation, without GPT-Live, browser audio, or the transcript settle timer.

| Path | Success | Failure | Timeout | Min | Mean | p50 | p90 | p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct TypeSafe/Jev | 50/50 | 0 | 0 | 140 ms | 237 ms | 216 ms | 307 ms | 393 ms | 459 ms |
| Sprout `/api/evaluate` | 50/50 | 0 | 0 | 150 ms | 227 ms | 214 ms | 289 ms | 309 ms | 380 ms |

The difference of the two p50s is **−2 ms**. That is measurement noise, not evidence of a negative server cost; the local route added no measurable latency at this resolution. Across the five scenarios, direct p50 was 173–219 ms and route p50 was 183–225 ms. No request in this sample took 2 seconds or timed out. Adding the configured 1,500 ms settle window to the observed p50 route request yields roughly 1,714 ms before a decision, assuming the timer fires on schedule; the live panel now measures actual settle and full elapsed time separately.

**Classification: inconclusive for the reported 2–4 second spikes.** This run does not reproduce them on either path. It provides no evidence that Sprout's `/api/evaluate` path was the source during this sample. The historical interactive run above did observe slow Jev calls and natural timeouts, but it did not isolate direct provider latency from local routing at those moments. Neither result establishes the cause of intermittent slow requests. Repeat this benchmark when the symptom recurs and compare simultaneous direct and route records.

The `?debug=1` development panel displays the current lesson's answer timeline, configured and actual settle time, browser Jev request time, final decision, deferred advance and in-memory history. This is instrumentation only; it makes no new lesson decision.

### Latest instrumented live run

The latest `?debug=1` attempt, `sprout-attempt-1790198970003.json` (created 2026-09-23 21:29:30 UTC), used `gpt-live-1` with `counting-jev-2`. Transcript timing is approximate, and the diagnostic cannot verify speaker identity or audio delivery. Jev completed every observed evaluation quickly in this run; the five correct answers below advanced:

| Utterance | Probability | Jev latency | Total elapsed | Result |
| --- | ---: | ---: | ---: | --- |
| "One" | 0.98 | 328 ms | 1,829 ms | Advanced |
| "Two" | 0.99 | 380 ms | 1,881 ms | Advanced |
| "There's three" | 0.98 | 332 ms | 1,833 ms | Advanced |
| "Three strawberries" | 0.99 | 359 ms | 1,860 ms | Advanced |
| "There are four ducks" | 0.99 | 222 ms | 1,723 ms | Advanced |

The other observed evaluation was "Yeah": probability 0.19, Jev latency 405 ms, and `STAY`, with no harmful behavioral effect. It was not a count, suggesting that the current implementation may make unnecessary requests for non-count child utterances. This is a follow-up observation, not a blocker for PR #9.

For the five advancing answers, the configured settle delay was about 1,500 ms. The full answer-to-decision totals were 1,723–1,881 ms, leaving Jev calls of 222–380 ms; scene commits/displays followed approval essentially immediately. This supports the conclusion that Jev is normally fast enough for this interaction model in this run, and that the fixed settle wait is the dominant normal latency in the current sequential design. Together with the standalone benchmark, there is no current evidence that Jev is normally multi-second, that `/api/evaluate` adds material normal latency, or that rendering is a meaningful normal delay. The earlier live run's 2–4 second requests and timeouts remain unexplained/intermittent; these samples are evidence, not a universal latency guarantee.

#### Incomplete utterance and stale-result protection

On the 4-duck scene, the learner's transcript arrived slowly. The 1.5-second settle timer fired on the incomplete utterance "There are". Jev evaluated that text at probability 0.07 in 370 ms. Before the result could be acted on, the learner continued with "four", making that evaluation stale. The app marked and discarded it as `STALE`; this was not a Jev error, since Jev evaluated the text it received and the orchestration had fired too early. The completed utterance "There are four ducks" was then evaluated at probability 0.99 in 222 ms and advanced correctly.

This is live evidence that stale-result protection works and, separately, that a fixed 1.5-second silence timer is not a reliable end-of-turn signal for slow or child-like speech.

#### Follow-up experiment

In a separate issue/PR, replace the fixed 1,500 ms transcript settle timer with the best available end-of-turn / end-of-speech signal, then invoke Jev immediately after turn completion. Measure at minimum:

- Final learner word → Jev request.
- Jev latency.
- Final learner word → decision.
- Final learner word → scene display.
- Stale/discarded evaluations.
- False advances.
- Subjective conversational smoothness.

The experiment must preserve self-correction handling, stale-result protection, deterministic app-owned scene transitions, no correctness praise before approval, and no mid-speech scene changes. Speculative/predictive Jev evaluation is deferred; first test proper end-of-turn-triggered evaluation.

## Reproducing

```bash
npm run dev                                          # needs OPENAI_API_KEY and TYPESAFE_API_KEY
npm run test:jev                                     # threshold calibration, text only, ~150 Jev calls
node scripts/live-matrix.mjs correct_once --repeat 5 # real GPT-Live sessions, billed per second
node scripts/live-matrix.mjs progression            # multi-scene pause/advance check
```

Both scripts write to `test-results/`, which is not committed. Repeats in one live-matrix command run concurrently; serial invocations were also used above to separate provider load from synchronization behavior. `npm test` and `npm run test:browser` cover the decision and advance logic with no network access.
