# Issue 30 acceptance and validation

Implementation covers planned slice 7 and follow-up diagnostics. This is not an issue-complete
claim: required provider coverage remains pending. No billed calls are part of
slice 7 validation. The current base is `f1c8407905ed177ed506f9190e708e0fbbc066d0`.

| Slice       | Boundary                                                                           | Primary files                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 `aa78a47` | Isolated opt-in live project and execution policy                                  | `playwright.config.ts`, `playwright.live.config.ts`, `docs/browser-tests.md`                                                                                                                                                        |
| 2 `79370ff` | Synthetic microphone, offline fixtures, seeded noise                               | `tests/helpers/synthetic-microphone.ts`, `tests/fixtures/speech/manifest.json`, `tests/browser/transport-output.spec.ts`                                                                                                            |
| 3 `9293b43` | Opt-in read-only production observation                                            | `lib/lesson-runtime/browser-observation.ts`, `tests/helpers/lesson-observer.ts`, `tests/browser/lesson-observation.spec.ts`                                                                                                         |
| 4 `69d70f0` | Reusable child actions and failure artifacts                                       | `tests/helpers/child-scenario.ts`, `tests/helpers/child-scenario.md`, `tests/browser/child-scenario.spec.ts`                                                                                                                        |
| 5 `c4b4a2a` | Complete lesson baseline/correction flows and evidence replay                      | `tests/browser/live/scenarios.spec.ts`, `flow.ts`, `signals.ts`, `evidence.ts`, `tests/live-scenario-evidence.test.ts`                                                                                                              |
| 6 `f1c8407` | Support, hesitation, silence, parent Stop                                          | `tests/browser/live/support.spec.ts`, `support-evidence.ts`, `behaviors.ts`                                                                                                                                                         |
| 7 | Butterfly timing variants, strict/probe separation, summaries and coverage mapping | `tests/browser/live/butterfly.spec.ts`, `butterfly-evidence.ts`, `tests/helpers/injection-window.ts`, candidate-discard lineage checks in `evidence.ts`, `tests/injection-window.test.ts`, `tests/browser/injection-window.spec.ts` |

## Acceptance criteria

Paths in the table are repository-relative. Offline checks below verify
implementation; provider-backed behavior must be validated separately.

| Issue acceptance criterion                                 | Implementation/check                                                                                                                     | Pending validation                                                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Current Playwright/browser transport architecture          | Existing configs and `installChildScenarios`; real local WebRTC/audio browser tests                                                      | Complete live scenario coverage                                                                                                         |
| No removed live-matrix/old reactive script dependency      | Live specs import current helpers/runtime only; dependency review                                                                        | None for static boundary                                                                                                                |
| Reactive waits, rather than fixed lesson timestamp         | `flow.ts`, `signals.ts`, observer cursor tests; `injection-window.ts` checks current window atomically                                   | Provider timing/fragmentation                                                                                                           |
| Controllable microphone MediaStream                        | `synthetic-microphone.ts`; local native microphone/WebRTC tests and atomic playback browser test                                         | Remote speech recognition                                                                                                               |
| Same path supports short noise                             | Seeded noise primitive; local detector discard tests; two butterfly noise cases                                                          | Both live noise windows                                                                                                                 |
| Reusable behavior primitives                               | `ChildScenario`, authored answer helpers, shared ready/observe/evidence functions; child unit/browser tests                              | None for API implementation                                                                                                             |
| Real GPT-Live + VAD + conversation-state-v2 + reducer + UI | Live files use production `/` without mocks or injected transcripts/results; canonical mapping parser                                    | Remaining clean provider runs                                                                                                           |
| Scene progression and runtime safety assertions            | `evidence.ts` completion replay; `support-evidence.ts` hold/recovery/Stop; `butterfly-evidence.ts`; adversarial unit tests               | Provider-run assertions                                                                                                                 |
| Butterfly cancellation expressed as scenario               | Hesitant-three + barge-in/noise/filler, active-output/confirmation-stabilization/in-flight tags; trigger-window tests                    | All five live cases; user-run filler confirmation lacked a child transcript and injected no filler; revised fixture requires validation |
| Failure retains session artifact and readable timeline     | `run()` preserves report/actions/timeline before cleanup; failure/destruction/attachment tests; butterfly summaries                      | Provider failure artifacts and diagnostics review                                                                                       |
| Independent case/subset selection                          | 14 live discovery tests, distinct tags; default project excludes all live files even by explicit file filter                             | Execution of selected provider cases                                                                                                    |
| No additional deterministic LLM                            | Committed offline TTS with checksums/provenance; seeded PCM; no test-time synthesis                                                      | None for static boundary                                                                                                                |
| Unit/browser/typecheck/lint/build green                    | Full offline suite, focused evidence/trigger tests, normal browser suite, typecheck, lint, changed-file formatting, diff check and build | Record current slice results in review handoff; provider validation remains separate                                                    |

## Initial scenario behavior coverage

