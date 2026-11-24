# Cocoa Stop: One Each

Nov 16, 2026 · David Hurley

## Overview

Elves sit along a table and mugs of cocoa slide out one at a time, one to each elf. She shouts "stop!" when every elf has a mug. Stop too early and some elves go without; stop too late and a mug slides off the end of the table.

She never says a number. The game teaches "one each" and "enough", the matching idea underneath counting, and her voice controls the action instead of answering a question.

- **Route:** `/cocoa-stop`
- **Lesson id:** `counting-cocoa-stop`
- **Length:** eight rounds and a finale
- **Amounts:** random, 2 to 6 elves

## Rounds

The rounds add elves and speed up in three steps, and the number of elves is random every time.

| Rounds | Elves | Time between mugs |
| --- | --- | --- |
| 1 and 2 | 2 or 3 | About 1.8 seconds |
| 3 to 5 | 3 to 5 | About 1.4 seconds |
| 6 to 8 | 4 to 6 | About 1.0 second |

- **No repeats in a row:** a round never has the same number of elves as the one before.
- **Pace follows her:** after a late stop, the next round goes one step slower. Two good stops in a row bring the planned pace back.
- **Steady rhythm:** the mugs come at an even beat within a round, so she can feel when the next one is due.

## How a round goes

Sprout explains the game once at the start: "The elves want cocoa, one mug each! Shout stop when everyone has one." After that Sprout does not prompt.

1. The elves sit down in a row along the table, each with an empty place in front of them.
2. Mugs slide out from the kitchen hatch one at a time. Each goes to the nearest elf who does not have one yet.
3. She shouts "stop!" when she thinks everyone has a mug.

| She does | What happens |
| --- | --- |
| Shouts "stop" after the last elf gets a mug | The hatch closes, the elves cheer and sip, and Sprout says "One each!" |
| Shouts "stop" too early | The mugs stop. The elves without one hold out their hands, and the game waits for her to say "more" |
| Says "more" or "go" after an early stop | The mugs start again from where they left off |
| Does not stop in time | One extra mug slides past the last elf and off the end of the table into a snowbank. The hatch closes by itself and Sprout says "Oops, one too many!" The round plays again, more slowly |
| Is late a second time | The round plays again, and Sprout shouts "stop!" along with her at the right moment |
| Says "stop" just as an extra mug sets off | The mug slides back into the hatch and it counts as a good stop |

There is no losing. An early stop is fixed by saying "more", and a late stop is a funny mug in the snow followed by another go.

## What she sees

A long wooden table in a cosy elf kitchen, seen from the side, with a hatch at the left end and an open window with a snowbank at the right end.

- **Elves:** sit in one row along the far side of the table, each in a different coloured hat, well spaced.
- **Empty places:** a round mat in front of each elf shows where a mug goes, so she can see who is still waiting.
- **Mugs:** large pink mugs with marshmallows on top. Each slides along the table and stops on the next empty mat.
- **Order:** the elf nearest the hatch is served first, and the furthest last, so a filled row grows from left to right.
- **Extra mug:** slides past every elf, off the end of the table, and lands in the snowbank with a soft poof. Nothing breaks.
- **Waiting elves:** an elf with no mug after an early stop holds out both hands and looks hopeful, not sad.
- **Glow cue:** the lamp over the table glows in place of the talking and listening pill.
- **Finale:** every elf raises a mug, and the kitchen fills with steam and sparkles. Nothing is asked.
- **Reduced motion:** mugs appear on the mats one at a time instead of sliding.

## Runtime notes

The game has to react the instant she speaks, which today's turn-then-judge flow does not do. It can use the same local microphone detection as Unicorn Hop. This is based on the repo docs, not the code.

- **Nodes:** `cocoa-1` to `cocoa-8`, then the finale. A node succeeds when the mugs are stopped with exactly one per elf.
- **Random values:** the server picks each node's number of elves when the game starts, as a per-game node fact. Tests pass a fixed seed.
- **Stopping on her voice:** while mugs are sliding, the start of any burst of her voice stops them. While stopped short, the next burst starts them again. No word recognition is needed for the game to respond.
- **Checking the words afterwards:** the transcript is read once she goes quiet, for diagnostics only, to see whether she said "stop" and "more".
- **Grace window:** a stop within about half a second of an extra mug setting off pulls it back and counts as on time.
- **Slide sounds and the microphone:** the mug sounds are app audio. Treat them like tutor output so they are not mistaken for her voice.
- **A quiet tutor:** the tutor brief says to stay silent while mugs are sliding. The app signals the outcome, and the tutor says only the short line for it.
- **Pace:** the mug spacing is kept by the app per game and adjusted after each node. It is not a node fact.
- **Limit:** because any sound stops the mugs, a cough or a sibling's voice will too. That is acceptable for a first version.

## What to test with her

The thing to find out is whether she is matching mugs to elves, or just shouting "stop" when it feels like long enough.

- [ ] **She watches the elves:** her eyes go to who is still waiting, not only to the mugs.
- [ ] **Stop is instant:** the mugs stop within a blink of her voice.
- [ ] **Starting pace:** 1.8 seconds between mugs gives her time to react.
- [ ] **Early stops:** she notices the waiting elves and says "more" without help.
- [ ] **Late stops:** the mug in the snow makes her laugh, and she does not start overshooting on purpose every round.
- [ ] **Faster rounds:** the quickest pace is exciting and not frustrating. If not, keep every round slow.
- [ ] **Staying quiet:** she can hold back from talking while the mugs slide. If she cannot, require the word "stop".
- [ ] **Six elves:** six elves and mugs are still easy to see on a phone.

## Later level

Before the mugs start, Sprout asks "How many mugs do we need?" and she counts the elves. Then the same game plays, so she sees her number come true.
