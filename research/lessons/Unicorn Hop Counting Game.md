# Unicorn Hop: Counting Game

Nov 14, 2026 · @David Hurley

## Overview

Her counting is the controller: each number she says makes a unicorn hop one stepping stone toward the castle. Sprout does not ask a question each round. The stones are the prompt, and Sprout only cheers at the end or nudges if she stalls.

She sees the unicorn land on exactly one stone per number, which teaches one number per object, in order. Counting smoothly earns a rainbow trail, but a slow crossing still gets across.

- **Route:** `/unicorn-hop`
- **Lesson id:** `counting-unicorn-hop`
- **Length:** six crossings and a finale
- **Counts:** random every game, from 2 to 6, then 7 to 10 on the two stretch crossings

## Crossings

The number of stones in each crossing is picked at random, so she cannot learn the pattern and has to count what is in front of her.

| Order | Stones | She hops across | Setting |
| --- | --- | --- | --- |
| 1 | Random, 2 to 4 | Pink stepping stones | A sparkly stream |
| 2 | Random, 2 to 6 | Heart-shaped lily pads | A lavender pond |
| 3 | Random, 2 to 6 | Cotton-candy clouds | Up into the sky |
| 4 | Random, 2 to 6 | Gold stars | Across the night sky |
| 5 | Random, 7 to 10 | Rainbow steps | Down the rainbow |
| 6 | Random, 7 to 10 | Castle stairs | Up to the castle door |
| 7 | Finale, nothing counted |  | Unicorn party inside the castle |

- **No repeats in a row:** a crossing never has the same number of stones as the one before it.
- **Easy start:** the first crossing is always short so she gets a quick win.
- **Stretch crossings:** 5 and 6 go past the range she knows, and the game can end after crossing 4 on days she is done.

## How a crossing goes

Sprout explains the game once at the start: "Help the unicorn get to the castle! Count the stones to make her hop." After that, each crossing just appears and waits for her.

| She does | What happens |
| --- | --- |
| Says the next number | The unicorn hops to the next stone, which lights up pink |
| Says the last number | The unicorn lands on the far side and Sprout cheers |
| Goes quiet for about 4 seconds | The next stone glows and pulses |
| Stays quiet for about 8 seconds | Sprout whispers a nudge: "What comes after two?" |
| Skips a number | The unicorn wobbles and stays put, and the missed stone glows |
| Keeps counting past the end | Nothing; the unicorn is already across |
| Counts the whole way with no long pause | A rainbow trail follows the unicorn |

There is no timer, nothing chasing her, and no way to fail a crossing. The rainbow trail is the only reward for speed, so she is pulled toward counting smoothly without being pushed into rushing and skipping numbers.

## Cupcake stops

On some crossings a pink cupcake sits on a random stone partway across, and she has to stop counting when the unicorn reaches it. The stones carry on past the cupcake, so counting too far is possible.

| She does | What happens |
| --- | --- |
| Stops on the cupcake stone for about 1.5 seconds | The unicorn eats the cupcake, then flies the rest of the way in a burst of sparkles |
| Counts one past the cupcake | The unicorn stops and looks back, Sprout says "Oops, we hopped past the cupcake!", and the unicorn trots back to the start |
| Hops past it a second time | Sprout counts along with her and says "stop!" on the cupcake stone |

- **Which crossings:** crossings 2 to 4 each have an even chance of a cupcake, with at least one per game. Crossing 1 and the stretch crossings never have one.
- **Where it sits:** cupcake crossings have 4 to 6 stones, and the cupcake is on a random stone from the second to the second-last.
- **No counting on:** she never has to pick up the count from the middle, because the unicorn flies the rest of the way.
- **Rainbow trail:** on a cupcake crossing the smooth-run rule only covers the hops up to the cupcake.
- **Detecting the stop:** the hop count equals the cupcake stone and her microphone stays quiet for about 1.5 seconds. This works with stage 1 hop detection.

A harder version for later: hide the cupcake inside a stone and have Sprout say "The cupcake is under stone four," so she has to stop on a number rather than on what she sees.

## What she sees

The screen is a side view of one crossing: the unicorn on the left, a row of stones, and the destination on the right.

- **Unicorn:** white with a pink and purple mane, drawn large enough that each hop is easy to follow.
- **Stones:** evenly spaced in one row and pale until landed on, when they turn bright pink and stay lit. The lit stones show how far she has counted.
- **Backdrop:** pink and lavender sky with the castle always visible in the distance, getting bigger with each crossing.
- **Hop:** a quick arc with a small sparkle on landing.
- **Rainbow trail:** a ribbon that draws behind the unicorn during a smooth run and fades after the crossing.
- **Glow cue:** the same glowing unicorn horn as the Silly Sprout lesson, resting on her turn for most of the game.
- **Finale:** the castle doors open on a unicorn party with gentle confetti. Nothing is counted.
- **Reduced motion:** hops become instant moves and the trail is a static ribbon.

## Runtime notes

The new work is reacting to each number as she says it; today a child turn is judged only after she goes quiet. This is based on the repo docs, not the code.

**Nodes**

One node per crossing: `hop-stones`, `hop-lilypads`, `hop-clouds`, `hop-stars`, `hop-steps`, `hop-stairs`, then the finale. The server picks each node's stone count N when the attempt starts, so N is a per-attempt node fact rather than an authored one. A node succeeds when she has said 1 to N in order. Tests pass a fixed seed so the counts are repeatable.

**Hearing each number, in two stages**

| Stage | Hop trigger | Catches a skipped number | Effort |
| --- | --- | --- | --- |
| 1 | Each burst of her voice from the local microphone detection, capped at N hops | Only at the end, from the transcript | Small |
| 2 | Each number word in a streaming transcript | As it happens, with the wobble | Larger |

- **Stage 1 end check:** when she goes quiet, read the transcript for the numbers 1 to N in order. If they are there, finish any hops still owed and celebrate. If not, the unicorn trots back and Sprout says "Let's count them together."
- **Stage 1 limits:** fast counting can blur into one burst, so hops may lag her voice. A non-number sound such as a giggle also causes a hop.
- **Count check:** matching number words in the transcript is a plain text check, so it does not need the semantic classifier.

**A quiet tutor**

- The tutor brief for hop nodes says to stay silent until the app signals a finished crossing or a stall.
- Stall nudges are app-timed: the app sends the nudge instruction at about 8 seconds with the next number as a node fact.
- Hops are ignored while tutor audio is playing, so Sprout's own voice never moves the unicorn.

**Smooth-run rule**

The rainbow trail shows when no gap between her numbers is longer than about 2 seconds. Tune this number with her; it should be reachable on most tries.

## What to test with her

The game only works if a hop feels instant, so test hop timing on a real phone first.

- [ ] **Hop delay:** the unicorn moves within a blink of each number, not after she has finished counting.
- [ ] **Hops match numbers:** in stage 1, count how often the hops and her numbers get out of step.
- [ ] **She starts on her own:** she begins counting when a crossing appears, without Sprout or a parent asking.
- [ ] **Sprout stays quiet:** the tutor does not talk over her or fill short silences.
- [ ] **Nudge timing:** 4 and 8 seconds feel helpful, not naggy or too slow.
- [ ] **Rainbow trail:** she notices it, wants it, and does not start skipping numbers to get it.
- [ ] **Stretch crossings:** counts of 7 to 10 are fun rather than frustrating. If not, end after crossing 4 for now.
- [ ] **Background noise:** a TV or sibling in the room does not move the unicorn.
- [ ] **Cupcake stops:** she stops on the cupcake on purpose, and a 1.5 second pause feels right rather than catching her mid-breath.
