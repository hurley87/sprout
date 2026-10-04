# Issue #57: missed final-node completion

Status: investigation complete; no additional application-code, semantic-question,
tutor-prompt, threshold or timing changes justified yet. Final completion and the
explicit support cases remain unverified.

## Established failure

The source is `sprout-lesson-8adca88d-2e69-4869-a512-dc31682fc071.json` in
Downloads. The [review set](issue-57-final-node-review-set.json) records its SHA-256,
zero-based event indices, exact runtime/node/visit/turn/revision identities,
transcripts and normalized mapping results. All times below are runtime seconds,
not recording offsets. No independently matched recording or audio was available
for this investigation. The user's report and exported text support the intended
finished count; they do not prove pointing, acoustic settling or independent mastery.

The final visit contains:

```text
Tutor: Alright, how many butterflies do you see?
Child: Two
Tutor: Hmm. Let's try it together. Point to each butterfly and say the counting words. Go ahead.
Child: One two three
Tutor: Yes. There are three butterflies.
Child: Is that all
Tutor: Yes, you counted all the butterflies.
```

At **56.7757 s**, visit 3 / turn 6 / revision 76, current-turn child transcript
eligibility was true, child speaking false, relevant tutor output observed and
drained. Classification started at 57.0205 s and abstained at **57.2263 s** with
`answer_no_winner`. There was no completion proposal, terminal render request or
`lesson.completed` event. The authored butterfly success edge is `complete`;
the reducer did not reach that edge because semantic acceptance was absent.

| Snapshot | Correct | Incorrect | Unclear | None | Help | Acknowledging | Asking | Clarifying | Helping | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 57.2263 s, turn 6, rev 76 | .80 | .15 | .30 | .02 | .17 | .87 | .03 | .06 | .08 | answer_no_winner |
| 58.9350 s, turn 7, rev 76 | .79 | .14 | .35 | .03 | .19 | .88 | .03 | .06 | .09 | answer_no_winner |
| 67.2519 s, turn 8, rev 79 | .64 | .17 | .52 | .03 | .40 | .87 | .04 | .08 | .11 | answer_no_winner |
| 70.9894 s, turn 8, rev 84 | .68 | .16 | .64 | .04 | .38 | .82 | .03 | .06 | .06 | answer_no_winner |

A candidate onset at 58.1617 s immediately invalidated authority. Its discard at
58.3205 s restored transcript eligibility; fresh drain was observed at 58.5796 s
and a new classification used turn 7. It also abstained on identical text. This
is recovery under a new identity, not a successful classification or a retry of
the same exact identity. The first abstention occurred before this candidate.

The later follow-up appears only in revisions 79/84 and cannot explain the first
miss. It coincides with more ambiguity, but neither causation nor the child's
intended meaning is established. The session ended at **79.1362 s**,
`page_hidden`, `lessonComplete: false`. There were no classifier/provider errors
in the export; all nine mappings had normalized probabilities.

The same run provides useful controls: one-duck wrong answer → learner-led
`One` → explicit acknowledgment was accepted at **24.3802 s**, followed by render
confirmation at 24.4067 s and context-append acknowledgment at 25.5280 s.
Two ducks were accepted at **35.5798 s**, render-confirmed at 35.6060 s, and
context-append-acknowledged at 36.7198 s. Startup and scene progression worked.
The one-duck control shows that historical difficulty does not always prevent
acceptance. It is not an explicit child help-request case or proof of audio quality.

## What is already specified, and what remains ambiguous

`answerCorrect.true` already explicitly accepts counting up to the displayed
quantity and stopping there, as well as correcting an earlier number.
`answerScope` already ignores superseded answers and considers self-corrections
across messages. `needsHelp` already asks for unresolved support at the snapshot's
end, permits a settled successful response to resolve earlier difficulty, and
does not derive correctness from tutor acknowledgment. Tutor questions already
target the latest tutor message with its preceding child group. Full ordered
history remains available for answer/support observations.

The first counted response therefore fits the existing text contract under the
human reading that it is finished. Adding another instruction to accept completed
counts would repeat existing policy. The probabilities do not identify whether
count settling, earlier difficulty, repeated counting words or another provider
interpretation produced the uncertainty. No deterministic runtime defect is
demonstrated for this first miss.

`Is that all` has at least three plausible readings: lesson-status question,
question about whether all objects were covered, or renewed doubt about the
answer. A clear lesson-status question need not retract a settled task answer;
explicit numeric doubt or renewed help must still hold. Existing wording asks for
the latest task attempt but also calls tentative questions unclear without
explicitly distinguishing these readings. This is a candidate clarification to
evaluate, not an established cause or an implemented correction. Never classify
all follow-up questions as harmless. A new child turn must immediately clear old
authority regardless of its eventual semantic interpretation.

There is also a context boundary to review for the later snapshots:
`tutorObservation.precedingChildAttempt` is the immediately preceding child group,
so revision 84 supplies `Is that all`, rather than `One two three`. The latest
tutor message can be interpreted as confirming the earlier count, but the focused
tutor scope does not explicitly explain acknowledgment across a non-answer
follow-up. This may contribute to later acknowledgment ambiguity; it cannot
explain revision 76, whose preceding child group is the counted answer. Evaluate
this distinction before adding a projection or expanding tutor context.

