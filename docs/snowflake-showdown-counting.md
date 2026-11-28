# Snowflake Showdown counting

Run `npm run dev` and open `/scenes/snowflake-showdown`. Append `?seed=N` to
reproduce a game, using a decimal integer from 0 to 99, or `?debug=1` for
diagnostics and export. An absent or invalid seed is drawn on the server.
Each allowlisted lesson ID is `counting-snowflake-showdown-<seed>`, and
`/api/live`, `/api/classify` and `/api/sessions` accept only the canonical form.
The server and browser derive the same rounds from that seed using the shared
Mulberry32.
[Route](../app/scenes/snowflake-showdown/page.tsx) ·
[Plan](../lib/lesson-runtime/snowflake-showdown-plan.ts) ·
[Lesson registry](../lib/lesson-runtime/lesson-registry.ts)

Two mittens flip over together, the snowman's blue one on the left and her pink
one on the right, and the child calls which has more snowflakes. She never says
a number. Each mitten shows 1–6 snowflakes and the two amounts never tie. The
gap between them is 3 or more in rounds 1–3, exactly 2 in rounds 4–7 and exactly
1 in rounds 8–10. The same two amounts never appear in consecutive rounds,
whichever side has more.

The order of which side has more is drawn whole, in one seeded draw, from every
ten-round sequence that gives each side 4–6 rounds and never has one side three
times running. A round-by-round pick could paint itself into a corner, so the
plan has no retry loop and always finishes. Each round then draws its pair from
its tier, minus the previous round's pair. Nodes are `showdown-1` to
`showdown-10`, with flat facts for the answer, `count_blue`, `count_pink`, the
gap, the round and the tier.
[Lesson definition](../lib/lesson-runtime/snowflake-showdown-lesson.ts)

`snowflakeLayout` picks which palm slots hold each mitten's snowflakes. Every
(seed, round, colour) has its own seeded stream, separate from the plan's, so a
layout can never change the counts, and only the stage uses it. A mitten never
repeats its previous round's slot set, so she cannot judge by the shape.

## Colour check extension

