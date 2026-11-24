# Down the Chimney: Counting What Happens

Nov 16, 2026 · David Hurley

## Overview

Santa drops presents down the chimney one at a time, each one disappears with a thump, and when he stops she says how many went down. Then the fireplace lights up and shows the presents in a row, so she can see whether she was right.

Every other lesson lets her look again and recount. Here the presents are gone once they drop, so she has to count along as it happens and hold the number in her head.

- **Route:** `/down-the-chimney`
- **Lesson id:** `counting-down-the-chimney`
- **Length:** eight rounds and a finale
- **Counts:** random, 1 to 5 presents

## Rounds

The rounds get longer and quicker in three steps, and the number of presents is random every time.

| Rounds | Presents | Time between drops |
| --- | --- | --- |
| 1 and 2 | 1 to 3 | About 1.5 seconds |
| 3 to 5 | 1 to 4 | About 1.2 seconds |
| 6 to 8 | 1 to 5 | About 0.9 seconds |

- **No repeated answers:** the number is never the same two rounds running.
- **Pace follows her:** after a miss, the next round drops one step slower. Two right answers in a row bring the planned pace back.
- **Steady rhythm:** within a round the drops are evenly spaced, so the beat helps her count.
- **Clear ending:** after the last present Santa dusts off his hands and looks down the chimney. That is her cue to answer.

## How a round goes

Sprout explains the game once at the start: "Santa is dropping presents down the chimney! Count them, and tell me how many." After that Sprout does not ask again.

1. Santa lifts a present from his sack and drops it. It falls into the chimney and lands with a thump.
2. He repeats this for each present in the round.
3. He dusts off his hands and waits.
4. She says how many.

| She does | What happens |
| --- | --- |
| Says the right number | The fireplace lights up, the presents slide out in a row, and each one bounces while Sprout counts them. One present then moves under the tree |
| Counts along out loud during the drops, "one, two, three" | Counts as right if the last number she says is the right one. This is the habit to encourage |
| Says a wrong number | The fireplace stays dark, Sprout says "Let's watch again," and Santa drops the same number again, more slowly |
| Misses a second time | Santa drops them once more while Sprout counts along with each thump |
| Says nothing for about 6 seconds | Santa peers down the chimney, then drops the same presents again |

There is no losing. Every round ends with the fireplace lit and a present under the tree, whether she got there alone or with help.

## What she sees

A cutaway view of a snowy house at night: Santa on the roof beside the chimney, and the living room below with a dark fireplace and a Christmas tree.

- **Santa:** stands at the chimney with a closed sack, so she cannot see how many presents are inside.
- **Presents:** large boxes in pink, gold and red with big bows. Each is in view for about half a second as it falls, then vanishes into the chimney.
- **Thump:** every present lands with the same soft thump and a small puff of snow from the chimney top. The sound matters as much as the picture.
- **Dark fireplace:** hides the presents until she answers.
- **The reveal:** the fire glows and the presents sit in one row in front of it, evenly spaced and not stacked.
- **Under the tree:** the pile grows by one present per round. It is off to the side and never counted.
- **Glow cue:** the moon glows in place of the talking and listening pill.
- **Finale:** Santa waves, the sleigh flies across the moon, and the tree lights come on over the pile of presents. Nothing is counted.
- **Reduced motion:** presents appear at the chimney top and fade out with the thump instead of falling.

## Runtime notes

Each round is still one spoken number, but the scene plays an animation with sound first, and she may start talking before it ends. This is based on the repo docs, not the code.

- **Nodes:** `chimney-1` to `chimney-8`, then the finale. A node succeeds when she says its number.
- **Random values:** the server picks each node's number of presents when the game starts, as a per-game node fact. Tests pass a fixed seed.
- **Scene phases:** each node's scene moves through dropping, waiting and reveal. Scenes are static today, so this is new.
- **Drops start on render:** the first drop waits until the UI confirms the scene is on screen, using the existing render confirmation.
- **Counting along:** her turn can begin during the drops. Judge the answer only after the last drop and once she has gone quiet, using the last number word in the transcript.
- **Thump and the microphone:** the thump is app audio. Treat it like tutor output so it is not mistaken for her voice.
- **Pace:** the drop spacing is kept by the app per game and adjusted after each node. It is not a node fact.
- **A quiet tutor:** the tutor brief says to stay silent during the drops and not to ask. After a right answer the app tells the tutor to count the revealed presents.
- **Replays:** a wrong answer or a silence replays the dropping phase in the same node at the slower pace.

## What to test with her

The thing to find out is whether she counts along as the presents fall, or waits until the end and guesses.

- [ ] **Counting along:** she counts out loud or on her fingers while the presents drop.
- [ ] **She answers unprompted:** she says a number when Santa stops, without Sprout asking.
- [ ] **The ending is clear:** she knows Santa is finished and does not wait for another present.
- [ ] **Starting pace:** 1.5 seconds between drops is slow enough to keep up with.
- [ ] **Faster rounds:** the quickest pace is exciting and not frustrating. If not, keep every round at the slow pace.
- [ ] **The reveal:** she looks at the presents in the fireplace and checks them against her answer.
- [ ] **Replays:** watching again after a miss feels like another go, not a telling-off.
- [ ] **Sound off:** she can still play with the phone muted, by watching alone.
- [ ] **Thump and the microphone:** the thump never registers as her speaking.

## Later level

Jingle bells ring a few times with nothing to see, and she counts the sounds. It uses the same rounds and rules, with the bells in place of the falling presents and a row of bells for the reveal.
