# Issue #57: support evidence and bounded clarification

## Evidence and limits

Source: `sprout-lesson-391be478-7860-432d-b002-79331f4723cf.json`
from Downloads. No recording was supplied. Actual audible/visible behavior and
speaker attribution remain unverified.

```text
Tutor: How many ducks do you see?
Child: [breath ]I think [sigh
Child: ] One
Tutor: Yes. One duck.
```

The export shows about 12 seconds of local tutor-output quiet before detected
child speech, followed by resumed child speech after the incomplete attempt.
Current-turn child transcript was eventually attached correctly. Relevant output
drained at runtime 27.433 s. At 27.886 s the classifier abstained with
`support_ambiguous`: correct .96, acknowledgment .97, needsHelp .17. There were
no classifier errors or transition requests. Parent stop occurred at 48.818 s.
The support mapping gate demonstrably held the scene. Whether fragmented
non-speech markers, earlier hesitation, or another semantic factor caused .17
is a hypothesis, not an established root cause.

## Focused semantic change

The existing support scope already specifies temporal resolution. We retain it
and add a literal `supportEvidence` projection in the same single Jev request:
preceding context, the child block before the latest tutor block, then subsequent
messages (including any later child responses). If no such preceding child block
exists, the latest child block is the anchor. This structural anchor does not
assert a task attempt, help request, verified speaker, or provider turn identity.
Consecutive same-label lines stay together, preserving partial annotations,
requests and self-corrections. Earlier context is not filtered by guessed meaning.
The full original transcript remains available and unchanged in diagnostics.

Support questions now explicitly say pauses, breaths, sighs, non-speech markers,
and isolated “I think...” alone do not establish unresolved support. They do not
strip bracketed words; meaningful words inside or across annotations still count.
Current support resolution remains separate from independent mastery. A settled
correct child answer can resolve earlier help; renewed requests, incomplete
answers, unresolved alternatives, continued uncertainty, and repeated difficulty
remain evidence against resolution. Tutor-supplied repetition alone establishes
neither mastery nor unresolved support. High correctness never forces help to
none. All probability thresholds and reducer completion rules remain unchanged.

## Separate runtime policy

A normalized `support_ambiguous` abstention on the exact current
runtime/node/visit/child-turn/revision can schedule clarification only when the
current child transcript exists, the tutor snapshot is current, and relevant
observed tutor output is quiet and drained. Four additional seconds of unchanged
eligible state constitute persistence; no identical classifier retry is required.
This is an explicit initial product policy, not calibrated child thinking time.
Initial silence or the unfinished “I think...” snapshot alone cannot trigger it.

Budget: **one instruction append per node visit**, spent even if sending fails.
Pending requests cancel on new child activity (including candidates), transcript,
identity/phase changes, output becoming active/unavailable, steering, proposal,
or stop. Cancelled identical sources cannot rearm. A new visit has a fresh budget.
Discarded microphone candidates still retain the existing classifier revalidation
behavior; they never cause unlimited clarification requests.

The short one-time GPT-Live instruction asks naturally whether the child finished
or wants help; it prohibits numbers, total repetition, hints and counting methods.
It does not contain the transcript or scene answer. It grants no completion
facts. Append acknowledgments cannot move the transcript visit boundary, confirm
render, establish acknowledgment/audio drain, or advance the reducer. A new child
answer still needs fresh classification, success acknowledgment, relevant audio
drain, and render confirmation before scene steering.

Transport supports instruction append, not retracting an already sent append.
New activity invalidates its local tracking; a delayed acknowledgment is ignored.
The instruction tells GPT-Live to ignore the request if the child has resumed.
That conversational race is a live-validation gap. There is no automatic retry
on missing append acknowledgment. Once the single request is spent, continued
ambiguity holds the scene for fresh child evidence or parent stop.
Diagnostics include clarification scheduled/requested/cancelled/invalidated,
acknowledged/ignored and send failure, attributed to the captured source.

## Before/after expectations and validation

| Case | Expected semantic interpretation after refinement |
| --- | --- |
| Exact split pause/resume transcript above | Settled one; annotations alone are not unresolved help. Recorded .17 still abstains if replayed as fixed scores. |
| Help → settled correct answer → acknowledgment | Earlier support may resolve; independent mastery is a separate question. |
| Correct → renewed help; “One... can you help?” | Help remains current even with high correctness. |
| Unresolved alternatives or repeated wrong answers | Do not manufacture settled success or resolved difficulty. |
| Tutor supplies total → child repeats tentatively | Do not infer independent counting or completion from tutor words. |
| Bracketed help/non-speech fragments and self-corrections | Preserve all words and order; no blanket stripping. |
| Persistent final support ambiguity | Scene holds; at most one clarification request after four eligible quiet seconds. |
| Resumed speech, new transcript/output, visit change, stop | Pending request cancelled; stale append acknowledgment has no authority. |

Projection tests verify literal preservation. Mocked provider tests verify request
shape, original-score abstention and unchanged mapping bands; they do **not**
establish better Jev interpretation. Fake-clock runtime tests verify trigger,
budget, cancellation, transport failure and authority separation. Existing reducer,
interruptions, stabilization, render and help/hint regressions remain required.

With explicit authorization, replay the exact exchange and the table's semantic
cases through Jev; compare real probabilities and gates before/after rather than
substitute mocked scores. Then record a live lesson with audible wording, long
pause/resume timing, interruption just before/after clarification send, no answer
leakage or repeated prompts, supported recovery, audio drain, scene render and
terminal completion. No paid replay, live lesson, or microphone session was run
for this change.
