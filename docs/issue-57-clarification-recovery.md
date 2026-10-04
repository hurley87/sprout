# Issue #57: clarification response recovery

Status: focused GPT-Live instruction correction and offline regression coverage;
semantic calibration and live recovery remain unverified. Changes stay uncommitted.

## Established evidence

The [review set](issue-57-clarification-review-set.json) preserves the SHA-256 of
`sprout-lesson-39abf02a-8c9a-4144-ada0-9430673ab5d4.json`, zero-based event indices,
exact source identities, four exact request transcripts, recorded probabilities,
and expected current serialized state. No recording was supplied. Transcript
labels are reported attribution; audible/visible behavior remains unverified.
Runtime seconds below use the export's clock, not a recording clock.

| Snapshot | Correct | Help | Acknowledging | Observed outcome |
| --- | ---: | ---: | ---: | --- |
| 47.106 s, turn 5 / rev 37, after explicit success | .95 | .40 | .97 | support_ambiguous |
| 57.318 s, turn 5 / rev 47, after clarification | .95 | .36 | .94 | support_ambiguous |
| 62.216 s, turn 6 / rev 51, “Yeah, I answered one” | .97 | .10 | .95 | accepted child-source proposal; acknowledgmentObserved false |
| 64.546 s, turn 6 / rev 55, “Thanks for telling me.” | .97 | .09 | .43 | tutor_no_winner |

The four-second timer worked: scheduled 47.106, requested/appended 51.107,
append acknowledgment 51.818. New tutor text invalidated local tracking 52.917.
Tutor revisions 52–55 cleared child-source acceptance and acknowledgment as
required. Relevant new tutor audio drained around 64.133. Parent stop at 69.621
occurred with no completion. The missing fresh explicit acknowledgment after
reaffirmation is the recovery blocker demonstrated by these mappings.

## Small conversational correction

The prior append ended with the unrestricted “Do not imply success”. Its effect
on the model is unknown, but its scope conflicted with the durable instruction to
confirm a settled correct answer on later turns. The append now applies
no-success/no-count/no-hint specifically to the clarification question. After a
child response establishes a settled correct answer or a settled reaffirmation
of their previous correct answer, without renewed help or uncertainty, GPT-Live
is told to explicitly confirm it again with number and object, then pause. The
session instruction also explicitly covers this recovery.

A generic finished/yes reply alone is insufficient. Renewed help, unresolved
alternatives and unfinished/uncertain replies require help, waiting or
clarification without giving the total. No application score, diagnostic or
clarification callback sends a success instruction. GPT-Live must interpret the
actual response; prompt wording is not proof of compliance. The request remains
one-time and tells the tutor to ignore it if the child has resumed or responded.

No runtime/reducer, thresholds, models, support projection or Jev question changes
were added in this slice. Exact runtime/node/visit/child-turn/revision matching,
stale-result rejection, immediate candidate interruption protection, fresh
relevant acknowledgment and audio drain, and render-before-steering remain the
authority gates. The old acknowledgment is not reused and generic “Thanks” is not
assigned success by fiat. Clarification and GPT-Live still have no transition
or completion authority. Four eligible quiet seconds and one request per visit
are unchanged, including cancellations, spent send-failure budget and no
identical-snapshot rearming.

## Current support diagnosis

The exact rev 37 state structurally groups the latest child block as
`Maybe... Uh\n... One`. The earlier `Uh, I think... [sigh\n] Two` and retry stay in
precedingContext; the explicit confirmation stays in subsequentMessages. No
words or bracket markers are stripped. This literal grouping does not assert
settling, verified speakers or independent counting.

The current supportScope already evaluates need at the snapshot's end, permits
settled successful child responses to resolve earlier difficulty, and separates
current support from independent mastery. It also preserves blockers for renewed
help, uncertainty and incomplete attempts. The pre-clarification “Maybe” creates
an interpretive uncertainty; earlier wrong answers or hesitation influencing .40
is a hypothesis. No explicit child help request appears in that snapshot. After
reaffirmation the real scores reached the existing no-help band. This run does
not establish model incapacity or justify duplicating/strengthening the current
support contract. **Further semantic refinement is pending real replay**, with
no global threshold/model change proposed.

