# Session feedback semantics

Catching Unicorns uses `SessionSummary` for both recap rendering and tutor context. It is a deterministic projection of session-local accepted live evidence and the asynchronous full-conversation review, not a new model-generated assessment. The summary includes up to two recorded strengths, one practice focus, and an authored exercise adapted to that focus. There is no numerical grade.

## Evidence policy

- Authored criterion IDs identify concepts. Repeated scene criteria collapse into one concept, retaining every scene record, quotation, prompting history, full-review outcome and score in provenance/export. Repetition never creates extra strengths.
- A strength requires a live demonstration with an attributable learner quotation from this runtime. It describes a recorded explanation, not global mastery. A full-review-only result is retained diagnostically but cannot supply a missing learner quotation.
- Uncertain review results abstain: they do not erase a recorded explanation or diagnose failure. Strength text explicitly qualifies an inconclusive full review. Confident partial/not-yet review outcomes conflicting with a demonstration keep the concept open and exclude it from strengths. Conflicting confident results across repeated scene criteria also remain open.
- Prompting is conservative: prompted evidence from either source takes precedence over independent attribution. Unknown live prompting stays unclear. Independent wording refers specifically to live evidence. Neither uncertain review results nor missing observations prove a knowledge deficit.
- The practice focus prefers a partial recorded explanation or disagreement, then a prompted/unclearly attributed explanation, then an unobserved concept. If all are independently recorded, it extends the first concept with a fresh example. Exercises invite explanation and comparison against the appropriate source, without disclosing an unresolved canonical answer.
- CAF concepts and exercises are explicitly transfer reasoning. They never become assertions that the manuscript establishes facts about the CAF.

## Delivery and lifecycle

The runtime creates the summary when recap rendering is confirmed. It starts full review without waiting for it, and appends the actual feedback instead of generic screen/question steering. The tutor is instructed to give the strengths, practice focus and exercise, and use that same content for subsequent feedback/study-next requests. It must not claim to see unsupplied screen content. The screen receives the same model through the runtime snapshot; standalone presentation tests may derive the same projection.

Review completion or failure refreshes the model. A passive tutor-context update waits behind any pending scene steering acknowledgment. It explicitly forbids an extra turn or speech interruption, preserves the entry recap if still due, and is deduplicated. This does not introduce a new scene/audio gate or change conversation transition coordination. Concise feedback text is supplied within the existing context append budget; full quotations and raw scores remain in evidence details/export rather than being repeated into tutor instructions.

Pending and unavailable review states keep useful live-evidence feedback. Each runtime owns its evidence, assessment generation, summary and delivery key. A changed conversation supersedes/aborts the older assessment; generation checks reject late results even if abort is ignored. Stop may finish a new full-conversation review for the export and screen, but never appends feedback to a closed transport. The existing UI callback identity guard prevents an old runtime from publishing into a restarted session.

## Reviewed session

The supplied 2026-10-09 export reached recap at 648.44 seconds. Its final review had 21 uncertain and seven independent entries out of 28, including repeated engram/exogram criteria. The earlier screen repeated those criteria, while tutor steering supplied only a generic recap invitation and no actual feedback. Under this policy the repeated memory concepts count once, uncertain results remain inconclusive, and the partial durability explanation supplies a concrete paper-note comparison exercise rather than a diagnosed failure.

Provider-free regression coverage checks grounding, abstention, disagreement, attribution, deduplication, source/transfer separation, identical screen/tutor feedback, bounded context, pending/failure states, acknowledgment ordering, superseded requests, late completion after stop and new-runtime isolation. The browser fixture exercises real transport/runtime/rendering with local provider events; it does not establish how a live voice model will phrase or time its response.

## Recap presentation

The recap uses one readable column for the shared strengths, practice focus, and next exercise. Quotations stay inside the native keyboard-accessible evidence disclosure. Concepts appear once; identical quotations within a concept appear once, with every scene observation, independent/prompted/unclear attribution, review outcome, and learner-turn source retained underneath. Different quotations remain separate. CAF entries keep their transfer label. Raw scores and prompting history remain available in the session export.

“Finish discussion” calls the existing session stop lifecycle. It releases the live transport and capture while retaining the recap and its evidence disclosure; “Start new discussion” begins a separate attempt. Export remains under Session details after finishing. Empty, pending, and unavailable feedback keep the same evidence policy and do not imply mastery or failure. CAF and synthesis questions name the framework/topics without supplying unresolved answers; tutor closure acknowledges and pauses for app-owned advancement without a readiness question. Learner follow-ups remain supported.
