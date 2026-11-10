# Garden Rescue

The `/games/garden` route uses the shared voice runtime and the server-owned `garden-rescue` lesson. It has one fixed quest order and no quest-choice screen, a deliberate deviation from #104. Add `?debug=1` to inspect diagnostics and the current run's game events.

| Node | Count | Foreground |
| --- | ---: | --- |
| `rescue-ducklings` | 3 | ducklings |
| `wake-butterflies` | 3 | sleeping butterflies |
| `grow-flowers` | 4 | flowers |
| `fresh-challenge` | 4 | awake butterflies |

Flowers use a plain meadow backdrop so decorative flowers cannot be mistaken for countable objects. The fresh challenge uses a new scattered layout and a different object from the immediately preceding flower scene, to probe counting in a new arrangement.

## Architecture

Game state is a read-only projection of authoritative lesson progress. During a pending render, its origin node remains authoritative until the exact render is confirmed; stopping during rendering reverts to that origin. The runtime ID identifies a run, the node and visit identify a quest encounter, and the render token identifies the exact displayed scene. None of the game projection, diagnostics or events authorizes progression or delays confirmation or steering.

Diffs emit `game.started`, `quest.started`, `quest.succeeded`, and `game.ended` in order, with run and relevant quest identity. The event log is local to the current run. `object.interacted` is reserved for #105's observed taps and keyboard interactions; `world.effect` is reserved for #106's effects. These are not emitted by projection diffs. #107 can extend the session-local event log for export. A spoken answer alone does not establish an interaction or delivered effect.

## Verification

On November 10, 2026, typecheck, ESLint, changed-file Prettier, the production build, and 2,537 Vitest tests across 139 files passed. The full provider-free browser suite passed 76 tests after correcting an observation-test hydration race; an earlier run also had a transient synthetic-audio timeout. Desktop and phone screenshots were inspected. Screenshots can be captured with `GARDEN_SCREENSHOTS=1 npx playwright test tests/browser/garden-rescue.spec.ts` in `/tmp/garden-rescue-shots`.

## Known limitations

In short landscape viewports, the pre-Play button overlaps the opening ducklings. This shared-layout behaviour is left for #108.

## Not performed

Live microphone, GPT-Live/Jev, and child playtests were not performed. Provider-free tests do not establish live provider or child usability.
