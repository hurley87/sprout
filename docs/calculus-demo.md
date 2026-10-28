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
   expression or rule the learner stated for each step, with a quote that must
   occur in learner speech. It never sees accepted answers and never judges
   correctness.
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
   | Final answer correct, steps missing | say it's right and ask how they got the first missing step |
   | Something unclear or uncheckable | ask one short clarifying question |
   | Steps correct so far | acknowledge and invite the next step |
   | Everything correct | acknowledge briefly; the application moves on |

6. When every step **and** the final answer are correct, the application requests
   the next problem itself. "Next", "skip this problem", the Skip button, help,
   repeat and stop still work as before; a problem left early is recorded as
   skipped.

## Required steps

Authored in `lib/calculus/problems.ts`.

| Problem | Steps | Final answer |
| --- | --- | --- |
| x³ − 4x | derivative of x³ = 3x² · derivative of the 4x term = 4 (either sign; the sign is checked in the final answer) | 3x² − 4 |
| x² sin x | names the product rule · derivative of x² = 2x · derivative of sin x = cos x | 2x sin x + x² cos x |
| (3x² + 1)⁵ | names the chain rule · outer derivative = 5(3x² + 1)⁴ · inner derivative = 6x | 30x(3x² + 1)⁴ |

## Timing

A check runs after each learner turn and a short debounce, and takes a few
seconds. Learners pause mid-thought for about a second, so new speech never
cancels a check: only one runs at a time, its result always updates the
checklist, and another check re-reads every turn once it finishes. The tutor is
briefed only from a check that covers everything the learner has said (or one
that completes the problem). Unchanged learner turns are not rechecked, and an
unchanged instruction is not resent.

## Diagnostics

The debug export's `math.visits` lists each problem visit with its outcome
(completed, skipped, stopped), help count, final work, and every check: the
learner turns sent, the model's mapping, the outcome, the tutor instruction, and
whether the learner said more while it ran (`current`).
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
