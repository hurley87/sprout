# MAE386 spoken practice route — issue #76, commits 6–7

`/demos/mae386` uses `MAE386_LESSON`, the shared voice-demo lifecycle and controls,
and the existing WebRTC/classifier/assessment runtime. `?debug=1` opts into the
transcript, secondary assessment diagnostics, event identities and export. Export
retains the full conversation, evidence/proposal provenance, navigation history
and frozen question outcomes; UI event summaries omit private rubric payloads.

The current prompt is the only task displayed. Q10 shows one exact original
sentence with an oral rewrite instruction; Q5 shows one case description. Their
three authored nodes each count as one parent question, so progress remains eight
questions. Help and Repeat append bounded app instructions through the existing
steering acknowledgment gate, without synthesizing learner speech. Skip this part
and Skip whole question use the existing authored navigation scopes; spoken
navigation remains unchanged. Stop is always available during a live session.

The visible eight-question recap reads `snapshot.questionRecap` directly, including
mixed subpart statuses, without projecting a second result from live evidence or
secondary assessment. Early Stop labels the recap **Session ended early** and
releases media immediately. Natural completion uses the same frozen outcomes for
spoken and visible claims. There are no exam marks or pass/fail judgments.

## Deterministic coverage

- `tests/mae386-presentation.test.ts`: every authored prompt/source, stable grouped
  progress, private criterion exclusion, all outcome labels, frozen eight-question
  recap and component detail.
- `tests/mae386-controls.test.ts`: Help/Repeat quiet, speech, steering and terminal
  gates; unique acknowledgment identities; no invented evidence or transcript;
  counting behavior remains unchanged.
- `tests/browser/mae386.spec.ts`: actual route/debug flag, narrow-screen layout,
  Q10 sentences and Q5 cases, UI support/skip, restart, immediate Stop teardown,
  late failed assessment with unchanged recap/export, and natural spoken/visible
  recap agreement. The shared local WebRTC fixture is extracted from the existing
  Catching Unicorns browser suite. Both suites enforce the same 2,000-byte
  authored-English regression budget; no per-route override masks rejection.
- `tests/mae386-append-budget.test.ts`: exact content hashes bind all 47 actual
  teaching, Help/Repeat, recovery and terminal-outcome appends to offline token
  measurements. The full rubric/provenance remains in the classifier and export;
  Live receives compact current prompt/source, private topic anchors and safe tutor guidance.
- Pending Help/Repeat regression cases cover active playback, whole/fragmented
  authenticated Stop, separate learner turns, late acknowledgment, late transcript,
  quoted/reported/negated/extended speech, and connection/visit isolation.

