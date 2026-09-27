## Revised product contract (2026-09-26)

Protect speech still active or already resuming before deterministic commit.
Once the child has clearly stopped and the current answer has been evaluated,
respond promptly. A correction beginning after commit may be a new turn.
The historical 1000/1500/2000 ms silent-pause cases below are boundary
characterization, not candidate rejection criteria. Their timing stays fixed.

Required invariants:

- Same-utterance self-correction remains safe.
- Transcript revisions before commit invalidate stale decisions.
- Microphone activity before commit holds or invalidates the pending decision.
- Stale Jev results cannot release.
- Final incorrect answers do not advance.
- Exactly one scene advance occurs.
- Explicit child stop wins.
- Output from an invalidated answer is not released.

Evaluate 750, then 250, then 0 ms, with deterministic safety tests before
any billed live subset (happy-path, self-correction, corrected-to-wrong,
continuation). Stop at the first real safety failure and investigate. Do not
change other timing constants to compensate or reject a candidate for a
post-commit change of mind. Select the smallest safe value; 0 ms would remove
the product delay while retaining necessary scheduling semantics.

The sections below preserve historical observations and the former contract;
this revised contract supersedes their long-silence acceptance conclusions.

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

Commit 2 adds deterministic separate-utterance coverage with explicit 1000,
1500, and 2000 ms pauses, independent of `CORRECTION_WINDOW_MS`. It includes
wrong-to-correct and initially-correct-to-wrong changes, transcript-only
revision invalidation, and renewed microphone speech after Jev resolves but
before commit. Each pause rejects scene commit and response-gate release;
results allow an abandoned earlier Jev evaluation and require the latest answer
to control progression. Live scenarios `delayed-correction` (1500 ms),
`corrected-to-wrong` (1000 ms), and `continuation` (2000 ms) send separate
synthetic speech through the browser microphone and real GPT-Live/Jev path.
They inspect both child transcripts and the entire intentional pause. No
production stabilization or response policy changed.

The safety boundary remains pre-finalization: newly transcribed speech or a
microphone speech-start before deterministic commit invalidates or holds the
pending decision. Speech that begins after commit is a new turn; the prior
scene transition is final and cannot be undone. The pause values exercise
ordinary long thinking gaps while remaining within the current policy window.
GPT-Live may generate provider transcript while the answer-response gate is
blocked. Provider transcript activity is not itself evidence of an audible
interruption. Deterministic session tests verify that stale answer responses
are not released before continuation or correction is resolved. Live observer
turn starts remain diagnostic; no acoustic or output-release proxy is inferred.

Commit 2 validation against the unchanged policy (2026-09-26): the targeted
session/diagnostics/reactive harness group passed 194 tests, and all 15 browser
tests passed. The billed retry passed `self-correction` and `corrected-to-wrong`.
The baseline `happy-path` reached Jev with transcript `1` (probability 0.98),
then failed the existing harness expectation for the spoken text `One!`; this
is retained as an ASR/harness mismatch, not a scene-commit failure.
`delayed-correction` timed out at its 150-second scenario deadline while
macOS `say` was synthesizing `Two!`. The earlier `continuation` run observed a
Sprout transcript turn (`Hmm, let's...`) during the 2000 ms pause. The prior
scenario incorrectly treated that provider transcript as a tutor interruption;
diagnostics showed the response gate remained active and no scene was committed.
This is not evidence of an audible interruption or success acknowledgement.
The corrected contract allows gated provider generation and makes the
deterministic session tests authoritative for response release. The first attempt, before the
local dev server was started, recorded `ERR_CONNECTION_REFUSED` for all five
scenarios.
`corrected-to-wrong` passed its scenario assertions; teardown then logged a
GPT-Live `context_injection_incomplete` error after the session was stopped.

Artifacts are preserved under `test-results/issue-34-commit2-baseline-20260926/`
(initial connection failures),
`test-results/issue-34-commit2-baseline-retry-20260926/` (configured retry),
and `test-results/issue-34-commit2-continuation-20260926/` (isolated continuation
attempt). No live artifact is part of the commit.

The reactive artifact summary now adds version-and-scene-correlated diagnostic
timelines for child transcript, evaluation request/completion, deterministic
commit, displayed scene, application response release, and first subsequent
observed Sprout transcript. Stabilization wait (evaluation completion to
commit) and tutor response delay (application release to observed transcript)
are separate fields. The browser/provider clock fields remain in their
existing browser summary and timeline.
Joined response timing is bounded to the current answer and will not consume a
Sprout transcript occurring after the next child answer begins.

