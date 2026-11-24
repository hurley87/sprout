# Snowflake Showdown: Who Has More?

Nov 16, 2026 · David Hurley

## Overview

Two mittens flip over at once, a pink one that is hers and a blue one that belongs to a snowman, and each shows some snowflakes. She calls which has more: "pink!" or "blue!" Every right call earns her a star.

She never says a number. She compares two amounts, which she can do at a glance when they are far apart and has to count for when they are close.

- **Route:** `/snowflake-showdown`
- **Lesson id:** `counting-snowflake-showdown`
- **Length:** ten quick rounds and a finale
- **Amounts:** random, 1 to 6 snowflakes on each mitten

## Rounds

The two amounts start far apart and move closer together, and the amounts and which mitten has more are random.

| Rounds | Gap between the mittens | Example |
| --- | --- | --- |
| 1 to 3 | Three or more | 1 against 5 |
| 4 to 7 | Two | 2 against 4 |
| 8 to 10 | One | 3 against 4 |

- **No ties:** the two mittens never show the same amount.
- **Either side:** pink and blue each have more about half the time, and the same mitten never has more for more than two rounds in a row.
- **Stars for her, either way:** she earns the star for calling it right, whichever mitten had more. There is no overall winner between her and the snowman.
- **Scattered snowflakes:** the snowflakes are spread out differently each round, so she cannot judge by the shape they make.

## How a round goes

Sprout explains the game once at the start: "Pink is yours and blue is the snowman's. When they flip, tell me who has more snowflakes!" After that Sprout does not ask again.

1. Both mittens flip over together with a soft swish.
2. She says which has more.
3. The next pair flips a moment after her star lands.

| She does | What happens |
| --- | --- |
| Calls the right mitten | That mitten does a little dance, a star flies to her row, and Sprout echoes it: "Pink has more!" |
| Says "me" or "mine", "you" or "snowman" | Counts the same as saying the colour |
| Calls the wrong mitten | The snowflakes pair off, one from each mitten, until one side runs out. The leftover ones glow, and Sprout says "Look, blue has some left over. Who has more?" |
| Misses a second time | Sprout counts both: "Pink has two. Blue has four. Blue has more!" |
| Says a number | Sprout asks "Which mitten has more?" |
| Says nothing for about 5 seconds | Both mittens wiggle |
| Gets several right quickly in a row | A flurry of snow blows across the screen |

There is no losing. A wrong call shows her why, by pairing the snowflakes off, and the round still ends with a star.

## What she sees

Two big mittens side by side on a snowy background, blue on the left with a small snowman beside it and pink on the right.

- **Mittens:** large and plain, pink and blue, each with a wide palm where the snowflakes sit.
- **Snowflakes:** white, all the same size, well spaced and never touching. The same size matters, so more always means more snowflakes and never bigger ones.
- **Flip:** both mittens turn over at the same moment, so neither gets a head start.
- **Pairing off:** after a wrong call, a thin line joins one snowflake on each mitten, pair by pair. The ones left without a partner glow gold.
- **Star row:** ten pale stars along the top, one turning gold per round.
- **Snowman:** claps when blue has more and shrugs happily when pink does. It is never upset.
- **Glow cue:** her pink mitten's cuff glows on her turn in place of the talking and listening pill.
- **Finale:** all ten stars swirl into a big snowflake and the snowman and the mittens dance. Nothing is asked.
- **Reduced motion:** the mittens fade to their snowflake side without turning, and the pairing lines appear all at once.

## Runtime notes

This is close to the existing lessons, a still picture and one spoken answer per node, except the answer is a side and not a number. This is based on the repo docs, not the code.

- **Nodes:** `showdown-1` to `showdown-10`, then the finale. A node succeeds when she names the mitten with more.
- **Random values:** when the game starts, the server picks both amounts for each node and where the snowflakes sit, as per-game node facts. Tests pass a fixed seed.
- **Scene:** one pair of mittens for the whole game. Moving to the next node only changes the snowflakes, so there is no scene swap.
- **Checking the answer:** look for a side word in the transcript of her turn. "Pink", "me", "mine" and "my" mean pink; "blue", "you", "yours" and "snowman" mean blue. Use the classifier as a fallback for unclear answers.
- **A quiet tutor:** the tutor brief says not to ask anything. After a right call the app tells the tutor to say only the echo.
- **Wrong-call help:** the app gives the tutor both amounts and which side has more, so its lines match the pairing on screen.
- **Pairing animation:** timed by the app, about half a second per pair, not synced to the tutor's speech.
- **Diagnostics:** log the gap between the amounts with each answer, to see how close they can be before she starts missing.

## What to test with her

The thing to find out is how close two amounts can be before she has to stop and count.

- [ ] **"More":** she understands the word, and picks the bigger side in rounds 1 to 3 at a glance.
- [ ] **Colour names:** she says "pink" and "blue", or "me" and "you", without help.
- [ ] **Not always "me":** she calls blue when blue has more, and does not just pick her own mitten.
- [ ] **Close amounts:** in rounds 8 to 10 she slows down and counts each side.
- [ ] **Pairing off:** the lines and leftover snowflakes make sense to her after a wrong call.
- [ ] **Pace:** the next flip comes quickly enough to feel like a game.
- [ ] **Six snowflakes:** six on one mitten are still easy to count on a phone.
- [ ] **Sprout stays quiet:** the tutor only echoes her call and does not give it away first.

## Later level

Some rounds are a tie, and she calls "same!" Another variation flips the question: Sprout says "fewer" at the start, and she calls the mitten with less.
