# Historical nine-question classifier contract

This archived contract describes the retired runtime classifier. It remains only
for offline comparisons under `lib/experiments/issue-57/legacy/`. See
[the current production contract](lesson-classifier.md). Historical paths and
recovery behavior below describe the earlier implementation.

# Current-node transcript classification

This document describes the classifier's implementation contract. Broader live
calibration continues in [#57](https://github.com/hurley87/sprout/issues/57).

The root transcript-steering runtime uses a server-side
`jevConversationStateClassifier`. It accepts an authored node ID, a nonnegative
safe transcript revision, a recent ordered `Child:`/`Tutor:` transcript containing
only that node's exchange, and an `AbortSignal`. It returns a descriptive
`ConversationStateProposal` or `null`. The browser runtime calls
it through the retained classification/diagnostic endpoint. The classifier has no transition,
persistence, or GPT-Live authority.

Endpoint failures produce `classifier.error` with a closed `category` (`http`,
`network`, `timeout`, `invalid_json`, or `invalid_schema`), `httpStatus` (or
`null` before a response), and an allowlisted `endpointCode` (or `null`). HTTP
status is checked before JSON parsing so an HTML 404 remains an HTTP failure.
Response text, exception messages, credentials, and raw provider payloads are
never copied into these diagnostics. Server codes distinguish local request
rejection, invalid input, missing configuration, timeout, cancellation, and
unexpected internal failure. Provider abstentions retain the existing normalized
mapping reasons.

Each exact runtime/node/visit/turn/revision snapshot is requested at most once,
including failed requests. A newer eligible snapshot can recover; failure alone
does not retry or advance. An HTTP 404 cannot be repaired by repeating the same
snapshot. After moving routes or changing checkouts under `next dev`, restart
the dev server if `/api/classify` is missing. A local POST with `{}` and matching
Origin must return JSON HTTP 400; this invalid-input probe never calls Jev.

For issue #57's 2026-10-03 wrong-answer demo, the retained server returned HTML
404 for this safe probe while `/api/live` responded normally. Restarting that
server restored the expected JSON 400. This supports a stale route discovery
failure, but the original export omitted HTTP status and cannot prove the
historical response. Missing credentials are unverified. This route recovery is
not a successful behavioral rerun: the live case still needs correct answer,
acknowledgment, relevant output drain, transition, render confirmation, and
steering evidence.

The existing `lib/jev.ts` transport now projects validated Noul probabilities for
one or more questions from a single TypeSafe/SystemOne request. The classifier keeps the
existing credential and pinned `jev-1.13.0`; provider bodies and errors remain
private and are never logged.

The classifier explicitly projects only `nodeId`, `scene.object`,
`scene.quantity`, `learningObjective`, `transcript`, `tutorObservation`, and
`transcriptRevision` into the provider state. Scene facts and objective come from the requested
authored node. Neither the whole node nor its tutor brief or success edge is
serialized. Extra caller fields, future nodes and graph edges are excluded. The caller remains responsible for supplying
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

Mocked tests establish wiring and mapping, not Jev's real semantic accuracy.
Independent Noul probabilities do not supply a joint confidence score. Correctness
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


## Latest tutor message after counting help (issue #57)

The export `sprout-lesson-7cd5c9eb-88c5-40ba-b8a3-22f254ae597e.json` shows a
separate failure from discarded microphone candidates. The wrong `Three` answer
held the two-duck scene. After counting help, the child corrected to `Uh two` and
the tutor transcript ended `Yes, two ducks!`. At runtime 36.454 seconds, child
transcript eligibility and relevant tutor-output drain were both present. At
36.910 seconds the classifier abstained: `answerCorrect=0.94`,
`tutorAcknowledging=0.95`, and competing `tutorHelping=0.27`. That competitor exceeded
the 0.20 ceiling and left a 0.68 margin below 0.70. No proposal reached the reducer.
No discarded candidate or classifier error occurred in this run. This establishes
a missed transition relative to the reviewed text/scene evidence, not the acoustic
cause or proof that historical help caused the competing score.

Previously the tutor questions asked the provider to locate its target within the
full transcript. The server now supplies `tutorObservation.latestMessage` and
`tutorObservation.precedingChildAttempt` as explicit evidence. Tutor questions
classify only that latest message, using its preceding child attempt and current
scene/objective as context. Earlier counting help does not make a later success
acknowledgment itself a helping message. The full ordered transcript remains the
answer/support evidence so corrections and unresolved help requests are retained.
All nine questions still share one pinned-model request; no extra call or retry
was added.

The projection groups adjacent same-speaker lines because they may be fragments
of one utterance, preserves multiline text, and chooses the last tutor group and
its preceding child group. A newer child interruption is not substituted into an
earlier tutor acknowledgment's context. If there is no tutor message, the latest
message and preceding attempt are null. Unlabelled continuation lines remain
literal evidence; an unlabelled preamble makes the boundary unparseable and causes
`invalid_input` abstention before a provider call. This uses the existing speaker
labels, not verified audio attribution or a new provider turn identity.

Mixed acknowledgment/help within the latest group stays intact and may still
cause abstention. Child-authored revisions, unresolved help, real interruption,
stale identity, audio drain, and render confirmation retain their existing gates.
No probability thresholds changed: replaying the original observed scores still
abstains. Tests verify target projection, full correction context, single-call
wiring, current help/mixed-message handling, and conservative mapping with mocked
probabilities. They cannot establish that Jev's scores improve. A fresh authorized
live wrong-answer → correction rerun is required; none was started for this change.

## Help request recovery follow-up (issue #57)

See [the help-case evidence and correction](issue-57-help-recovery.md) for the
`support_ambiguous` finding, learner-led hint guidance, offline checks and required
live rerun. The help case remains unverified.
