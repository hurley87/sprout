# Issue #5: reviewed observation verification

**Status: local verification passed; issue acceptance remains open.** Results recorded 2026-09-30
(America/Toronto). Starting SHA and required commit parent:
`e9c8825d98def14081c86f61fd468c4aead63bbd`, branch `codex/issue-5-reviewed-observations`.
This is commit 6's verification slice for [issue #5](https://github.com/hurley87/sprout/issues/5).
No planner, profile inference, adaptation, account, deployment or UI redesign is included.

## Evidence levels and results

- **Implemented:** located in the actual application/backend, without claiming execution in a deployment.
- **Local mock verification:** real implementation with synthetic inputs; external transport/provider/storage
  HTTP boundaries are mocked. Convex-test runs the actual schema, functions, scheduler and transactions.
- **Synthetic live provider verification:** none in this slice. Mocked transcription/model output is not provider evidence.
- **Manual verification:** visual inspection of synthetic screenshots only. No adult-speech scenario or child-session review was performed.
- **Unverified:** deployed registration/configuration, real provider interpretation, acoustic alignment and the manual speech matrix below.

| Check | Actual result |
| --- | --- |
| Full unit suite | 32 files, 645 tests passed (baseline: 31 files, 634 tests) |
| Full browser suite | 68 passed (baseline: 66); Chromium 153.0.8010.12, existing server at `127.0.0.1:3000` |
| Typecheck / lint / production build | Passed; Next 16.3.5, all six application routes emitted |
| Whitespace check | `git diff --check` passed |
| Live environment preflight | Shell presence checks: public Convex URL, capability, provider key and model override absent; values never read or printed |
| Existing server preflight | Same-origin loopback `get` with a deliberately invalid synthetic ID returned HTTP 503, `Review server configuration is unavailable.` No backend record read occurred |
| Isolated deployment / public RPC registration | Isolation could not be established; no deployed RPC invoked. Shell absence alone does not prove server/backend absence |

The production build used Next's existing environment loading; no environment file was inspected or changed.
No Convex CLI command was run, and no function/schema/configuration was uploaded. No provider request,
real session read, external message, push or issue update was made.

## Acceptance matrix

`I + L` means implemented and locally verified with mocks. It does **not** mean provider or manual acceptance.
Test paths are relative to the repository; each row names executable evidence and the remaining boundary.

| Issue criterion | Implementation and test evidence | Status / remaining gate |
| --- | --- | --- |
| Finalized complete/partial recording triggers structured proposals | `lib/convex-session-recorder.ts`, `convex/sessions.ts`, `convex/observer_action.ts`; `tests/reviewed-observation-flow.test.ts` complete and connection-failure paths | I + L; live saved-file/provider path unverified |
| Inspectable utterance, scene, help and exchange timestamp | `lib/observation-contracts.ts`, `parent_review.inspect`, `app/evidence-detail.tsx`; flow, contract and browser parent-review tests | I + L; acoustic/scene alignment unverified |
| Correct total distinguished from spoken counting | Contract sequence validation and provider instructions; `observation-contracts.test.ts`, flow counting fixture, browser counting/help test | I + L for structure; actual provider interpretation unverified |
| Preserve hint/choice/modeling/counting together/parent help | Support source/time checks; contract/provider tests, flow help fixture, bridge corrections, browser help controls | I + L; production delivered-support events remain absent; untimed transcription cannot establish recording-only help |
| Silence/unclear/ambiguous/missing scene/interruption stays uncertain or omitted | Contract tests, flow uncertain/empty/wrong-scene cases, provider failure tests | I + L for validated structures; no claim of provider speech accuracy |
| No claims of unseen pointing/touch/eye/object tracking | Provider instructions; parent context separate; flow limitation reproduction | **Open finding:** unrestricted description can contain unsupported visual claims despite valid structured fields |
| No mastery/developmental label from one success | Concrete behavior enums and provider instructions; same limitation reproduction | **Open finding:** unsupported mastery wording in description is not rejected locally |
| Accept unchanged and accept-all | `parent_review.decide/acceptAll`, `app/parent-review-panel.tsx`; flow, bridge, review and browser tests | I + L; deployed writes unverified |
| Correct interpretation, add assistance/pointing context | Separate `parentContext` and corrected evidence; flow mixed review and browser correction | I + L; actual parent workflow unverified |
| Reject unsupported proposal | Internal decision operation, public capability bridge, browser rejection | I + L; rejected rows never reach planning gate |
| Immutable originals remain inspectable | Separate proposal/decision rows; flow compares original batch and canonical events before/after review and duplicate triggers | I + L; no replacement operation exists |
| Separate accepted/corrected evidence with provenance | `reviewedEvidence` and backend resolved source identities; flow/bridge/review tests | I + L; parent context retained in returned evidence |
| Exclude pending/rejected from profile/planning inputs | Internal `parent_review.forPlanning`; flow gate checks before/after completion, mixed batch; review multi-session test | I + L; later planner must supply every prerequisite session; no planner/profile implemented |
| Explicit empty review | Validated empty publication + explicit acknowledgment; flow silence and browser READY test | I + L; not equated with failed/pending/running |
| Failed Observer safe and retryable | `observer_action.analyze`, claim/fail; flow provider HTTP 503 then explicit retry | I + L; real provider failure path unverified |
| Retry/idempotency never duplicates/bypasses review | Durable attempt token/lease/snapshot, expected-attempt scheduling; persistence tests and flow duplicate triggers | I + L; deployed scheduler behavior unverified |
| Day verified/light/substantial repair and note | `sessionReviews`; review tests for all levels, flow light correction/note, browser completion | I + L; actual daily parent evaluation unverified |
| Manual scenario matrix | Protocol below; screenshot inspection does not satisfy speech cases | **Unverified**, all 14 required scenarios remain open |
| Critical automated gate/retry rules | Full unit and browser suites, actual cross-layer flow test | Locally verified; external services mocked |
| Lint/build | Commands/results above | Locally verified |

