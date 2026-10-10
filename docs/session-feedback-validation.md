# Session feedback validation, 9 October 2026

Commit 7 validates the six session-feedback slices on branch `codex/session-feedback-quality`, parent `050a06d46ae1c0d163634f7a9e52db64cdd2c038`. Production code is unchanged. This is a validation record, **not completed live acceptance**.

## Revision and reproducibility

The tested production revision is exactly the parent above. The candidate test diff is identified below by SHA-256 of `git diff 050a06d46ae1c0d163634f7a9e52db64cdd2c038 -- tests/browser/catching-unicorns.spec.ts tests/session-summary-runtime.test.ts`; documentation and sanitized replay results are additional validation artifacts, not production changes.

Test diff SHA-256: `36c21aef80da78218b9570a26e12c44db842d0d96d23f9a0316ae552dc4a05a3`.

| Candidate file | SHA-256 |
| --- | --- |
| `tests/browser/catching-unicorns.spec.ts` | `d8711c606ff50b48e612266be619a742c564fea2183029ab2ded21c4c929e1b0` |
| `tests/session-summary-runtime.test.ts` | `986929f2a68a4e3879e55954ceb2f4961629d3a165c60d10ca4dd8e09166b11d` |

A clean validation copy at `/tmp/sprout-commit7-validation.tgn1IY` was created with `git archive HEAD | tar -x -C <copy>`, then overlaid with the two candidate test files and validation documentation. Dependencies were copied from the installed `node_modules` using macOS clone copy (`cp -cR`); no credential files were copied. The invoking environment has neither provider variable set. Tests use the existing provider-free Playwright configuration, whose server overrides both keys with empty values. Source/test files in the copy must byte-match the candidate; no lint rules, thresholds or production assertions are changed.

The first copy used a dependency symlink. Next/Turbopack rejected it as outside the filesystem root before any test ran; a real dependency copy fixed that setup failure. Earlier focused test failures were harness mistakes: omitted microphone/tutor audio lifecycle, an invalid `incomplete` answer label, and confident `partial` instead of the recorded fixture's `partial_uncertain`. Each was corrected against production contracts. Confident partial evidence still conflicts; it is not weakened into tentative evidence by production code.

## Deterministic coverage

The new scenario in `tests/browser/catching-unicorns.spec.ts` explains an engram, records an initially tentative exogram explanation, adds a neutral request and separate relevant learner clarification, records a demonstrated independent live memory-extension explanation and its reveal context, and explicitly skips other discussion topics before recap. It does not claim full rubric coverage. It checks:

- Pending recap remains usable and selects the supported foundational partial topic.
- Review references resolve both exact exogram learner replies from the actual runtime assessment snapshot. The tentative live observation remains intact; the recap reconciles the later clarification and preserves unclear assistance without downgrading demonstrated content.
- Reasoning takes precedence over the definition when strengths are selected. Recorded engram/exogram/memory-extension prerequisites permit discovery exploration, ahead of uncertainty about prompting. The exercise and learner-facing strengths/notice match the tutor context received on the actual WebRTC data channel.
- The **entire runtime state**, including live evidence and scene identity, plus the real before/after session exports' reveal context, is identical before and after review. Review sends one passive context refresh that asks for no extra turn. It does not navigate or issue an interrupt.
- Finish launches a review after a new recap follow-up; restart creates a live separate attempt before that late result is released. The closed peer receives no new commands, the fresh peer receives no old summary, and the fresh attempt retains idle review and empty evidence.

Mocked boundaries are `/api/live` (local peer, no external voice provider), `/api/classify` (controlled tentative partial, memory demonstration or abstention), `/api/assess` (synthetic rubric/reference choices normalized by production functions), and tutor/learner transcript events. Synthetic microphone PCM and local tutor tone exercise real Web Audio/WebRTC and production activity detection, but are not the words injected into transcripts. This is transport/runtime/UI integration, not ASR or human audio validation. Matching context delivery is not proof of what a voice model says.

The strengthened `tests/session-summary-runtime.test.ts` deliberately ignores fetch abort and completes both the superseded entry review and final stop review **while a new attempt is live**. It asserts no transport commands and exact new-attempt state preservation. Existing tests in that file remain the integrated coverage for pending steering/acknowledgment ordering, passive refresh deduplication, failed review fallback, malformed successful review and foreign/superseded snapshot rejection. Existing reconciliation tests cover wrong/foreign/tutor/missing/uncertain references, supported conflicts and prerequisite eligibility. Existing complete lesson/browser export tests cover reveal carry-forward, navigation, export, microphone disposal and peer closure. These checks are reused rather than duplicated.

## Commands and results

| Command | Location | Result |
| --- | --- | --- |
| `npm test` | Original checkout baseline | 56 files, 1,148 tests passed. |
| `npm test` | Exact clean candidate copy | 56 files, 1,148 tests passed, including the strengthened active-restart lifecycle regression. |
| `npm run typecheck` | Exact clean candidate copy | Passed (`next typegen` and `tsc --noEmit`). |
| `npm run lint` | Original checkout | Failed on existing generated artifacts; see counts below. |
| `npm run lint` | Exact clean candidate copy | Passed with the unchanged lint rules. |
| `npm run build` | Original checkout and exact clean candidate copy | Passed; production routes generated successfully. |
| `npm run test:browser -- --grep 'multi-reply grounded'` | Clean copy, earlier scenario | 1 passed; this preceded the additional live demonstration and export assertions. |
| `npm run test:browser` | Exact final clean candidate copy | All 27 passed (1.7 minutes), including actual before/after exports and exactly one received passive feedback command. |
| `git diff --check` | Original checkout | Passed. |

