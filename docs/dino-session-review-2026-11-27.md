# Dino Car Crunch session review — November 27, 2026

Reviewed export `sessions/production/dino-car-crunch/2026-11-27/15-17-31-0a3eeb54-6b0f-44a0-9b87-fa56ccc2497f.json`, runtime `0a3eeb54-6b0f-44a0-9b87-fa56ccc2497f`. Times are elapsed from the start of the attempt.

The session stayed on `warm-up`, where the child had to count 3 + 4 cars and answer 7. The child copied the tutor’s partial count three times. The tutor gave an acknowledgment that sounded like agreement, asked for a repeat, then fell silent. The parent stopped the session at 61.56 seconds with the scene’s answer still unresolved.

## Findings

1. **The count-on hint invited the child to copy it.** After the child said “Five,” the tutor said “Try counting on from the first cars like this. Three... four, five, six. Now you!” The child said “Three, four, five, six” three times. “Now you!” cued the child to reproduce the example. End the hint with “and then…?” so the child knows to supply the next number.

2. **The tutor sounded as though it accepted the unfinished count.** After the first copied count, the tutor said “Mm-hmm.” The exported scene instruction called for a smaller next-number hint after another wrong answer, but the tutor never gave that hint. Treat a count that stops where the demonstration stopped as unfinished and ask “What comes after six?”

3. **The only recovery request asked for another repeat.** All seven `classifier.mapping` events abstained. The `objectiveState` choice was `incorrect` in every mapping, with probabilities of 0.77–0.98. Five had confident incorrect scores of 0.93–0.98 and abstained with `answerCommitment_no_winner`. The other two scored 0.77 and abstained with `objectiveState_no_winner`. The `answerCommitment` probability for `committed` ranged from 0.47 to 0.75, below the `HIGH` threshold of 0.90 throughout. At 40.01 seconds the runtime sent the visit’s single answer recovery instruction, which asked for a repeat and explicitly forbade hints. The child had started answering again at 40.37 seconds when GPT-Live acknowledged the instruction at 40.82 seconds. The tutor still said “Say it one more time for me.” Use the confident incorrect objective state to request the smaller hint, and check in a live run whether the tutor follows the child’s newer response when speech resumes after a request.

4. **Silence after the final count left the child waiting.** The last child turn ended at 49.59 seconds and the classifier abstained at 50.24 seconds. There was no tutor reply or further prompt before `parent_stop` at 61.56 seconds. The silence nudge only covered a child who had yet to speak, and the visit’s answer recovery budget was already spent. Give the runtime a separate, one-time prompt to request a tutor reply after an unanswered child turn.

5. **Even the plain “Five” went unregistered as an incorrect answer.** At 20.26 seconds the number reader identified a child-owned 5. The mapper scored it 0.98 `incorrect` and 0.75 `committed`, then abstained. This case remains unresolved by the changes below. Gather replay data for standalone wrong answers and unfinished counts before revising classifier criteria or thresholds.

## What changed

- The warm-up and truck-scene guidance now ends count-on hints on “and then…?”, treats a copied partial count as unfinished, and calls for the smaller next-number hint without agreement. [e0746ef](https://github.com/hurley87/sprout/commit/e0746ef)
- When a scene is held and `objectiveState` is confidently `incorrect`, Dino Car Crunch can use its once-per-visit answer recovery to request a smaller hint. The generic repeat instruction still covers uncertain answers. `gpt_live.answer_recovery_append` records `variant` as `incorrect_answer` or `generic` for these Dino recovery paths. [72d2d21](https://github.com/hurley87/sprout/commit/72d2d21)
- The reply nudge gives Dino Car Crunch a separate once-per-visit request after six seconds of quiet following an eligible child turn. It waits for pending answer recovery and starts a fresh quiet interval after a recovery send. [1c626e6](https://github.com/hurley87/sprout/commit/1c626e6)

## What was not changed

Classifier criteria, confidence thresholds, and the reducer’s authority to accept an answer and advance the scene are unchanged.

## Validation

Validation of the changes is limited to provider-free tests. A live replay is still pending. In the next live run, verify that the hint ends on “and then…?”, a copied count gets “What comes after six?”, and diagnostics show `gpt_live.answer_recovery_append.variant` when recovery sends and `reply_nudge.*` events during an unanswered turn. If the tutor stays silent through the quiet interval, check for `reply_nudge.requested` and `gpt_live.reply_nudge_append`.