## Cross-layer findings

The new flow tests call the actual `ConvexSessionRecorder` create/activate/append/finalize/upload/notify
path. The HTTP client dispatches into Convex-test; storage upload HTTP is replaced with an in-memory
Convex-test storage write. Recording retrieval returns those stored synthetic bytes; transcription and
Responses return fixed synthetic output. Both real Next route handlers, public capability actions,
scheduled analysis, local/provider publication validation and internal review operations execute.

Tests verify incomplete-record qualification, exact canonical IDs/snapshot, sequence/support validation,
immutable event/proposal rows, accepted/corrected/rejected separation, repair notes and the planning gate.
A new read-only recorder recovers the saved record. Playback composes the real response-start helper
with the real offset helper: speech start 1700 ms minus recording offset 100 ms gives 1.6 seconds.
The browser suite additionally plays a range-served synthetic silent WAV: response start 12000 ms,
flush event 20000 ms and offset 2000 ms seek to about 10 seconds for review and 18 seconds for event inspection.
This verifies browser seeking, not actual spoken-word alignment or audible speech.

Persisted-state reconciliation executes against real bridge reads: an accepted write's lost response
resolves as saved, a competing rejection returns 409 and resolves as conflict, and an absent correction
remains unresolved/retryable. Browser tests verify disabled competing actions, identical payload retention,
failed-refresh recovery, conflicting/lost completion metadata, accept-all conflicts and late unmounted responses.
`observer-persistence.test.ts` separately verifies lease recovery/exhaustion, stale tokens, changed snapshots,
duplicate scheduled attempts and 1000-row bounds. Bridge tests exercise missing/wrong capability, loopback
and origin guards, forged timestamps/sources, wrong session/analysis/proposal provenance and safe error redaction.

**Open semantic finding:** the limitation test supplies a model description saying “The child mastered
counting and independently touch-counted every object.” Valid quantity-identification fields and canonical
references permit READY publication. No parent approval or planning evidence is produced by that test.
The parent gate works, but structured-output/reference validation does not enforce the truth of free text.
No production fix is included. Root review must decide whether to constrain descriptions, add conservative
semantic rejection, or evaluate another bounded mitigation before declaring the no-visual/mastery criteria met.
Support-kind interpretation is likewise semantic; a referenced support row establishes identity/time, not
that the model characterized the audible help correctly. Provider accuracy is not established by these tests.

## Visual inspection

Synthetic review screenshots: [desktop 1280×900](verification/issue-5/review-1280.png) and
[mobile 390×844](verification/issue-5/review-390.png). Panel captures include expanded canonical sources,
correction/assistance/pointing controls and completion metadata. Both were visually inspected: text and
controls wrap, original/support qualification is readable, and there is no horizontal overflow. Mobile
uses a long vertical form; no redesign was made. All IDs/text are invented. The saved synthetic scene
contains three ducks for target three. Screenshots are presentation evidence, not provider or child evidence.

## Reproduce local checks

Run from the repository root with dependencies installed. These commands never invoke the Convex CLI.
The browser tests intercept service calls and supply synthetic records/audio; do not run live experiment scripts.

