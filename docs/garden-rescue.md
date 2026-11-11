# Garden Rescue

The `/games/garden` route uses the shared voice runtime and the server-owned `garden-rescue` lesson. It has one fixed quest order and no quest-choice screen, a deliberate deviation from #104. Add `?debug=1` to inspect diagnostics and the current run's game events.

| Node | Count | Foreground before success | World effect after success |
| --- | ---: | --- | --- |
| `rescue-ducklings` | 3 | ducklings; no lily pads | `ducklings.crossed`: lily pads appear and the ducklings move onto them |
| `wake-butterflies` | 3 | sleeping butterflies | `butterflies.awakened`: the butterflies wake and fly gently |
| `grow-flowers` | 4 | sprouts | `flowers.bloomed`: the sprouts become flowers, one after another |
| `fresh-challenge` | 4 | awake butterflies | none |

Sprouts are counted over a blurred, softened garden backdrop (`softBackdrop`), so the small decorative flowers in the garden art recede and cannot be mistaken for countable objects. During the conversation the status pill shows the same abstract glow cue as `/halloween`. The fresh challenge uses a new scattered layout and a different object from the immediately preceding sprout scene, to probe counting in a new arrangement. A “New challenge!” badge and a tinted backdrop distinguish it without adding countable objects. Its spoken brief and the shared tutor guidance never state the target count; the quantity stays in the private steering context so the tutor can judge the answer.

## Architecture

Game state is a read-only projection of authoritative lesson progress. During a pending render, its origin node and encounter remain authoritative until the exact render is confirmed; stopping during rendering reverts to that origin. The runtime ID identifies a run, the node and visit identify a quest encounter, and the render token identifies the exact displayed scene. Effects are presentation-only: they never authorize progress, delay render confirmation or steer the tutor. Effect props sit behind the counting objects, are not countable and are excluded from the artwork loading gate.

The effect plays during the existing success window, alongside the success numeral. In live sessions the answer is accepted only after the tutor's reply ends, so the lesson authors `successHoldMs: 3000`: an accepted success stays on the answered scene for three seconds from when it becomes visible, long enough for each effect (about 2.5 s) to finish, before the next scene is requested. The hold is lesson timing in the reducer, not driven by the effects; renewed speech clears the success and restarts it. Without it, live attempt 9e4646cd replaced each effect about 0.35 s after it started. Its `held` state keeps the final frame on the answered scene while the committed transition renders; otherwise it is `before`. Stop, restart or a stale visit cancels the effect. Renewed speech or Stop can cancel a success window before commit, so animation alone does not produce a log entry.

At render-confirmed commit, projection diffs emit `world.effect` immediately after the matching `quest.succeeded`, once per run. Its `visitId` identifies the committing visit, or is null if the diff never observed that visit. Diffs also emit `game.started`, `quest.started`, `quest.released` and `game.ended`. The event log is local to the current run and restarts with each new run; it is the list shown under "Game events" in debug mode and the `game.events` of the export. `object.interacted` remains reserved and is not emitted because the game is voice-only.

Counting scenes stay clean to keep counts unambiguous. Restored effects reappear in the celebration as three ducklings on lily pads, three awake butterflies and four flowers, and as icons on finished progress dots. Effect styles describe the static final state; keyframes animate only from the start, so reduced motion shows the finished picture.

## Transfer probe

The three quests author `evidenceRole: "rehearsal"`; the fresh challenge authors `"transfer"`. Garden presentation records carry the authored `skillId` and `sceneVersion` alongside quantity and scene ID. The projection exposes the role as `probe` on encounters, displayed quests and `quest.started` events. This metadata grants no answer, transition or steering authority and does not establish mastery.

## Bounded support

Garden opts into three visit-local difficulties. A settled incorrect answer or an explicit unresolved child help request counts at most once per child turn. Unclear speech and unfinished answers do not count. At the limit the application sends one authored, non-leading close; after fresh tutor output drains, the reducer follows the authored edge without accepting an answer. A correct answer accepted before departure takes precedence. Stop before render confirmation records no visit outcome.

