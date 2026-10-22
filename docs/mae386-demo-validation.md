# MAE386 spoken practice route — issue #76, commits 6–8

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

## Final acceptance review — October 22, 2026

**Not ready for merge: current-code microphone acceptance remains unverified.**
Automated verification below tested `819758fba241722b6c56d86fb1683950944d37aa`.
This validation commit changes documentation only; no runtime, classifier, rubric,
threshold, UI or test assertion is changed. Earlier sections retain the results
and limitations at their historical SHAs, not a current acceptance sign-off.
The current append fixture has 48 messages, at most 378/384 offline proxy tokens;
the earlier 47-message counts below describe older code.

### Evidence reconciled before testing

| Scenario                                                  | Existing evidence                                                                                                                                                                                                                                                                                                            | Current-code human microphone status                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Q10 correct paraphrases and disfluencies                  | October 21 initial run at `918fccbc5ffbc1df2b3146bf6ddab06023048f20`: Q10-1 accepted; Q10-2 locator confidence unresolved. October 22 captured Q10-1/2 texts pass actual Jev replay and deterministic frozen projection after subsequent fixes.                                                                              | Unverified after the latest fixes; replay does not exercise streaming speech.                             |
| Q10 correction, poorer replacement, withdrawal and echoes | `mae386-rewrite-proposal`, `mae386-navigation-runtime`, `mae386-rewrite-classifier` and `mae386-historical-evidence` tests cover exact words, latest proposal, withdrawal, source/tutor echoes and authenticated turn identity. Provider judgments in these cases are mocked, except the explicitly retained replay outputs. | No complete historical live matrix; unverified.                                                           |
| Q10-3 variations and optional nuance                      | Current source-grounded rubric and regression cases accept use-based variants, with building/toolkit detail optional. Earlier live unresolved outcomes are not regraded by that calibration.                                                                                                                                 | Unverified under current code.                                                                            |
| Useful help and assisted learner application              | October 21 help run at `7a87b3664de5f0f44d28ee8e0d2fabcc8f430c5e` observed one useful Q8 Help-button explanation, but no accepted assisted demonstration; Q5 and spoken requests were not exercised. Help/source-block tests use mocked judgments.                                                                           | Full spoken help → application → assisted source chain unverified.                                        |
| Neutral acknowledgments and fragmented evidence           | Historical Q6 failure led to source-block and textless-turn fixes. Actual Jev text replays accept captured explanations; runtime tests bind original words/turns without crediting textless activity.                                                                                                                        | Fresh natural pauses, backchannels and final outcomes together unverified.                                |
| Subpart/parent navigation, fragmented commands and Stop   | Unit tests cover direct versus quoted/negated commands, identity gates and fragments. Browser tests use local WebRTC peers, synthetic media and injected transcripts. Historical initial run observed UI Stop, not spoken Stop or explicit parent skip.                                                                      | Spoken next-part/next-question, accidental-command resistance and spoken Stop unverified on current code. |
| Eight groups, mixed outcomes and immutable recap          | Historical initial run observed eight frozen groups and a later secondary review without mutation, but early Stop meant no natural spoken recap. Browser/runtime tests cover mixed natural completion, render-confirmed freeze, contradictory late review and media teardown with fixtures.                                  | Current natural provider-spoken/visible agreement and late-result behavior unverified.                    |

See [evidence/recap follow-up](mae386-evidence-recap-followup.md),
[Q6 replay](mae386-q6-followup.md), [help observations](mae386-help-response.md),
[recovery observations](mae386-recovery-expiry.md), and the
[artifact provenance index](evidence/README.md). Actual Jev text replay is a
separate evidence class from both deterministic mocks and actual GPT-Live + Jev
microphone acceptance. No earlier recording was revalidated in this review.

### Automated verification

- `npm test`: **1,960 passed across 92 files**.
- `npm run test:browser -- --workers=1`: **35/35 passed** (3.1 minutes),
  including all six MAE386 cases and the existing root/Catching Unicorns and
  transport regressions.
- `npm run lint`: passed.
- `npm run typecheck`: passed (`next typegen && tsc --noEmit`).
- `npm run build`: passed with the default production bundler; `/demos/mae386`
  is present in the route output.
