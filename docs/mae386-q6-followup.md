# Q6 attribution and discussion closure follow-up

The October 22 microphone export
`sprout-mae386-5ce19ff1-531e-45e3-a1d6-859165533f5f.json` contains a complete
learner explanation of System 1 and System 2, with a driving example of each.
The original export SHA-256 is
`36aae91d50d938b10cb962890c2981c45990884a61a4d0b0e06babb9aef33c8e`.
The curated regression fixture retains the Q6 transcript before the explicit next
command and the original revision-331 classifier scores (event index 2953).
The original frozen Q6 outcome is partial and remains a historical record.

## Attribution

The earlier neutral-block implementation discarded its single candidate if any
later substantive tutor response appeared between the first and last learner
messages. This session's feedback and follow-up therefore restored separate
start/end selection. Three criteria had strong semantic judgments but ambiguous
start boundaries, so no learner source was accepted for those criteria.

MAE386 conceptual nodes now offer maximal learner explanation blocks separated
by substantive tutor speech, retaining earlier blocks after a later question.
Standalone `Go on` is treated as content-free encouragement within this MAE386
path, alongside existing neutral backchannels. Every candidate preserves original
indexes, learner text and intervening tutor context; single-message candidates
remain available alongside fragmented blocks. Jev must select a supporting block
confidently for each criterion. No blocks bridge substantive help or feedback.
Grouping alone grants no credit; semantic sufficiency, assistance and echo guards
still apply. Counting, Catching Unicorns and Q10 retain their existing paths.

## Closure

At revision 331 the tutor said the learner had shown both processes and finished
without a follow-up. The multiclass tutor-state completion probability was 0.85,
below the unchanged 0.90 gate. The user subsequently requested the next question.

Fresh Q6 classification requests add a separate `discussionClosure` choice between
closed and open. It judges the final tutor response and any later learner speech,
independently of correctness and mastery. A pending question, explanation or
uncertain closure stays open. The existing probability/margin gates still apply;
an uncertain/open closure cannot fall back to multiclass completion. A confident
closed result maps to the existing tutor acknowledgment proposal and passes
through the existing runtime identity, playback-drain and render gates. It grants
no learning evidence. Historical diagnostics without this field keep their
original interpretation; fresh provider responses must match the requested schema.

## Provider text replay, October 22

Two actual Jev requests replayed the captured text against the working-tree fix.
This is **text replay**, not new GPT-Live speech or microphone acceptance.
The [retained results](evidence/mae386-q6-replay-2026-10-22.json) include base SHA,
implementation file hashes, source export hash, new outputs and mapped
proposals. The regression fixture separately retains the original scores. The new classifier selections are provider observations, distinct
from mocked selections in the deterministic tests.

| Snapshot | Expected | Observed |
| --- | --- | --- |
| Tutor feedback followed by its clarification question | Retain all four criteria; keep discussion open | All four source selections identify original messages 1–9, with selected probabilities 0.98–0.99. Closure is open at 1.00; mapped outcome holds the scene. |
| Final tutor acknowledgment after the learner's clarification | Retain all four criteria; allow closure | All four identify original messages 1–9, with probabilities 0.94–1.00. Closure is closed at 0.94; mapped proposal acknowledges and allows semantic completion. |

These two requests establish behavior on the captured text, not broad semantic
reliability. A fresh natural microphone run is still needed to check streaming
fragmentation, real tutor closure, navigation timing and the final recap together.
The Q10 focused-start shortcut and teacher PDF already present in the checkout
are separate pending work; this follow-up does not integrate or push them.

## Deterministic verification

The captured-session regressions cover four attributed criteria, historical score
interpretation, original source identities, closure after playback drains, frozen
Q6 outcome, open/uncertain closure, closure without mastery, substantive-help
boundaries, forged spans and missing fresh-response fields. The existing authored
Q6 route fixtures now explicitly supply an open discussion state.


Full checkout validation: **1,890 unit tests across 86 files pass**. ESLint,
type checking, production build, changed-file formatting and `git diff --check`
pass. The provider-free browser suite passed **35 of 36 tests**; the existing
mixed-answer/grouped-skip/recap test again read `questionOutcomes` before it was
available at `tests/browser/mae386.spec.ts:342`. The same failure occurred at the
PR head before this follow-up. Its isolated rerun passed (1/1). This is not an all-green full browser suite.