## Commit 3 candidate: 1500 ms

The first candidate changes only `CORRECTION_WINDOW_MS` from 2500 to 1500 ms;
there is no environment or runtime configuration. Focused session tests ran
first. **139 passed and 2 failed** (141 total). The explicit 1000 ms
correct-to-wrong correction passed. The explicit 1500 ms wrong-to-correct
case failed because the scene had already committed when the pause ended. The
2000 ms no-activity correction case also committed at 1500 ms; speech after that
commit is a new turn and cannot reverse the scene transition. The separate
2000 ms continuation case passed when microphone speech began at 1250 ms,
before the 1500 ms deadline, and the `and two` transcript arrived at 2000 ms.
Same-utterance correction, stale-result invalidation, exact-once advancement,
and the other focused session cases passed.

The explicit deadline probe models the correction event and commit timer due at
the same millisecond. The commit timer was registered first, so commit won and
the following transcript was recorded as transition-period speech and ignored.
This implementation therefore does not include equality: its supported
correction contract at this candidate is strictly before 1500 ms. The requested
1500 ms delayed-correction case fails that contract, so the candidate did not
qualify for the billed live subset; no 1500 ms live scenarios were run and no
candidate latency measurements are available. Use the existing 2500 ms live
baseline table above for comparison; do not infer candidate timings from it.

The evidence does not support lowering the window to 1000 ms. A 1500 ms fixed
window protects the 2000 ms continuation only when renewed microphone activity
arrives before commit. If the product requirement includes corrections after
1500 ms of silence, retain the baseline or investigate an adaptive policy
before another candidate.

## Revised-contract experiment: 750 ms stopped on safety failure

Changed only the timing constant to 750 ms for the deterministic probe.
The focused session/diagnostics group reported 137 passes, seven failures,
and one expected failure (145 total). The additional probe was then run as
an ordinary test to verify the expected-failure diagnosis: it failed because
`advance.released` occurred at 750 ms despite `microphone.activity_started`
at 749 ms. No transcript revision, confirmed speech, or discard event had
resolved the provisional activity. This violates the required pre-commit
microphone activity invariant, independently of long silent corrections.
The committed reproducer uses `it.fails` to expose the known defect; an
unexpected pass will require replacing it with an ordinary regression test.
A green suite with this marker does not qualify the policy for live use.

Investigation: `microphone.activity_started` sets `provisionalActivity` but
neither suspends the deferred timer nor changes its release deadline.
`releaseDeferredAdvance` does not check provisional activity. The existing
“transcriptless microphone spike” test explicitly expects that advance.
Confirmed speech uses a different bounded VAD grace path. This conflict is
pre-existing; increasing the correction window does not eliminate the race.
A follow-up fix must protect provisional activity through confirmation or
discard and examine both ADVANCE and STAY releases, including activity
already present when Jev resolves, without treating indefinite noise as speech.

The other seven failures include historical silent-pause expectations and
assumptions about VAD grace/output quiet relative to the larger window; they
were not weakened to qualify 750. Fixed 1000/1500/2000 ms silent boundary
probes retain their timing and now recognize a previously committed scene.
The confirmed continuation probe also retains its 1250 ms onset, which is
post-commit at 750; it cannot qualify pre-commit safety at that candidate.

| Candidate | Deterministic qualification | Live results |
| --- | --- | --- |
| 750 ms | Failed: unresolved microphone activity before commit | Not run |
| 250 ms | Not evaluated: stopped on first safety failure | Not run |
| 0 ms | Not evaluated: stopped on first safety failure | Not run |

The local 750 ms candidate was reverted to the branch's original 1500 ms;
no production timing change is included in this investigation. That retained
value is not a new production recommendation and has the same activity race.
No value can be recommended as satisfying the revised contract yet. Whether
the extra correction window can be removed remains unproven. There are no
new live latency measurements to compare with the 2500 ms baseline above.
The remaining dominant component is unmeasured; VAD quiet (900 ms), transcript
tail (250 ms), and provider generation/release are follow-up measurement
candidates, not grounds for changing their constants.