- `npx prettier --ignore-path /dev/null --check docs/mae386-demo-validation.md`
  and `git diff --check`: passed. The explicit ignore override is required because
  the repository normally excludes Markdown from Prettier.
- No automated failures were observed; no application or test changes were needed.
  Logs and their hashes are retained locally in the ignored directory
  `.sprout-evidence/pr79-validation-2026-10-22/`.

The full browser command uses the checked-in configuration on port 3100, refuses
to reuse another server, and explicitly empties both provider credentials. Its
local peers, synthetic microphone and mocked classifications exercise application
choreography only. The separately named `test:browser:live` suite uses automated
speech fixtures for other scenarios and is not this manual acceptance plan.
No actual provider calls, text replay or new microphone sessions were run here.

### Manual setup and evidence protocol

The invoking process has no provider keys, and this worktree has no `.env.local`.
The primary checkout has both key names in its local credential file (values were
not displayed or copied). A human microphone and listening participant are still
needed: this text-only agent session cannot deliver human speech or independently
hear the real tutor. Browser automation with synthetic audio would not satisfy
that requirement. Consequently all runs below are **unverified**, with no new
live pass or fail assigned.

1. In a terminal, use this chat's worktree and record the exact checkout identity:

   ```sh
   cd /Users/davidhurley/.codex/worktrees/9914/sprout
   git switch codex/76-mae386-spoken-practice
   git rev-parse HEAD
   git status --short
   mkdir -p .sprout-evidence/mae386-acceptance-2026-10-22
   ```

   Keep the tree clean. Test the pushed documentation commit or a later explicitly
   recorded SHA; the automated baseline above remains `819758f`. Record SHA,
   date/time with timezone, browser, actual input device and scenario IDs in a
   local notes file. The UI export does not itself attest the Git SHA.

2. Check that port 3100 is free (`lsof -nP -iTCP:3100 -sTCP:LISTEN`). Wait for the
   automated browser suite to finish; do not reuse its credential-free server.
   Load credentials into the terminal environment using your normal local setup.
   On this machine, the existing dotenv file can be loaded without forwarding
   Node's `--env-file` through Next's child processes:

   ```sh
   node --env-file=/Users/davidhurley/Desktop/sprout/.env.local --input-type=module -e '
   import { spawn } from "node:child_process";
   for (const name of ["OPENAI_API_KEY", "TYPESAFE_API_KEY"]) {
     if (!process.env[name]?.trim()) throw new Error(`${name} is missing`);
   }
   const child = spawn(process.execPath,
     ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"],
     { stdio: "inherit", env: process.env });
   child.on("exit", code => process.exit(code ?? 1));
   '
   ```

   These sessions use billed providers. Keep the configured GPT-Live/Jev models
   and thresholds unchanged. Do not run Playwright, fake microphone flags, an
   observer bridge, transcript injection or response interception for these runs.

3. Open `http://127.0.0.1:3100/demos/mae386?debug=1` in ordinary Chrome, select the
   real microphone, allow access, and click **Start practice**. Keep the tab
   foreground: hiding/leaving it stops the session. Listen to the actual tutor;
   its transcript alone cannot prove audible delivery. No focused-start route is
   implemented at this SHA. Reach Q10 by using **Skip question** at Q1/Q6/Q8 when
   a run below starts at Q10; setup skips are not spoken-navigation evidence.
4. Start a fresh session for each run below so help and prior evidence cannot
   leak between cases. At each utterance, note node/visit and exact heard words.
   If the tutor closes a subpart before the required replacement, the replacement
   case is unverified; do not inject text, force state or count a new visit as a
   same-visit replacement. Stop and export that attempt before restarting.
5. While still foreground, open **Session details → Export session** at recap
   entry, then export again after secondary assessment settles (complete or
   unavailable). At an ended session use **Download diagnostics**. Copy each
   `sprout-mae386-<runtimeId>.json` into the ignored directory above with unique
   run/phase subdirectories, keeping its original basename; never overwrite the
   first snapshot. Run `shasum -a 256 <local-export-path>` and record file bytes,
   runtime ID and SHA-256 in local notes. Keep every attempt, including failures.
   Full JSON stays out of Git; commit only a concise reviewed result table.