The lesson opts into the [spoken colour check](which-stocking-counting.md#spoken-colour-check)
with a new `childAliases` map. Me, mine and my mean pink, and you, yours and
snowman mean blue. Child aliases are read only in her turns, because perspective
words flip by speaker. The tutor's “yours” in “Pink is yours” means pink, and
the tutor's “you” in “Can you tell me?” means her, not the snowman. Read in
tutor turns, they would make ordinary tutor speech look like it named a colour.
Validation rejects child aliases that shadow a colour or a reader word such as
“that” or “it”, or that share a word with `aliases`.
[Reader](../lib/lesson-runtime/spoken-colour.ts) ·
[Validation](../lib/lesson-runtime/lesson-definition.ts)

A tutor turn now gives the answer away only when it names the answer colour and
no other on-screen colour. A turn that names the choices tells her what the
options are, not which one is right. The intro, “Pink is yours and blue is the
snowman's”, names both mittens. Under the old rule it would have made every
answer an echo, and the round could never advance on her first call. Off-screen
colours do not count as other choices, so “red or blue?” still gives blue away.
Because tutor turns are read without `childAliases`, the tutor's “you” never
gives blue away either.

The `spokenColour` diagnostic adds `choiceCounts`, the `count_<colour>` fact
for each on-screen colour in on-screen order. The gap between the mittens is
therefore logged with every answer, including a number or “that one”. The
runtime replay recomputes it from the node facts, so a forged or stale count is
rejected.
[Colour check](../lib/lesson-runtime/spoken-colour-check.ts) ·
[Diagnostic](../lib/lesson-runtime/live-classification-diagnostic.ts)

Which Stocking is unchanged. It sets no child aliases, a one-colour tutor
question still gives its answer away, and its tests and browser spec pass
unchanged. Its diagnostic now also carries `choiceCounts` for its stockings.

The known trade-off is that casual phrases with a perspective word carry a side.
“My turn” and “me too” read as pink. The check still never overrides a
confident no-attempt judgement, so this matters only when the classifier is
unsure or agrees.

## Sprout's rules

Sprout gives the intro once in round 1: “Pink is yours and blue is the
snowman's. When they flip, tell me who has more snowflakes!” At later round
starts it says nothing and listens, and it never asks again. It never names,
hints at or describes which mitten has more, or how many snowflakes either has,
before she calls it. It never says the snowman wins or that she lost.

After a settled correct call Sprout echoes only “[her colour] has more!” and
pauses with no question. A settled correct answer can advance the lesson
independently of tutor confirmation.

After a first wrong call Sprout says only “Look, some are left over. Who has
more?” The glowing left-over snowflakes show the side, so the line names no
colour. The brief's “Look, blue has some left over” would name the answer colour
alone. Her next correct call would then be an echo that cannot finish the round.

After a second miss Sprout says both counts and the answer as one turn, pink
first: “Pink has two. Blue has four. Blue has more!” As one turn it names both
mittens, so her repeat after it counts. If a child turn splits it, the last
tutor turn names the answer alone. Her first repeat is then an echo and only a
second separate repeat counts, as assisted. The runtime groups tutor speech by
her turns, so two output bursts with no child turn between are still one turn.
The browser spec pins both behaviours.

If she says a number, or “that one”, Sprout asks “Which mitten has more?” The
lesson's `incorrectAnswerInstruction` replaces the generic repeat prompt after
a confidently wrong call. There is no silence nudge because the stage wiggles
the mittens instead. The 2.5-second `successHoldMs` and 1-second
`transitionQuietMs` keep rounds quick. Live replies pause 300–800 ms between
sentences, so 1 second still outlasts any pause inside the echo.

## Stage

Before Play both mittens show their knitted backs. Once the round has rendered
and the art has loaded, they flip together over 500 ms with a soft swish. The
pink mitten's cuff is the voice cue, in place of the status pill. It shimmers
cool while Sprout talks and glows warm on her turn, breathing as she speaks. The status text stays for screen readers.
[Stage](../app/snowflake-showdown-stage.tsx) ·
[Timeline](../app/snowflake-showdown-timeline.ts)

On success the mitten with more dances for 600 ms. The snowman claps when blue
has more and shrugs happily when pink does. A star leaves the mitten at 500 ms
and turns gold in her row on landing, 1.5 seconds in. The third clean
first-try round in a row blows a flurry across the sky between the stars and
the mittens, then the run starts over. A miss or Stop and Play resets it. The
sequence ends by 2.1 seconds, inside the 2.5-second hold.

The first miss in a round starts the pairing. After a 500 ms lead-in, one line
joins a snowflake on each mitten every 500 ms, then the leftovers glow gold. The
timing is the app's and is not synchronised to speech. Each line has a white
casing, and the pair's two snowflakes are ringed in the line's tint. None of the
five tints is gold. Lines are drawn above the snowflakes because a line can pass
another snowflake. Drawn beneath it, that snowflake would look joined. The
pairing stays until the round ends, and a second miss does not restart it.

After 5 seconds of quiet both mittens wiggle, up to 3 times per round. The wait
restarts at the latest of the flip ending, her turn ending and the tutor going
quiet. Speech, a speech candidate or tutor output cancels it.

In the finale the ten stars swirl into one big snowflake, and the snowman and
both mittens dance under “All ten stars are yours!” Reduced motion fades the
mittens instead of turning them, draws the pairing at once and turns the star
gold in place. Dances and wiggles become a brightness flash. The flight,
flurry, swish, snowman hop, cuff breathing and finale swirl and dancing are
removed. Loaded-asset state and the streak sit above the per-round key, so
later rounds never show the loading cover.
[Styles](../app/snowflake-showdown-stage.module.css)

Before success, the learner's screen, status and ARIA, alt and title text
contain no colour word or number apart from the progress labels. No attribute
is named for the answer or the gap. Attributes that name a colour are the same
for both mittens. Pairing markers appear only after a miss. The “Pink has
more!” label appears only after success. The star row is the main progress. The
shared progress list stays for screen readers, as “Scene 3, playing now”, and
keeps the Stop button's place, styled down to small frosty dots.
[Theme](../app/snowflake-showdown-theme.ts)

## Artwork and layout

The hand-authored SVGs include a snowy yard, mirrored mittens with knitted
backs, one snowflake, four snowman poses, a pale star and a flurry. The gold
star is reused from Christmas Tree. Blue is the darker mitten, with a striped
cuff and zigzag bands on its back. Pink is lighter, with a plain cream cuff and
a heart on its back. They differ in value, cuff and pattern, so they stay
distinct in greyscale and for colour-blind viewers.
[Artwork](../public/snowflake-showdown/)

Placements are fractions of the 1600 × 900 background. Each palm has nine
same-size slots in a loose staggered grid, where no three line up and no two
touch. Pink's are blue's mirror image. `pairingLines` ranks every one-to-one
pairing by crossing lines, then lines passing behind another snowflake, then
total length. Tests check that no line crosses in any of the 1,000 rounds that
seeds 0–99 can show, or in over 10,000 other layouts. A line can still pass a
snowflake when no pairing avoids it. Measured for this doc, that happens in 327
of those 1,000 rounds, about one in three, and mostly in the close tiers.
[Geometry](../app/snowflake-showdown-scene.ts)

Tests compute on-screen sizes at 1440 × 800 and 390 × 844. Every snowflake
paints at least 28 px across with at least 8 px between neighbours on the phone.
Both mittens, their cuffs, every slot and the star row stay clear of the status
pill and progress bar. In portrait about a third of the snowman, his outer arm
and the edge of his body, is cropped, but his head, hat and scarf stay visible.
The pines, sun and sled are landscape-only.

## Validation

The seven `tests/snowflake-showdown-*.test.ts` suites cover plans and layouts,
lesson IDs, allowlisting and tutor copy, route parsing, scene geometry, pairing
lines and sizes, the pairing, silence, streak and success timelines, stage
rendering and theme copy. `tests/spoken-colour.test.ts` covers child aliases, the tutor's
perspective words and listed choices. `tests/spoken-colour-check.test.ts`
covers agree, veto, rescue, assisted, `choiceCounts`, the diagnostic replay and
option validation. The classifier route test checks that `choiceCounts` is
exported.

The provider-free browser spec uses a synthetic microphone, local session and a
mocked classifier that mirrors the server's colour check, child aliases
included. It plays seed 0 to the finale with every side word and covers the
intro and the tutor's “you”, a wrong call's pairing and leftovers, and the
one-turn count after a second miss. It covers a count split over two outputs, a
turn naming only the answer then an echo and assisted repeat, and a number or
“that one”. It also covers the silence wiggle, the flurry and streak reset, Stop
and restart, reduced motion and lesson IDs for seeds 0 and 1 and a
server-selected seed, with the diagnostics export. The reported run passed 45/45
with `--repeat-each=3` (about 3.7 minutes). The full unit suite passed 195 files
/ 3,947 tests, and the Which Stocking browser spec still passed.
[Browser spec](../tests/browser/snowflake-showdown.spec.ts)

## Not performed

Play on a real phone with a child. Check whether she understands “more” and
picks the bigger side at a glance in rounds 1–3, and whether she says pink and
blue, or me and you, without help. Check that she calls blue when blue has more
rather than always her own mitten, and whether she slows down and counts in
rounds 8–10. Check whether the pairing makes sense after a wrong call, whether
the next flip comes quickly enough and whether six snowflakes are easy to count
on the phone.

Check whether the pairing still makes sense when a line passes a snowflake.
Check whether casual “me” or “my” phrases cause false pink calls. Check whether
Sprout really stays quiet after the intro on the live provider, and only echoes
her call.

The brief's tie or “same!” level and its “fewer” level are deferred, as is a
fresh game on Play again. The seed stays fixed for the page load.