The [official Live session guide](https://developers.openai.com/api/docs/guides/live-conversations)
limits append content to 500 tokens. The current 47 messages measure at most 294
`o200k_base` / 297 `cl100k_base` tokens, with a 450-token test ceiling. These are
regression proxies rather than the provider's exact tokenizer. Any message edit
invalidates its measured hash. To recalibrate with an environment containing
`tiktoken`:

```sh
SPROUT_APPEND_BUDGET_INPUT=.sprout-evidence/append-input.json npm test -- tests/mae386-append-budget.test.ts
python3 scripts/measure-live-append-budgets.py .sprout-evidence/append-input.json tests/fixtures/mae386-append-token-budgets.json
npx prettier --write tests/fixtures/mae386-append-token-budgets.json
npm test -- tests/mae386-append-budget.test.ts
```

The first command can fail stale-hash assertions while still writing the explicit
calibration input. Recalibration must retain the 450-token ceiling and the exact
current-node source; it is not permission to raise the provider limit.

Same-node support appends now identify their own steering kind. They do not hold
back authenticated learner transcripts or reset the confirmed visit floor. Stop
uses the normal direct-command parser and local ended-turn identity, including
while support acknowledgment or tutor playback is pending. Other classification,
new-scene steering and timeline gates remain unchanged.

Browser cases use local peers and synthetic microphone infrastructure, with
provider credentials disabled. They do not constitute actual GPT-Live/Jev
microphone acceptance. Commit 7 adds the assessment/regression matrix below;
real microphone acceptance and inspection of its exported diagnostics remain
commit 8. No live reliability claim or fabricated acceptance evidence is included.

## Commit 7 assessment and browser regression matrix

Reconciled against current [issue #76](https://github.com/hurley87/sprout/issues/76)
and the typed rubrics/examples in `lib/lesson-runtime/mae386/`. Those examples remain
the sole authored expectations. This commit adds tests and validation notes only;
it introduces no answer key, production grader or runtime refactor. Formative
outcomes remain separate from closure, cumulative mastery and secondary review.

| Boundary                                                                                 | Coverage and evidence limit                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual classification route → Jev response validation/mapping → reducer → frozen outcome | `mae386-assessment-flow.test.ts` uses 27 selected authored examples across all seven non-editing questions, plus a rejected tutor-owned Q14 locator. Checks exact learner text, node/visit/revision and local turn identity; earlier speech first classified in a later snapshot retains a null turn ID. Jev responses, source choices and confidence are mocked.                                                                                                               |
| Reasoning and assistance                                                                 | Q1 paraphrase and helped application; Q6 explanations missing examples versus alternate complete examples; Q12 preserves unaided dimensions while education/synthesis are helped. Tutor reasoning cannot become learner evidence through a forged locator.                                                                                                                                                                                                                      |
| Special conceptual boundaries                                                            | All three Q5 cases accept authored justified uncertainty under discovery necessity; digital/printed-afterward shortcuts fail. Q8 contrasts sound decoding, letters-only, missing advantage, misconception and ambiguity. Q14 covers two distinct arguments, one reason, duplicate examples and cognitive-inferiority misconception. Q15 covers prediction without optional limits, MRI, qualified critique, model improvement and unresolved belief.                            |
| Q10 actual two-stage classifier requests                                                 | `mae386-rewrite-classifier.test.ts` adds two authored alternatives per original, after an earlier poorer proposal. Only selected words and that original enter the assessment request. Unchanged-source rejection now covers all three originals. Existing proposal/runtime tests cover echoes, self-correction, worsening latest answers, withdrawal, spans, help, authenticated turn mapping and cumulative-ledger independence. Semantic selection and judgments are mocked. |
| Actual browser lifecycle and downloaded JSON                                             | `browser/mae386.spec.ts` adds independent/partial/incorrect answers, subpart then whole-parent skips, unvisited sibling detail, natural completion, eight frozen outcomes, spoken/visible snapshot agreement and exported original attempt text. A deliberately contradictory successful secondary assessment cannot change the snapshot. Local WebRTC peers, synthetic microphone audio, injected transcripts and mocked classifications exercise choreography only.           |
| Preserved regression coverage                                                            | Existing MAE386 browser cases cover early endings, Stop during pending support, media teardown, restart and late failed review; runtime suites cover fragmented authenticated skip/Stop, render identity, final-observation drain and frozen recap races. Full provider-free browser execution also includes the root/counting and Catching Unicorns routes. The unchanged content-hashed append-token fixture remains mandatory.                                               |

No paid provider request or actual learner microphone acceptance is part of this
matrix. In particular, matching an authored label supplied by a test does not
establish Jev semantic accuracy, GPT-Live tutor quality or speech recognition
reliability. Commit 8 still requires actual GPT-Live/Jev microphone scenarios and
inspection of their exports with date, SHA, flags and expected/observed paths;
synthetic text/audio must never be presented as that evidence.

## Validation notes

Commit 6 baseline, validated October 21, 2026:

- `npm test`: 1,781 tests across 81 files passed.
- `npm run test:browser -- tests/browser/mae386.spec.ts tests/browser/catching-unicorns.spec.ts tests/browser/lesson.spec.ts --workers=1`:
  all 18 passed (5 new-route cases plus 13 existing demo/root cases).
- `npm run lint`, `npm run typecheck`, `npm run build`, changed-file Prettier and
  `git diff --check` passed. The production build lists `/demos/mae386` alongside
  the existing root and Catching Unicorns routes.
- Q10 source and early-Stop recap mobile screenshots were visually inspected;
  screenshots are local test artifacts, not actual provider-session evidence.

Commit 7, validated October 21, 2026, against approved parent
`659b2f710e306f4b7a8ef66c81b5cd248e7221c6`:

- `npm test`: 1,817 tests across 82 files passed (36 additional tests).
- `npm run test:browser -- --workers=1`: all 35 provider-free browser tests
  passed, including all six MAE386 cases and existing root/Catching Unicorns
  regressions. The new mixed-outcome case also passed in isolation.
- `npm run lint`, `npm run typecheck`, `npm run build`, changed-file Prettier
  (including an explicit Markdown check) and `git diff --check` passed.
- No production change was necessary. Initial new-test failures were fixture
  assumptions about partial helped work, historical turn attribution, microphone
  initialization and fresh playback before navigation, corrected in test setup.

The full repository format check currently reports 41 pre-existing files outside
this commit's changed paths. Changed files are checked separately without
reformatting unrelated implementation or historical experiments.
