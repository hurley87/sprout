# Issue #47, commit 5: playback evidence and bounded verification

## Scope

Implementation was tested from parent `5b25ab29d3f296977a60818ff74482d08e84d892`. Live trials were captured on 2026-10-02 using model `gpt-live-1` and prompt version `counting-jev-11-varied-help`.

The tested source and harness inputs are SHA-256 pinned in [commit-5-source.sha256](commit-5-source.sha256); the resulting commit is expected to have the parent SHA above.

This final verification slice joins browser lifecycle diagnostics to retained audio, checks finite acknowledgment playback against the selected catalog asset, records acknowledgment startup resource timings, and bounds the live acceptance runs. The run analyzer fails closed on missing scenes, invalid playback lifecycle, asset or transcript hash mismatch, incorrect phase order, or a question dispatched before the new display. It reports DOM/audio alignment as unavailable where a clock bridge was not captured.

No production React, Next, or Convex files changed. No deployment or schema change was made. Live recording evidence is the test harness's local mirror of the browser's actual `MediaRecorder` output; the durable Convex recording service did not establish a saved record during these trials.

## Browser evidence

The four-scene Chromium test drives the production `BrowserTransport`, `LessonSession`, finite catalog and display-token choreography using synthetic WebRTC provider input and silent child input. It verifies three scene advances, exact selected asset hashes, catalog startup requests, clip end and output fence evidence, display confirmation before each fresh-source question, and captured finite audio.

RMS amplitude correlation uses a 20 ms window sampled every 1 ms. The test first searches coarse alignment, then refines the shared whole-clip alignment at 1 ms increments. In the final run, whole-clip correlations were 0.9995, 0.9995 and 0.9997; the final 200 ms audible windows were 0.9986, 0.9986 and 0.9992. Zeroing each matched final window produced a 0.000 negative-control correlation. All three recorded asset SHA-256 values matched the selected catalog files. Ten distinct catalog resources were requested during startup. Full local artifacts are retained under ignored `test-results/issue-47/chromium-four-scene/`.

This browser test is synthetic evidence of the application playback path. It is not a live tutor-voice trial, a physical speaker test, or proof of perceived intelligibility.

## Bounded live trials

Three bounded live trials completed below 150 seconds. The enforced whole-run hard deadline applied to trials 2 and 3. All used public synthetic speech and no child data. Each saved an actual MediaRecorder WebM locally, whose SHA-256 was bound to its independent `gpt-4o-transcribe-diarize` transcript artifact. Diarized segment times are model estimates; labels do not prove speaker identity. Where capture and page clocks were bridged, the analyzer maps transcript segment estimates to page-clock DOM events. Trial 1 predates that bridge, and its DOM/audio alignment is explicitly unavailable.

| Trial | Result and observed behavior | MediaRecorder SHA-256 | Audio bytes | Independent transcript evidence |
| --- | --- | --- | ---: | --- |
| `issue47-four-scene` (1) | PASS; recording 44.2 s; three advances: hello-duck → duck-friends → butterfly-garden → picnic | `2840a56c5f8dec3d8c53f2d8a056ad0545e6c7bf0ffb7be7fe26100f99ae53b8` | 594,584 | Contains the three catalog acknowledgment sentences and subsequent questions. DOM/audio clock bridge unavailable. |
| `issue47-four-scene` (2) | PASS; recording 40.9 s; same three advances | `5a1ca6146587c9e9ec7e8b3cad573892367528fa3d8159503bd8fdbcddd611f0` | 547,812 | Includes questions such as “How many ducks are on your screen?” and “How many strawberries do you see?”; phrasing differs from trial 1. Page-clock bridge captured. |
| `interruption` (3) | PASS; recording 19.6 s; synthetic “Wait!” interrupted the provider's opening question, then one answer advanced to duck-friends and its next question | `9956cbb0dd07c8148accc9b71f09bc5dfcfb70b7e96f55522b89d1461efa3025` | 270,487 | Transcript includes overlapping “Wait” and greeting question, then “Sure, take your time,” acknowledgment and next question. Page-clock bridge captured. Its transcript was SHA-bound during audited post-processing after confirming transcription used the unchanged capture; the initial transcript metadata did not include that binding. |

