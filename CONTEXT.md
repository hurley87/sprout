# Sprout domain glossary

**Lesson definition**: Application-authored lesson identity, initial node, node
presentation, learning objectives, tutor instructions, classifier criteria and
success edges. The server resolves a submitted lesson ID through an explicit
application allowlist; clients cannot submit prompts or graphs.

**Lesson graph**: The authored nodes and success edges inside a lesson definition.
The deterministic runtime follows only the selected graph.

**Lesson node**: One bounded teaching objective and its displayed scene. The current
current counting lesson counts one duck, two ducks, then three butterflies.

**Lesson runtime**: `LessonRuntime` orchestrates one in-memory lesson attempt.
Its identifier scopes async work and render tokens; stopping or restarting invalidates its authority.

**Visit**: One activation of a node within a runtime. Each visit owns its transcript
and steering boundary.

**Child turn**: App-owned local microphone activity, beginning with candidate onset
and ending with confirmed quiet or candidate discard. It is not a provider utterance ID.

**Transcript revision**: A monotonically increasing app-owned identity for a
meaningful speaker-labelled current-visit transcript snapshot.

**ConversationStateClassifier**: Jev-backed semantic observation of a current-node
transcript. Its proposal describes answer outcome, support need and tutor function;
it does not direct lesson transitions.

**Answer outcome**: Correct, incorrect, unclear, or none for the latest settled child
answer. Tutor speech cannot supply a child answer.

**Support state**: The inferred unresolved need for help, independent of answer outcome.

**Tutor state**: The latest tutor message's semantic function: asking, clarifying,
helping or acknowledging. This is separate from audible output activity.

**Output activity**: Local decoded tutor audio observed as active, quiet or unavailable.
Unavailable cannot stand in for quiet.

**Tutor stabilization**: Independent transcript-stability and output-quiet clocks
that bound when a tutor-authored snapshot can be classified.

**Render confirmation**: The committed UI verifies an exact runtime/visit render
token, node and scene before new teaching context can be sent.

**Current-node steering**: A bounded instruction containing only the confirmed
node's presentation facts, objective and tutor brief. It excludes future nodes and
edges. Classifier requests follow the same current-node boundary.

**Lesson snapshot**: `LessonSnapshot` exposes current runtime state, display identity,
transcript and recent diagnostics to the lesson UI.

**Diagnostic export**: The current attempt's locally downloaded runtime events and
conversation text. It is not a durable session record.