```sh
git rev-parse HEAD
git status --short
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

If no existing dev server holds Next's lock, `npm run test:browser` starts its default port 3100.
To reuse the existing port 3000 server without stopping it:

```sh
cat > .issue-5-playwright.config.ts <<'EOF'
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, use: { ...base.use, baseURL: 'http://127.0.0.1:3000' }, webServer: undefined });
EOF
npx playwright test --config .issue-5-playwright.config.ts
rm .issue-5-playwright.config.ts
```

Playwright clears its output directory on each run. Copy only the two synthetic `review-*.png` panel
captures from `test-results/playwright` if refreshing the committed screenshots. Record browser version,
viewport and fixture provenance again. Never commit real session data, credentials or provider diagnostics.

## Remaining bounded live and manual runbook

**Blocked before live work:** no already configured isolated test environment could be established, and
the existing local review route reports unavailable configuration. Deployed action registration, capability
agreement and provider-key presence are unverified. Do not infer registration from `_generated/api` or a build.
No deployment, new capability or credentials are authorized by this verification slice.

Before any future authorized run, establish isolated synthetic-only tables/storage, deployed current schema
and public bridge registration, and matching runtime capability using authenticated tooling that displays
presence only. A wrong-capability action probe must fail without scheduling or reading records. Never inspect
environment files/values, invoke the Convex CLI, or enumerate real sessions. If configuration or deployment
is required, stop that gate for review. Existing live-voice scripts are not an Observer acceptance harness.

Once those prerequisites are independently established, use one adult-only, explicitly synthetic mixed
recording at a time (WebM/Opus or supported MIME), under 20 MiB and 30 seconds. Pre-author at most the 14
scenarios below, one analysis per case and one additional attempt only for the retry case: at most 15
transcription/Responses pairs. Stop on the first configuration, registration, provenance or unexpected billing
problem. The adapter's 90-second timeout/five-minute lease remains unchanged. Do not treat synthetic adult
speech as suitability evidence for the actual child. Preserve synthetic IDs only in local disposable artifacts;
record aggregate outcomes and sanitized failure categories in docs.

For each case, the adult hand-marks the audible words, approximate speech interval, actually displayed scene,
help preceding the response and ending independently of provider output. Capture through the existing browser
recording path; inspect saved sources/audio, proposed wording and parent decision. Record pass/fail, transcription
errors, alignment difference, omitted/uncertain conclusions and required repair. Production does not emit delivered
support events, and untimed transcription cannot supply timed recording-help citations: verify omission/qualification
and separate parent context rather than inventing support rows to make a production-provider check pass.

| Required manual case | Synthetic adult fixture / action | Required observed result | Current result |
| --- | --- | --- | --- |
| Correct total without spoken counting | Display 3 ducks; adult says “three” | Quantity identification; no counted-aloud/independence claim | Unverified; local fixture passed |
| Spoken counting with correct total | Display 3 ducks; “one, two, three” | Counting sequence + total; no object-tracking inference | Unverified; local fixture passed |
| Hint | Audible “start at one,” then response | Preserve/qualify help; parent can report it when timestamps unavailable | Unverified; canonical support fixture passed |
| Counting together | Adult tutor voice counts alongside response | Supported/uncertain; no independence | Unverified; canonical support fixture passed |
| Parent-reported help | Add help/pointing during correction | Separate parent provenance; immutable original | Unverified; bridge/browser controls passed |
| Unclear speech | Deliberately unclear adult syllable | Uncertain or omitted; no manufactured incorrect answer | Unverified; local uncertain fixture passed |
| Silence | Display scene, no response | Valid empty READY, explicit acknowledgment; no evidence | Unverified; mocked flow/browser passed |
| Interruption | Cut off “one, two—” | Uncertain/omitted incomplete count; retain completed exchanges | Unverified; local interrupted fixture passed |
| Wrong scene | Change 3 to 4 during speech | Reject concrete wrong/unstable scene claim or qualify uncertainty | Unverified; contract/provider local checks passed |
| Partial session | End with connection failure after a completed exchange | Saved partial record qualifies analysis; supported exchange survives | Unverified; local full flow passed |
| No usable observations | Unattributed/undelivered exchange only | Empty READY or qualified uncertainty; never failed-as-empty | Unverified; empty flow and contract checks passed |
| Correction | Change description, add assistance/context | Original retained; only corrected reviewed version eligible after completion | Unverified; local flow/browser passed |
| Rejection | Reject unsupported attribution | Original retained; rejection excluded; record repair/note | Unverified; local flow/browser passed |
| Observer retry | Controlled provider failure, then explicit saved-record retry | Failed remains blocked; retry creates one batch; no automatic approval | Unverified; mocked provider failure/retry passed |

After these checks, obtain the parent/builder's manual assessment of the actual intended workflow and separately
resolve the semantic finding and child-speech/alignment feasibility gates. Keep issue #5 open until remaining
acceptance requirements are met; passing this local verification slice does not authorize closing it.