### Spoken scenario scripts and expected results

Prepared answers below are evaluation scripts grounded in the current rubrics,
not evidence of unaided subject knowledge. Independent means relative to tutor
assistance within that session. Tutor praise alone never establishes acceptance.
For replacement cases, keep the same Q10 visit and inspect its proposal history;
if the initial success never settled, record that limitation rather than claiming
that an earlier accepted proposal was replaced.

| Run / scenario                                   | Say or do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Expected behavior and diagnostic check                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A — correct Q10 variants                         | At Q10-1: “Because he overslept, he was late.” At Q10-2: “They worked together on the project.” At Q10-3: “He uses habits, heuristics, and external scaffolds to think.” Let the tutor finish each response.                                                                                                                                                                                                                                                                                        | All three preserve core meaning with genuine shortening and coherent spoken grammar. Current selected words must be learner-owned and criteria settled before calling the outcome accepted. Q10-3 must not demand toolkit/building detail as a condition for credit; optional nuance feedback is allowed.                                                                                                                                                                                  |
| B — incomplete → complete; alternate Q10-3       | At Q10-1: “Because he overslept.” If asked to clarify, answer “He was late because he overslept.” At Q10-2 use “They collaborated on the project.” At Q10-3: “His — he uses habits, heuristics, and external scaffolds he builds to think.”                                                                                                                                                                                                                                                         | Latest complete proposal, not the fragment, supplies all selected words. The abandoned “His” is a speech repair, not a grammar penalty. Q10-3's building-restored variation is accepted without requiring toolkit composition. If the tutor advances after the fragment, record the failed/unfinished path.                                                                                                                                                                                |
| C — good → poorer replacement                    | At Q10-1: “He was late because he overslept. I am still considering my final sentence.” Before departure, replace it with “Actually, my final answer is: He overslept because he was late.” Then finish the discussion.                                                                                                                                                                                                                                                                             | Latest proposal reverses causality and must not retain earlier meaning success. Inspect history to establish the earlier successful proposal actually settled, then verify current/frozen rewrite criteria belong only to the replacement. Cumulative conceptual evidence must not masquerade as current Q10 acceptance. If same-visit replacement was not achieved, leave the scenario unverified.                                                                                        |
| D — explicit withdrawal                          | At Q10-1 give the correct sentence, then before departure say “I withdraw that answer. I am not submitting a rewrite.” Say “Next” only after withdrawal is heard.                                                                                                                                                                                                                                                                                                                                   | Withdrawal appears in current proposal/history; no earlier good answer is resurrected. The final component must not be accepted on that withdrawn rewrite. If already advanced, the case was not exercised.                                                                                                                                                                                                                                                                                |
| E — source/tutor echoes                          | At Q10-1 read “The reason why he was late is that he overslept,” prefaced with “I am quoting the original, not submitting an answer.” Request a hint. If the tutor actually supplies a full rewritten sentence, quote its exact words with “You said …; that is a quotation, not my submission.”                                                                                                                                                                                                    | Source access and a quoted tutor solution earn no learner rewrite credit. Inspect selected words, source ownership and no accepted current rewrite. Do not invent a tutor solution: if none is supplied, source-echo can be evaluated but tutor-solution-echo remains unverified live. A genuine later application would be a different assistance case.                                                                                                                                   |
| F — spoken help and assisted application         | Reach Q8 using setup skips. Say “Can you explain how phonetic writing works?” Listen for an actual explanation, not a promise. Then say “I could sound out an unfamiliar written name and recognize a name I already know when spoken. The marks encode speech sounds rather than pictures of meanings.” If additional requested guidance is needed, record it.                                                                                                                                     | Useful spoken guidance precedes the learner's own applied explanation. Tutor content alone earns no credit. Accepted criteria whose mechanism was supplied by the tutor retain prompted/assisted provenance and the learner's actual application span. Uncertain or incomplete evidence is recorded as such, not forced to assisted success. Separately repeat with the **Help** button only if current button-path live evidence is needed; do not count that as the spoken-request case. |
| G — neutral backchannels and pauses              | At Q6: “System 1 is fast and automatic; System 2 is slower and deliberate.” Continue: “When driving, I brake immediately when a ball rolls into the road …” pause 1–2 seconds, allow a neutral “mm-hmm” if offered, then “… and deliberately consider whether to stop or steer based on traffic.” Use a natural restart, such as “I brake — I brake immediately.”                                                                                                                                   | No false skip/Stop or invented words during pauses. The complete explanation/example span retains original learner identities across neutral acknowledgments; a backchannel alone does not turn it into assisted or invalidate it. If the tutor supplies substantive answer content, record assistance instead; neutral-only attribution was then not exercised. Inspect transcript bindings and final retained Q6 criteria, including any textless recheck.                               |
| H — spoken subpart versus parent navigation      | Fresh run at Q10-1: quote “He said ‘next question’ in the story,” then stay quiet 2 seconds. Say “Next.” At Q10-2 say “Next question.” At Q5-a say “Next,” then at Q5-c say “Next question.”                                                                                                                                                                                                                                                                                                        | Quoted words and silence do not navigate. Direct Next reaches Q10-2 or Q5-c; Next question reaches Q5-a or Q12, skipping remaining siblings. Progress stays Question 4/8 through Q10 and 5/8 through Q5. Log navigation scope, learner source identity and skipped sibling IDs; do not infer it from tutor speech alone.                                                                                                                                                                   |
| I — explicit Stop                                | Fresh session: request Help, then say “Stop” during or just after tutor playback. Observe that session ends and the browser microphone-use indicator clears. On another fresh session click **Stop** during a pause.                                                                                                                                                                                                                                                                                | Spoken Stop ends after the authenticated command is received/end of learner speech without waiting for classifier or Help acknowledgment; UI Stop releases immediately. Eight outcomes freeze with unreached questions distinguishable. Note physical/browser teardown separately: JSON alone does not measure actual device-release latency.                                                                                                                                              |
| J — mixed natural completion and immutable recap | Fresh full run: Q1 explain “Writing makes abstract ideas visible so we can combine them, and stores ideas outside limited short-term memory.” At Q6 give definitions only, deliberately omit examples, then say Next if probed. At Q8 use run F. At Q10 use A. At Q5-a say Next question, leaving its cases unanswered. At Q12 say “Literacy is one characteristic,” then move on without supplying the rest. Skip Q14 and Q15 explicitly; let the app enter its natural recap and finish speaking. | Eight groups in order Q1, Q6, Q8, Q10, Q5, Q12, Q14, Q15. Inspect retained evidence rather than assume scripted labels: complete Q1/Q10, partial Q6/Q12, assisted Q8 if accepted, and unanswered/skipped components remain distinguishable. Compare every audible claim and displayed component with the frozen recap; no unsupported upgrade or added mark.                                                                                                                               |
| J — recap freeze / late results                  | At render-confirmed recap entry export once; after secondary review and spoken completion export again without restarting. Note actual late `classifier`/`assessment` events if any.                                                                                                                                                                                                                                                                                                                | `questionOutcomes` remains deeply equal across exports and `questionRecap.questions` agrees. Compare audible delivery to `questionRecap.spoken` as well as visible labels. Actual late arrivals must not change the snapshot. If no result arrives after freeze, immutable stability was observed but the live late-result race remains unverified; do not delay/inject a provider response to fabricate that observation.                                                                 |

