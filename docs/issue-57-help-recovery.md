# Help request → supported completion: issue #57

Status: prompt correction and offline regressions complete; **live case unverified**.

## Evidence and diagnosed blocker

The input evidence is `Cap Recording - 4 October 2026.mp4` (verified duration
41.109 s, 1920 × 900, with an audio track), `sprout-lesson-e5458bfc-058b-4947-878e-43760307b4d3.json`,
and `transcript-eqqvb2kmsg65pyk.vtt` in Downloads. The JSON export records this
ordered exchange on `count-1-duck`:

```text
Tutor: How many ducks do you see on the screen?
Child: Can you help
Tutor: Sure. Let's count slowly together. Start with one...
Child: One
Tutor: Yes. One duck. You're counting carefully!
```

The VTT also records the help request, a supplied starting number, learner
“One”, and confirmation. Prior sampled video review showed one duck throughout. A fresh frame at recording
offset 35 s shows one duck, visit 1, child turn 2, tutor revision 24, child
transcript eligibility true, relevant tutor audio true/drained, and correctness
and acknowledgment unaccepted.
Audio wording, pacing, and the child's independent counting ability have not
been independently established. Recording/VTT offsets and runtime timestamps
are separate clocks; filenames alone do not establish a shared timeline.

At runtime **31.037 s**, `runtime.changed` records current-turn child transcript
eligibility intact and relevant tutor output drained. At **31.5062 s**, visit 1,
child turn 2, tutor revision 24, the final mapping abstained:

| Observation | Probability |
| --- | ---: |
| answerCorrect | 0.94 |
| answerIncorrect | 0.03 |
| answerUnclear | 0.13 |
| answerNone | 0.03 |
| needsHelp | 0.23 |
| tutorAcknowledging | 0.96 |
| tutorAsking | 0.03 |
| tutorClarifying | 0.07 |
| tutorHelping | 0.09 |

Answer and tutor selections passed their existing bands. `needsHelp: 0.23`
exceeded LOW (0.10) and was below HIGH (0.90), producing `support_ambiguous`.
No completion proposal reached the reducer. No `classifier.error` occurred.
`page_hidden` ended the run at **39.4832 s** on the initial node without a
transition. Earlier mappings abstained with `answer_no_winner`: while helping,
answerNone was 0.86 and answerUnclear 0.79; after “One”, answerCorrect was 0.79,
answerUnclear 0.41 and needsHelp 0.44.

This establishes a semantic mapping blocker, not a transport or current-turn
eligibility failure. It does **not** establish why Jev returned 0.23. Historical
help influencing the score is a hypothesis; uncertainty from a learner repeating
the tutor's supplied answer is also possible. The literal transcript cannot
prove independent mastery.

## Small correction and expected behavior

The existing `answerScope` already targets the latest settled child answer;
`needsHelp.false` already allows successful answers to resolve earlier difficulty.
However, `needsHelp.true` described a child requesting help without explicitly
requiring that request to remain unresolved after later responses. The correction
makes both sides temporal and consistent: inspect the full ordered transcript
for outstanding support **at its end**. A settled successful child answer can
resolve historical help, but renewed help, uncertainty, or wrong/incomplete
follow-ups preserve unresolved support. Tutor acknowledgment alone cannot resolve
it. Receiving help or repeating a supplied number alone establishes neither an
unresolved need nor independent mastery. No transcript is cropped, no new
projection is added, and tutor-observation isolation remains intact.

The exact original probabilities still abstain. Expected recovery requires Jev
to independently observe a settled successful child response, no outstanding
support, and an acknowledgment with sufficiently clear probabilities; high
answerCorrect never overrides an ambiguous or high needsHelp. Offline tests do
not demonstrate changed Jev probabilities for the recorded exchange.

