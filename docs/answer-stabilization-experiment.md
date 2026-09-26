# Answer stabilization latency experiment

## Commit 1: current-policy baseline

The unchanged production policy is `CORRECTION_WINDOW_MS = 2500` in
`lib/answer.ts`. Baseline command:

```sh
LIVE_OUT=test-results/correction-window-2500 npm run test:live:reactive happy-path self-correction
```

Run against the configured local app on 2026-09-26. `happy-path` passed all
three correct-answer advances. `self-correction` failed its exactly-once
advance assertion: the provider delivered one final transcript (`two no one`),
Jev returned probability 0.69, and the app correctly stayed on `hello-duck`;
the harness expected an advance. This is a live semantic/model outcome, not
evidence of a premature/stale commit. The harness had one refused delegation
before that assertion. Durable attempt recording also reported `Failed to
fetch`; prototype session diagnostics were still downloaded.

Available baseline observations from the browser-arrival and application
diagnostics summaries:

| Scenario/answer | Jev latency | transcript to displayed scene | transcript to first observed Sprout transcript |
| --- | ---: | ---: | ---: |
| happy-path / One | 284 ms | 2656 ms | 4100 ms |
| happy-path / Two | 191 ms | 2730 ms | 3919 ms |
| happy-path / Three | 214 ms | 2614 ms | 3306 ms |
| self-correction / “two no one” | 229 ms (browser log; 230 ms app diagnostics) | unavailable; no scene change | 725 ms to first acknowledgment, before the decision; 13217 ms to the next instruction append |

The happy-path browser summary reports scene display (not the internal
deterministic commit) and measures child transcript arrival to the first Sprout
transcript delta. It is not acoustic timing or verified audio playback. The
self-correction’s first Sprout transcript delta occurred before Jev completed,
and that answer stayed on the current scene, so its later acknowledgement
should not be compared with happy-path's post-advance response. See raw
`log.json`, `timeline.txt`, and `diagnostics.json` under
`test-results/correction-window-2500/{happy-path,self-correction}/`.

The original baseline predates the new joined timeline metrics below. It does
not contain a safe per-answer join of request, completion, commit, display,
response release, and subsequent transcript. Later experiment runs will report
those as application-session-relative values; browser-arrival values and
provider transcript timestamps remain separate clocks. Missing stages are
null/unavailable, never inferred from neighboring events.

## Timing path and existing protections

- Each child transcript delta updates the current transcript revision and
  schedules an evaluation. The fallback wait is 1500 ms; a clean microphone
  speech-stop can replace it with the 250 ms transcript tail. A later speech
  stop can reschedule a pending transcript evaluation.
- The 2500 ms correction deadline is computed from the later of detected turn
  end and latest transcript arrival. An affirmative Jev result is deferred
  until that deadline; a response gate also waits until the new scene is
  displayed, and any longer microphone VAD grace can extend the hold. A stay
  decision is deferred until the correction deadline, response-output quiet,
  and any VAD grace have all elapsed.
- Jev is requested after the settling/tail timer and resolves independently.
  Slow Jev keeps the response gate closed; the correction deadline does not
  wait for Jev to start or finish. The scene cannot commit until both an
  affirmative current result and its correction deadline are satisfied.
- Any new child transcript delta increments the revision, aborts pending Jev,
  cancels deferred advance/stay, updates the latest answer and response gate,
  then schedules a decision for the revised answer. A VAD speech-start can add
  grace to an already-deferred decision; it preserves, rather than commits, a
  pending evaluation. New speech after Jev resolves but before commit therefore
  invalidates the old approval. The release also rechecks transcript revision,
  answer version, scene, session state, and response-gate identity.
- Existing regression coverage includes `tests/session.test.ts` cases for
  continuously blocked self-correction revisions, stale results not releasing,
  stale decisions during deferred advance, and exactly-once scene advancement;
  `tests/jev-diagnostics.test.ts` covers the timing stages, stale outcomes, and
  displayed scene. The live `self-correction` scenario checks one settled
  transcript reaches Jev and that no earlier tutor turn triggers progression.

The reactive artifact summary now adds version-and-scene-correlated diagnostic
timelines for child transcript, evaluation request/completion, deterministic
commit, displayed scene, application response release, and first subsequent
observed Sprout transcript. Stabilization wait (evaluation completion to
commit) and tutor response delay (application release to observed transcript)
are separate fields. The browser/provider clock fields remain in their
existing browser summary and timeline.
Joined response timing is bounded to the current answer and will not consume a
Sprout transcript occurring after the next child answer begins.
