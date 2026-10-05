# Reactive child scenarios

Install `installChildScenarios(page, testInfo)` before navigation; it composes the synthetic microphone and opt-in read-only observer. Navigate to `/`, then call `run(name, async child => ...)`. Run attempts serially, await actions, and dispose the harness after the last run. Wrap the run in a Playwright fixture/`try/finally` when additional resources need teardown. Collection runs inside `run` before microphone cancellation and parent Stop cleanup. Each run permits one `parentStart()`; restart requires another run after artifacts have been saved.

```ts
const harness = await installChildScenarios(page, testInfo);
await page.goto("/");
try {
  await harness.run("one answer", async child => {
    await child.parentStart();
    await child.waitForNode("count-1-duck");
    await child.waitForTutorOutputStart();
    await child.waitForTutorQuiet();
    await child.correctAnswer();
    const started = await child.waitForClassifierStart();
    await child.waitForClassifierResult(started);
    await child.assert("next node rendered", async () => {
      await child.waitForNode("count-2-ducks");
    });
    await child.parentStop();
    await child.waitForSessionEnd();
  });
} finally {
  await harness.dispose();
}
```

This example requires a live provider or a local peer that supplies transcript/classifier responses. Normal browser CI uses local peers/mocks; live suites remain opt-in and isolated. The harness never supplies transcripts, evaluates classifier meaning, or decides when a lesson should advance.

## Actions and waits

- `say(text)` selects an **exact**, case/punctuation-sensitive manifest text. `sayFixture(name)` selects committed bytes. Missing phrasing fails clearly. Test runs never synthesize speech. Supported phrases are in `tests/fixtures/speech/manifest.json`; self-corrections, tentative answers and arbitrary novel wording are currently unsupported.
- `correctAnswer()` selects the current graph node's authored quantity; `wrongAnswer()` rotates to the next of one/two/three. These express the intended answer, without judging the observed transcript or classifier.
- `dontKnow()`, `help()`, `requestStop()` select the corresponding manifest audio. A spoken stop request is audio only, with no harness transition authority. `parentStop()` and `parentStart()` click ordinary UI buttons.
- `noise({seed, durationMs, amplitude})` uses the existing deterministic PCM noise path. `staySilent(ms)` cancels any source while preserving a connected microphone. `wait(ms)` is an elapsed delay with browser-clock samples at its boundaries; Node scheduling is not used as a diagnostic epoch. `cancelAudio()` cancels active playback. Audio actions return `ended` or `cancelled`.
- `interrupt(text = "Wait!", checkpoint?)` waits for a fresh tutor PCM active event, then plays committed speech. Capture a `checkpoint()` before triggering tutor output when precise event ordering matters; `waitForEvent` accepts `{from, scope, detail, timeoutMs}`.
- `currentNode()` reads the rendered node. `waitForNode(id)` waits for a fresh `render.confirmed` diagnostic for that node. `waitForTutorOutputStart()` and `waitForTutorQuiet()` observe decoded PCM only. Quiet is **not** proof of semantic turn completion.
- `waitForClassifierStart()` returns a checkpoint (`after`, `scope`) that `waitForClassifierResult(checkpoint, type?)` uses with exact runtime, visit, child-turn, node and revision identities. Alternate result types include cancelled, blocked, held and abstained; no semantic interpretation occurs.
- `waitForSessionEnd()` waits for an actual production terminal diagnostic. Generic `waitForEvent` also supports microphone candidate/confirmed activity, transcript revisions, render and steering diagnostics. `assert(label, callback)` records assertion intent and failure; uncaught ordinary assertions in the scenario body are also retained.

Audio/UI actions capture their cursor before the action. Sequential waits consume journal order rather than the newest journal offset, so events arriving while audio plays remain observable. Defaults scope to the attempt and current visit; classifier results use all checkpoint identities. Explicit checkpoints are recommended for concurrent action/wait patterns. No wait uses old quiet/classifier events preceding its cursor. Restart invalidates the attempt. Cancellation aborts pending observable waits and elapsed waits; browser/playback failures are surfaced rather than replaced by success.

## Evidence

Every attempt writes and attaches three Playwright output files, with an attempt counter and sanitized scenario name:

1. `report.json`: the unchanged `LessonRuntime.report()` production object. No extra runtime event schema or raw provider payloads are introduced. It retains microphone/VAD, transcript, classifier mapping/result/latency, render, steering and terminal diagnostics.
2. `harness.json`: scenario name, attempt, intended triggers, action start/end/cancellation/failure records, assertion errors, final pre-cleanup runtime state and evidence/cleanup problems.
3. `timeline.txt`: readable merged chronological production diagnostics and harness records, ordered by attempt-relative `atMs`.

The read-only observation returns `nowMs` sampled from the same `performance.now() - createdAt` clock as the report. Harness boundaries sample this clock through the observer; they include browser round-trip/scheduling latency, and do not claim sample-exact audio onset. AudioContext `startedAt`, Node wall-clock and provider transcript interval times are never treated as this epoch. Parent Start invocation precedes creation of the attempt, so its start is explicitly unaligned (`atMs: null`); its end is aligned. Missing clock/report evidence after page/browser destruction is explicitly marked incomplete. The original assertion exception is rethrown even if evidence collection, attachment or cleanup fails. Browser resources must remain open until `run` returns/throws.

Cleanup Stop occurs **after** report collection and is not part of the captured final state. If a terminal state is part of a scenario assertion, call `parentStop()`/`waitForSessionEnd()` inside the scenario. Reports are preserved before the next run can restart the application. No audio recording, credentials, environment files or additional model are consumed or persisted.
