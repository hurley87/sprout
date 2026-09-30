# Issue #40: targeted cooperation findings

Date: 2026-09-30. This is a bounded synthetic-child validation, not a real-child
study or an estimate of semantic disagreement rate.

## Run identity and retained evidence

- Application source SHA: `4428cc4d8892eb05e6e704e88d6f2ed02a96a484` (expected parent).
- Prompt: `counting-jev-5`; voice model: `gpt-live-1`; evaluator: `jev-1.13.0`;
  advancement threshold: `0.90`.
- Child speech: macOS synthesized audio played through the browser microphone.
  App: the configured local Next.js development server at `http://127.0.0.1:3000`.
- The validation commit changes the observer, live scenario catalog, tests, and
  documentation only; session/evaluation production code was not changed.
- Raw browser logs, timelines, diagnostics, and failure stacks are preserved in
  `test-results/issue-40-20260930-targeted/` and the three separate retry
  directories below. None of these directories are tracked by Git.

Initial targeted command (one sequential invocation; the runner continued after
failures):

```bash
LIVE_OUT=test-results/issue-40-20260930-targeted BASE_URL=http://127.0.0.1:3000 \
  npm run test:live:reactive happy-path incorrect-then-correct hedged-answer counting-aloud \
  self-correction corrected-to-wrong continuation off-topic interruption explicit-stop
```

Targeted retries, each in a fresh directory:

```bash
LIVE_OUT=test-results/issue-40-20260930-targeted-retry1 BASE_URL=http://127.0.0.1:3000 \
  npm run test:live:reactive hedged-answer counting-aloud
LIVE_OUT=test-results/issue-40-20260930-targeted-retry2 BASE_URL=http://127.0.0.1:3000 \
  npm run test:live:reactive hedged-answer
LIVE_OUT=test-results/issue-40-20260930-targeted-retry3 BASE_URL=http://127.0.0.1:3000 \
  npm run test:live:reactive continuation
```

Retry 1 addressed two measured observer/assertion defects: the numeric-only
assertion rejected a natural phrase that Jev accepted, and the response helper
waited for a new turn-start even though the answer's tutor transcript had already
started while output was gated. Retry 2 followed a further fix to the natural
phrase assertion. Retry 3 followed the observer fix for the current
`Evaluated answer… The screen has changed` result wording. The first attempts and
all their failures remain unchanged.

## Scenario outcomes

| Scenario | Result | Live evidence |
| --- | --- | --- |
| `happy-path` | Pass | One, two, three each advanced once. Jev: 0.98, 0.99, 0.99. |
| `incorrect-then-correct` | Pass | “Two” scored 0.02 and stayed; “One” scored 0.98 and advanced once. |
| `hedged-answer` | First two harness failures; retry 2 passed | “I think there is one duck” reached Jev as one settled final answer and scored 0.92. Both first failures happened after the app had advanced; the harness assumed a number-only transcript. |
| `counting-aloud` | Initial harness failure; retry 1 passed | After two advances, “One, two, three” reached Jev as one final answer and scored 0.98 on three butterflies. Initial failure was the stale turn-start wait; no third answer was spoken on that initial run. |
| `self-correction` | Pass | “Two, no, one” was the one settled Jev answer, scored 0.97, and advanced once. |
| `corrected-to-wrong` | Failed; no retry | “One” scored 0.98 and committed ADVANCE. One second “No, Two” transcript followed after the 1,000 ms pause, but no second Jev request/result was observed. Diagnostics say its transition-period transcript was ignored; the delegation was rejected because the old answer's scene was no longer current. See open finding below. |
| `continuation` | Initial observer failure; retry 3 passed | Initial “One” advanced. On retry 3, “And two” was evaluated on the two-duck scene at 0.88 (STAY), below the unchanged 0.90 threshold. This differs from the other continuation run, where it scored exactly 0.90 and advanced. |
| `off-topic` | Pass | The dinosaur comment received a conversational response without Jev; a later “One” was evaluated once at 0.98 and advanced. |
| `interruption` | Pass | “Wait!” was observed during a tutor turn; it did not produce a Jev result or advancement. A later numeric transcript (“1”) was evaluated once at 0.98. |
| `explicit-stop` | Pass | “I am all done” ended the lesson without Jev, scene progression, or a new tutor turn after acceptance. |

All source scenarios used the actual microphone path. No child transcript or
provider result was injected. No full benchmark was run.

## Per-answer evaluator and control record

Each completed answer below has one browser-observed Jev request/result. The
origin is application fallback alone or application plus an associated
delegation; no delegation caused a second Jev call. `both` rows received an
ID-linked result. The app context is sent before or at gate release; a missing
ack at release is shown as `missing → estimated` when a later acknowledgment
arrived. The later acknowledgment means estimated context injection only.

