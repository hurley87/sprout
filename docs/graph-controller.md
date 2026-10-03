# Issue #55: experimental graph controller (commit 2)

`lib/counting-graph-controller.ts` is a standalone application controller. No route,
provider configuration, production session, Jev evaluation, or persistence is changed.

## Authority and association

`startSource` takes a freshly activated **application-owned** transport source and
returns an event sink bound locally to its teaching visit. Forward the existing
`ProviderEvent` events, with BrowserTransport's source ID, through that sink. The
sink's closure is a local callback fence, not provider proof of request freshness.
The transport adapter must send only to the specified active source, synchronously
reject stale sends, and permanently isolate sources passed to `retireSource`.
Startup context is withheld until `confirmRender(pendingRender)` matches the source,
visit and node. The snapshot and render identities are copies, not mutable authority.

The actual parsed delegation contract (`lib/events.ts`) exposes an opaque ID and
optional provider-clock `offsetMs`. It exposes no node, visit, or action arguments.
A local receive time, monotonic offset, phase, or media activity cannot distinguish a
late, distinct old-node ID from a new-node request on the same source. Provider offsets alone
have no proven mapping to the local render/visit boundary. The appended-context
alternative was also checked below. The controller therefore
uses **one teaching attempt per source**, ignores offsets for association, permanently
retires every observed rejected/accepted ID, and never reuses a source for teaching.
It accepts only the first eligible request during teaching with previously observed
active output. Extra pending, wrong-phase, missing-source, stale-source, duplicate and
unsupported requests do not advance. No model-supplied identity or next action is used.

After successor render confirmation the old source receives the pending response
containing only the now-rendered current-node teaching context, then is retired. The
controller waits for a fresh source. Commit 3 needs an isolated graph transport adapter
and fresh-source startup context; the existing production replacement seed is not a
graph contract. This conservative policy adds source setup latency and does **not**
claim that a persistent single-source three-node trial is safe. Loosening association
requires new trustworthy causal evidence, not a timestamp or phase heuristic. There
is also no guarantee that an eligible first request within one visit is semantically
correct: GPT-Live's judgment remains experimental.

## Appended-context fence investigation

The existing boundary already preserves `context.appended` with `name`,
`clientEventId`, `startMs`, and `endMs`. Commands send `event_id`; the provider
acknowledgment echoes it as `client_event_id`. `Session.contextAcknowledged` matches
that ID and source, recording estimated injection rather than model adoption.
Existing local findings in `docs/response-gate-latency-experiment.md` record matching
acknowledgments and provider context intervals; these fields are real, not invented.

A possible temporal filter is: after exact render, send node context, await the
matching `session.instructions.appended` with finite ordered nonnegative times,
then require `delegation.offsetMs > endMs`. Both times refer to the provider session
timeline; this comparison does not require conversion to the application clock.
Missing, mismatched or regressing acknowledgments and missing/equal/earlier delegation
offsets would need to fail closed. This can exclude requests known to predate that
estimated boundary, but does not establish a reliable semantic node-visit fence.

The current [official context timing contract](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model)
describes start/end as estimates and explicitly allows the model to respond before
using the whole update. Thus an old-objective request created after estimated end
could satisfy the temporal test while remaining stale for the application visit.
No hard model-adoption barrier or visit association is supplied. That is the remaining
limit, not merely the distinction between context delivery and audio playback.
A timestamp/phase combination cannot rule it out. For this strict fail-closed spike,
the controller keeps the fresh-source fallback rather than asserting such proof.
Fresh sources are a conservative experimental limitation, **not the intended final
architecture**; their setup latency and loss of conversational continuity confound
comparisons and must be included in subsequent findings. Revisit this choice if a
stronger provider barrier becomes available or a separately approved experiment
relaxes association to an explicitly heuristic timestamp fence.

## Audio, render and cancellation

The sequence is teaching → observe active decoded output → accept delegation →
observe a fresh post-delegation quiet transition → sustain quiet for `quietMs` →
commit the authored successor → confirm its render → answer the pending delegation.
`outputWasActive` records prior activity; `ackAudioObserved` records acceptance with
that prior activity. Both reset on visit/source changes and cancellation. Neither
flag proves acknowledgment **content**. Later recordings must check that.

Pre-existing quiet, repeated quiet notifications and delegation alone never start
an interval. Active or unavailable output invalidates a running quiet interval.
Unavailable is never silence. Quiet intervals and failure callbacks have generation
fences in addition to source/visit fences. `failureMs` is finite and greater than
`quietMs`; it bounds startup render, teaching, accepted progression and successor
render separately. Activity cannot extend a stage's deadline. Failure never forces
an edge or sends pending context. Decoded PCM is upstream of playback and may measure
an ordinary pause; this is an experimental gate, not playback-complete attribution.

The old node stays current until the gate passes. Only its authored success edge is
committed. A successor render token identifies the intended new source/visit/node;
no response is released before an exact confirmation. Duplicate confirmations cannot
release twice. Terminal success uses the graph's `complete` edge: retain the final
scene, answer once with its brief-goodbye-then-silent contract, and accept no further
teaching. The adapter may keep terminal audio alive for goodbye until stopped.

Child activity/speech during pending progression, disconnect/provider failure, stop,
and disposal invalidate handles, timers and render callbacks and retire the source.
Interruption after a committed successor retains that scene; no rollback is invented.
Failure recovery is explicit: activate a never-used source and start a fresh visit of
the currently committed node. Stop/disposal cannot restart. There is no automatic
retry loop. The caller must surface snapshot failure and source-wait states; route
wiring, recording, live trials and browser hardening belong to later commits.

## Verification

Focused tests use a fake source-targeted transport and clock, including cancelled
callbacks deliberately fired after invalidation. Coverage includes startup/render
ordering, prior activity, pre-existing quiet, active/unavailable interval resets,
duplicate and same-source distinct stale IDs (with and without offsets), wrong source
and phase, cancellation/recovery, renewed child speech, timeout, send failure,
at-most-once responses and the exact terminal path with fresh sources.
