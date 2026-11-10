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

The three quests author `evidenceRole: "rehearsal"`; the fresh challenge authors `"transfer"`. Garden presentation records carry the authored `skillId` and `sceneVersion` alongside quantity and scene ID. The projection exposes the role as `probe` on encounters, displayed quests and `quest.started` events. This metadata grants no answer, transition or steering authority and does not establish mastery.

Game state is a read-only projection of authoritative lesson progress. During a pending render, its origin node and encounter remain authoritative until the exact render is confirmed; stopping during rendering reverts to that origin. The runtime ID identifies a run, the node and visit identify a quest encounter, and the render token identifies the exact displayed scene. Effects are presentation-only: they never authorize progress, delay render confirmation or steer the tutor. Effect props sit behind the counting objects, are not countable and are excluded from the artwork loading gate.

The effect plays during the existing success window, alongside the success numeral. In live sessions the answer is accepted only after the tutor's reply ends, so the lesson authors `successHoldMs: 3000`: an accepted success stays on the answered scene for three seconds from when it becomes visible, long enough for each effect (about 2.5 s) to finish, before the next scene is requested. The hold is lesson timing in the reducer, not driven by the effects; renewed speech clears the success and restarts it. Without it, live attempt 9e4646cd replaced each effect about 0.35 s after it started. Its `held` state keeps the final frame on the answered scene while the committed transition renders; otherwise it is `before`. Stop, restart or a stale visit cancels the effect. Renewed speech or Stop can cancel a success window before commit, so animation alone does not produce a log entry.

At render-confirmed commit, projection diffs emit `world.effect` immediately after the matching `quest.succeeded`, once per run. Its `visitId` identifies the committing visit, or is null if the diff never observed that visit. Diffs also emit `game.started`, `quest.started` and `game.ended`; the event log is local to the current run. `object.interacted` remains reserved and is not emitted because the game is voice-only. #107 can extend the session-local event log for export.

Counting scenes stay clean to keep counts unambiguous. Restored effects reappear in the celebration as three ducklings on lily pads, three awake butterflies and four flowers, and as icons on finished progress dots. Effect styles describe the static final state; keyframes animate only from the start, so reduced motion shows the finished picture.

## Verification (#106)

On November 10, 2026, typecheck, ESLint, Prettier on the changed files, 2,549 Vitest tests across 141 files, the production build and the full provider-free browser suite (82 tests, including 10 Garden Rescue tests) passed. Screenshots of every effect at 1440×1000, 1024×640, 390×844 and 844×390 were inspected. Screenshots can be captured with `GARDEN_SCREENSHOTS=1 npx playwright test tests/browser/garden-rescue.spec.ts` in `/tmp/garden-rescue-shots`.

## Known limitations

In short landscape viewports, the pre-Play button overlaps the opening ducklings. This shared-layout behaviour is left for #108.

The duckling crossing moves the ducklings forward onto their pads rather than to a fixed spot on the far bank, because the background is cover-cropped independently of the fixed 8:5 character area. The celebration's lily pads sit on grass. The sprout art has a faint smudge behind its stem, barely visible at desktop size. The "Play again" button moves to the bottom-right corner only in the Garden Rescue landscape celebration.

The bounded-support help-request check needs the literal word "help" in the child's words, so differently worded requests for help are not counted. If the tutor produces no output after the support-limit close instruction, the quest is not released until Stop; this is deferred to #108.

## Not performed

Live microphone, GPT-Live/Jev, and child playtests (#108) were not performed. Provider-free tests do not establish live provider or child usability.

## Bounded support (#107 C2)

Garden opts into three visit-local difficulties. A settled incorrect answer or an explicit unresolved child help request counts at most once per child turn. Unclear speech and unfinished answers do not count. At the limit the application sends one authored, non-leading close; after fresh tutor output drains, the reducer follows the authored edge without accepting an answer. A correct answer accepted before departure takes precedence. Stop before render confirmation records no visit outcome.

Committed visit outcomes, rather than quest position, determine restored and released quests. Only successes emit `quest.succeeded` and `world.effect`; releases emit `quest.released`. A completed run with any release shows a gentle thank-you and only the restored artwork. A fully successful run retains the celebration. Stop and errors remain separate. The classifier's `needs_help` label also covers uncertainty, so the reducer requires an explicit child help request in the authenticated snapshot before counting that kind of difficulty; this conservative text check can miss differently worded requests.

## Evidence summary (#107 C3)

`summarizeGardenSession({ report, gameEvents })` in `lib/garden-rescue/evidence-summary.ts` is a pure projection of one run's `LessonRuntime.report()` and its Garden game-event log into a compact `garden-evidence/v1` record. It makes no model call, network request or timer, and runs no extra grading pass. It copies no transcript text or audio, only source identities (visit, child turn, transcript revision) and classifier labels.

Per displayed quest visit, it reports the authored quest, probe, skill, quantity and scene version. Attempts come from consumed `tracking.evidence` proposals, keyed by the child revision they judged, and are marked `accepted`, `superseded` or `not_accepted`. Clarifications and hints are tutor turns labelled `clarifying` or `helping` in `tracking.feedback`. Delivery is `audio_observed` only when `tracking.delivery` saw local playback activity near that turn; this is a temporal inference, never proof the child heard it. The record also includes runtime support and answer-recovery instructions, C2 difficulties and support-limit state, and the committed visit outcome or an unfinished state. `support` considers only what happened before acceptance, and is `unknown` when a tutor turn before acceptance has no feedback label. `selfCorrected` is `unknown` when an earlier child turn has no classification. `countingStrategy` is always `unknown`. A rehearsal effect is `authorized` only when a matching `world.effect` and a succeeded visit outcome agree. The transfer probe has its own block, and the run ending keeps completed, released, stopped, error and in-progress runs distinct. `integrity` flags game events that no committed outcome backs, duplicate successes, effects on released quests, superseded successes and ending mismatches. The summary never labels a result as mastered or independent. The summary is not yet wired into the Garden export (C4).