### Inspect and report each live result

Use original event array indexes (or retained `sourceEventIndex` in a curated
extract), timestamps/`atMs`, runtime/visit/node/turn/revision identities, transcript
and selected proposal text. Inspect `classifier.mapping`/`classifier.result`
outputs and confidence, rewrite selection/assessment and history, assistance
source, navigation records, `lesson.ended`, `assessment.completed`, frozen
`questionOutcomes` and `questionRecap`. Locate fields in the full report or its
`runtime`; do not infer acceptance from a single preferred model label below the
unchanged confidence gate. A paid text replay cannot fill a missing microphone
observation. Never publish credentials, SDP, full session JSON or raw bodies.

For every completed scenario, add one compact record using this schema:

| Scenario                              | Tested SHA / local date and runtime | Expected          | Observed                            | Diagnostic file SHA-256 / event identities | Status         |
| ------------------------------------- | ----------------------------------- | ----------------- | ----------------------------------- | ------------------------------------------ | -------------- |
| A–J (one row per exercised assertion) | Pending                             | As scripted above | No current-code human run performed | None                                       | **Unverified** |

Use **pass** only when expected behavior and required evidence were observed;
**fail** when a valid exercised path contradicts them; **unverified** when timing,
missing inputs, uncertain assessment or absent late arrivals prevent a conclusion.
Keep historical failures at their original SHAs. No new live failure has been
claimed from this environment, and no current live pass has been inferred from
older recordings, synthetic tests or Jev replay. Complete and review the required
microphone rows before marking this PR ready to merge; do not merge as part of
this validation commit.

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

