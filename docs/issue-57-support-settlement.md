# Issue #57: support settlement candidate

The latest live transcript gives a settled correct reaffirmation followed by a
fresh explicit success acknowledgment, yet current support stayed ambiguous
(.12 live, .11 baseline replay). Correctness .96 and acknowledgment .94 already
passed; the classification issue is outstanding support, not correctness itself.
The user's intended behavior is progression after that correct settlement, with
existing acknowledgment/audio/render gates still enforced.

## First candidate: tested and rejected

The user authorized trying a focused semantic correction. The first candidate
explicitly described finishing/reaffirming a correct answer as settled child
evidence, excluded fillers alone and tutor offers of help from outstanding help,
and added corresponding false criteria. Its exact
[wording diff](issue-57-support-candidate-v1.patch) and
[15 real results](issue-57-support-candidate-results.json) are preserved.

| Case | Baseline help | First candidate help | Outcome |
| --- | ---: | ---: | --- |
| Latest “Finished, uh, one” + fresh confirmation | .11 | .06 | Changed from support_ambiguous to accepted, correct/none/acknowledging |
| Settled reaffirmation + fresh explicit confirmation | .09 | .06 | Accepted remains |
| Help → settled correct answer → confirmation | .10 | .12 | Regressed from accepted to support_ambiguous |
| Renewed help after correct | .94 | .94 | Accepted needs_help proposal still blocks completion |
| Number plus help | .91 | .90 | Answer ambiguity still blocks completion |
| Alternatives | .92 | .91 | Answer ambiguity still blocks completion |
| Uncertain supplied repetition | .94 | .94 | Tutor gate still abstains; unclear answer/help are not success |
| Fresh unfinished reply | .90 | .90 | Answer ambiguity still blocks completion |

All 15 requests returned normalized scores, no retries. The first candidate was
not retained: improving the target run while losing the settled-help control is
not a verified fix. The score changes come from single passes of two contracts,
not independent repeated calibration samples. Cause of the control's change is
unknown; attributing it to wording exclusivity is a hypothesis.

## Smaller revision in the working tree

The current revision changes only supportScope. It gives corrected totals,
completed counts and explicit reaffirmations equal standing as forms of
settlement, without requiring a special phrase. It says a filler alone does not
make a settled answer unfinished, and a tutor's offer/question is not a child
help request. The true/false criteria are restored to the prior general contract:
any settled successful child answer can resolve earlier difficulty; renewed
requests, continued uncertainty, unresolved alternatives, inability and
unfinished replies retain their blockers. Support remains separate from mastery.
Original transcript words/markers and structural projection remain intact.

No thresholds, models, runtime/reducer, fresh-acknowledgment requirement, audio
drain, render-before-steering or clarification budget/timing were changed. There
is no deterministic rule granting completion to a matching number or the word
“finished”. GPT-Live remains the tutor, Jev the observer, and the graph/reducer
the authority.

The offline suite passes **486 tests**; typecheck and lint pass. Prompt assertions verify delivered wording and preserved blockers. Tests also
map the saved real candidate observations offline and feed target, settled-help
and renewed-help proposals through the reducer: child-source historical
acknowledgment cannot authorize completion; tutor-source success waits for
relevant audio drain, then requests render and steers only after confirmation.
Replaying saved probabilities tests deterministic gates, not fresh semantics.
Formatting of changed files and the tracked diff check pass. The pre-existing
repository-wide formatting issue remains untouched.

## Second revision: authorized comparison passed

The user explicitly approved another bounded 15-case comparison. All 15 requests
returned normalized scores, with no retries. The
[second revision results](issue-57-support-candidate-v2-results.json) identify
source hashes and retain identical inputs plus baseline diagnostics. The current
source hash matches the evaluated contract.

| Case | Baseline help | Second revision help | Outcome |
| --- | ---: | ---: | --- |
| Latest “Finished, uh, one” + fresh confirmation | .11 | .07 | Now accepted: correct .96 / support none / acknowledging .94 |
| Settled reaffirmation + fresh explicit confirmation | .09 | .07 | Accepted remains |
| Help → settled correct answer → confirmation | .10 | .10 | Accepted restored |
| Renewed help after correct | .94 | .94 | Accepted needs_help proposal still blocks completion |
| Number plus help | .91 | .89 | Answer ambiguity still blocks completion |
| Alternatives | .92 | .91 | Answer ambiguity still blocks completion |
| Uncertain supplied repetition | .94 | .94 | Tutor gate still abstains |
| Fresh unfinished reply | .90 | .88 | Answer ambiguity still blocks completion |
| Generic thanks | .09 | .07 | Acknowledgment .43: tutor_no_winner remains |

Only the target case changed mapping outcome relative to the baseline; all other
14 mapping outcomes remained the same. Explicit renewed help remains high. A
matching number plus help and an unfinished reply did not reach the high help
band in this pass, but their unclear answer observations still held completion;
this is not proof of universally calibrated support detection. The initial
ambiguous attempt and its clarification question remain support_ambiguous, while
non-speech-only fragments remain unresolved. Generic finished and child-source
reaffirmation can retain historical correct-answer scores; their source still
cannot supply fresh acknowledgment for that child turn.

This is evidence to retain the smaller supportScope revision. It does not prove
why any single probability changed or establish broad calibration. Exact current
identity, fresh relevant acknowledgment, audio drain and render confirmation
remain necessary. The bounded candidate requests are finished; no more calls
were made after this comparison.

No live lesson or microphone session was started. Small text replay sets do not
verify audible behavior, speaker attribution, interruption during append delivery
or actual scene progression. All work remains uncommitted and prior work was
preserved.

Candidate results were checked for 15 HTTP-200 responses, each with nine finite
probabilities in [0, 1], and for classifier source hash matching the final
working tree. Changed-file formatting, lint, typecheck and `git diff --check`
pass. No commits, pushes, deployment, persistence or issue-status changes.