Validation after reverting the candidate: focused session/diagnostics tests
passed 144 tests with one explicitly expected failure. Full unit validation
reported 339 passes, one expected failure, and one failure in the unchanged
`tests/live-recording.test.ts:678`: its hard-coded 3600 ms commit expectation
is incompatible with the branch's retained 1500 ms policy (actual 2600 ms).
Lint passed. Typecheck and build both failed on unchanged test-fixture types
in `tests/reactive-suite.test.ts:88,89,98` (missing `currentScene`, `scene`,
and `utterance`). These failures are outside this contract/investigation diff.

All 15 provider-free browser tests passed after the candidate was reverted.

## Provisional activity fix and 750 ms retest

The historical reproducer above is retained as evidence of the defect and is
now a passing regression. Both ADVANCE and STAY scheduling/release check
`provisionalActivity` before consuming a pending decision. Discard reschedules
against the original deadlines; no correction window or fallback is restarted.
Confirmation clears provisional state and uses the existing VAD grace, including
when classification completes after the original release deadline. Revisions
still cancel the old decision and keep output gated for the new answer.

Inspection confirmed ordinary onset at 80 ms sustained voice and discard after
150 ms quiet. It also disproved the claimed unconditional bound: alternating
short bursts reset both intervals forever. The detector now discards an unresolved
candidate after onset + quiet (230 ms), on the next animation frame, while giving
confirmed sustained speech priority. This adds no long session watchdog; frame
suspension can still defer detector resolution until the browser resumes frames.

At the retained 1500 ms value, 152 focused session/detector/diagnostics tests
passed. Coverage includes activity 1 ms before ADVANCE/STAY release, 150 ms of
unresolved noise followed by release within 1 ms of discard, confirmation after
the deadline followed by grace/revision invalidation, and alternating noise.
The full unit suite reported 343 passes and the same pre-existing hard-coded
3600 ms recording expectation failure (actual 2600 ms). Lint passed; typecheck
still reports the three existing reactive-suite fixture errors recorded above.

### Deterministic 750 ms qualification

152 focused tests and all 344 unit tests pass at 750 ms. The seven initial
focused failures were test setup assumptions, not unresolved activity failures:
pre-commit revision tests now use microphone turn-end/tail and inject revision
1 ms before the configured deadline; the early VAD case checks either ignored
or already-active grace according to whether a fallback interval fits before
commit; output tests honor the unchanged output-quiet deadline independently
of scene commit. Fixed long-silence characterization probes retain their timing.
The recording test now derives commit/display timestamps from the configured
window rather than expecting the old 2500 ms commit time.

### Live joined timing observations

Executed the requested subset once with
`LIVE_OUT=test-results/correction-window-750 npm run test:live:reactive happy-path self-correction corrected-to-wrong continuation`.
Happy-path and self-correction passed. Measurements below use application
session-relative milliseconds, joined by answer version and scene. Older
baseline commit events lack a scene field; for the three baseline happy-path
answers their unique answer versions identify the commits unambiguously.
The reconstructed baseline is retained as `baseline-joined.json` in the output
directory. These are transcript observations, not acoustic playback latency.

| Run/answer | Final transcript → evaluation done | Evaluation done → commit | Final transcript → commit | Release → first Sprout transcript | Final transcript → first Sprout transcript |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2500 baseline / One | 683 | 1966 | 2649 | 1419 | 4099 |
| 2500 baseline / Two | 663 | 2059 | 2722 | 1164 | 3919 |
| 2500 baseline / Three | 571 | 2034 | 2605 | 669 | 3306 |
| 750 / One | 658 | 207 | 865 | 1019 | 1916 |
| 750 / Two | 495 | 258 | 753 | 753 | 1530 |
| 750 / Three | 551 | 267 | 818 | 689 | 1536 |
| 750 / Two, no, one | 456 | 294 | 750 | 946 | 1726 |

Happy-path mean stabilization wait decreased from 2020 to 244 ms (1776 ms).
Mean final-transcript-to-commit decreased from 2659 to 812 ms (1847 ms).
Mean final-transcript-to-first-observed-response decreased from 3775 to 1661 ms
(2114 ms). Single sequential runs include VAD, ASR, network and provider
variation; these differences are observations, not a controlled causal estimate.
Baseline self-correction did not advance, so it has no comparable commit row.