Timing abbreviations in the final column are all **application session-relative
milliseconds**: final child transcript → request/result; result → displayed
scene; result → gate release; gate release → first observed tutor transcript /
decoded-media activity. `—` means that artifact lacked the signal. These are
not physical acoustic-onset measurements.

| Run / identity (`scene:revision:answerVersion`) | Jev result; origin | Delegation | Transcript → request/result; result → display / release; release → transcript / media |
| --- | --- | --- | --- |
| continuation / `0:1:13200:One` | 0.98 ADVANCE; both | associated; linked result sent | 350/585; 29/29; 312/617 |
| continuation / `1:2:16800:And two` | 0.90 ADVANCE; both | associated; linked result sent | 366/584; 30/30; 76/416 |
| corrected-to-wrong / `0:1:11400:One` | 0.98 ADVANCE; application | first request rejected as unsettled | 255/492; 37/4,505; 157/478 |
| counting-aloud initial / `0:1:11600:One` | 0.98 ADVANCE; both | associated; linked result sent | 328/562; 30/30; 350/700 |
| counting-aloud initial / `1:2:22400:Two` | 0.99 ADVANCE; application | no associated delegation observed | 430/697; 48/3,616; 1,250/1,494 |
| happy-path / `0:1:19600:One` | 0.98 ADVANCE; both | associated; linked result sent | 254/513; 30/30; 341/504 |
| happy-path / `1:2:31200:Two` | 0.99 ADVANCE; both | associated; linked result sent | 312/554; 25/25; 471/970 |
| happy-path / `2:3:43800:Three` | 0.99 ADVANCE; application | no associated delegation observed | 251/462; 37/37; 1,774/2,073 |
| hedged initial / `0:6:12200:I think there is one duck` | 0.93 ADVANCE; application | rejected: offset did not identify a settled transcript | 254/466; 26/—; —/— |
| incorrect-then-correct / `0:1:10600:Two` | 0.02 STAY; both | associated; linked result sent | 254/489; no scene commit; release after output quiet; 978/1,262 |
| incorrect-then-correct / `0:2:27200:One` | 0.98 ADVANCE; both | associated; linked result sent | 318/531; 34/34; 942/1,475 |
| interruption / `0:2:11000:1` | 0.98 ADVANCE; both | associated; linked result sent | 312/500; 27/27; 709/933 |
| off-topic recovery / `0:6:23200:One` | 0.98 ADVANCE; both | associated; linked result sent | 298/533; 30/30; 698/924 |
| self-correction / `0:3:12000:Two, no, one` | 0.97 ADVANCE; both | associated; linked result sent | 338/584; 37/37; 335/597 |
| counting-aloud retry 1 / `0:1:12000:One` | 0.98 ADVANCE; both | associated; linked result sent | 254/484; 34/34; 997/1,518 |
| counting-aloud retry 1 / `1:2:24800:Two` | 0.99 ADVANCE; both | associated; linked result sent | 288/548; 38/38; 763/1,020 |
| counting-aloud retry 1 / `2:5:37400:One, two, three` | 0.98 ADVANCE; both | associated; linked result sent | 326/560; 31/32; 992/1,836 |
| hedged retry 1 / `0:6:11200:I think there is one duck` | 0.92 ADVANCE; application | rejected: offset did not identify a settled transcript | 252/524; 32/33; —/— |
| hedged retry 2 / `0:5:12200:I think there is one duck` | 0.92 ADVANCE; application | delegation rejected; application fallback completed | 252/500; 40/3,587; 1,476/1,553 |
| continuation retry 3 / `0:1:12800:One` | 0.98 ADVANCE; both | associated; linked result sent | 254/565; 25/26; 728/976 |
| continuation retry 3 / `1:3:16000:And two` | 0.88 STAY; application | no association observed | 251/395; no scene commit; release after output quiet |

The exact provider delegation IDs, event IDs, rejection reasons, and full per-event
payloads remain in the corresponding `diagnostics.json` and `log.json` artifacts.
Across these runs, 14 evaluated answer identities were associated with a
delegation and each received one linked result; seven settled identities used
application fallback without an association. There were no duplicate Jev
results or duplicate scene commits for one settled identity. One partial hedged
revision in retry 2 had an evaluation canceled/superseded by the final transcript;
it did not commit or release authority. A microphone VAD stop replaced the
transcript fallback schedule in observed numeric cases; requests began about
250–359 ms after the eligible microphone turn-end. Final-transcript-to-request
was 251–430 ms for settled answers (573 ms for the superseded partial); request
to returned Jev result was 143–267 ms.

