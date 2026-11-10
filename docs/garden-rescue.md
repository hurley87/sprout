# Garden Rescue

The `/games/garden` route uses the shared voice runtime and the server-owned `garden-rescue` lesson. It has one fixed quest order and no quest-choice screen, a deliberate deviation from #104. Add `?debug=1` to inspect diagnostics and the current run's game events.

| Node | Count | Foreground before success | World effect after success |
| --- | ---: | --- | --- |
| `rescue-ducklings` | 3 | ducklings; no lily pads | `ducklings.crossed`: lily pads appear and the ducklings move onto them |
| `wake-butterflies` | 3 | sleeping butterflies | `butterflies.awakened`: the butterflies wake and fly gently |
| `grow-flowers` | 4 | sprouts | `flowers.bloomed`: the sprouts become flowers, one after another |
| `fresh-challenge` | 4 | awake butterflies | none |

Sprouts are counted over a blurred, softened garden backdrop (`softBackdrop`), so the small decorative flowers in the garden art recede and cannot be mistaken for countable objects. During the conversation the status pill shows the same abstract glow cue as `/halloween`. The fresh challenge uses a new scattered layout and a different object from the immediately preceding sprout scene, to probe counting in a new arrangement.

## Architecture

Game state is a read-only projection of authoritative lesson progress. During a pending render, its origin node and encounter remain authoritative until the exact render is confirmed; stopping during rendering reverts to that origin. The runtime ID identifies a run, the node and visit identify a quest encounter, and the render token identifies the exact displayed scene. Effects are presentation-only: they never authorize progress, delay render confirmation or steer the tutor. Effect props sit behind the counting objects, are not countable and are excluded from the artwork loading gate.

The effect plays during the existing success window, alongside the success numeral. Its `held` state keeps the final frame on the answered scene while the committed transition renders; otherwise it is `before`. Stop, restart or a stale visit cancels the effect. Renewed speech or Stop can cancel a success window before commit, so animation alone does not produce a log entry.

At render-confirmed commit, projection diffs emit `world.effect` immediately after the matching `quest.succeeded`, once per run. Its `visitId` identifies the committing visit, or is null if the diff never observed that visit. Diffs also emit `game.started`, `quest.started` and `game.ended`; the event log is local to the current run. `object.interacted` remains reserved and is not emitted because the game is voice-only. #107 can extend the session-local event log for export.

Counting scenes stay clean to keep counts unambiguous. Restored effects reappear in the celebration as three ducklings on lily pads, three awake butterflies and four flowers, and as icons on finished progress dots. Effect styles describe the static final state; keyframes animate only from the start, so reduced motion shows the finished picture.

## Verification (#106)

On November 10, 2026, typecheck, ESLint, Prettier on the changed files, 2,546 Vitest tests across 140 files, the production build and the full provider-free browser suite (82 tests, including 10 Garden Rescue tests) passed. Screenshots of every effect at 1440×1000, 1024×640, 390×844 and 844×390 were inspected. Screenshots can be captured with `GARDEN_SCREENSHOTS=1 npx playwright test tests/browser/garden-rescue.spec.ts` in `/tmp/garden-rescue-shots`.

## Known limitations

In short landscape viewports, the pre-Play button overlaps the opening ducklings. This shared-layout behaviour is left for #108.

The duckling crossing moves the ducklings forward onto their pads rather than to a fixed spot on the far bank, because the background is cover-cropped independently of the fixed 8:5 character area. The celebration's lily pads sit on grass. The sprout art has a faint smudge behind its stem, barely visible at desktop size. The "Play again" button moves to the bottom-right corner only in the Garden Rescue landscape celebration.

## Not performed

Live microphone, GPT-Live/Jev, and child playtests (#108) were not performed. Provider-free tests do not establish live provider or child usability.