The final browser run follows a failed harness assertion that looked for Learned so far in recap (that region is intentionally omitted there). The final assertion compares the real exports, including an existing memory-extension reveal and an unrevealed exogram. Earlier full browser runs are not substituted for this final candidate run.

Full lint in the **original checkout** fails: 759 errors and 10,594 warnings (11,353 problems). All 759 errors are in 54 generated files under existing ignored `test-results` validation copies. This is a confirmed pre-existing artifact problem, not a passing original-checkout lint result. The original artifacts were preserved. The same unmodified lint configuration is run against the exact clean candidate source.

Untracked evidence logs are in `/tmp/sprout-commit7-evidence/` (`unit-initial.log`, `unit-final.log`, `lint-original.log`, `lint-clean-final.log`, `typecheck-final.log`, `build.log`, `build-clean.log`, `browser-focused.log`, `browser-full.log`, `browser-full-final.log`). Focused logs contain the final run; setup/harness failures above are summarized here rather than checked in as repetitive logs. Playwright evidence is under `/tmp/sprout-commit7-validation.tgn1IY/test-results/playwright/`. The new scenario attaches `grounded-feedback` JSON with the actual runtime review snapshot, reconciled summary and received tutor feedback. The default list reporter does not persist that inline body, so one additional unchanged-candidate focused run used `npm run test:browser -- --grep 'multi-reply grounded' --reporter=json --output=/tmp/sprout-commit7-evidence/focused-artifacts` (1 passed). Its JSON report is `/tmp/sprout-commit7-evidence/browser-focused-report.json`; the extracted attachment is `/tmp/sprout-commit7-evidence/grounded-feedback.json`. These `/tmp` paths are local, ephemeral evidence, not durable acceptance records. Compact provider inputs/results are committed below.

## Provider-backed HTTP replay

The existing Next development server on `127.0.0.1:3000` was verified with `lsof` to run from this checkout. Its configured application interfaces were used without reading credential files or displaying credential values. The production revision is the expected parent; this slice changes no production files. Four bounded sequential calls were made, with no retries: two `/api/assess` requests (client timeout 45 seconds; route provider timeout 30 seconds), then two `/api/classify` requests (client timeout 15 seconds; route timeout 10 seconds).

Exact inputs, timestamps, raw distributions, normalized proposals and sanitized API failures are in [the compact replay artifact](validation/session-feedback-provider-replay.json). Requests used `Content-Type: application/json` and matching `Origin: http://127.0.0.1:3000`; server keys stayed inside existing server code. To reproduce an assessment, POST the artifact's request, replacing `visitsFromFixture` with the committed fixture's `conversation`; the exogram-only case includes its complete request. Classification requests are also complete. No raw upstream response, audio, SDP or credential material is retained.

| Case | Result | What it establishes |
| --- | --- | --- |
| Compact saved eight-visit session, new full review | HTTP 502, `Assessment unavailable.` | Confirmed production assessment failure; no new review/evidence or feedback was produced. |
| Saved exogram visit with neutral clarification | HTTP 502, `Assessment unavailable.` | Failure also reproduces on a smaller input; content/assistance separation and multi-reply provider grounding remain unverified. |
| Synthetic association-only synthesis reply, scripted neutral probe | HTTP 200; objective incomplete 0.98, tutor clarifying 0.96 | Classifier holds the association-only exchange. The probe is supplied test text, not generated tutor behavior. |
| Synthetic mechanism reply, scripted acknowledgment | HTTP 200; tutor confirmation 0.99; completed/incomplete each 0.47; content/source judgments do not establish a culture demonstration | Acknowledgment is recognized, but learner grounding remains unresolved for this deliberately limited example. Accepted proposal validity is not mastery/completion. |

The assessment route intentionally returns a generic failure for upstream non-OK responses, invalid model/schema/normalization, timeouts and fetch errors. The exact upstream cause is **unknown** from this interface; a 502 is not proof of absent credentials or a confirmed assessment-policy defect. Classifier success demonstrates that its configured integration is reachable, not that full review works. No production fix is bundled here. The small synthetic mechanism example is not independently adjudicated rubric ground truth; its scores are recorded rather than asserted to be a confirmed model bug.

These are **text provider replays**, not real audio/transport tests. There is no successful provider full-review projection to compare with a voiced recap. Deterministic tests establish selection and shared feedback plumbing only.

## Human walkthrough and remaining gate

The user confirmed availability for a fresh human walkthrough. The local discussion URL and deliberate scenario were supplied, and a fresh export path plus observations of audible probes/closure, recap agreement and finish/restart were requested. No fresh export or spoken-feedback observations have been received or inspected at the time of this record. The only matching file found in Downloads is the original saved session; it is not a fresh walkthrough. Human acceptance is therefore pending, not failed or passed. The task does not claim that the microphone is unavailable.

A fresh human walkthrough must retain a session export plus the human's observation of what was spoken (transcript alone cannot prove audible timing). Check neutral elaboration versus answer-giving, association-only CAF/synthesis probing with at most two scene probes and one per connection, closure on sufficient mechanism or a request to move on, grounded later exogram clarification, evidence-based practice selection, visual/spoken recap agreement, and finish/restart cleanup. Inspect assistance and exact learner references in export, and confirm review does not change live evidence/reveals or navigation.

Provider review must first produce a valid grounded result; the two recorded HTTP 502 failures remain an acceptance blocker. If a human session also receives unavailable review, its fallback/audio behavior can still be evaluated, but it cannot establish successful provider-grounded recap agreement. No synthetic playback is labeled as a human walkthrough, and no unrun step is passed.