The live command ended with **2 passes / 2 failures**. `corrected-to-wrong`
failed its old scene-stayed assertion during the 1000 ms silent pause;
`continuation` failed the same assertion during its 2000 ms silent pause.
Both stopped before synthesizing/sending their second utterance. Diagnostics
show only the first utterance's activity/confirmed speech, with no renewed
activity before commit. These runs characterize post-commit silence boundaries,
not a remaining provisional-activity race. They do not validate live pre-commit
continuation/correction; deterministic tests supply that evidence. No assertion
was removed or rerun to turn these live failures green.

| Failed scenario's first answer | Transcript → evaluation | Evaluation → commit | Transcript → commit | Release → Sprout | Transcript → Sprout |
| --- | ---: | ---: | ---: | ---: | ---: |
| corrected-to-wrong / One | 569 | 271 | 840 | unavailable | unavailable |
| continuation / One | 536 | 276 | 812 | 291 | 1137 |

750 ms qualifies against the deterministic revised-contract invariants, with
live happy-path/self-correction evidence and the above live coverage limitation.
250 ms is worth a separate deterministic experiment: most remaining 750 ms
stabilization waits are 207–294 ms. Slower evaluation will already consume a
250 ms window, while VAD quiet/tail/output quiet and provider response remain
unchanged. This does not establish 250 ms safety or promise another 500 ms of
end-to-end gain. Stop here for review; neither 250 nor 0 was tested.

Final candidate checks: all 344 unit tests and all 15 provider-free browser
tests passed; lint, changed-code Prettier checks and `git diff --check` passed.
Production build compiled, then failed TypeScript on the same three unchanged
`tests/reactive-suite.test.ts:88,89,98` fixture errors. Typecheck has that same
known limitation. No fixture typing or unrelated production behavior was changed.
The local live dev server was stopped after the subset completed. Artifacts
remain local under `test-results/correction-window-750/`; no push, deployment,
250 ms test, or 0 ms test is included.

## Cleanup before the next candidate

The prior TypeScript fixture errors were branch-local errors, not failures on
main; describing them earlier as pre-existing only meant present before that
individual run. They are fixed here with typed event/snapshot fixtures,
`observer.currentScene`, and explicit evaluation utterance/scene fields.
No type suppression or `any` was added.

`corrected-to-wrong` and `continuation` now always send the second utterance.
They inspect the observer snapshot at the end of the pause and retained scene
transitions at second playback onset. A commit during synthesis is classified
from playback ordering, not from the earlier snapshot. The branch and its
checkpoints/transition are recorded as `stabilization.pre-commit-continuation`
or `stabilization.post-commit-new-turn` in the timeline and raw log, before
waiting for second transcription/evaluation so later failures retain evidence.
These observer transitions reflect displayed scenes; playback is a conservative
speech-onset boundary, not a replacement for precise detector/application
commit timestamps. Deterministic session tests remain authoritative for the
1 ms provisional-activity race.

Pre-commit paths require second transcription/evaluation in the original scene,
no application answer release before the revised evaluation, and the original
scene remaining active through the response. Gated provider transcript is still
permitted. Post-commit paths require transcription and evaluation in the new
scene, reject duplicate/retroactive transitions, and allow at most one legitimate
advance from that scene after its evaluation. In particular, the original
"wrong" correction can be correct for the new two-duck scene; it is not forced
to stay or roll back. Both branches reject unexpected session end.

Tests use actual scene/assertion windows to cover both branches, stale release,
stale advancement, valid new-scene advancement, retroactive advancement, and
commit during synthesis. The observer now projects application answer-instruction
release separately from provider transcript turn-start; it does not infer audio.
No billed rerun was needed for this harness cleanup; the previous live failures
and artifacts above remain unchanged.

Timing tests derive normal release from diagnostic turn-end/transcript times
and evaluation completion. Evaluation promises can be flushed without executing
the queued release callback. If correction is already due (including a zero
window), "before release" means delivering the event before that callback in
the same scheduling turn, not advancing a negative duration. The opposite order
is explicitly tested as final commit winning. Transcript revision before release
uses the same deadline helper. Recording/diagnostic display expectations include
an evaluation that outlives the correction window. No production timing or
production test hooks changed, and lower candidate policies were not executed.

Validation at **750 ms unchanged**: 355 unit tests, 15 provider-free browser
tests, lint, typecheck and production build passed. Changed-file formatting and
`git diff --check` passed. This is one cleanup commit on top of `2d10c7b`;
the branch is ready to begin a separately authorized 250 ms experiment.


