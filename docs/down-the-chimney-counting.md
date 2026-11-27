# Down the Chimney counting

Run `npm run dev` and open `/scenes/down-the-chimney`. Append `?seed=N` to
reproduce a game, using a decimal integer from 0 to 99, or `?debug=1` for
diagnostics and export. An absent or invalid seed is drawn on the server.
Each allowlisted lesson ID is `counting-down-the-chimney-<seed>`. The server
and browser derive the same rounds from that seed using Mulberry32, shared with
Christmas Tree.
[Route](../app/scenes/down-the-chimney/page.tsx) ·
[Plan](../lib/lesson-runtime/down-the-chimney-plan.ts) ·
[Seeded random](../lib/lesson-runtime/seeded-random.ts)

Eight rounds progress through counts 1–3 for rounds 1–2, 1–4 for rounds 3–5
and 1–5 for rounds 6–8. Consecutive rounds never have the same count. Planned
drop intervals are 1.5, 1.2 and 0.9 seconds; an extra-slow level is 1.8
seconds. A miss slows the next round, and two clean rounds restore the planned
pace. A first-miss replay is one level slower, a second-miss count-together
replay uses two seconds, and a silence replay keeps the current pace. Stop and
Play reset the pace.
[Lesson definition](../lib/lesson-runtime/down-the-chimney-lesson.ts) ·
[Timeline](../app/down-the-chimney-timeline.ts)

## Count-along window

The lesson opts into `countAlong`, and the stage requests `beginCountAlong`
for each drop sequence and a 600 ms buffer after the last landing. The window
holds classification, tutor stabilisation, recovery, spoken support and reducer
transitions while microphone activity, provider input, transcripts and tutor
output continue. It cancels in-flight classification and restarts nudge waits
when it closes. If speech occurred, the runtime schedules a single judgement
of the current answer after the window, waiting for a turn still in progress
to finish. Lessons without `countAlong` retain their existing behaviour.
[Runtime](../lib/lesson-runtime/lesson-runtime.ts) ·
[Reducer](../lib/lesson-runtime/lesson-runtime-reducer.ts) ·
[Stage prop](../app/lesson-screen.tsx)

At faster paces a child counting along can produce one continuous turn: the
local detector needs 900 ms of quiet to end it. The window lets the count finish
before judging its last number. This is the opposite of Dino's `beginEffect`
[mic-safety gate](dino-car-crunch.md#mic-safety), which suspends provider input
and ignores microphone activity so app sounds cannot be mistaken for speech.
Down the Chimney needs the microphone open while the child counts.

## Round flow

Drops wait for the scene render to be confirmed, assets to settle and tutor
output to be quiet. In round 1 they begin about 1.2 seconds after the spoken
opening has gone quiet; a 6.5-second fallback handles no opening output.
Presents land on an even beat with a snow-puff visual “thump”. Santa's dust-off
pose cues the answer. The count is not placed in the DOM before success.

After a wrong answer the stage waits for the tutor's reply and quiet before
replaying; a four-second fallback permits a replay if the tutor stays silent.
After six seconds of silence Santa peers down the chimney and replays, at most
twice per round. The wait restarts after speech. On success the fireplace
lights, the presents appear in a row and one moves to the pile. The moon is the
voice cue; in the finale Santa waves, a sleigh crosses the sky and the tree
lights up. Reduced motion fades drops and removes the chimney jolt, with static
or reduced finale effects.
[Stage](../app/down-the-chimney-stage.tsx) ·
[Styles](../app/down-the-chimney-stage.module.css)

Sprout is instructed to explain once, stay silent during drops and never ask
for or say the total before the child supplies it. On the count-together replay
Sprout stops before the last number: under `latestChildNumber`, a total supplied
by the tutor before the child's first attempt makes the first repeat an echo.
There are no tutor silence or reply nudges because the app replays instead.
After a settled correct answer Sprout may confirm and count the revealed row.
[Spoken-number reader](../lib/lesson-runtime/spoken-number.ts)

## Sound and artwork

Version 1 has a visual-only thump, decided with the product owner. The effect
gate would mute the child's count-along; ungated app audio could be heard as
speech, and the repo does not rely on browser echo cancellation. Adding sound
needs a real-phone acoustic check first.

The hand-authored SVG scene uses placements expressed as fractions of the
1600 × 900 background, keeping objects aligned with the roof through cover
crops. The tree and lights are reused from Christmas Tree. In the tested
portrait crop Santa, chimney, hearth and all five possible row presents remain
visible; the tree and pile are off-screen.
[Artwork](../public/down-the-chimney/) ·
[Geometry](../app/down-the-chimney-scene.ts)

## Validation

The `tests/down-the-chimney-*.test.ts` suites cover plans and pacing, lesson IDs
and allowlisting, route parsing, scene geometry, theme copy, stage timing,
render gating and silence. `tests/count-along-window.test.ts` covers the
opt-in window, deferred judgement, recovery, nudge waits, lifecycle and
unflagged lessons.

The provider-free browser spec uses a synthetic microphone, local session and
mocked classifier. It covers early answers, silence replays, reduced motion,
misses and pace reset, matching seeded and server-selected lesson IDs, all
rounds and the hidden answer, the pile, continuous counting and separate turns.
The reported run passed 27/27 with `--repeat-each=3` (about 3.9 minutes). The
full unit suite passed 179 files / 3,310 tests, and the Christmas Tree browser
spec still passed.
[Browser spec](../tests/browser/down-the-chimney.spec.ts)

## Not performed

Play on a real phone with a child. Check whether she counts along or guesses,
answers unprompted, recognises the dust-off as the ending, watches the reveal
and finds replays encouraging. Check the starting and fastest paces, and whether
she can play with sound off. Check whether the count-together tutor speech lines
up with the two-second drops: provider speech cannot be precisely synchronised.
Check whether the welcome caption covers Santa's hat on some screens.

The thump sound, the brief's later-level jingle bells and a fresh game on Play
again are deferred. The seed stays fixed for the page load.
