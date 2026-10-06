# Realtime lesson architecture

```text
/
  application-owned lesson definition → deterministic lesson reducer → rendered scene
  GPT-Live ↔ microphone / local VAD + decoded tutor output activity
  speaker-labelled current-visit transcript → Jev ConversationStateClassifier
  tutor utterance stabilization → exact-source proposals → reducer
  exact render confirmation → bounded current-node steering → GPT-Live
```

## Authority

- GPT-Live owns conversation inside the current node's tutor brief.
- Jev supplies semantic observations, including answer outcome, support need and tutor function.
- The authored graph and deterministic reducer own lesson/UI authority.
- Local media state supplies choreography evidence; transcript text cannot manufacture it.

`LessonDefinition` supplies validated authored node identities, the initial node,
success edges, tutor instructions, recovery prompts, classifier criteria and presentation data. The
current application registry is intentionally small and explicitly registers only
counting. The reducer receives the selected definition for the whole attempt;
runtime state records its lesson ID and mismatched definitions are ignored. Models
cannot choose arbitrary scenes or see future graph edges through classification or
steering input. The reducer requires exact runtime, visit, child turn, node and
transcript revision identity. Exact render-token identity controls the handoff.

## Modules

| Module | Current responsibility |
| --- | --- |
| `app/lesson.tsx` | Root lesson UI, render confirmation, diagnostic export |
| `lib/lesson-runtime/lesson-definition.ts` | Shared definition contract, validation and current-node projection |
| `lib/lesson-runtime/lesson-registry.ts` | Small server-side application allowlist |
| `lib/lesson-runtime/counting-lesson.ts` | Counting content, criteria and recovery prompts |
| `lib/lesson-runtime/lesson-runtime-reducer.ts` | Deterministic transitions and gates |
| `lib/lesson-runtime/lesson-runtime.ts` | Runtime orchestration, transcript assembly, classification scheduling and steering |
| `lib/lesson-runtime/tutor-stabilization.ts` | Independent transcript stability and output quiet clocks |
| `lib/lesson-runtime/conversation-state-classifier.ts` | Closed proposal/input contract |
| `lib/lesson-runtime/jev-conversation-state-classifier.ts` | Authored current-node projection and Jev questions |
| `lib/lesson-runtime/classification-decision.ts` | Probability mapping and safe diagnostics |
| `lib/lesson-runtime/live-context.ts` | GPT-Live setup and bounded teaching instructions |
| `lib/browser-transport.ts` | Single WebRTC connection, input fence, playback and resource teardown |
| `lib/events.ts` | Provider event parsing and client command types |
| `lib/microphone-turn.ts`, `lib/output-activity.ts` | Local VAD and decoded output observation |
| `lib/jev.ts` | Generic server-only Noul transport |
| `lib/local-request.ts` | Loopback request checks and bounded JSON reads |
| `app/api/live/route.ts` | Server-only GPT-Live session setup |
| `app/api/classify/route.ts` | Server-only classification and normalized diagnostics |

`/api/live` accepts `{ lessonId, sdp }`, resolves the ID through the application
allowlist, and builds matching session instructions on the server. `/api/classify`
accepts `{ lessonId, nodeId, transcriptRevision, transcript }`, rejects unknown
lessons/nodes, and derives current-node context and classifier criteria from the
resolved definition. It returns the `{ proposal, diagnostic }` contract. Neither
route accepts client-authored prompts or graphs. Both retain loopback guards,
bounded parsing, deadlines and safe provider errors.
The transport retains its microphone input fence because the root opens provider
input only after initial scene confirmation and session readiness. It retains
app-owned source identity to reject unrelated provider events. Unused provider
delegation events are discarded by the parser. Steering commands retain
`delegation_id: null` as part of the provider wire contract.

## Lifecycle and recovery

The initial scene is committed and confirmed before connection startup. Microphone
input stays silent until the runtime opens it. The runtime assembles ordered,
speaker-labelled transcript snapshots for the current visit, and captures exact
source identity before classification. Tutor snapshots must pass stabilization.

Progression requires a correct answer with no unresolved support need, a current
tutor-authored acknowledgment, fresh relevant tutor output, and a drained quiet
interval. The reducer selects the authored edge, requests a render, and waits for
exact confirmation before releasing new-node steering. The matching provider append
acknowledgment establishes the next visit's transcript timeline boundary. Terminal
confirmation completes the lesson and releases local media.

Abstention, invalid data, timeout or stale classification holds the scene. A
meaningful new transcript allows new classification. Missing VAD/output evidence
cannot authorize progression. Interrupted render confirmation, disconnect, failed
startup or failed/missing steering acknowledgment ends the attempt; restart creates
a fresh runtime. Stop, page hiding and navigation release microphone and connection.
See the [reducer contract](lesson-runtime-reducer.md) and
[browser guide](lesson-browser-guide.md) for exact timing
and known media/transcript limitations.

## Diagnostics and prototype reset

The page displays current gate state, current-visit transcript and recent runtime
events. JSON export includes classification mapping, identity/staleness, stabilization,
local media and render/steering diagnostics. Credentials, SDP and raw provider bodies
are excluded. Exports contain conversation text and remain under the user's control.

There is no persistence, recording, saved-session recovery, post-session Observer,
parent review or historical inspection stack. Convex and its project tooling have
been removed. Historical prototype data is disposable, with no compatibility or
migration layer. New persistence will be designed only when a current requirement
needs it. Behavioral calibration and broader evaluation remain in #57.