## 250 ms candidate — deterministic qualification stopped (2026-09-26)

Evaluated on `feat/answer-stabilization-latency`, parent `31ea631`, by changing
only `CORRECTION_WINDOW_MS` from 750 to 250. All microphone thresholds,
transcript tail/fallback, Jev thresholds, prompting and VAD behavior were unchanged.
No 0 ms candidate was tested.

**Result: not qualified.** The targeted session, microphone, diagnostics,
recording, reactive-harness, inspector and persistence run passed 263 of 266
tests across nine files. Three tests failed:

- `does not commit an incomplete slow phrase during a speech pause`;
- `preserves an in-flight approval through confirmed microphone activity without a new transcript`;
- `preserves VAD, evaluation, committed advancement and actual display on one clock`.

The slow-phrase and recording failures were test scheduling assumptions at the
250 ms transcript-tail boundary: an evaluation resolving at the current fake
clock schedules a zero-delay release callback that needs another timer tick.
A temporary diagnostic rerun advanced one extra millisecond after the actual
release deadline (and adjusted the recording timestamp expectations by that
millisecond); both passed. This does not add a policy delay or change production
scheduling. Those temporary test edits were removed.

The in-flight approval failure is a **real scheduling/VAD race**, not a promise
to undo post-commit corrections. It also reproduces when the complete detector
sequence `microphone.activity_started → microphone.speech_started` is injected
before resolving the pending evaluation. Expected scene index is 0; actual index
is 1 while confirmed microphone speech is still active. The original test itself
is the minimal executable reproducer:

```bash
# With lib/answer.ts temporarily set to 250:
npx vitest run tests/session.test.ts -t 'preserves an in-flight approval through confirmed microphone activity without a new transcript'
```

For the detector-shaped variant, insert this line immediately before the second
`mic(session, "microphone.speech_started")` in that test:

```ts
session.receive({ type: "microphone.activity_started" });
```

The reproduced order, relative to the initial transcript/turn end, is:

```text
0 ms:   initial transcript, microphone speech stops
250 ms: transcript tail expires; evaluation starts and remains pending
250 ms: microphone activity starts, then confirms as speech
250 ms: evaluation resolves ADVANCE; release callback runs
        scene commits while microphone speech remains active
```

At speech confirmation there is no deferred decision yet, so
`startDeferredVadGrace` returns without retaining the provisional classification.
When evaluation resolves, `deferAdvance` sees active speech and calls the grace
helper again, but the default `classifiedProvisional = false` and
`speechStartedAt >= normalReleaseAt` guard reject grace. At 250 ms the ordinary
correction deadline equals the transcript tail, so this event order reaches that
guard even though speech began before the actual release callback. This is a
latent deadline-versus-callback race exposed by the smaller policy; the
experiment does not establish that 250 ms is inherently unsafe after a fix.

The diagnostic rerun passed 190 of 191 session/recording tests; only this race
remained. The existing pending-decision activity holds, noise-discard resumption,
provisional-to-VAD handoff, pre-release transcript revisions, same-utterance
correction, stale-result and exactly-once checks passed in the initial targeted
run. These passes do not override the confirmed-speech failure.

**Live scenarios run: none.** Billed `happy-path`, `self-correction`,
`corrected-to-wrong` and `continuation` were withheld after deterministic failure.
Historical 1000/1500/2000 ms silent corrections were not treated as disqualifiers.
There are no 250 ms per-answer measurements, ranges or means to report.

| Observed mean metric | 2500 ms baseline | 750 ms candidate | 250 ms candidate |
| --- | ---: | ---: | --- |
| Final transcript → commit | ~2659 ms | ~812 ms | Not measured |
| Final transcript → observed Sprout response | ~3775 ms | ~1661 ms | Not measured |
| Evaluation complete → commit | Not recorded here | ~244 ms | Not measured |
| Response gate release → observed Sprout transcript | Not recorded here | Not recomputed | Not measured |

No claim can be made about further latency improvement or the dominant remaining
component at 250 ms. Fix and deterministically qualify this race before a fresh
250 ms live experiment; testing 0 ms is premature while this boundary is unresolved.
The candidate constant was restored to **750 ms**, and no production race fix
was included in this experiment. Historical results above are unchanged.
