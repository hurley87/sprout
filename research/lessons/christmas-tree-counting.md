# Count the Scene: Christmas Tree

Nov 16, 2026 · David Hurley

## Overview

She looks at a decorated Christmas tree with presents underneath and counts whichever kind of thing Sprout names: baubles, candy canes, gingerbread men or presents.

It is the same game as Count the Scene: Ski Hill with a new picture. It is separate from Christmas Lights, where she counts by colour after the lights stop twinkling.

- **Route:** `/scenes/christmas-tree`
- **Lesson id:** `counting-scene-christmas-tree`
- **Length:** three rounds on the scene and a finale
- **Counts:** random, 1 to 5 of each kind

## Things to count

Four kinds of things are in the picture, each with a very different shape so they are easy to tell apart.

| Kind | Where it sits | Move when counted |
| --- | --- | --- |
| Baubles | Hanging on the tree | Swings and glints |
| Candy canes | Hooked on the branches | Wiggles |
| Gingerbread men | Hanging on the tree | Waves |
| Presents | On the floor under the tree | Bounces and its bow pops up |

**How each game is set up**

- **Random amounts:** each kind gets a random count from 1 to 5, so the tree is decorated differently every time.
- **All different:** no two kinds have the same count, so counting the wrong kind always gives a wrong answer.
- **Three of four:** each game asks about three of the four kinds, picked at random. The fourth stays in the picture as something to ignore.
- **Easy first:** the first round is always the kind with the fewest items.

## How a scene goes

Sprout explains the game once at the start: "Look at the Christmas tree! I'll name something, and you tell me how many you can find."

1. The whole scene appears and she gets a few seconds to look around.
2. A picture of one kind of thing pops up in a bubble, and Sprout says just its name: "Candy canes!"
3. She says how many.
4. After three rounds, the finale plays.

| She does | What happens |
| --- | --- |
| Says the right number | Each of those things does its little move in turn while Sprout counts them |
| Says a wrong number | Those things glow and the rest of the scene dims slightly, and Sprout repeats the name |
| Misses a second time | Sprout counts with her, and each one moves as it is counted |
| Says nothing for about 6 seconds | The bubble pulses and Sprout repeats the name |
| Counts out loud, "one, two, three" | Counts as right if she ends on the right number |

Things she has already counted stay on the tree for the later rounds, so the picture never gets easier by emptying out.

## What she sees

A big green Christmas tree stands in the middle of a cosy living room, taking up most of the screen.

- **Tree:** wide and simply drawn, with clear gaps between branches so each decoration has its own space.
- **Baubles:** round and shiny in pink, gold and purple. The colour varies but the shape is always a ball.
- **Candy canes:** pink and white stripes, hooked over branch tips.
- **Gingerbread men:** brown with white icing smiles and pink buttons.
- **Presents:** boxes in different sizes with pink and gold paper and big bows, side by side on the floor, never stacked.
- **Size and spacing:** every countable thing is large, fully visible and not overlapping another one.
- **Not counted:** the star on top, the fireplace, the rug and the snowy window. There is only one of each, and Sprout never asks about them.
- **Lights:** a plain string of warm white lights, kept small and still so they are not mistaken for baubles.
- **Picture bubble:** a round bubble in a top corner shows the kind being counted, so she does not need to know the word.
- **Glow cue:** the star on top glows in place of the talking and listening pill.
- **Finale:** the star shines, the lights twinkle softly, and snow falls past the window. Nothing is counted.
- **Reduced motion:** the counting moves become a brief highlight, and the finale is a still picture.

## Runtime notes

This scene needs no new game logic if Ski Hill is built first; it is a second scene definition plus art. This is based on the repo docs, not the code.

- **Shared with Ski Hill:** the three round nodes and finale, random counts and placement, the one-word tutor brief, the answer check, and the count-along timing.
- **Scene definition:** the living-room backdrop plus four kinds, each with six hand-placed positions. Tree positions follow the branch tips; present positions run along the floor.
- **Random values:** when the game starts, the server picks a count for each kind, fills that many of its positions at random, and picks which three kinds are asked. Tests pass a fixed seed.
- **Tutor names:** "baubles", "candy canes", "gingerbread men" and "presents". If she calls baubles "balls" or "ornaments" at home, change the word in the scene definition.
- **Built on its own:** if this scene comes before Ski Hill, the shared pieces above are the work, and Ski Hill then becomes the art-only follow-up.

## What to test with her

The tree packs things closer together than the ski hill does, so the main question is whether she can still pick out one kind.

- [ ] **She knows the things:** she can point to a bauble, a candy cane, a gingerbread man and a present before any counting.
- [ ] **The words:** she recognises the names Sprout uses, or the picture bubble is enough on its own.
- [ ] **Keeping track on the tree:** she counts decorations at different heights without missing one or counting one twice.
- [ ] **Ignoring the rest:** she does not fold candy canes into the bauble count, or count the star.
- [ ] **Lights:** she does not count the string of lights as baubles.
- [ ] **Busy enough:** up to 14 things on screen is fun to search and not overwhelming. If it is too much, cap each kind at 3.
- [ ] **Small screen:** candy canes and gingerbread men are still easy to tell apart on a phone.
- [ ] **Sprout stays quiet:** the tutor names the kind and does not give away the number.