## Commit 8: actual microphone evidence, October 21, 2026

**Acceptance remains incomplete.** This human microphone run exposed tutor and
assessment problems and did not exercise several required scenarios. It is useful
failure evidence, not a successful acceptance sign-off. No production fix, new
provider replay, synthetic replacement dialogue or additional paid run was made.

### Identity and reproducibility

- Tested code: `918fccbc5ffbc1df2b3146bf6ddab06023048f20`, branch
  `codex/76-mae386-spoken-practice`, verified before setup and after export review.
  This evidence-only commit is parented to that code. Source files were unchanged
  during the run. Original untracked `output/` teacher packet remains unstaged.
- October 21, 2026, **15:49:55–16:03:38 America/Toronto**
  (`19:49:55.577–20:03:38.808 UTC`), approximately 13 minutes 43 seconds.
- Built UI: `http://127.0.0.1:3100/demos/mae386?debug=1`, Chrome.
  Only `debug=1`; normal production runtime/provider paths, no observer bridge,
  transcript injection, synthetic microphone or mocked provider responses.
  The human confirmed participation and supplied the downloaded JSON. Prepared
  sample answers were supplied beforehand; this is scripted product evaluation,
  not evidence of unaided subject knowledge.
- Server configuration at tested SHA: `gpt-live-1`, voice `marin`, `store: false`;
  Jev `jev-1.14.0`, `conversation-state-v2`, unchanged thresholds. Model identities
  are code configuration, not independent attestations from raw provider bodies.
  Only presence of `OPENAI_API_KEY` and `TYPESAFE_API_KEY` was checked/reported.
- A dedicated Next dev server was started in the approved worktree on free port
  3100, passing the existing local credential configuration through the child
  environment. No unrelated server was stopped. Initial direct `node --env-file`
  launches failed locally because Next forwarded the flag through `NODE_OPTIONS`;
  spawning Next without inherited exec arguments resolved setup before the run.
- Actual microphone settings (event 3): mono, 48 kHz, 16-bit samples, latency
  0.01 seconds; echo cancellation, noise suppression and auto gain enabled.
- Runtime: `c7d94b28-b76b-4ed1-9493-d008cb58d2d9`; 13,009 diagnostic events,
  73 classifier starts, 57 normalized mappings, 51 results, 6 abstentions and
  22 cancellations. Counts include superseded work, not unique accepted answers
  or a billable-request total.

Actual downloaded export (unchanged, local only):

`/Users/davidhurley/Downloads/sprout-mae386-c7d94b28-b76b-4ed1-9493-d008cb58d2d9.json`

- Bytes: `191872443` (approximately 183 MiB).
- SHA-256: `0087844c0cde63217c2d4900ed337eb6e752b4f5d0daae902539a96edf6eb227`.
- Locally retained scrubbed projection:
  `mae386-live-2026-10-21-c7d94b28.json` (see the
  [historical artifact archive](evidence/README.md)).
  It preserves full visit conversations, final evidence/proposal provenance,
  navigation, frozen outcomes, secondary review and 279 selected diagnostics with
  zero-based `sourceEventIndex` back into the original export. Repeated runtime
  snapshots, detector windows and transient transcript snapshots are omitted;
  steering retains only identity and displayed scene, and the ending event retains
  its reason. This is an extract, not a new UI export. Credential/SDP/raw-body keys
  are recursively excluded; none were present in the selected projection.
  Extract SHA-256: `bf261c610b79a0e3a861beb3821dfa32539c49553e39262e3a71c31d65dc517f`.
  The original remains available to inspect omitted timing windows.