Trial 1 completed before the harness had whole-run hard-deadline wiring. Trials 2 and 3 had the enforced 150-second hard deadline; each trial remained below it. The durations in the table are the recording durations in the `MediaRecorder` metadata. Trial 1 also had a separately estimated 46.7-second overall run timeline; that value is not a recording-duration field. Trial 3 exercises interruption of provider speech, not interruption of the finite acknowledgment clip. Finite-clip cancellation is covered by unit and synthetic Chromium tests. The alternate WAV family was exercised in trials 1 and 3; baseline clips were exercised across the trials. Detailed per-trial analyzer output and source audio/transcript files are in ignored `test-results/issue-47/`; they are local verification artifacts and are not committed.

### Observed live latency

All values are milliseconds. “Fetch/decode” is the diagnostic asset request-to-ready interval; it is independent of replacement-source readiness and does not mean every asset was preloaded. “Dispatch to ASR onset” is an estimated diarized transcript-segment onset relative to question dispatch, not word-level acoustic timing. Trial 1 values are session/diagnostic-derived and have no recording-to-DOM bridge; trials 2 and 3 have the page-clock bridge.

| Trial / evaluated scene | Accept → clip start | Fetch/decode | Clip | Media end → output fence completion | Commit → display | Display → replacement ready | Question dispatch → ASR onset |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 hello-duck | 20 | 12 | 2,500 | 42 | 33 | 1,609 | 1,300.5 |
| 1 duck-friends | 24 | 15 | 2,650 | 48 | 33 | 966 | 1,095.5 |
| 1 butterfly-garden | 25 | 17 | 5,540.2 | 47 | 33 | 1,522 | 1,367.5 |
| 2 hello-duck | 22 | 12 | 2,500 | 43 | 33 | 1,126 | 1,458.6 |
| 2 duck-friends | 25 | 16 | 2,650 | 45 | 33 | 1,144 | 1,728.6 |
| 2 butterfly-garden | 24 | 15 | 2,800 | 42 | 34 | 956 | 1,992.6 |
| 3 hello-duck | 26 | 17 | 4,219.8 | 52 | 33 | 1,250 | 668.5 |

The recording duration is exposed as `recordingDurationMs` by the analyzer and is not total browser-run wall time. Startup catalog availability is separately evidenced by the synthetic browser resource-timing test: ten distinct acknowledgment resources were requested during startup. Per-transition fetch/decode times above describe the requested clip's diagnostic readiness interval; the artifacts do not establish a complete production preload cache before trial start.

Live runs can be repeated against an already running configured service with the same scenario/capture switches (these commands invoke billed services):

```bash
LIVE_OUT=test-results/issue-47/replay-four-scene LIVE_CAPTURE_AUDIO=1 npm run test:live:reactive -- issue47-four-scene
LIVE_OUT=test-results/issue-47/replay-interruption LIVE_CAPTURE_AUDIO=1 npm run test:live:reactive -- interruption
```

The tests also set the issue-47 scenario's 150-second deadline in the runner. The recorded first-trial invocation predates that deadline feature, as stated above. Run `node scripts/live/analyze-issue47.mjs` after capturing the expected three trial artifact directories to produce the analyzer summary.

## Verification run

The final verification results are:

- `npm test` — 49 files and 931 tests passed.
- `npm run test:browser` — 132 tests passed.
- `npx playwright test --config=playwright.transport.config.ts` — 53 tests passed.
- `npm run lint` — passed without diagnostics.
- `npm run typecheck` — passed.
- `NEXT_PUBLIC_CONVEX_URL=https://synthetic-public.convex.cloud npm run build` — passed.
- `node scripts/live/analyze-issue47.mjs` — all three trials passed with no analyzer errors (3, 3 and 1 transitions); it reports recording duration from MediaRecorder metadata.
- `npx prettier --check` over every changed source and documentation file — passed.
- `npm run format:check` — reports six existing formatting warnings: four Convex skill YAML files and two generated Convex declarations. No warned file was changed.
- `git diff --check` — passed.

The build variable above is synthetic public configuration only. No secret was read and no deployment was performed. Existing repository-wide formatter warnings outside this slice are preserved and called out with the final command result.

## Existing coverage and remaining review

The controller unit and browser tests cover accept-without-commit, playback against the old display, drain and output fence, display-token validation, single next-question dispatch on a fresh source, cancellation and stale callbacks, retry/failure behavior, stop and lifecycle boundaries, and correction of the old displayed group. Help-candidate tests preserve source/display provenance and keep recorded help separate from a correct total alone; transcript-only evidence remains unverified.

Human review remains for listening to the actual captured clips on a physical device, voice continuity, intelligibility, room conditions, and perceived latency. Durable Convex recording was not proven in these trials. The live interruption trial does not replace finite-clip interruption verification. Captured transcript timing is approximate and should be interpreted alongside the WebM and diagnostic clock metadata.