Committed visit outcomes, rather than quest position, determine restored and released quests. Only successes emit `quest.succeeded` and `world.effect`; releases emit `quest.released`. A completed run with any release shows a gentle thank-you and only the restored artwork (game status `finished`). A fully successful run retains the celebration (`celebrating`). Stop and errors remain separate. The classifier's `needs_help` label also covers uncertainty, so the reducer requires an explicit child help request in the authenticated snapshot before counting that kind of difficulty; this conservative text check can miss differently worded requests.

## Evidence summary

`summarizeGardenSession({ report, gameEvents })` in `lib/garden-rescue/evidence-summary.ts` is a pure projection of one run's `LessonRuntime.report()` and its Garden game-event log into a compact `garden-evidence/v1` record. It reads the full journal in `report.events`, never the snapshot's diagnostics, which keep only the latest 100 events. It makes no model call, network request or timer, and runs no extra grading pass. It copies no transcript text or audio, only source identities (visit, child turn, transcript revision) and classifier labels.

Per displayed quest visit, it reports the authored quest, probe, skill, quantity and scene version. Attempts come from consumed `tracking.evidence` proposals, keyed by the child revision they judged, and are marked `accepted`, `superseded` or `not_accepted`. Clarifications and hints are tutor turns labelled `clarifying` or `helping` in `tracking.feedback`. Delivery is `audio_observed` only when `tracking.delivery` saw local playback activity near that turn; this is a temporal inference, never proof the child heard it. The record also includes runtime support and answer-recovery instructions, bounded-support difficulties and support-limit state, and the committed visit outcome or an unfinished state. `support` considers only what happened before acceptance, and is `unknown` when a tutor turn before acceptance has no feedback label. `selfCorrected` is `unknown` when an earlier child turn has no classification. `countingStrategy` is always `unknown`. A rehearsal effect is `authorized` only when a matching `world.effect` and a succeeded visit outcome agree. The transfer probe has its own block, and the run ending keeps completed, released, stopped, error and in-progress runs distinct. `integrity` flags game events that no committed outcome backs, duplicate successes, effects on released quests, superseded successes and ending mismatches. The summary never labels a result as mastered or independent.

## Export

In debug mode (`?debug=1`), "Export diagnostics" downloads `sprout-garden-<runId>.json`. Other routes keep their `sprout-lesson-<runId>.json` report unchanged: `LessonScreen` takes optional `exportReport` and `exportPrefix` props, which only the Garden route passes. The file is the existing `LessonRuntime.report()` with one added top-level key:

```json
{
  "runtimeId": "…", "lessonId": "garden-rescue", "classifierVersion": "conversation-state-v2",
  "status": "ended", "runtime": { "…": "…" }, "transcript": "…", "conversation": [], "events": [],
  "game": {
    "events": [{ "type": "game.started", "runId": "…" }],
    "summary": { "schema": "garden-evidence/v1", "ending": "completed_all_restored", "rehearsals": [], "transfer": {}, "integrity": { "ok": true, "issues": [] } },
    "provenance": {
      "schema": "garden-export/v1", "summarySchema": "garden-evidence/v1", "lessonId": "garden-rescue",
      "lessonRevision": "fnv1a64:…", "sceneVersions": { "rescue-ducklings": "1", "…": "1" },
      "classifierVersion": "conversation-state-v2", "runId": "…", "exportedAt": "2026-11-10T…Z",
      "build": "unknown", "redactions": []
    }
  }
}
```

`buildGardenExport` in `lib/garden-rescue/evidence-export.ts` assembles the file. It runs only when the download is requested: the summary is computed then from the full journal, so gameplay does no extra work and makes no extra model call or grading round trip. The Garden stage hands its run's game-event log to the page after each render. The export keeps only events for the exported run.