The app-authored result context was normally sent at display confirmation and
gate release followed in 0–3 ms. Result-to-context-send was 25–48 ms on those
immediate paths. Three releases waited for existing output/source conditions:
4,505 ms for `corrected-to-wrong`, 3,616 ms for the initial `counting-aloud`
answer on two ducks, and 3,587 ms for the hedged retry after source replacement.
For correlated acknowledgments, diagnostics marked the app context `missing` at
immediate release; later acknowledgments reported `estimated_injection` 717–1,146
ms after release. ID-linked delegation contexts had their own event IDs and
separate estimated-injection acknowledgments. Neither acknowledgment nor
decoded-media activity proves audible delivery.

The browser observer timestamp (`page`), GPT-Live transcript `start_ms` and
`end_ms` (`provider`), and diagnostic `at` (`application session-relative`)
remain separate clocks. For example, answer-version prefixes such as `19600`
come from the provider transcript clock; they must not be subtracted from
browser arrival or app diagnostic timestamps. The live data did not approach
the local 30-second delegation-age cutoff closely enough to characterize that
heuristic's boundary.

## Conversation and delivery observations

- In `hedged-answer`, the provider transcript included “Thank you.” before Jev
  returned 0.93. In `corrected-to-wrong`, generated tutor text included “Let's
  stay with our little duck for a moment” before the 0.98 ADVANCE was committed.
  These are pre-outcome generated transcript fragments while the answer gate
  was active. The artifacts do not establish whether either fragment was
  acoustically delivered, so they are not evidence that the child heard
  premature praise or contradictory correction.
- Correct, STAY, and counting-aloud outputs included scene-appropriate phrases
  such as “Now there are butterflies fluttering” after the display advanced,
  “Let's stay with our little duck for a moment” on a STAY response, and
  “I loved how you counted those butterflies. Now three strawberries are
  here” after counting aloud. No confirmed scene mismatch was observed.
- The initial counting-aloud run generated “Let's count them together. Ready?
  1…” after the second advance, while the harness waited on the wrong tutor
  boundary and never spoke its third answer. This is a retained initial failure,
  not evidence that an audible tutor turn was lost.
- The `corrected-to-wrong` retry was intentionally not repeated. At application
  times 15,397–17,331 ms, microphone speech started after the first scene had
  committed; diagnostics report `answer.advance_transition_transcript_ignored`
  for that transition-period transcript. The app's existing 250 ms correction
  window had elapsed. No final answer was evaluated in the new scene, so this
  scenario does not validate the post-commit correction path. It also does not
  establish an unsafe commit: the correction began after commit, and the
  contract does not retroactively undo a displayed scene.
- On the passing continuation retry, Jev returned 0.88 for “And two” on the
  two-duck scene, so the existing threshold produced STAY. Another run returned
  0.90 for the same phrase and advanced. This provider variability is retained;
  neither the threshold nor question was changed.
- For measured releases, the first tutor transcript fragment appeared 76–1,774
  ms after release and decoded-media activity 416–2,073 ms after release.
  Some runs had missing signals or source replacement. Physical acoustic onset,
  utterance completion, and child hearing are unobserved. Context acknowledgments
  were often `missing` at the immediate release boundary and arrived later as
  `estimated_injection`; no acknowledgment was treated as audio delivery.
- No duplicate acknowledgment or confirmed audible contradiction was
  established. These small, synthetic samples do not support a semantic
  disagreement rate or a claim about preschool speech recognition.

## Remaining limitations

- `corrected-to-wrong` did not produce a second evaluation after the 1,000 ms
  pause and scene commit. Keep the artifact as a follow-up investigation; this
  validation does not change microphone, transition, correction, or source
  isolation policy.
- The continuation probability varied from 0.90 ADVANCE to 0.88 STAY. The
  existing evaluator and threshold remain unchanged.
- Delegations were associated in 14 settled identities; several were declined
  as unsettled or no-longer-applicable while application fallback still
  evaluated the answer. No run measured behavior near the local 30-second
  association-age boundary.
- No natural evaluator timeout/unavailable outcome occurred. Deterministic tests
  cover that path, but this live subset does not.
- Synthetic adult speech does not validate real-child or preschool ASR quality.
  Transcript and media observations cannot prove audible onset, completion, or
  compliance with result context.

## Checks

The harness observer/scenario changes have focused regression tests in
`tests/live-observer.test.ts`, `tests/live-metrics.test.ts`, and
`tests/reactive-suite.test.ts`. The issue's final unit/browser checks, lint,
typecheck, production build, formatting, and diff checks are recorded in the
commit handoff.
