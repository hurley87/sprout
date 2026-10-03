# Current-node transcript classification

The spike is complete; see the
[final engineering findings](transcript-state-steering-findings.md).
This document describes the classifier's implementation contract. Broader live
calibration continues in [#57](https://github.com/hurley87/sprout/issues/57).

The classifier slice on `spike/transcript-state-steering` implements a server-side
`jevConversationStateClassifier`. It accepts an authored node ID, a nonnegative
safe transcript revision, a recent ordered `Child:`/`Tutor:` transcript containing
only that node's exchange, and an `AbortSignal`. It returns a descriptive
`ConversationStateProposal` or `null`. The isolated browser experiment now calls
it through a diagnostic endpoint. It remains separate from production
`LessonSession` and has no transition, persistence, or GPT-Live authority.

The existing `lib/jev.ts` transport now projects validated Noul probabilities for
one or more questions from a single TypeSafe/SystemOne request. `/api/evaluate`
continues using its existing count question and response envelope. Both use the
existing credential and pinned `jev-1.13.0`; provider bodies and errors remain
private and are never logged.

The classifier explicitly projects only `nodeId`, `scene.object`,
`scene.quantity`, `learningObjective`, `transcript`, and `transcriptRevision`
into the provider state. Scene facts and objective come from the requested
authored node. Neither the whole node nor its tutor brief or success edge is
serialized. Extra caller fields, future nodes, graph edges, reviewed evidence,
and learner profiles are excluded. The caller remains responsible for supplying
only a recent current-node transcript; the classifier does not accumulate or
trim session history.

Nine Noul questions cover four mutually exclusive answer outcomes (correct,
incorrect, unclear/incomplete, no attempt), one unresolved need for help, and
four primary functions of the latest tutor message (acknowledging success,
asking for the total, clarifying the child's response, providing counting help).
The answer questions judge the child's latest settled answer including
self-corrections across messages. Tutor speech never supplies a child answer.
Tutor questions describe the latest message's semantic function, not whether it
is being spoken now. A message with conflicting functions can cause abstention.

The deterministic mapping uses **experimental, uncalibrated** bands:

- An answer or tutor category must score at least 0.90, every competing category
  must score at most 0.20, and the winner must lead by at least 0.70.
- Help scores at least 0.90 map to `needs_help`; at most 0.10 map to `none` (no
  evidence of current need). Intermediate values cause `null`.
- All four tutor scores at most 0.10 map to `unknown`, including a snapshot with
  no tutor message. Intermediate or conflicting tutor scores cause `null`.
- Acknowledging success with an answer outcome other than `correct` causes
  `null`. Any invalid/missing probability or provider failure causes `null`.

These rules are not calibrated by the older single-count-question experiment.
Mocked tests establish wiring and mapping, not Jev's real semantic accuracy.
There is no joint confidence score: the old `confidence` field was removed
because independent Noul probabilities cannot honestly supply it. Correctness
is descriptive and never grants permission to advance.

`childActivity` is always `unknown`. Transcript absence is never interpreted as
waiting, thinking, silence, or speech. The existing other activity values and
`tutorState: listening` remain available for a later deterministic runtime layer.

Returned identity is copied from the request before any await, never from
provider output. Cancellation is checked before fetch, after fetch, after body
parsing, and before returning the proposal. Superseded callers can abort their
request; the browser runtime and reducer also validate the captured runtime,
node, visit, child turn, and revision against current state. The classifier
itself cannot determine staleness without that caller-owned state.