No transcript cropping, answer extraction, forced `supportState: none`, cached
success reuse, tutor-speech correctness inference or new transition authority is
justified. The existing identity, interruption, stale-result, acknowledgment,
relevant-output drain and render-confirmation gates remain necessary.

## Threshold decision

The bands remain HIGH .90, LOW .10, COMPETITOR_CEILING .20 and MIN_MARGIN .70.
The mapper reports the first failed gate; `answer_no_winner` does not mean it is
the only blocker. For the first correction, acceptance would also require:

- Correct .80 to meet HIGH, with unclear .30 below the competitor ceiling and
  an answer margin of .50 meeting MIN_MARGIN.
- Acknowledgment .87 to meet HIGH; its largest competitor is .08, margin .79.
- Help .17 to meet the no-help LOW band.

Lowering HIGH alone leaves the answer-competitor, answer-margin and support gates
failing. Accepting this sample by threshold changes requires HIGH at most .80,
ceiling at least .30, margin at most .50 and LOW at least .17. Those bounds would
still reject the second identical-text sample (.79 correct, .35 unclear, .44
margin, .19 help). This is illustrative gate arithmetic, not a proposed tuning.
Simultaneously weakening gates would risk accepting unfinished counts, uncertain
echoes, mixed acknowledgment/help or unresolved support. One session with two
correlated accepted controls cannot estimate those false-transition rates.

**Changed gates: none. Changed accepted/abstained recorded cases: none.**

## Focused review set and authorized evaluation plan

The JSON contains all **nine recorded classification snapshots** from the only
available export and **16 clearly marked synthetic contrasts**. Human text
interpretations are separate from observed mapping results; uncertain labels are
not ground truth. It covers direct learner totals, finished sequences, historical
and unresolved help, wrong and partial counts, tentative tutor-total echoes,
self-corrections, renewed difficulty, status versus doubt questions, and
interruptions. Earlier exports described in repository docs were unavailable in
Downloads and were not revalidated as source evidence. Synthetic interruption
text cannot verify actual VAD, timing or output behavior.

Before any paid/provider or live evaluation, obtain explicit user authorization
for the run and its bounded call/session budget. No such evaluations were run here.
After authorization:

1. Human-review complete exchanges and matched audio where available. Adjudicate
   ambiguous labels before computing semantic accuracy; record unheard/uncertain
   audio separately. Include pauses below the displayed total and at the total,
   resumed counting beyond it, echoes, explicit doubt and renewed help.
2. Freeze the current questions, thresholds, pinned model and code revision. Run
   the exact recorded snapshots and synthetic contrasts with the current explicit
   state projection in one nine-question call per snapshot. Log full normalized
   probabilities, each failing gate, latency and cost. Keep runtime identities
   alongside results, never use them as provider-selected transition authority.
   If repeated calls are authorized, report variability and their correlation.
3. If status questions reproducibly erase settled answers while explicit doubt
   remains distinguishable, compare one narrow semantic clarification against
   the same set: distinguish a new task answer/doubt/help request from a status
   question that does not retract the answer. Evaluate finished-count ambiguity
   separately; do not combine unrelated prompt changes into one experiment.
4. Keep bands fixed initially. Any later threshold proposal must list each changed
   gate and every recorded/contrast case changing accepted versus abstained,
   including wrong/partial/renewed-help false transitions. Use additional
   independent sessions and held-out contrasts, not only this failure's scores.
   A provider-only evaluation cannot establish runtime completion.
5. Rerun wrong answer → learner-led finished butterfly count with explicit tutor
   acknowledgment; inspect the accepted proposal's exact runtime/node/visit/turn/
   revision, tutor source, no outstanding support, relevant output onset/drain,
   terminal render request (`nodeId: null`, `sceneId: null`), matching render
   confirmation and `lesson.completed`. Repeat the explicit help-request case
   separately. Terminal completion must be observed, not inferred from tutor words.
6. Rerun unclear/partial counts, renewed help, self-correction and interruption
   during acknowledgment/terminal handoff; verify they hold or invalidate pending
   completion until fresh current evidence satisfies all gates. Preserve exports
   and matched recordings without treating their clocks as interchangeable.

Offline mapping/reducer regressions can verify gate arithmetic and terminal
render wiring. They cannot establish Jev calibration, actual counting completion,
GPT-Live pacing or microphone behavior. Review-set construction is not an
automated simulated-child harness and adds no provider calls or dependencies.

## Offline verification for this investigation

- All **405 tests** passed; typecheck and lint passed.
- Review-set validation matched every recorded transcript, mapping result,
  identity and zero-based event index against the source export; the source hash
  matched. There are two accepted and seven abstained recorded snapshots.
- Both new artifacts passed targeted Prettier checks; `git diff --check` passed.
  Repository-wide formatting reported
  `tests/transcript-state-tutor-stabilization.test.ts`, which is byte-identical
  to HEAD and was left untouched.
- Every existing modified/untracked file was hash-checked and preserved. Only
  this document and its review-set JSON were added, on `main` at existing HEAD
  `3ccb0231e30d7f9ab082e9df4f5228af1feba42b`.
- No paid provider evaluation, live lesson, microphone session, commit, push,
  deployment or GitHub issue-status change was performed.
