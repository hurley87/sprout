# Silly Sprout: Unicorn Counting Lesson

Nov 14, 2026 · @David Hurley

## Overview

In this lesson Sprout does the counting and she is the checker. Sprout counts pink unicorn-world objects out loud, sometimes gets it wrong on purpose, and asks "Did I count right?" When she catches a mistake, Sprout asks how many there really are.

It stays voice-only and reuses the shared counting runtime. The existing lessons all ask "how many?" about a still picture; this one asks her to judge someone else's count first, then give her own.

- **Route:** `/unicorns` (separate from the adult demo at `/demos/catching-unicorns`)
- **Lesson id:** `counting-unicorns`
- **Length:** six scenes and a finale
- **Counts:** 2 to 5, kept lower than the 1 to 6 lessons because catching a mistake is harder than counting

## Scenes

Four scenes have a scripted mistake and two are counted correctly, so "no" is not always the right answer.

| Order | Objects | Sprout counts | Mistake | Then |
| --- | --- | --- | --- | --- |
| 1 | 2 unicorns | "One... ten!" | Silly number | Fix: 2 |
| 2 | 3 pink hearts | "One, two, three." | None | Next scene |
| 3 | 3 cupcakes | "One, two, four!" | Skipped a number | Fix: 3 |
| 4 | 4 crowns | "One, two, three, five!" | Skipped a number | Fix: 4 |
| 5 | 4 butterflies | "One, two, three, four." | None | Next scene |
| 6 | 5 unicorns | "One, two, four, five, six!" | Skipped in the middle | Fix: 5 |
| 7 | Finale | Nothing counted |  |  |

Scene 1 uses the most obvious mistake so she learns the game. Scene 6 is the hardest because the slip is in the middle and the count still sounds smooth.

Two other mistake types, counting one object twice and missing one, are left out of this version. They only make sense if each object lights up as Sprout counts it.

## How a round goes

Each scene opens with a catch step: Sprout says the scripted count slowly, then asks "Did I count right?" Scenes with a mistake add a fix step on the same picture.

| Step | She says | Sprout does |
| --- | --- | --- |
| Catch, count was wrong | "No", "that's silly", or the right number | "You caught me!" then moves to the fix step |
| Catch, count was wrong | "Yes" | "Hmm, listen again" and repeats the same wrong count, slower |
| Catch, count was wrong | "Yes" a second time | Doubts itself: "Wait... ten? Is it really ten?" |
| Catch, count was right | "Yes" | "Hooray, I did it!" then the next scene |
| Catch, count was right | "No" | "Let's check together" and counts along with her until she agrees |
| Fix | The right number | Celebrates and thanks her, then the next scene |
| Fix | A wrong number | Counts the objects with her, then asks again |

Sprout never tells her she is wrong for saying "yes" to a bad count. It just gives her another, easier chance to hear the mistake.

## What she sees

Every scene shares one pink meadow backdrop, with the counted objects in a single row across the open middle.

- **Backdrop:** a pink and lavender sky, cotton-candy clouds, a small castle on a far hill, and soft sparkles. None of these are ever counted, and the tutor briefs say so.
- **Counted objects:** original SVGs in pinks, purples and gold. Each object in a row gets its own shade so she can tell them apart.
- **Unicorns:** white with pink and purple manes. Scene 6 brings them back as the big finish.
- **Glow cue:** a glowing unicorn horn replaces the talking and listening pill. It shimmers while Sprout talks, rests on her turn, brightens while she speaks, and dims while Sprout thinks. Status text stays for screen readers.
- **Catch moment:** when she catches a mistake, the objects do a small wiggle and a burst of pink sparkles plays.
- **Finale:** a unicorn party on a separate backdrop with a rainbow, gentle confetti, and one unicorn doing a twirl. Nothing is counted.
- **Reduced motion:** all animation stops, as in the concert lesson.

## Runtime notes

The lesson is ten counting nodes plus a finale: one catch node per scene, and a fix node after each of the four wrong counts. This is based on the repo docs, not the code, so check it against the lesson definition types.

| Node | Scene | Succeeds when |
| --- | --- | --- |
| `catch-2-unicorns` | 1 | She disagrees or says 2 |
| `fix-2-unicorns` | 1 | She says 2 |
| `catch-3-hearts` | 2 | She agrees |
| `catch-3-cupcakes` | 3 | She disagrees or says 3 |
| `fix-3-cupcakes` | 3 | She says 3 |
| `catch-4-crowns` | 4 | She disagrees or says 4 |
| `fix-4-crowns` | 4 | She says 4 |
| `catch-4-butterflies` | 5 | She agrees |
| `catch-5-unicorns` | 6 | She disagrees or says 5 |
| `fix-5-unicorns` | 6 | She says 5 |

**Tutor brief for catch nodes**

- Say the scripted count exactly as written, one number per beat, then ask "Did I count right?"
- Never correct the count yourself and never hint whether it was right before she answers.
- The scripted count is a node fact, so it travels in current-node steering like the object and number do today.

**Tutor brief for fix nodes**

- Ask "Uh oh, how many are there really?"
- If she already said the number in the catch step, ask her to say it once more, nice and loud.
- Thank her for helping. The praise is for catching Sprout, not for being right.

**Classifier criteria**

- **Catch, wrong count:** correct is any disagreement or the true number; incorrect is agreement; anything else is unclear.
- **Catch, right count:** correct is agreement or repeating the number; incorrect is disagreement.
- **Fix:** correct is the true number as her final answer, including counting up and stopping on it.

**Open question:** if a node can have two success edges, a catch node could skip its fix node when she blurts the right number.

## What to test with her

The biggest risk is the live tutor fixing its own mistake mid-sentence, so test that before any art is drawn.

- [ ] **Scripted mistakes hold:** the tutor says each wrong count exactly, every time, without correcting itself.
- [ ] **She gets the game:** she laughs or objects at "One... ten!" in scene 1 without a parent explaining.
- [ ] **Yes to everything:** if she agrees with every count, try "Was that right or silly?" and watch whether she just repeats the last word.
- [ ] **Short answers are heard:** a quick "no" is picked up by the microphone and not discarded as noise.
- [ ] **Talking over Sprout:** shouting or giggling during the count does not end Sprout's turn or confuse the classifier.
- [ ] **Correct scenes:** scenes 2 and 5 do not confuse her into saying "no" out of habit.
- [ ] **Length:** she is still interested at scene 6. If not, drop scene 4.
