# Which Stocking counting

Run `npm run dev` and open `/scenes/which-stocking`. Append `?seed=N` to
reproduce a game, using a decimal integer from 0 to 99, or `?debug=1` for
diagnostics and export. An absent or invalid seed is drawn on the server.
Each allowlisted lesson ID is `counting-which-stocking-<seed>`, and `/api/live`,
`/api/classify` and `/api/sessions` accept only the canonical form. The server
and browser derive the same rounds from that seed using the shared Mulberry32.
[Route](../app/scenes/which-stocking/page.tsx) ·
[Plan](../lib/lesson-runtime/which-stocking-plan.ts) ·
[Lesson registry](../lib/lesson-runtime/lesson-registry.ts)

Sprout says a number and the child names the colour of the stocking with that
many candy canes. Rounds 1–3 hang pink and purple stockings whose counts are at
least 3 apart. Rounds 4–6 add a third stocking with any three different counts
from 1 to 5, and rounds 7–8 use three consecutive counts. Exactly one stocking
matches the target. The target never repeats in consecutive rounds, and the
answer colour never comes up three times running. The left-to-right colour
order changes every round, and the answer never sits in the same position three
rounds running.

The third colour is one constant, `THIRD_STOCKING_COLOUR`, set to gold and
ready to swap for blue if the child cannot name gold. A blue stocking asset
exists. The aliases follow the constant: gold accepts “yellow” and “golden”,
and blue has none.
[Lesson definition](../lib/lesson-runtime/which-stocking-lesson.ts)

## Spoken colour check

The lesson opts into `spokenColourCheck`. Every node must ask for one of at
least two distinct on-screen colours, and aliases may only map to those colours.
[Validation](../lib/lesson-runtime/lesson-definition.ts)

