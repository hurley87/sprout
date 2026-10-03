# Sprout

Sprout supports short, supervised counting lessons that adapt to a child's prior responses. Its language distinguishes what was observed, what the parent reviewed, and what a later lesson changes.

## Language

### People and practice

**Child**:
The single preschool-aged participant in the prototype's learning activities.
_Avoid_: Student account

**Parent**:
The adult who supervises the child, starts lessons, and reviews learning observations.
_Avoid_: Teacher, examiner

**Experiment**:
A seven-day run intended to evaluate willing participation, useful lesson adaptation, and the trustworthiness of proposed observations.
_Avoid_: Clinical assessment, learning assessment

**Lesson**:
A planned counting experience consisting of a warm-up, one targeted activity, and a fresh example.
_Avoid_: Test, quiz

**Session**:
One live attempt at a lesson, which may end normally, early, or because of a technical failure.
_Avoid_: Completed lesson

**Target quantity**:
The number of objects, within the agreed learning scope, that the main activity practices.
_Avoid_: Level, grade

**Theme**:
The story or play setting used to present a counting activity.
_Avoid_: Learning objective

**Authored lesson graph**:
The application's bounded set of lesson nodes and permitted success paths, including where the lesson ends.
_Avoid_: Model-selected curriculum

**Lesson node**:
One authored counting activity with a displayed group, learning objective, tutor brief, and success outcome.
_Avoid_: Screen when referring to the whole activity

### Evidence and interpretation

**Session record**:
The account of what was said and shown during a session, including help provided and how the session ended.
_Avoid_: Transcript when referring to the entire record

**Quantity identification**:
Giving the correct total for a displayed group, without asserting how the child arrived at it.
_Avoid_: Counted when no count sequence was observed

**Counting aloud with a total**:
Saying a count sequence and giving the correct total for the displayed group.
_Avoid_: Proven one-to-one correspondence

**Support**:
Help preceding a response, including prompts, choices, modeling, counting together, or parent-reported assistance.
_Avoid_: Failure

**Independent response**:
A response for which no help was provided in the relevant exchange and no assistance is reported or otherwise evident.
_Avoid_: Mastery

**Uncertain evidence**:
An exchange whose speech, attribution, or activity context is insufficiently clear to justify a learning conclusion.
_Avoid_: Incorrect answer

**Proposed observation**:
The Observer's interpretation of a specific exchange before parent review.
_Avoid_: Established fact

**Conversation-state proposal**:
The ConversationStateClassifier's ephemeral interpretation of child activity, latest answer outcome, support need, and tutor state for a claimed lesson node and transcript revision, supplied to the deterministic lesson reducer.
_Avoid_: Observer proposal, transition command, reviewed evidence

**Child activity**:
What the child is currently doing in the exchange: waiting, thinking, or answering, independently of their latest answer's outcome or need for help. A transcript-only classifier reports unknown; establishing activity requires runtime turn or microphone signals.
_Avoid_: Child state when combining activity, outcome, and support need

**Answer outcome**:
The inferred outcome of the latest answer for the lesson node: correct, incorrect, or unclear, with none when no answer has been given.
_Avoid_: Current child activity, reviewed learning evidence

**Support state**:
The child's currently inferred need for help, independently of their activity or latest answer outcome; none means no need is inferred.
_Avoid_: Incorrect answer, record of help provided

**ConversationStateClassifier**:
The runtime interpreter that classifies a live transcript snapshot into a conversation-state proposal. It proposes conversation state without directing lesson transitions or producing persistent, parent-reviewable learning evidence.
_Avoid_: Observer, lesson controller

**Tutor state**:
The tutor's conversational function: asking, clarifying, helping, or acknowledging. Transcript classification describes the latest tutor message and reports unknown when none of these functions is evidenced; it cannot establish live speaking or listening activity.
_Avoid_: Acoustic activity inferred from transcript

**Reviewed evidence**:
An observation accepted by the parent, either unchanged or after correction, with its supporting context.
_Avoid_: Model verdict

**Learning profile**:
The accumulated history of reviewed evidence used to inform future lessons.
_Avoid_: Mastery score, developmental status

### Review and adaptation

**Observer**:
The post-session interpreter that proposes evidence-oriented, parent-reviewable learning observations from the session record.
_Avoid_: Examiner, assessor

**Parent review**:
The parent's decision to accept, correct, or reject proposed observations.
_Avoid_: Skill grading

**Parent repair**:
How much the parent had to change proposed observations during review, ranging from light correction (small contextual fixes) to substantial repair (rewriting, reconstructing, or supplying the learning evidence).
_Avoid_: Observer accuracy score

**Lesson planner**:
The process that selects a bounded lesson using reviewed evidence and explains that choice.
_Avoid_: Autonomous curriculum

**Useful adaptation**:
A delivered change to a later lesson's target, challenge, or support that earlier reviewed evidence caused, meaning the lesson would have differed without that observation, and that the parent judges useful.
_Avoid_: Theme change alone, name personalization, repeating a target without changing challenge or support

**Calibration**:
The initial exploration of whether the agreed range of quantities offers a suitable challenge.
_Avoid_: Placement test
