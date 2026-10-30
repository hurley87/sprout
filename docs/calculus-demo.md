# Calculus practice demo

`/demos/calculus` (add `?debug=1` for the session export). Three authored problems,
worked aloud. The learner talks through their working; after each turn the
application checks it step by step, shows what it heard, and tells the tutor
what is correct, wrong or missing. The tutor helps with one step at a time.

## Flow

1. The tutor asks the problem. The learner explains their steps in any order and
   in their own words, and gives a final answer.
2. When a learner turn ends, `/api/calculus-work` asks the model to **map** every
   learner turn in this problem onto the authored steps
   (`lib/calculus/work-extraction.ts`). The model only parses: it returns the
   expression the learner stated for each step, any rule they named for the whole
   function, and the final answer, each with a quote that must occur in learner
   speech. Quotes are compared as words, ignoring punctuation, fillers ("uh",
   "um") and sound tags, so a quote that runs across a pause still matches; the
   words and their order must be the learner's. It never sees accepted answers and
   never judges correctness. It runs at low reasoning effort: the default effort
   took up to 14 seconds on longer problems and exceeded the 10-second limit,
   while "none" misread steps spoken across pauses.
3. The application **checks** each step and the final answer by exact equivalence
   (`lib/calculus/math-validator.ts`, `lib/calculus/work-check.ts`). Reordered,
   factored and expanded forms count. Notation outside the bounded algebra is
   "could not check", never "wrong".
4. The checklist (`components/calculus/work-checklist.tsx`) shows each step as
   correct, needs another look, could not check, or not shown yet. Nothing needs
   confirming: if something was misheard, the learner says it again, and the next
   check re-reads every turn and takes their latest version.
5. The tutor receives one instruction per changed outcome:

   | Outcome | Tutor is told to |
   | --- | --- |
   | A step or the final answer is wrong | point at that step and ask one non-leading question, without its answer |
   | Every part right, final answer wrong | ask how they are combining their parts |
   | A named rule doesn't fit the function | ask one question about how the function is built, without naming the rule |
   | Final answer correct, steps missing | say it's right and ask how they got the first missing step |
   | Something unclear or uncheckable | ask one short clarifying question |
   | Steps correct so far | acknowledge and invite the next step |
   | Everything correct | the application moves on; the tutor praises the work as it asks the next problem |

6. When every step **and** the final answer are correct, the application requests
   the next problem itself. "Next", "skip this problem", the Skip button, help,
   repeat and stop still work as before; a problem left early is recorded as
   skipped.

## Required steps

Authored in `lib/calculus/problems.ts`.

| Problem | Steps | Final answer | Rules that fit |
| --- | --- | --- | --- |
| x³ − 4x | derivative of x³ = 3x² · derivative of the 4x term = 4 (either sign; the sign is checked in the final answer) | 3x² − 4 | power, sum |
| x² sin x | derivative of x² = 2x · derivative of sin x = cos x | 2x sin x + x² cos x | product |
| (3x² + 1)⁵ | outer derivative = 5(3x² + 1)⁴ · inner derivative = 6x | 30x(3x² + 1)⁴ | chain |

Naming a rule is never required, and the tutor never asks for one: doing the work
correctly shows the rule was applied, and names vary ("power rule", "exponent
rule", "bring the exponent down"). A rule the learner names for the whole function
is shown as a note; only one that doesn't fit gets a nudge. Rules named for a
single term are ignored.

## Timing

A check runs after each learner turn and a short debounce, and takes a few
seconds. Learners pause mid-thought for about a second, so new speech never
cancels a check: only one runs at a time, its result always updates the
checklist, and another check re-reads every turn once it finishes. The tutor is
briefed only from a check that covers everything the learner has said. Turns
that change nothing are not rechecked: repeats, and turns of only fillers or
sound tags ("[tongue click] Um", "And"). An unchanged instruction is not resent.

If the check of the learner's latest words times out or fails while they are
quiet, it is retried once, since nothing else would check those words again. If
the retry also fails, the tutor is told to ask them to say their last step again.

Because a check takes longer than the tutor takes to reply, the tutor's standing
guidance limits it to a neutral "Okay" or "Mm-hmm" until a check arrives. When a
check completes the problem, the praise goes into the next problem's steering
rather than a separate instruction, which the steering would replace before it
was spoken.

## Diagnostics

The debug export's `math.visits` lists each problem visit with its outcome
(completed, skipped, stopped), help count, final work, and every check: the
learner turns sent, the model's mapping, the outcome, the tutor instruction, and
whether the learner said more while it ran (`current`). Each
`calculus.check_ended` event also carries `diagnostics`: the model's raw output
(`raw`) and every item the parser dropped, with the reason (`dropped`:
`unknown-step`, `unknown-method`, `unquoted` or `invalid-expression`). Timed-out
checks have none.
Event log entries: `calculus.check_started`, `calculus.check_ended`,
`calculus.problem_completed`, `gpt_live.math_feedback_append`.

## Why this design

The first version (PR #81) required the learner to confirm every proposed step by
saying "confirm differentiation" before anything counted, and checked each line as
a derivative of the whole function. Four live runs on October 28, 2026 showed
learners could not confirm by voice, and correct term-by-term work (3x² for x³)
was marked wrong. Checking the steps a problem requires, without confirmation,
keeps the work visible and the tutor targeted while letting the learner just talk.

## Live acceptance

**Pending.** Run the demo with `OPENAI_API_KEY` set and `?debug=1`, work each
problem aloud including at least one wrong step and one correction, and export the
session. Check that steps are mapped as spoken, the tutor points at the wrong step
without giving its answer, and each problem advances only after the work is shown.