`lessonRevision` is a 64-bit FNV-1a hash of the canonical JSON of `GARDEN_RESCUE_LESSON`, with keys sorted at every depth. Any authored change, such as a brief, quantity, scene version, support limit, tutor or classifier wording, changes it. It identifies content, not security. `build` is `"unknown"` because no build or commit identity is exposed to the client.

**Included:** the runtime report (timing, runtime state, the full diagnostic journal, the current transcript and per-visit conversation text, assessment and evidence eligibility), the run's game events, the summary and provenance. The export contains conversation text, as the debug panel says.

**Excluded:** credentials and raw audio. The runtime never records the live session's credentials, SDP, headers or audio: the provider boundary keeps only parsed transcript, activity and error-code events, microphone diagnostics are RMS aggregates and track settings without device IDs, and `pcm` in delivery tracking is a playback-state label. As defence in depth, the export removes credential-like keys (secret, credential, password, bearer, authorization, cookie, API/private key, access/refresh/ID/session token, ephemeral, SDP, raw or provider body). It also replaces data URLs, base64-like strings longer than 512 characters, binary buffers and typed arrays with `"[redacted]"`. Each removal is listed in `provenance.redactions`, which is empty for current runs. Render identities (`display.token`, `renderToken`) are derived from the run ID and visit, are not credentials, and are kept.

## Verification (#106)

On November 10, 2026, typecheck, ESLint, Prettier on the changed files, 2,549 Vitest tests across 141 files, the production build and the full provider-free browser suite (82 tests, including 10 Garden Rescue tests) passed. Screenshots of every effect at 1440×1000, 1024×640, 390×844 and 844×390 were inspected. Screenshots can be captured with `GARDEN_SCREENSHOTS=1 npx playwright test tests/browser/garden-rescue.spec.ts` in `/tmp/garden-rescue-shots`.

## Verification (#107)

On November 10, 2026, on the final tree:

- `npm run typecheck` and `npm run lint` passed.
- `npx prettier --check` passed on every changed and new file.
- `npm test` passed 2,580 Vitest tests across 145 files. These include `tests/garden-evidence-export.test.ts` (6 tests): lesson-revision stability and change detection, a full real `LessonRuntime` Garden session with a hinted success and the transfer probe, a stopped run, run scoping, and redaction. They also include the 13 `tests/garden-evidence-summary.test.ts` tests.
- `npm run test:browser` passed the full provider-free suite: 85 tests with no failures or flakes, including 13 Garden Rescue tests. Two of those download and parse the export: one with a hinted success and the transfer probe (`completed_all_restored`, a separate `transfer` block, `integrity.ok`, provenance and the redaction audit), and one Stopped run (`ending: "stopped"`).
- `npm run build` passed.

The Garden browser classifier stub now labels the latest tutor line, as a real classifier does. Before, it labelled the whole transcript `acknowledging`. Every Garden and counting spec passed with the change.

## Known limitations

The duckling crossing moves the ducklings forward onto their pads rather than to a fixed spot on the far bank, because the background is cover-cropped independently of the fixed 8:5 character area. The celebration's lily pads sit on grass. The sprout art has a faint smudge behind its stem, barely visible at desktop size. The "Play again" button moves to the bottom-right corner only in the Garden Rescue landscape celebration.

The bounded-support help-request check needs the literal word "help" in the child's words, so differently worded requests for help are not counted. If the tutor produces no output after the support-limit close instruction, the quest is released after a 10-second timeout.

The exported game-event log is derived from the snapshots React renders, as the debug list is. Snapshots published within one task can be coalesced. The projection diff tolerates this, but a skipped encounter records a `world.effect` with a null `visitId`, which the summary's integrity check flags. The export is reachable only from the debug panel.

## Not performed

Live microphone, GPT-Live/Jev and child playtests (#108) were not performed for #106 or #107. Provider-free tests do not establish live provider behaviour or child usability, and the export has not been reviewed against a live session's report.

For real-microphone and parent-observed sessions, use the [Garden Rescue playtest protocol](garden-rescue-playtest.md).
