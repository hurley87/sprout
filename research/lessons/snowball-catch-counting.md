# Snowball Catch: Taking Turns to Count

Nov 16, 2026 · David Hurley

## Overview

A snowman and a penguin throw a snowball back and forth, and each throw needs the next number. Sprout says "one" for the snowman, she says "two" for the penguin, Sprout says "three", and so on until the snowball bursts into a snow shower.

In the other lessons she counts from one by herself. Here she listens to Sprout's number and gives the one that comes after it, which is harder than reciting the whole run. Sprout is a player in this game, not someone asking questions.

- **Route:** `/snowball-catch`
- **Lesson id:** `counting-snowball-catch`
- **Length:** five rallies and a finale
- **Counts:** rallies that go up to between 4 and 10

## Rallies

The rallies get longer, and from the third one on the length and who throws first are random.

| Rally | Counts up to | Who starts |
| --- | --- | --- |
| 1 | 4 | Sprout, so she says "two" and "four" |
| 2 | 5 | She does, so she says "one", "three" and "five" |
| 3 to 5 | Random from 6 to 10 | Random |

- **Both halves:** because the starter changes, she gets practice saying the odd numbers in some rallies and the even numbers in others.
- **No repeats in a row:** a rally never ends on the same number as the one before.
- **Stopping early:** the game can end after rally 2 on days when counting past five is too much.

## How a rally goes

Sprout explains the game once at the start: "Let's throw the snowball! I say a number, then you say the next one." Before a rally that she starts, Sprout says only "You start!"

| She does | What happens |
| --- | --- |
| Says the next number | The penguin throws the snowball back, a little bigger. Sprout says the number after hers and the snowman throws |
| Says a wrong number | The snowball plops into the snow at the penguin's feet. Sprout says its own number again with a lift, "Three...?", and the snowman throws again |
| Misses a second time | Sprout gives it to her: "Three... four! You say it." |
| Repeats Sprout's number | Same as a wrong number |
| Runs ahead, "four, five, six" | Her first number counts as her throw, and Sprout takes its turn with a laugh: "My turn! Five." |
| Says nothing for about 5 seconds | The snowman wiggles and Sprout repeats its number |
| Says the last number of the rally | The snowball bursts into a shower of snow and both of them cheer |
| Answers quickly several times in a row | The snowball starts to sparkle as it flies |

There is no losing. A dropped snowball is thrown again, and every rally ends in a snow shower.

## What she sees

A snowy garden with a snowman on the left and a penguin in a pink hat and scarf on the right, facing each other.

- **Snowman:** Sprout's player. It leans back and throws when Sprout says a number.
- **Penguin:** her player. It throws when she says the right number, so she sees her voice make it move.
- **Snowball:** flies in a high, slow arc and grows a little with every throw, so a long rally ends with a huge one.
- **Progress:** a row of pale snowflakes across the top shows how long the rally is, and one turns bright with each throw. There are no numerals.
- **Dropped snowball:** lands softly in the snow and rolls back to the snowman.
- **Snow shower:** the snowball bursts overhead and snow falls on both players.
- **Glow cue:** the penguin's scarf glows on her turn in place of the talking and listening pill.
- **Finale:** the snowman and the penguin build a small snowman together from the last snowball. Nothing is asked.
- **Reduced motion:** the snowball fades from one player to the other without an arc.

## Runtime notes

This fits the existing voice flow well, because each of her turns is one word judged after she goes quiet. The new part is many turns inside one node. This is based on the repo docs, not the code.

- **Nodes:** `rally-1` to `rally-5`, then the finale. A node succeeds when the rally reaches its last number.
- **Turns inside a node:** the app keeps the next expected number for the rally and moves it on after each correct turn. Today a node is one question and one answer, so this is new.
- **Random values:** when the game starts, the server picks each node's last number and who starts, as per-game node facts. Tests pass a fixed seed.
- **Tutor brief:** say exactly one number on each turn, the one the app gives, and nothing else. Do not count ahead, and do not correct her.
- **Number per turn:** the app sends the tutor its next number before each of its turns, so the tutor cannot drift out of step with the game.
- **Checking her turn:** look for the expected number word in the transcript of her turn, using the first number she says.
- **Throws:** the snowman's throw starts when the tutor's audio starts, and the penguin's throw starts when her turn is judged correct.
- **Pace:** every turn waits for her to go quiet before it is judged. Keep that wait as short as the microphone detection allows, since it sets the rhythm of the rally.
- **Diagnostics:** log which numbers she missed and how long each of her turns took.

## What to test with her

The thing to find out is whether she can give the next number after hearing Sprout's, or whether she needs to start again from one each time.

- [ ] **Taking turns:** she waits for Sprout's number and does not count straight through.
- [ ] **Next number:** she gives the number after Sprout's without restarting from one.
- [ ] **Starting a rally:** she says "one" when Sprout says "You start!"
- [ ] **Rhythm:** the gap between her number and the penguin's throw is short enough to feel like a game of catch.
- [ ] **Sprout stays in step:** the tutor says one number per turn and never skips or counts ahead.
- [ ] **Dropped snowballs:** a miss feels like a fumble in a game, not a wrong answer.
- [ ] **Past five:** rallies to 6 and beyond are a fun stretch. If not, keep every rally at 4 or 5.
- [ ] **Running ahead:** note how often she counts on by herself, and whether "My turn!" brings her back.

## Later level

A rally starts from a number other than one. Sprout says "four" to begin, and she carries on from there.