### Expected versus observed

Q10-3 calibration update: the table below preserves the original observation and
its then-current interpretation. The user subsequently accepted the use-based
rewrite as correct with optional nuance loss; composition/building details are
no longer required for credit. See [the current Q10 feedback standard](mae386-rewrite-feedback.md).
The historical unresolved outcome is unchanged.

| Scenario / expectation                                                  | Actual observation and provenance                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result / limit                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 own explanation, independent evidence                                | Both functions recorded from learner text. Reification source: visit 1, turn 3, revision 28; memory extension: turn 6, revision 55. Frozen Q1 is independent. Tutor acknowledgment remains separate.                                                                                                                                                                                                                                                                         | Observed; independence means relative to the in-session tutor, not independence from the prepared script.                                                                                                                                                 |
| Q10 unchanged source echo earns no rewrite credit                       | The original appears only in the tutor prompt. The learner instead said “He was late because he overslept.” Current proposal has six learner words, turn 40, revision 456; all three criteria demonstrated.                                                                                                                                                                                                                                                                  | Correct alternative observed; learner-source echo rejection was **not exercised live**.                                                                                                                                                                   |
| Q10 self-correction and latest poorer/withdrawn replacement             | Each sentence has one learner proposal. No Q10 correction, poorer replacement or withdrawal is in the retained conversation or proposal history. The rhyme answer contains a self-correction, but that does not test Q10 projection semantics.                                                                                                                                                                                                                               | **Not exercised live**; deterministic coverage does not substitute for the required live Q10 correction.                                                                                                                                                  |
| Q10 second sentence accepts a meaning-preserving revision               | “They, yeah, they collaborated on the project” is heard. At revisions 491 and 502, Jev's preferred start probabilities are 0.64 and 0.72, below the 0.9 gate. Final assistance probability 0.85 is also below threshold. The app falls back to `start: none`, assistance unknown, empty words, null selected text and `rewriteAssessment: not_requested`; the frozen subpart is unresolved. Tutor nevertheless says it keeps the meaning and moves on. Events 5622 and 5799. | Observed assessment limitation: a plausible spoken revision receives no settled rewrite assessment. The model returned valid candidate locators; confidence gating, not a nonexistent provider locator, causes the fallback. No false independent credit. |
| Q10 third sentence preserves meaning; tutor avoids unsupported approval | Learner says “He uses habits, heuristics, and external scaffolds, to think,” omitting toolkit composition and the building relationship. Jev prefers meaning incorrect (0.61 then 0.52), below threshold, so final criteria remain unresolved. Tutor says “that keeps the meaning and trims the extra words.” Events 6206 and 6341.                                                                                                                                          | Tutor approval conflicts with the authored preservation requirement; recap conservatively remains unresolved. This is one proposal, not a latest-poorer replacement test.                                                                                 |
| Help delivers substance, followed by assisted application               | Q8: learner asks “Yeah, can you explain it” and “Are you explaining it”; tutor replies “Sure!” and “I'll take a swing at connecting that idea,” without the explanation before the UI skip. Q5-f: “What's the discovery test” gets “lemme just put that idea in plain words,” with no definition before the learner answer. Later tutor feedback does supply the tinkering/diagrams distinction, with no later learner application. No Help/Repeat button event exists.      | Help fulfillment problem observed. No successful help → learner application → assisted outcome chain is established. Do not relabel independent/uncertain evidence as assisted solely because help was requested.                                         |
| Subparts stay under Q10/Q5; explicit next versus next question differs  | All three Q10 nodes and all three Q5 nodes are visited in order; steering scene `questionId` remains q10 or q5. Each departure is tutor closure. Only explicit UI skip is ordinary Q8, scope subpart. No parent-skip command or skipped sibling exists.                                                                                                                                                                                                                      | Authored tutor closure observed; explicit subpart-versus-parent navigation **not exercised live**. JSON establishes grouped identities, not a screenshot of visible progress.                                                                             |
| Q12 receives and responds to the spoken answer                          | The final answer is in both the visit transcript and classifier request at revision 1212, event 12782. Tutor then says “I didn't catch your answer. Are you still there?” and asks for the answer again. Earlier app recovery was requested at 746733 ms (events 11968/11970); the final answer snapshot arrives at 811448 ms and the check-in transcript at 816098 ms.                                                                                                      | Recovery/tutor timing problem observed. The export proves an earlier app missing-text request and a later misleading check-in; it does not prove the internal provider scheduling cause or an audio-device fault.                                         |
| Explicit early Stop releases session, freezes all eight outcomes        | One `lesson.ended`, event 13007 at 822864.9 ms, reason `parent_stop`, phase stopped, lessonComplete false, label “Session ended early.” No spoken stop is in the transcript: this is UI Stop. Q14/Q15 remain unattempted. No transcript events follow Stop.                                                                                                                                                                                                                  | Early-stop state observed. Export alone does not instrument ended capture-track state or verify physical media-release latency; deterministic browser teardown coverage supplies that check.                                                              |
| Late secondary assessment does not rewrite recap                        | `assessment.completed`, event 13008, arrives approximately 368 ms after Stop. Final `questionOutcomes` equals the snapshot in the original ending event and `runtime.questionOutcomes`; `questionRecap.questions` matches it exactly. Secondary Q6 judgments differ, but the frozen Q6 stays partial.                                                                                                                                                                        | Observed: secondary review does not overwrite frozen claims. No natural spoken recap occurred.                                                                                                                                                            |