“Start with one” reveals the total on a one-object scene despite the existing
instruction not to give the total. The initial node brief lacked a specific help
method. Durable session guidance and each authored brief now invite
pointing and learner-supplied counting words, then waiting. Hints must not start
or finish the count, give a number to repeat, or reveal the total through a
leading question. On one duck: “Point to the duck and count it. What do you get?”
If the tutor has supplied a number and the learner only echoes it, guidance asks
for learner-led counting without supplying another number. GPT-Live still handles
natural support; this is prompt guidance, not a deterministic conversational rule.

Only semantic support wording, tutor help guidance, authored briefs, tests and
this documentation change for this case. The mapper, thresholds, runtime timing,
reducer, identity checks, interruption protection, stale route diagnostics and
microphone-candidate safeguards are unchanged from the starting checkout.

## Offline verification and limits

`tests/help-request-recovery.test.ts` preserves the exact final exchange and
probabilities, checks delivered support questions and full history/latest-tutor
projection, and maps **mocked** observations for help alone, learner-led success,
renewed help after success, incorrect/unclear follow-ups, tutor-only totals, and
uncertain repetitions. Static checks verify full hint guidance reaches session setup, while initial and
subsequent steering carry current briefs and compact support/confirmation reminders. Reducer tests
hold none/incorrect/unclear/correct answers with unresolved help, reject stale
success, require acknowledgment plus relevant output drain, request two ducks,
and emit steering only after matching render confirmation. Existing interruption,
stabilization, identity, scheduling and route-diagnostic regressions run alongside
these cases. Mock mapping tests test wiring and gates, not semantic understanding;
static prompt tests cannot establish helpfulness, compliance or pacing.

No paid provider requests, live lesson or microphone session were started.
No persistence, commits, pushes, deployment or GitHub issue status changes are
part of this correction.

## Required live rerun

Keep issue #57's help case open until a new authorized live run shows:

1. On one duck, the child requests help and receives useful support without the
   tutor supplying a counting word or total, including a leading question.
2. The child supplies a settled answer through learner-led counting. Record what
   was actually heard separately from transcript attribution; an echoed supplied
   answer is not evidence of independent completion.
3. GPT-Live explicitly acknowledges the answer. Inspect the accepted proposal's
   exact runtime/node/visit/turn/revision, support state, tutor source and relevant
   output onset/drain. Unresolved help and uncertain/incorrect follow-ups hold.
4. The application requests `count-2-ducks`, confirms its render, then appends and
   acknowledges steering for that scene. No steering precedes render confirmation.

Preserve the new export and recording, keep their clocks distinct, and compare
with this baseline. Passing offline tests is not a live verification result.

## Startup regression found in the next attempt

Export `sprout-lesson-e1941ede-a5fe-4c34-bca4-9bf7c0b785a7.json` records the first
`gpt_live.steering_append` at 1.3531 s and `gpt_live.error` at 1.4341 s, with
`code: invalid_value` and `clientEventId` matching `:steer:1`. It stops before
any transcript. The expanded append contained 2,560 characters. The
[official session guide](https://developers.openai.com/api/docs/guides/live-conversations)
limits each context append to **500 tokens**, while startup instructions allow
16,384 tokens. The recorded append counts as 505 tokens with `o200k_base` and
512 with `cl100k_base`. These are public tokenizer checks; the exact GPT-Live
tokenizer and provider's detailed error message are not established by this
export. The matched error plus excessive size strongly support a size rejection.

Repeating the durable counting/help guidance in every append introduced this
regression. Full guidance now stays in session instructions; each append contains
only rendered current-node context, its authored brief, concise support/success
reminders, and application authority. Offline counts for one duck/two ducks/three
butterflies are respectively 216/205/211 (`o200k_base`) and 218/207/213
(`cl100k_base`). Session instructions are 508/514 tokens, below their separate
startup limit. The tokenizers were used in a temporary local environment;
no provider request or repository dependency was added.

Tests enforce a 1,200-byte append-text budget for all three authored nodes to
catch recurrence of this expansion, preserve exact current-node projection, and
verify the full guidance in session setup. This static size regression is not a
provider tokenizer assertion. All **405 tests**, typecheck, lint, formatting and
diff checks pass after the correction. Live startup acceptance and the help
completion case still require an authorized rerun.