Consecutive tutor lines are grouped too: at rev 47 the prior confirmation and
clarification are in one latest tutor message. This explains the supplied
projection, not why Jev scored it .94 acknowledging. Isolating semantic utterances
inside one provider text block would require additional evidence and is outside
this focused correction.

## Offline verification versus semantic calibration

`tests/clarification-recovery.test.ts` verifies all 14 reviewed payloads against
the actual classifier wire state/questions using a mocked provider. The four
recorded scores preserve the original decisions; a reducer replay preserves
child-source acceptance without acknowledgment, revision invalidation, generic
thanks hold and stale rejection. A counterfactual explicit success observation
requires active audio to drain and matching render before steering. This tests
deterministic gates, not interpretation of a new tutor phrase.

`tests/support-clarification-runtime.test.ts` adds renewed-help, alternatives and
unfinished reply cases, verifying no diagnostics-driven success append or second
request. Interruption at 3,999 ms cancels; at 4,000 ms a sent request is invalidated.
Existing request/cancellation, hint/completion, identity and scheduling coverage
remains required. Static prompt assertions test delivered conditional guidance;
mock scores do not establish better Jev interpretation or GPT-Live behavior.

## Concrete replay plan requiring separate authorization

No paid calls, live lesson or microphone session were run. The following is a
reviewable plan, not authorization to execute it:

1. Review/adjudicate the four recorded and ten synthetic cases in the review set.
   Treat review expectations as text judgments, not acoustic or mastery labels.
   Non-speech and generic-finished cases intentionally retain interpretive
   uncertainty; do not require high correctness/no-help merely to fit a target.
2. With explicit paid-provider authorization, make **one Jev request per case,
   14 total**, using pinned `jev-1.13.0`, the case's `expectedState`, and the exact
   current `CONVERSATION_QUESTIONS` from
   `lib/lesson-runtime/jev-conversation-state-classifier.ts`. The transport body
   is `{ model: JEV_MODEL, state: expectedState, questions: CONVERSATION_QUESTIONS }`
   through the existing `evaluateNoulQuestions` function. Provision the credential
   through the approved environment without reading or logging it or env files.
   Capture only normalized probabilities, elapsed time and mapped outcome;
   retain neither raw provider bodies nor authorization headers. No retries,
   additional repetitions or automatic prompt tuning in this budget.
3. Compare the four real replay results to recorded scores and inspect blockers
   across all contrasts. All snapshots are correlated within one session and a
   small synthetic set; they do not establish general calibration. Jev inputs
   are unchanged by this tutor correction, so any score shift cannot be credited
   to it. If a smallest semantic revision becomes justified, review that exact
   wording plus a separately authorized paired baseline/candidate call budget
   before implementing or running it.
4. Separately authorize a recorded live lesson. Confirm append acceptance and
   audible natural no-hint clarification; settled reaffirmation produces a fresh
   explicit number/object acknowledgment; renewed help/unfinished alternatives
   receive support or clarification; relevant acknowledgment audio drains before
   render and steering. Compare the new export with these four snapshots.
5. Validate child activity immediately before and after append send, including
   delayed provider acknowledgment. Transport cannot retract a sent append.
   Local invalidation is tested, but whether the provider obeys ignore-on-resume
   guidance is a live-validation gap. Confirm no interruption, duplicate prompt,
   answer leakage, premature transition or terminal completion from clarification.

## Checks for this slice

Full offline suite: **467 tests passed**. Typecheck and lint passed. Formatting
passes for the six files changed in this slice; `git diff --check` passes.
Repository-wide `format:check` reports the already tracked, untouched
`tests/transcript-state-tutor-stabilization.test.ts`; its HEAD version also fails
Prettier's check. That unrelated file was preserved.

Files added: this note, the clarification review set and
`tests/clarification-recovery.test.ts`. Files refined:
`lib/lesson-runtime/support-clarification.ts`, `lib/lesson-runtime/live-context.ts`
and `tests/support-clarification-runtime.test.ts`. All other prior uncommitted
work was preserved. No commits, pushes, deployments, issue changes or persistence
were added.
