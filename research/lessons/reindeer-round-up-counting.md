# Reindeer Round-Up: One More, One Fewer

Nov 16, 2026 · David Hurley

## Overview

Reindeer trot in one at a time to pull Santa's sleigh, and each time the team changes she says how many there are now. Sometimes one wanders off, so the number goes down as well as up. When the team is full, the sleigh takes off.

Every other lesson gives her a fresh amount each round. Here it is one group that keeps changing, so she learns that one more means the next number and one fewer means the number before.

- **Route:** `/reindeer-round-up`
- **Lesson id:** `counting-reindeer-round-up`
- **Length:** one team per game, 4 to 12 changes, then a finale
- **Counts:** 1 to 6 reindeer

## How a game is set up

The size of the team and the order of arrivals and departures are random every game.

| What changes | How it is picked |
| --- | --- |
| Team size | Random from 4 to 6. The game ends when the line reaches it |
| First three changes | Always arrivals, so she starts with "one, two, three" |
| Each change after that | Usually a reindeer arriving, sometimes one leaving |
| Departures | Never two in a row, never below two reindeer, and no more than three per game |

- **One at a time:** every change is exactly one reindeer in or one out.
- **End of the line:** arrivals join the end of the line and departures leave from the end, so the row stays tidy and easy to count.
- **Always visible:** the reindeer in the line stay on screen the whole time, so she can count them whenever she is unsure.

## How a change goes

Sprout explains the game once at the start: "The reindeer are coming to pull the sleigh! Each time, tell me how many there are." After that Sprout does not ask again.

1. A reindeer trots in and joins the line, or the last one wanders off the screen.
2. The line settles and the reindeer stand still.
3. She says how many there are now.
4. The next change follows a moment later.

| She does | What happens |
| --- | --- |
| Says the right number | The reindeer jingle their bells and Sprout echoes it: "Four!" |
| Says the number from before the change | The reindeer that just arrived glows, or the empty spot does, and the game waits for another try |
| Says another wrong number | The reindeer light up one at a time along the line, and the game waits |
| Misses a second time | Sprout counts with her, and each reindeer stamps as it is counted |
| Says nothing for about 6 seconds | The newest reindeer shakes its bell, or the empty spot glows |
| Counts out loud, "one, two, three, four" | Counts as right if she ends on the right number |

She can answer either way: by recounting the line, or by knowing that one more than three is four. Both are right. The second is the skill this game grows, and it is also the faster way to play.

## What she sees

A snowy field at dusk with Santa's sleigh on the right and a long harness line stretching to the left.

- **Reindeer:** large and side-on in a single row, each with a different coloured collar in pink, purple, gold, red, green or blue, and a bell.
- **Harness line:** has a faint loop for each place in the team, so she can see how many spots are still empty. Empty loops are pale and plain so they are not mistaken for reindeer.
- **Arriving:** a reindeer trots in from the left edge and steps into the next loop.
- **Leaving:** the last reindeer in the line turns and wanders off the left edge. It is fully gone before she answers.
- **Santa:** sits in the sleigh and waves. He is never counted.
- **Glow cue:** the lantern on the sleigh glows in place of the talking and listening pill.
- **Finale:** with every loop filled, the reindeer leap and the sleigh flies up across the moon. Nothing is counted.
- **Reduced motion:** reindeer fade in and out at their spot instead of trotting.

## Runtime notes

Each change is one spoken number on one scene, but the number of changes differs from game to game. This is based on the repo docs, not the code.

- **Nodes:** one node per change, then the finale. A node succeeds when she says the count after its change.
- **Variable length:** lesson graphs are authored today. Either author twelve change nodes and skip the unused ones, or build the node list from a template when the game starts.
- **Random values:** when the game starts, the server picks the team size and the full order of arrivals and departures, as per-game node facts. Tests pass a fixed seed.
- **Scene:** one field for the whole game. Moving to the next node only adds or removes a reindeer, so there is no scene swap.
- **Answer after the move:** her answer is judged only once the UI confirms the reindeer has finished arriving or leaving.
- **Checking the answer:** look for the number word in the transcript of her turn, using the last one she says.
- **A quiet tutor:** the tutor brief says not to ask anything. After a right answer the app tells the tutor to say only the number.
- **Diagnostics:** log when her answer is the previous count, and how long she took to answer. A quick right answer suggests she knew it; a slow one suggests she recounted.

## What to test with her

The thing to find out is whether she starts to say the next number straight away, or recounts the whole line every time.

- [ ] **She answers unprompted:** she says a number when the line settles, without Sprout asking.
- [ ] **One more:** after a few arrivals she says the next number without recounting.
- [ ] **One fewer:** when a reindeer leaves she notices and gives the lower number. Expect this to be harder than one more.
- [ ] **Departures are fun:** a reindeer wandering off makes her laugh and does not upset her. If it does, turn departures off.
- [ ] **Empty loops:** she does not count the empty harness loops as reindeer.
- [ ] **Six in a row:** six reindeer are still easy to tell apart on a phone.
- [ ] **Length:** a game with three departures is not too long. If it is, cap departures at one.
- [ ] **Sprout stays quiet:** the tutor only echoes the number and does not give it away first.

## Later level

Two reindeer arrive together, and she says the new number. It uses the same game and rules, with some arrivals bringing a pair.
