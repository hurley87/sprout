# Issue #57: authorized Jev replay

The user explicitly authorized replay after the latest live export. Completed
**15 requests, one per case, no retries**: that export's final snapshot plus the
four recorded and ten synthetic cases in the
[clarification review set](issue-57-clarification-review-set.json). All returned
normalized probabilities. [Results](issue-57-jev-replay-results.json) preserve
inputs, original mappings when available, source hashes, request timing and
normalized responses. No raw provider body or credential was captured.

Requests used the running loopback `/api/classify` endpoint, whose process cwd
was verified as this checkout. Current transport source pins `jev-1.13.0`; source
hashes identify the classifier/projection/mapping contract. The endpoint does
not expose the provider-reported model, so that response field was not verified.
Local end-to-end request times ranged from 148.9 to 275.3 ms, not provider-only
latency. No live lesson or microphone session was started by this replay.

## Results

| Case | Correct | Help | Acknowledging | Mapping |
| --- | ---: | ---: | ---: | --- |
| Latest “Finished, uh, one” + fresh “Yes, one duck.” | .96 | .11 | .94 | support_ambiguous |
| Recorded before clarification | .95 | .39 | .97 | support_ambiguous |
| Recorded after question | .95 | .36 | .94 | support_ambiguous |
| Recorded child reaffirmation | .97 | .10 | .95 | accepted, support none; child source |
| Recorded generic thanks | .97 | .09 | .42 | tutor_no_winner |
| Synthetic fresh explicit confirmation | .97 | .09 | .95 | accepted, support none |
| Help then settled correct answer | .97 | .10 | .98 | accepted, support none |
| Renewed help | .93 | .94 | .94 | accepted, support needs_help |
| “One... can you help?” | .80 | .91 | .90 | answer_no_winner |
| Unresolved alternatives | .28 | .92 | .91 | answer_no_winner |
| Repeated wrong answers | .04 | .80 | .02 | tutor_no_winner |
| Uncertain tutor-supplied repetition | .06 | .94 | .02 | tutor_margin_too_small |
| Non-speech fragments | .93 | .41 | .94 | support_ambiguous |
| Fresh uncertain/unfinished attempt | .31 | .90 | .91 | answer_no_winner |
| Generic “Yeah, finished” | .96 | .09 | .95 | accepted, support none; child-ending transcript |

The exact latest snapshot is source export
`sprout-lesson-817101b0-2e13-4943-86d6-7d21689bf806.json`, request event 505,
mapping event 507, visit 1 / child turn 4 / revision 36. Live help .12 replayed
as .11; correctness .96 and acknowledgment .94 were unchanged. Both mappings
hold under the unchanged .10 no-help boundary. The original four review-set
snapshots also retained their recorded mapping outcomes. Small probability shifts
are observations from a single replay, not estimates of model variance.

## Interpretation and authority limits

This reproduces the remaining current-support blocker after the latest fresh
success acknowledgment. It does not identify why Jev assigned .11. Earlier
wrong answers, the hesitation word, or other context influencing that score are
hypotheses; the replay did not isolate those factors. It does not establish model
incapacity, independent mastery or a calibrated need to change the threshold.

The settled reaffirmation and help-then-settled controls reached the existing
no-help band. Explicit renewed help reached .94: the resulting accepted proposal
carries `supportState: needs_help`, which blocks completion even though correctness
and acknowledgment are high. Uncertain/unfinished cases abstained. These are
real semantic results on this small text set, not mocked scores; they do not
establish broad behavioral calibration.

Generic finished/yes alone remains insufficient for the tutor's *fresh*
success-confirmation guidance. Jev nevertheless retained the prior correct
answer and prior acknowledgment in that child-ending historical transcript.
The same applies to recorded child reaffirmation. The reducer's transcript-source
and fresh relevant acknowledgment gates prevent those historical tutor scores
from becoming acknowledgment authority for the new child turn. A replayed
proposal is not a render/transition or a live lesson completion. No reducer,
audio drain, render confirmation or scene steering ran during these requests.

Non-speech-only follow-up did not receive a clean support verdict; its textual
review intentionally remains uncertain. Treat neither its .41 nor generic
finished's .09 as ground truth about a real child. No recording was supplied;
audible behavior and speaker attribution remain unverified.

## Next boundary

No model, thresholds, semantic questions or runtime behavior were changed by
this evaluation. Any candidate refinement should be reviewed separately and
compared against this baseline, with settled reaffirmation, renewed help,
unfinished attempts and uncertain repetition all retained. The authorized
15-request budget is exhausted; no candidate calls or repeat calibration runs
were made. The existing clarification correction still requires live validation
for interruption just before/after append send, actual audible wording and full
lesson completion.

Results JSON was checked for 15 successful responses and nine finite normalized
probabilities per response. Documentation formatting and diff checks passed.
Application source was unchanged, so the prior 467-test/typecheck/lint results
were not rerun solely for these evaluation artifacts. All artifacts remain
uncommitted; prior working-tree changes were preserved.
