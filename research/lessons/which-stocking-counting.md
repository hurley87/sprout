# Which Stocking? Finding a Number

Nov 16, 2026 · David Hurley

## Overview

Stockings hang over the fireplace, each with a different number of candy canes poking out. Sprout says a number, "Three!", and she says which stocking has that many: "the purple one!"

In every other lesson she looks at things and says a number. Here she hears the number first, checks several groups to find it, and answers with a colour.

- **Route:** `/which-stocking`
- **Lesson id:** `counting-which-stocking`
- **Length:** eight rounds and a finale
- **Counts:** random, 1 to 5 candy canes per stocking

## Rounds

The rounds add a stocking and move the amounts closer together, and the amounts, the number Sprout says and where each stocking hangs are random.

| Rounds | Stockings | Candy canes in each |
| --- | --- | --- |
| 1 to 3 | Two: pink and purple | Far apart, such as 1 and 4 |
| 4 to 6 | Three: pink, purple and gold | Any three different amounts |
| 7 and 8 | Three: pink, purple and gold | Close together, such as 3, 4 and 5 |

- **All different:** no two stockings in a round hold the same amount, so only one answer is right.
- **No repeated numbers:** Sprout never says the same number two rounds running.
- **Colour mix:** the right answer is never the same colour more than twice in a row.
- **Shuffled places:** the stockings swap positions between rounds, so she cannot learn that the answer is "the one on the left".

## How a round goes

Sprout explains the game once at the start: "I'll say a number. You find the stocking with that many candy canes, and tell me its colour." After that Sprout only says the number.

1. The stockings appear with their candy canes.
2. Sprout says just the number: "Three!"
3. She says the colour of the stocking with that many.

| She does | What happens |
| --- | --- |
| Says the right colour | The stocking jiggles, the candy canes pop out one at a time while Sprout counts them, and a toy drops onto the pile by the fire |
| Says a wrong colour | The candy canes in the stocking she picked light up one at a time while Sprout counts them: "That one has two. We want three." Then the game waits |
| Misses a second time | Sprout counts each stocking in turn, and the right one glows |
| Says the number back, "three" | Sprout asks "Which colour has three?" |
| Says "that one" or points | Sprout asks "What colour is it?" |
| Says nothing for about 6 seconds | Sprout repeats the number |

A wrong pick is still useful: she hears that stocking counted, so she learns what it holds and can try again.

## What she sees

A brick fireplace with a warm fire, and big stockings hanging in a row from the mantel.

- **Stockings:** large and plainly coloured in pink, purple and gold, with white cuffs, hung well apart.
- **Candy canes:** poke out of the top of each stocking in a fan, every one fully visible and not crossing another. They are pink and white striped in every stocking, so colour only tells the stockings apart.
- **Mantel:** bare apart from the stockings, so there is nothing else to count.
- **Toy pile:** grows by one toy per round on the floor beside the fire. It is never counted.
- **Glow cue:** the fire glows brighter on her turn in place of the talking and listening pill.
- **Finale:** all the stockings fill up with candy canes, the fire crackles, and snow falls past the window. Nothing is counted.
- **Reduced motion:** the jiggle and the popping candy canes become a brief highlight.

## Runtime notes

This is close to the existing lessons, a still scene and one spoken answer per node, except the answer is a colour and a wrong answer gets its own feedback. This is based on the repo docs, not the code.

- **Nodes:** `stocking-1` to `stocking-8`, then the finale. A node succeeds when she says the colour of the stocking that holds the number.
- **Random values:** when the game starts, the server picks each node's stockings, their amounts and positions, and the number to find, as per-game node facts. Tests pass a fixed seed.
- **Tutor brief:** say only the number, and never say or hint at the colour.
- **Checking the answer:** look for a colour word in the transcript of her turn, with the classifier as a fallback for unclear answers. Accept "yellow" for gold.
- **Wrong-colour feedback:** the app tells the tutor which stocking she picked and how many it holds, so the tutor can count that one.
- **Count-along:** the candy canes pop or light up on the app's timing at roughly one a second, not synced to the tutor's speech.
- **Diagnostics:** log which stocking she picked and how many it held. A pick that is one away from the number is a near miss.

## What to test with her

First check that she knows pink, purple and gold by name, because her answer depends on it.

- [ ] **Colour names:** she can name each stocking's colour before any counting. If gold is hard, swap it for blue.
- [ ] **One word is enough:** she understands that "Three!" means find the stocking with three.
- [ ] **She checks more than one:** she looks at each stocking and does not just name the first one she counts.
- [ ] **Two stockings first:** rounds 1 to 3 are easy wins.
- [ ] **Close amounts:** telling 4 from 5 in rounds 7 and 8 is a fun challenge. If not, keep the amounts far apart.
- [ ] **Wrong picks:** hearing "that one has two" helps her and does not feel like a telling-off.
- [ ] **Candy canes are countable:** five in one stocking are still easy to tell apart on a phone.
- [ ] **Sprout stays quiet:** the tutor says only the number and does not give away the colour.

## Later level

Sprout says "more" or "fewer" in place of a number, and she names the stocking with the most or the fewest candy canes.
