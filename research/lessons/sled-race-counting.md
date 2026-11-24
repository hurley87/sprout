# Sled Race: First, Second, Third

Nov 16, 2026 · David Hurley

## Overview

Elves on coloured sleds race down a snowy hill and park in a row in the order they finished. Sprout says a position, "Second!", and she says which sled it was: "the pink one!"

Every other lesson is about how many. This one is about order, which uses a different set of number words: first, second, third, fourth and last.

- **Route:** `/sled-race`
- **Lesson id:** `counting-sled-race`
- **Length:** six races and a finale
- **Positions:** first to third, then first to fourth

## Races

The races add positions and then a fourth sled, and the finishing order and the position Sprout asks for are random.

| Races | Sleds | Sprout says |
| --- | --- | --- |
| 1 and 2 | Three: pink, purple and gold | "First!" |
| 3 and 4 | Three: pink, purple and gold | "First!", "Second!", "Third!" or "Last!", at random |
| 5 and 6 | Four: pink, purple, gold and blue | Any position from first to fourth, or "Last!" |

- **Random finish:** the finishing order is different every race.
- **Colour mix:** the right answer is never the same colour more than twice in a row.
- **Different winners:** the same sled never wins two races running.
- **One question per race:** each race asks about one position, so the game keeps moving.

## How a race goes

Sprout explains the game once at the start: "The elves are racing! When they finish, I'll say first, second or third, and you tell me which colour it was." After that Sprout only says the position.

1. The sleds line up at the top and race down for about four seconds, with a few overtakes on the way.
2. They cross the finish one at a time and park in a row beside the flag, the winner nearest the flag.
3. Sprout says just the position: "Second!"
4. She says the colour.

| She does | What happens |
| --- | --- |
| Says the right colour | That elf jumps up and gets a ribbon, and Sprout echoes it: "Pink was second!" |
| Says a wrong colour | The sleds light up one at a time from the flag while Sprout counts along, "First... second!", stopping on the right one. Then the game waits |
| Misses a second time | Sprout counts along again and the right elf waves |
| Says a number or "that one" | Sprout asks "What colour is it?" |
| Says nothing for about 6 seconds | Sprout repeats the position |

The sleds stay parked in order until she answers, so she can work it out by counting along the row from the flag. She does not have to remember the race.

## What she sees

A side view of a snowy hill sloping down to a finish flag at the bottom right, under a bright winter sky.

- **Sleds:** large and plainly coloured in pink, purple, gold and blue, each with an elf in a matching hat.
- **The race:** the sleds bob and swap places on the way down, slowly enough to follow.
- **Finish row:** the sleds park in one row, well spaced and all facing the flag, with the winner nearest to it.
- **No numbers shown:** there is no podium and there are no numerals, so the order comes only from where each sled is parked.
- **Ribbons:** a ribbon stays on each elf that she has named correctly. Ribbons are never counted.
- **Glow cue:** the finish flag glows in place of the talking and listening pill.
- **Finale:** all the elves pile onto one long sled and ride down together. Nothing is asked.
- **Reduced motion:** the race is skipped, and the sleds fade in one at a time at their parked spots in finishing order.

## Runtime notes

Each race is one spoken colour judged after she goes quiet, on a scene that animates and then settles. This is based on the repo docs, not the code.

- **Nodes:** `race-1` to `race-6`, then the finale. A node succeeds when she says the colour of the sled in the position asked.
- **Random values:** when the game starts, the server picks each node's finishing order and the position to ask, as per-game node facts. Tests pass a fixed seed.
- **Scene phases:** each node's scene moves through racing and finished. Scenes are static today, so this is new.
- **Position call waits for the finish:** the UI confirms the parked row is on screen before the tutor is told to say the position, using the existing render confirmation.
- **Tutor brief:** stay silent during the race, then say only the position word. Never say or hint at the colour.
- **Checking the answer:** look for a colour word in the transcript of her turn, with the classifier as a fallback for unclear answers. Accept "yellow" for gold.
- **Count-along:** the sleds light up on the app's timing at roughly one a second, not synced to the tutor's speech.
- **Diagnostics:** log the position of the sled she picked. Picking the winner when asked for "last" is a different mistake from being one place out.

## What to test with her

Find out first which position words she already knows; most three-year-olds know "first" and "last" well before "second" and "third".

- [ ] **Colour names:** she can name each sled's colour before any racing.
- [ ] **First:** she can name the winner in races 1 and 2.
- [ ] **Last:** she understands it means the sled furthest from the flag.
- [ ] **Second and third:** note which of these she gets, and whether the count-along helps.
- [ ] **Reading the row:** she knows the winner is the one nearest the flag.
- [ ] **The race:** the overtakes are exciting and she can still follow who is where.
- [ ] **Four sleds:** a fourth sled is a fun stretch. If not, keep every race at three.
- [ ] **Sprout stays quiet:** the tutor says only the position and does not give away the colour.

## Later level

Sprout asks about neighbours in the row: "Who was just in front of pink?"
