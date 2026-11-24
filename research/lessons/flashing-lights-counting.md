# Flashing Lights: Quick Counting Game

Nov 16, 2026 · David Hurley

## Overview

Ten lights hang on a string, five red and five blue, and each round a few of one colour start flashing. She says how many and what colour, "three red!", and the next pattern starts straight away.

The flashing lights are the prompt, so Sprout never asks a question; that makes it quicker than Christmas Lights, where the lights freeze and Sprout names a colour. She also has to pick the flashing lights out from the steady ones, among lights of both colours.

- **Route:** `/flashing-lights`
- **Lesson id:** `counting-flashing-lights`
- **Length:** ten quick rounds and a finale
- **Counts:** random, 1 to 5 flashing lights

## Rounds

Every round flashes lights of one colour only, and the colour, the number and which bulbs flash are all random.

| Rounds | Flashing lights | Colour |
| --- | --- | --- |
| 1 to 3 | 1 to 3 | Red or blue, at random |
| 4 to 10 | 1 to 5 | Red or blue, at random |

- **No repeated answers:** the number is never the same two rounds running.
- **Colour mix:** the same colour never comes up more than twice in a row.
- **Scattered:** the flashing bulbs are spread along the string, with steady bulbs of both colours in between.
- **They keep flashing:** the lights flash until she answers, so she never has to remember what she saw.

A later step, once this is easy: both colours flash at once and she says each in turn, "two red, three blue".

## How a round goes

Sprout explains the game once at the start: "Some lights are going to flash! Tell me how many, and what colour." After that Sprout only echoes her answers.

| She says | What happens |
| --- | --- |
| The right number and colour, "three red" | The flashing lights burst into sparkles, the star on top flashes that colour, and Sprout echoes "Three red!" |
| Just the right number, "three" | Counts as right. The lights sparkle and Sprout adds the colour: "Three red!" |
| The right number, wrong colour | Counts as right. Sprout echoes it with the correct colour |
| A wrong number | The steady lights dim, the flashing ones slow down, and the game waits for another try |
| A wrong number again | The flashing lights light up one at a time while Sprout counts them |
| Nothing for about 6 seconds | The steady lights dim so the flashing ones stand out more |

The number is what counts. Saying the colour as well earns the star flash, but she is never marked wrong for leaving it out or mixing it up.

Each right answer also lights one star on a garland across the top of the screen, and ten lit stars start the finale.

## What she sees

A Christmas tree with a star on top and one string of ten big bulbs zigzagging down it, on a plain dark-blue evening background.

- **Bulbs:** five red and five blue, mixed along the string in an order that changes each game. Red bulbs are round and blue bulbs are pointed, so they differ by shape as well as colour.
- **Steady lights:** glow softly at a constant, low brightness.
- **Flashing lights:** pulse between bright and dim about once a second and grow slightly as they brighten. They never go fully dark, so she can always see where they are.
- **Gentle flash:** a soft pulse, never a hard strobe, and all flashing bulbs pulse together.
- **Nothing else to count:** the tree has no ornaments, so the bulbs are the only things on it.
- **Star:** glows gold on her turn in place of the talking and listening pill, and flashes red or blue when she names the colour.
- **Star garland:** ten small unlit stars across the top of the screen, one lighting up per right answer.
- **Finale:** every bulb flashes in a slow wave down the tree, red then blue, and snow begins to fall.
- **Reduced motion:** flashing bulbs get a steady bright halo and do not pulse.

## Runtime notes

Each round is one spoken answer judged after she goes quiet, on one scene whose bulbs change state between nodes. This is based on the repo docs, not the code.

- **Nodes:** `flash-1` to `flash-10`, then the finale. A node succeeds when she says its number.
- **Random values:** the server picks the bulb order once per game, then each node's colour, number and which bulbs flash, as per-game node facts. Tests pass a fixed seed.
- **Scene:** one tree for the whole game. Moving to the next node only changes which bulbs flash, so there is no scene swap to wait for.
- **Checking the answer:** look for the number word in the transcript of her turn. The colour word is read too, but only to decide the star flash and for diagnostics.
- **A quiet tutor:** the tutor brief says not to ask anything. After a right answer the app tells the tutor to say only the echo, "Three red!".
- **Pace:** the lessons today wait for a second of tutor quiet before moving on. Keep that, and start the next pattern as soon as the echo ends.
- **Diagnostics:** log whether she gave the colour, and whether it was right, separately from the number.

## What to test with her

The first thing to check is whether she can tell flashing lights from steady ones well enough to count them.

- [ ] **Flashing is clear:** she can point to the flashing bulbs before any counting.
- [ ] **Counting while they pulse:** she can keep her place even though the bulbs brighten and dim.
- [ ] **She answers unprompted:** she says a number when the lights start, without Sprout asking.
- [ ] **Number and colour:** see whether she naturally says both, or just the number. Do not coach it at first.
- [ ] **Colour names:** she knows red and blue by name.
- [ ] **Pace:** the next pattern arrives quickly enough to feel like a game and not so fast it flusters her.
- [ ] **Ten rounds:** she is still keen at round ten. If not, cut to six.
- [ ] **Two-word answers:** "three red" is transcribed correctly when she says it fast.