| Initial behavior                          | Selectable implementation and assertions                                                                                                                        | Live evidence status                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Happy path/all correct                    | `scenarios.spec.ts @happy-path`; three current authorities, render order, final completion                                                                      | Clean revised run pending                                                                    |
| Incorrect then correct                    | `@incorrect-then-correct`; heard wrong answer, canonical hold, three-second non-advance, fresh learner recovery                                                 | Clean revised run pending                                                                    |
| Self-correction                           | `@self-correction`; one continuous fixture, success only after heard settled correction                                                                         | Saved completion reported by commit-6 handoff; not rerun here                                |
| Help → scaffold → learner-led answer      | `support.spec.ts @help`; canonical helping state, tutor audio/transcript, hold, fresh learner total, full completion                                            | Saved completion and completion evidence replay reported by commit-6 handoff; not rerun here |
| Incomplete count/continuation after pause | `@incomplete`; partial count, response settlement, three-second hold, then fresh complete learner total                                                         | Pending; continuation is a new complete total, not fragment concatenation                    |
| Ambiguous or tentative answer             | `@ambiguous`; explicit unresolved two-or-three phrase; butterfly cases use hesitant correct three separately                                                    | Pending                                                                                      |
| Off-topic                                 | `@off-topic`; heard toy utterance, canonical non-completion, hold and fresh total                                                                               | Pending                                                                                      |
| Silence                                   | `@silence`; five seconds of connected silent frames and no child authority, then recovery                                                                       | Pending                                                                                      |
| Genuine interruption/barge-in             | `butterfly.spec.ts @barge-in-output`; actual output-window/VAD confirmation, earlier authority invalidation, heard current interruption and explicit held state | Pending; no prior-answer recovery permitted                                                  |
| Short noise during tutor output           | `@noise-output`; seeded 40 ms PCM, current output/VAD window, cancellation outcome plus strict completion                                                       | Pending; `@noise-confirmation` covers the late variant                                       |
| Short filler after correct answer         | `@filler-confirmation`, `@filler-classifier`; distinct voiced uh fixture, current confirmation/work identity, strict completion                                 | Pending; starvation fails strict test                                                        |
| Explicit stop                             | `support.spec.ts @stop`; parent UI authority ends and prevents further progression/capture                                                                      | Pending; spoken stop remains an audio primitive, not a guaranteed provider stop-policy test  |

The historical butterfly starvation motivates a failing product regression, but
slice 7 cannot assert it reproduces on current providers without an authorized
run. Evidence-only mode can pass evidence/safety checks with a bounded unresolved
outcome; it cannot satisfy the recovery acceptance criterion. Noise/filler strict
mode requires full safe completion. Genuine interruption requires a current
semantic held state after discarding earlier answer authority.

Commands, cost policy, artifact paths, fixture provenance and limitations are in
[the live harness guide](../tests/browser/live/README.md). Run one authorized case
at a time, review saved evidence, and retain the issue as open until the required
coverage is validated. Synthetic credentials are only for `--list`.

## Slice 7 and follow-up diagnostics validation

- Harness/diagnostics review: `npm test` passed 794 tests across 32 files. The subsequent recovery extension passed 816 tests across 34 files.
- `npm run test:browser`: 18 provider-free Chromium tests passed in an isolated source copy, preserving the running development server.
- Typecheck, lint, changed-file Prettier (including Markdown), diff whitespace check and production build passed.
- Live discovery: 14 tests; each butterfly tag selects one, noise/filler subset selects four, evidence-only mode selects five. Default suite excludes all live cases, including an explicit live file filter.
- No agent live execution was performed. The first supplied user-run filler-confirmation attempt had confirmed VAD and tutor confirmation, but no learner transcript or filler injection. The later attempt stopped at the two-duck prerequisite: canonical objective completion probability 0.87 and confidence 0.84 caused `objectiveState_no_winner`, below the unchanged 0.9 gate. No butterfly answer or filler played. A third supplied run reached butterflies, but ASR omitted hesitation words and interleaved the tutor confirmation across lines, so the textual injection checks rejected the window. Its later tutor classifier abstained at confidence 0.83. Window checks now reconstruct speaker fragments and require the current learner total without mandatory hesitation words, excluding pre-answer and older-turn prefixes. The revised fixture, prerequisite clarification and fragment checks need provider validation as mapped above.

The scheduling test's normalized-data exclusion assertion now scopes to classifier
detail, preventing generated runtime UUID digits from being mistaken for leaked
provider data. Its separate exact runtime/visit/turn/node/revision checks remain.

Slice 7 includes the following primary files:

- `docs/browser-tests.md`
- `docs/issue-30-harness-acceptance.md`
- `tests/browser/injection-window.spec.ts`
- `tests/browser/live/setup.ts` (bounded fresh learner clarification after a canonical semantic abstention in butterfly prerequisites)
- `tests/browser/live/README.md`
- `tests/browser/live/butterfly-evidence.ts`
- `tests/browser/live/butterfly.spec.ts`
- `tests/browser/live/evidence.ts`
- `tests/child-scenario.test.ts`
- `tests/fixtures/speech/barge-in.wav`
- `tests/fixtures/speech/hesitant-three.wav`
- `tests/fixtures/speech/manifest.json`
- `tests/helpers/child-scenario.md`
- `tests/helpers/child-scenario.ts`
- `tests/helpers/injection-window.ts`
- `tests/helpers/synthetic-microphone.ts`
- `tests/injection-window.test.ts`
- `tests/lesson-runtime-scheduling.test.ts`
- `tests/live-scenario-evidence.test.ts`

Follow-up diagnostics add transcript wire/parser comparison, a Samantha answer
fixture, outbound audio counters and bounded retained evidence. Their tests cover
parser uncertainty, metadata privacy, counter boundaries and retention across
Playwright cleanup. See [the comparison guide](transcript-wire-comparison.md) for
the authorized live procedure and interpretation limits. No provider recognition
or receipt is inferred from local playback or outbound counters.

The subsequent user-requested production recovery extension is separate from
the original harness issue scope. It requests fresh learner evidence once per
visit after confirmed speech with missing text or a current canonical semantic
hold. Thresholds and completion authority remain unchanged. Its provider-free
tests pass, but the latest extension has no successful live validation. The
default strict butterfly regression still requires automatic completion; the
opt-in conversational check supplies one fresh answer only after a heard recovery
prompt. See [the saved-run investigation](issue-30-filler-confirmation-investigation.md).
