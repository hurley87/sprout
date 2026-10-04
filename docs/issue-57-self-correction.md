# Issue #57: self-correction before acknowledgment

Status: focused uncommitted semantic candidate and bounded recovery correction.
**This live case remains unverified.** No recording accompanies the export;
audible wording, speaker attribution and visible behavior are unverified. No paid
provider requests, live lessons or microphone sessions were started.

## Confirmed sequence

Source: `sprout-lesson-55d1ca93-4bee-4bfc-a046-7c29b438673c.json` in Downloads.
The [review set](issue-57-self-correction-review-set.json) preserves its SHA-256,
zero-based mapping event indices 198 and 219, exact source identities, complete
recorded score vectors and the literal final transcript:

> Tutor: How many ducks do you see?
> Child: Two. Oh, actually one
> Tutor: Yes , there is one duck.

The child correction finished in the transcript at runtime 11.870 s, before tutor
acknowledgment text began at 12.738 s. These are export-clock times, not verified
acoustic boundaries. Relevant output became quiet at 14.315 s and the reducer
recorded drain at 14.569 s.

| Mapping | Identity (visit / child turn / revision) | Correct | Help | Acknowledgment | Result |
| --- | --- | ---: | ---: | ---: | --- |
| 15.355 s | 1 / 2 / 13 | .97 | .09 | .87 | tutor_no_winner |
| 17.212 s | 1 / 3 / 13 | .97 | .10 | .85 | tutor_no_winner |

A microphone candidate began at 16.428 s and was discarded at 16.594 s. The
existing interruption protection invalidated the old activity snapshot and
reclassification began at 17.028 s with unchanged transcript/revision but turn 3.
This explains the second request; it was not a provider error or support retry.
No classifier error, accepted proposal, transition request or clarification
occurred. Only the initial scene render/steering occurred. Parent stop was logged
at 22.749 s, with no accepted answer/acknowledgment, no pending render and
lessonComplete false. Stopping resets output evidence; the final drained=false
field does not negate the earlier observed drain.

## Cause and focused correction

The mechanical blocker is certain: answer selection cleared its existing bands,
but no tutor category reached HIGH=.90. Acknowledgment was the highest candidate;
competing tutor categories were only .02–.13. Support .09/.10 was within the
no-help band, although tutor selection abstains before support mapping. No
proposal means the reducer cannot record semantic completion evidence.

The current projection faithfully retains `Two. Oh, actually one` as
precedingChildAttempt and the whole latest confirmation as latestMessage. It
neither loses the corrected total nor strips the restatement. Full history and
ordered support evidence remain available. The export records request transcripts
and returned diagnostics, not the exact provider wire questions used in that run.
Reconstruction with this checkout verifies current delivery, not historical
prompt provenance.

The previous acknowledgment question coupled “successful answer” with “primary
function”, explicit confirmation or celebration, and a terse example. The focused
candidate asks whether the message confirms the child's final settled answer as
correct. Its criteria explicitly interpret corrections in order and recognize
agreement or a contextual factual restatement without requiring celebration or
exact wording. It excludes supplying a total without a settled correct child
answer, correcting a still-wrong answer, generic encouragement, unfinished
corrections and alternatives. All other semantic questions, projections, models,
thresholds and proposal mapping remain unchanged. The [candidate patch](issue-57-self-correction-candidate.patch)
and review-set source hashes preserve the precise before/after contract.

That ambiguity in the contract is a plausible contributor, **not a proven
explanation of Jev's internal reasoning**. Scores cannot establish that Jev
mistook restatement for teaching, penalized self-correction, or missed context.
Improved semantic recognition is pending real calibration and a live rerun.

The deterministic recovery gap is also confirmed: only support_ambiguous could
use the existing clarification policy. A new eligibility helper reuses existing
answer bands and allows tutor_no_winner only when the answer is decisively
correct, support is in the no-help band, acknowledgment is the leading uncertain
tutor candidate and other tutor categories stay below the existing competitor
ceiling. It does not turn these scores into a proposal. Incorrect/unclear answers,
renewed support, rival functions, accepted observations and provider failures do
not gain this recovery path.

Both ambiguity causes share the existing four-second quiet wait, exact snapshot
eligibility, interruption cancellation and **one request per visit**. The existing
no-hint clarification asks whether the child has finished or needs help. A generic
yes is insufficient; only a later settled answer or settled reaffirmation permits
the tutor to confirm it freshly. The request itself grants no completion
authority. No identical-snapshot retry, repeated prompt, new timing, persistence
or reducer authority change was added. The historical SupportClarification class
name is retained to keep this correction small.

GPT-Live remains tutor; Jev remains semantic observer; the authored graph and
reducer remain lesson/UI authority. Runtime/node/visit/turn/revision matching,
stale-result rejection, immediate candidate interruption protection, fresh
acknowledgment plus relevant audio drain and render-before-steering are preserved.

## Verification and remaining rerun

The review set has two real recorded vectors and nine synthetic contrasts,
including correct correction, no child answer, still-wrong answer, encouragement,
unresolved correction, and renewed help/uncertainty both before and after an
acknowledgment. Mock-provider tests verify literal wire delivery, unchanged
recorded abstention, safe mapping and reducer holding. The counterfactual accepted
correction requires audio drain and matching render before steering. Runtime tests
cover one-time acknowledgment recovery, sharing the support budget, cancellation,
delayed append acknowledgment and fresh-evidence recovery through render.

These are deterministic tests with supplied scores, **not evidence that Jev now
interprets these words better**. Historical support review hashes and evidence
remain intact; their tests account for the deliberate later acknowledgment
revision while retaining support criteria and unrelated-question checks.

With separate explicit authorization, compare baseline/candidate Jev questions
on the review set, then rerun the exact self-correction exchange in a recorded
live lesson. Confirm final-answer recognition, acknowledgment, relevant audio
drain, next scene render confirmation and next-node steering. Also verify that
renewed uncertainty/help holds the scene and any clarification stays natural,
ignores resumed speech and occurs at most once. Do not mark this matrix case
verified based on mocked scores, transcript attribution or a successful append.

Checks: focused tests passed (46); full offline suite passed (529 tests across
21 files); typecheck and lint passed without warnings; changed-file formatting
and `git diff --check` passed. Repository-wide formatting still flags only the
untouched `tests/transcript-state-tutor-stabilization.test.ts`; it was preserved.

This slice changes four runtime/classifier files (the clarification class has
only a comment change), extends the existing clarification runtime tests, updates
historical support provenance tests and adds the self-correction test/review/note
and semantic candidate patch. Earlier endpoint, discarded-candidate, support,
hint and clarification work remains uncommitted and intact. Checkout remains
`main` at `3ccb0231e30d7f9ab082e9df4f5228af1feba42b`; no commit, push, deployment
or GitHub status change was made.