Snowflake Showdown extends it with child-only aliases and a narrower disclosure
rule; see its [colour check extension](snowflake-showdown-counting.md#colour-check-extension).

The reader takes the child's latest turn in the scene transcript. It recognises
on-screen colours, their aliases and common off-screen colours, so “red” is a
wrong answer rather than silence. In a self-correction the last colour wins:
“pink… no, purple” is purple. “Pink or purple” is held as alternatives,
“purple?” as a question and “not purple” as negated. With no colour, “that one”
or “over there” reads as pointing, then a number reads as the number said back,
then a bare pronoun such as “it” reads as pointing.
[Reader](../lib/lesson-runtime/spoken-colour.ts)

Ownership mirrors `latestChildNumber`. When the tutor says the answer colour
before the child first tries it, her repeat is an echo and cannot advance the
round. Only a second separate repeat counts, as assisted. Sprout must never
name a colour first: it gives the answer away and holds her right answer as an
echo. Only the answer colour is looked for in tutor turns, so Sprout naming her
wrong pick does not change ownership.

After the classifier runs, the check agrees with a matching “correct”. It vetoes
a “correct” that the reader contradicts: another colour becomes incorrect, an
echo becomes no answer, and anything else is unclear. It rescues a matching
answer only when the classifier is unsure, or sure only that the answer is
unclear. It never overrides a confident incorrect, no-attempt or needs-help
judgement. The agree/veto/rescue logic now lives in `spoken-answer-check.ts`,
shared with `spokenNumberCheck`, and the Child/Tutor turn parser is shared too.
Number behaviour is unchanged.
[Colour check](../lib/lesson-runtime/spoken-colour-check.ts) ·
[Shared check](../lib/lesson-runtime/spoken-answer-check.ts)

The `spokenColour` diagnostic records the action, the reader result and the
classifier outcome. When the reader found a colour it adds the pick, that
stocking's `count_<colour>` fact, the target and whether a wrong pick was a near
miss, one away from the target. It appears in the `/api/classify` diagnostic.
The runtime replays it and rejects any that do not match, then logs it as
`classifier.mapping`, so it reaches the `?debug=1` export. Ice Cream does not
set the option and still judges colours by the classifier alone.
[Route](../app/api/classify/route.ts) ·
[Diagnostic](../lib/lesson-runtime/live-classification-diagnostic.ts)

## Sprout's rules

Sprout explains the game once in round 1, then says only the number at each
round start. It never names, lists or hints at a colour before she names one,
offers a choice of colours or describes where a stocking hangs. The tutor copy
names no colour at all.
After a settled correct colour, Sprout says “[her colour] has three!” and counts
the canes once as they pop. A settled correct answer can advance the lesson
independently of tutor confirmation.

After a first wrong colour Sprout counts the stocking she picked, then says
“That one has two. We want three.” It may name the colour she said, but never
another. After a second miss it says “Let's count them all” and counts each
stocking as “this one”. A number said back gets “Which colour has three?” and
“that one” gets “What colour is it?” Sprout never claims to see pointing.
The lesson's `incorrectAnswerInstruction` replaces the generic repeat prompt
after a confidently wrong colour. A single silence nudge after 6 seconds
repeats only the number, with no colour, hint or question.

## Stage

The fire and hearth glow as the voice cue, in place of the status pill. A wrong
pick lights the canes of the stocking she named, one a second after a 500 ms
lead-in. The stage reads that colour from the current scene transcript with the
same reader, in the render that reports the miss. An off-screen colour still
counts as a miss but gets no highlight. A third or later miss lights her pick
again.
[Stage](../app/which-stocking-stage.tsx) ·
[Timeline](../app/which-stocking-timeline.ts)

On the second miss the stage sweeps every stocking left to right, 800 ms per
cane with a 500 ms gap between stockings. The right stocking then glows until
the round ends. This is the only answer marker before success. On success the
right stocking jiggles for 400 ms, its canes pop about every 750 ms, then a toy
drops onto the pile. At five canes this ends at 4.85 seconds, inside the
5-second `successHoldMs`. A 1.5-second `transitionQuietMs` lets Sprout's count
finish.

In the finale all three stockings fill with five canes, the fire crackles, snow
falls past the window and the full pile of eight toys shows with “Every stocking
is full!” Reduced motion keeps highlights, pops and the glow as brightness only.
It replaces the jiggle with a flash and fades the toy in, and removes the
finale movement and snow. Loaded-asset state sits above the per-round key, so
later rounds never show the loading cover.
[Styles](../app/which-stocking-stage.module.css)

Before success, the learner's screen, status and ARIA, alt and title text
contain no number or answer colour. No stocking carries `data-hint` until the
second miss's glow, and stockings carry only their own colour and count.
The “Purple has 3!” label appears only after success.
[Theme](../app/which-stocking-theme.ts)

## Artwork and layout

The hand-authored SVGs include pink, purple, gold and spare blue stockings,
stepped in value so they stay distinct in greyscale and for colour-blind
viewers. Blue also has a white heel and toe beside purple. Every cane is the
same pink and white, and the snow is reused from Christmas Tree.
[Artwork](../public/which-stocking/)

Placements are fractions of the 1600 × 900 background, and `caneFan` lays out
1–5 canes per stocking without overlaps. Tests compute on-screen sizes at
1440 × 800 and 390 × 844. Stockings are at least 100 px tall in portrait and
120 px in landscape, and every cane shows at least 40 px. A five-cane fan keeps
at least 4 px between canes on the phone. In the portrait crop the mantel, the
firebox opening and every stocking with its fullest fan are visible; the window
and toy pile are off-screen.
[Geometry](../app/which-stocking-scene.ts)

## Validation

The seven `tests/which-stocking-*.test.ts` suites cover plans, lesson IDs and
allowlisting, route parsing, scene geometry and sizes, miss and success timing,
stage rendering and theme copy. `tests/spoken-colour.test.ts` covers the reader,
and `tests/spoken-colour-check.test.ts` covers agree, veto, rescue, assisted,
Ice Cream, the diagnostic and option validation. The classifier route test
checks that the diagnostic is exported.

The provider-free browser spec uses a synthetic microphone, local session and a
mocked classifier that mirrors the server's colour check. It plays seed 0 to the
finale with varied answers, including “Yellow!” for gold. It covers a wrong
pick, the second-miss sweep and glow, the number back and pointing, an
off-screen colour, an echo then assisted repeat, the silence nudge and Stop and
restart. It also covers reduced motion and lesson IDs for seeds 0 and 1 and a
server-selected seed, with the diagnostics export. The reported run passed
33/33 with `--repeat-each=3` (about 2.4 minutes). The full unit suite passed
188 files / 3,595 tests, and the Down the Chimney browser spec still passed.
[Browser spec](../tests/browser/which-stocking.spec.ts)

## Not performed

Play on a real phone with a child. First check that she can name pink, purple
and gold; if gold is hard, change `THIRD_STOCKING_COLOUR` to blue. Check whether
“Three!” alone tells her what to find, whether she checks more than one
stocking, whether rounds 1–3 are easy wins and whether 4 against 5 in rounds
7–8 is a fun challenge. Check whether “That one has two” helps without feeling
like a telling-off, and whether five canes are easy to count on the phone.

Check whether the app-timed cane highlights line up with Sprout's counting: they
are not synchronised to speech. Check whether Sprout really avoids naming
colours on the live provider. Check whether the toy drop matters, since it is
unseen in portrait.

The brief's “more” or “fewer” later level and a fresh game on Play again are
deferred. The seed stays fixed for the page load.