Final frozen question outcomes, in authored order:

| Question | Outcome     | Component detail                                                                                                                      |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Q1       | Independent | Both functions recorded from learner sources.                                                                                         |
| Q6       | Partial     | System 2 description/example retained; System 1 evidence not retained in live snapshot. Secondary review differs without changing it. |
| Q8       | Unresolved  | Reached and explicitly skipped after help request.                                                                                    |
| Q10      | Unresolved  | First sentence independent; second and third unresolved.                                                                              |
| Q5       | Unresolved  | ChatGPT unresolved; rhyme partial; spindle unresolved.                                                                                |
| Q12      | Unresolved  | Reached; no settled demonstration before Stop.                                                                                        |
| Q14      | Unattempted | Not reached.                                                                                                                          |
| Q15      | Unattempted | Not reached.                                                                                                                          |

### Verification and follow-up boundary

Re-read the actual downloaded JSON, verified original byte count/hash, inspected
all ten visit conversations and Q10 histories, and compared source runtime/visit/
turn/revision identities. Equality checks establish eight groups and the same
frozen snapshot in final runtime, ending-event runtime and recap. No post-Stop
transcript snapshot exists. The source export lacks independent capture-track
teardown instrumentation and raw provider model attestation; do not infer those
from the absence of further events.

Focused deterministic verification on tested code:

```sh
npm test -- tests/mae386-recap-runtime.test.ts tests/mae386-question-outcomes.test.ts tests/mae386-navigation.test.ts tests/mae386-rewrite-proposal.test.ts
```

All **137 tests across four files passed**. Existing commit 7 browser coverage
(`natural recap renders all eight frozen questions and speaks the same snapshot`,
plus mixed-outcome/secondary-review coverage) supplies the other ending's
provider-free check; the reviewed baseline is 35 passing browser tests. It was not
rerun against the credential-enabled acceptance server. That coverage does not
establish a natural provider-spoken recap.

Remaining acceptance needs: Q10 learner-source echo, spoken correction and latest
poorer/withdrawn proposal; a fulfilled hint followed by learner application with
assistance provenance; explicit subpart versus parent navigation. Escalate the
observed uncertain-span behavior, unfulfilled help, unsupported rewrite praise and
misleading recovery check-in for product review before substantive fixes. The
large export is a separate diagnostic-size concern. No threshold adjustment,
prompt edit or runtime change is included here. Any substantive fix requires
fresh live evidence at its new SHA. A single session cannot establish semantic
reliability, even after remaining scenarios are covered.
