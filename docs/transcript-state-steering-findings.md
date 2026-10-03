# Transcript-state steering: engineering findings

The architecture experiment on `spike/transcript-state-steering` is complete.
The architecture is sufficiently validated to become the direction for further
Sprout development. Broader behavioral testing and calibration should now happen
incrementally rather than keeping this spike open indefinitely.

## Validated architecture and authority

```text
authored lesson graph
        ↓
app renders current node
        ↓
GPT-Live teaches naturally
        ↓
speaker-labelled transcript
        ↓
Jev semantic classification
        ↓
deterministic application reducer
        ↓
relevant tutor audio drains
        ↓
authored graph transition
        ↓
next scene renders
        ↓
render confirmation
        ↓
bounded current-node steering back to GPT-Live
```

| Component | Authority |
| --- | --- |
| GPT-Live | Conversational tutor: natural wording, pacing, acknowledgment, hints, and clarification. |
| Jev / ConversationStateClassifier | Semantic observer of the bounded current-node transcript; supplies descriptive proposals. |
| Authored graph + reducer | Lesson/UI authority: validates evidence and identity, follows only authored edges, and owns terminal completion. |
| Local media state | Speech choreography evidence from microphone activity and decoded tutor output. |
| Steering | Resynchronizes GPT-Live with only the newly rendered current-node context after exact render confirmation. |

Neither GPT-Live nor Jev selects an arbitrary next scene. Async observations are
bound to the exact runtime, node, visit, child turn, and transcript revision.
Render confirmation additionally matches the render token and scene. Future
nodes and graph edges are excluded from model context. The realtime classifier
is separate from the post-session Observer and produces no durable learning
conclusions or parent-review evidence.

## Progression of the experiment

1. **GPT-Live playback events.** The observed GPT-Live WebRTC session did not
   expose a reliable playback-complete provider event suitable for controlling
   UI transitions. Local media observations became choreography evidence, not
   a claim of definitive provider completion.
2. **Explicit delegation.** We explored “GPT-Live acknowledges → delegates to
   client → waits → app transitions.” The expected explicit delegation event
   was not reliable enough in observed sessions to serve as the critical
   transition signal. Silence alone was not treated as proof of delegation.
3. **Transcript-state steering.** The transcript observer and deterministic
   reducer succeeded without requiring GPT-Live delegation. Early demos
   exercised the first two transitions and held the butterfly scene during
   explanation/help. A later butterfly acknowledgment still caused Jev to
   abstain, prompting normalized probability and mapping-reason diagnostics
   rather than speculative tuning. The final manual run completed all three
   nodes and terminal completion.

Tutor utterance stabilization substantially reduced unnecessary Jev calls on
partial GPT-Live transcript fragments. It waits for stable tutor text and local
output quiet before classifying, independently of the reducer's audio-drain
gate. This finding does not establish an optimal timing threshold or a measured
cost reduction under sustained usage.

## Final manual run

The final manual run was reviewed from the recording and exported runtime
diagnostics during the spike. The closeout commit itself did not rerun the live
session. This remains evidence of one successful path, not aggregate classifier
accuracy or production validation.

```text
count-1-duck → count-2-ducks → count-3-butterflies → lesson complete
```

At each node the reported choreography was:

```text
child answers
→ GPT-Live acknowledges current scene
→ Jev observes correct + acknowledging
→ current tutor audio drains
→ application follows authored edge
→ next scene renders
→ exact render confirmation
→ GPT-Live receives only the newly rendered node context
```

The terminal authored edge renders the completion view and ends the connection;
it does not send a future-node or completion teaching prompt.

| Current node | answerCorrect | tutorAcknowledging |
| --- | --- | --- |
| One duck | ≈ .98 | ≈ .98 |
| Two ducks | ≈ .98 | ≈ .97 |
| Three butterflies | ≈ .98 | ≈ .97 |

These successful semantic classifications were strongly separated. The reported
final state was `phase = complete` and `lessonComplete = true`. These are
per-question probabilities in one run, not joint confidence or aggregate
classifier accuracy. No runtime behavior, questions, thresholds, or timing
settings were changed during closeout.

## What remains unproven

This spike does not fully production-validate every conversation. Continued
evaluation must cover wrong answer → retry, self-correction, unclear speech,
long pauses, help requests, interruptions / barge-in, repeated mistakes, longer
lessons, and objectives more complex than simple counting. Classifier
calibration needs more real sessions; latency, request frequency, and cost need
measurement under sustained usage.

Local PCM quiet can be a pause within speech, and approximate transcript timing
does not prove what a listener heard. Echo/noise, delayed fragments, unavailable
media evidence, classifier abstention/timeouts, and interrupted render/steering
handoffs still need evaluation and explicit recovery design. Existing automated
tests establish deterministic contracts and mocked wiring, not general live
semantic accuracy. The successful path justifies the architecture direction
without settling those limits.

## Closeout and follow-up ownership

- [#55](https://github.com/hurley87/sprout/issues/55) records the completed spike,
  including the unsuccessful delegation hypothesis and the transcript-state pivot.
- [#56 — Productionize authored lesson graph + transcript-state steering](https://github.com/hurley87/sprout/issues/56)
  owns integration, reusable runtime pieces, identity/authority preservation,
  migration from prerecorded acknowledgments, diagnostics, and recovery. It
  does not require every behavioral edge case to be solved before integration.
- [#57 — Expand live behavioral evaluation for transcript-state steering](https://github.com/hurley87/sprout/issues/57)
  owns the live matrix, calibration, false/missed transitions, conversational
  quality, recovery, and cost/latency trends. Threshold/prompt tuning must follow
  evidence; automated/simulated-child E2E can follow justified live cases.

The branch remains an isolated experiment. Shared changes are limited to an
explicit experiment selector in `/api/live` and `BrowserTransport`, plus the
reusable Jev multi-question transport; default lesson configuration and the
existing count-evaluation contract remain in place. Closeout review found no
obsolete delegation-control comments, disposable debugging code needing removal,
or accidental production-path edits. Delegation rejection diagnostics, mapping
diagnostics, and experiment infrastructure remain useful and are retained.

Implementation contracts and reproduction instructions remain in the
[classifier notes](transcript-state-classifier-experiment.md),
[reducer notes](transcript-state-runtime-reducer.md), and
[browser experiment guide](transcript-state-steering-browser-experiment.md).

Closeout validation: `npm test` passed all 1,112 tests in 49 files;
`npm run lint`, `npm run typecheck`, and `git diff --check` passed. These local
checks supplement the reviewed manual-run evidence; no new live-provider or browser
E2E run was performed during this documentation-only closeout.
