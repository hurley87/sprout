# Sleigh Launch: Counting Down

Nov 16, 2026 · David Hurley

## Overview

A row of lanterns lights the runway for Santa's sleigh, and she counts down to launch it: "three, two, one!" A lantern goes out with each number she says, and on "one" the sleigh takes off.

Every other lesson counts up. Here she counts backward, and she has to count the lanterns first to know which number to start from.

- **Route:** `/sleigh-launch`
- **Lesson id:** `counting-sleigh-launch`
- **Length:** six launches and a finale
- **Counts:** countdowns starting from 3, 4 or 5

## Launches

The countdowns get longer in three steps, and from the third launch on the starting number is random.

| Launches | Lanterns | She says |
| --- | --- | --- |
| 1 and 2 | 3 | "Three, two, one" |
| 3 and 4 | 3 or 4, at random | From three or from four |
| 5 and 6 | 4 or 5, at random | From four or from five |

- **Same start twice:** launches 1 and 2 both start from three so she learns the game before anything changes.
- **Count first:** from launch 3 on she cannot know the starting number without counting the lanterns.
- **Stopping early:** the game can end after launch 4 on days when counting down from five is too much.

## How a launch goes

Before the first launch Sprout shows her how: the lanterns go out one by one as Sprout says "Three, two, one, blast off!" Then the lanterns relight and it is her turn. After that Sprout does not prompt.

| She does | What happens |
| --- | --- |
| Says the starting number | The first lantern goes out |
| Says the next number down | The next lantern goes out |
| Says "one" | The last lantern goes out, the sleigh whooshes off, and Sprout shouts "Blast off!" |
| Starts from the wrong number | The lanterns flicker and stay lit. After a pause they light up one at a time while Sprout counts them: "One, two, three, four. Start at four!" |
| Counts up, "one, two, three" | The sleigh rocks but stays put, and Sprout says "The other way! Four..." |
| Skips a number | The skipped lantern flickers and stays lit, and the game waits |
| Goes quiet for about 4 seconds | The next lantern flickers |
| Stays quiet for about 8 seconds | Sprout whispers the next number |
| Counts the whole way down with no long pause | The sleigh leaves a trail of stars |

There is no timer and no way to fail a launch. The star trail is the only reward for a smooth countdown.

## What she sees

A snowy rooftop at night, with the sleigh and reindeer at the right-hand end of a short runway and the moon above.

- **Lanterns:** large, evenly spaced in one row along the runway, glowing warm gold. A lantern that has gone out turns dark blue and stays in place.
- **Order:** the lanterns go out from left to right, toward the sleigh, so the last one lit is right beside it.
- **Sleigh:** Santa sits ready with the reins, and the reindeer paw the snow. None of them are counted.
- **Launch:** the sleigh runs along the roof and lifts off to the upper right.
- **Star trail:** a ribbon of stars behind the sleigh on a smooth countdown, fading after a moment.
- **Glow cue:** the moon glows in place of the talking and listening pill.
- **Finale:** the sleigh flies across the moon and presents drift down to the houses below. Nothing is counted.
- **Reduced motion:** lanterns switch off without flickering, and the sleigh fades out in place of flying.

## Runtime notes

Like Unicorn Hop, this game reacts to each number as she says it, which today's turn-then-judge flow does not do. Build one and the other reuses it. This is based on the repo docs, not the code.

- **Nodes:** `launch-1` to `launch-6`, then the finale. A node succeeds when she has said the numbers from its start down to one, in order.
- **Random values:** the server picks each node's starting number when the game starts, as a per-game node fact. Tests pass a fixed seed.
- **Stage 1, small build:** a lantern goes out on each burst of her voice from the local microphone detection, up to the number of lanterns. When she goes quiet, check the transcript for the right numbers in order. If they are there, launch; if not, relight the lanterns and help.
- **Stage 1 limits:** a fast countdown can blur into one burst, so lanterns may lag her voice, and wrong starts or counting up are only caught at the end.
- **Stage 2, larger build:** react to each number word in a streaming transcript. This is what makes the wrong-start, counting-up and skipped-number rows work as they happen.
- **A quiet tutor:** the tutor brief says to stay silent during the countdown. The app signals the launch, and the tutor says only "Blast off!"
- **Demonstration:** the first-launch demo is tutor speech with app-timed lanterns, and her voice is ignored while it plays.
- **Smooth-run rule:** the star trail shows when no gap between her numbers is longer than about 2 seconds.

## What to test with her

Find out first whether she can already say "three, two, one" on her own, since everything builds on that.

- [ ] **Three, two, one:** she can count down from three without help after the demonstration.
- [ ] **She starts unprompted:** she begins the countdown when the lanterns appear.
- [ ] **Counting the lanterns:** from launch 3 on, she counts them before starting.
- [ ] **From four and five:** these are a fun stretch. If not, keep every launch at three for now.
- [ ] **Counting up by habit:** watch how often she counts up, and whether "the other way" helps.
- [ ] **Lantern timing:** a lantern goes out within a blink of each number.
- [ ] **Sprout stays quiet:** the tutor does not count down for her unless she stalls.
- [ ] **The launch:** the whoosh and "Blast off!" make her want another go.

## Later level

Countdowns from higher numbers, up to ten, with the same game and rules.
