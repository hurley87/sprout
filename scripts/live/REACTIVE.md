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

The full baseline suite and matrix remain for Commit 5.
