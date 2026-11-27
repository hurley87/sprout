# Christmas Tree counting

Run `npm run dev` and open `/scenes/christmas-tree`. Append `?seed=N` to
reproduce a tree, using a decimal integer from 0 to 99, or `?debug=1` for
diagnostics and export. The route also accepts zero-padded seed values. With
an absent or invalid seed, the server page draws one at request time.
[Route](../app/scenes/christmas-tree/page.tsx)

The server resolves only allowlisted lessons. Each tree has a lesson ID of
`counting-scene-christmas-tree-<seed>` with a canonical decimal suffix.
Mulberry32 lets the server and browser derive the same arrangement and lesson
from that ID's seed. Definitions are memoised by seed.
[Arrangement](../lib/lesson-runtime/christmas-tree-arrangement.ts) ·
[Lesson registry](../lib/lesson-runtime/lesson-registry.ts)

Each kind gets a distinct count from 1 to 5 and draws from six hand-placed
slots. Three kinds are asked, with the fewest of those three first. The fourth
stays in the picture as a distractor, and the full tree stays visible across
rounds. A picture bubble shows the asked kind. Sprout cues each round with just
its plural name and keeps the total private until the child supplies it. On
the second miss, Sprout is instructed to count along and stop before the last
number. For a single item, Sprout invites the child to count without saying a
number. A settled correct answer from the current round can advance the lesson
independently of tutor confirmation. The `spokenNumberCheck` option checks the
transcript against the expected count and can use the final number of a
finished count.
[Lesson definition](../lib/lesson-runtime/christmas-tree-lesson.ts) ·
[Spoken-number check](../lib/lesson-runtime/spoken-number-check.ts)

The 8:5 objects box sits over the cover-cropped living room. The SVGs include
the room, tree, star, lights, window snow, three colours of bauble, candy
canes, gingerbread men and pink and gold presents with separate bows.

| Kind | Success move |
| --- | --- |
| Baubles | Swing and glint |
| Candy canes | Wiggle |
| Gingerbread men | Rock |
| Presents | Bounce with a bow pop |

The asked items move one at a time, 650 ms apart. The star is the visual voice
cue. In the finale the star shines, the lights twinkle, snow falls in the
window and the stage says “Beautiful work!” Reduced motion uses success
highlights, a static hint and finale, and a bubble without the pop.
[Artwork](../public/christmas-tree/) · [Stage styles](../app/christmas-tree-stage.module.css)

The opt-in `trackDifficulties` flag records committed misses and explicit help
requests without imposing a support limit. A miss in the current round makes
the asked kind glow. Brightness and saturation filters dim the surroundings
while keeping the tree opaque. Lessons that omit the flag keep their existing
state shape.
[Reducer](../lib/lesson-runtime/lesson-runtime-reducer.ts)

Down the Chimney uses the separate opt-in [count-along window](down-the-chimney-counting.md#count-along-window) to defer judgement while listening.

In development, Next.js can log “Image with src … has either width or height
modified, but not the other” for item SVGs when one rendered dimension matches
its `<Image>` attribute exactly and the other differs. This warning has no
effect on rendering.

## Validation

The six `tests/christmas-tree-*.test.ts` suites cover seeded arrangements,
route parsing, lesson IDs and API allowlisting, spoken numbers, difficulty
tracking, SVG geometry, stage cues and theme copy. The full unit run passed
3,090 tests across 167 files.

The provider-free browser spec uses a synthetic microphone, local session and
mocked classifier. It covers all three rounds, cues and success moves, the
finale, early answer hiding, unclear and wrong answers, correction, Stop and
restart, reduced motion, matching lesson IDs in live setup and classification,
and diagnostics export. All 18 runs passed with `--repeat-each=3`.
[Browser spec](../tests/browser/christmas-tree.spec.ts)

## Not performed

Play on a real portrait phone with a child. Check whether the roughly 30 px
ornaments are legible, whether the child notices the picture bubble, how the
star and wrong-answer glows read and whether the success stagger feels right.

A silence pulse on the bubble and a fresh draw on Play again are deferred.
Play again reuses the same tree. Reload the unseeded route to draw a seed again.
