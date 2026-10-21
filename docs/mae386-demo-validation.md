# MAE386 spoken practice route — issue #76, commit 6

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
microphone acceptance. The broader assessment/regression matrix remains commit 7;
real microphone acceptance and inspection of its exported diagnostics remain
commit 8. No live reliability claim or fabricated acceptance evidence is included.

## Validation notes

Validated October 21, 2026:

- `npm test`: 1,781 tests across 81 files passed.
- `npm run test:browser -- tests/browser/mae386.spec.ts tests/browser/catching-unicorns.spec.ts tests/browser/lesson.spec.ts --workers=1`:
  all 18 passed (5 new-route cases plus 13 existing demo/root cases).
- `npm run lint`, `npm run typecheck`, `npm run build`, changed-file Prettier and
  `git diff --check` passed. The production build lists `/demos/mae386` alongside
  the existing root and Catching Unicorns routes.
- Q10 source and early-Stop recap mobile screenshots were visually inspected;
  screenshots are local test artifacts, not actual provider-session evidence.


The full repository format check currently reports 41 pre-existing files outside
this commit's changed paths. Changed files are checked separately without
reformatting unrelated implementation or historical experiments.
