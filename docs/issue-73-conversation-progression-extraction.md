# Issue #73: conversation progression extraction (Commit 2)

Parent: `ed4da2f1ca4d53fbd2dd527b1d1747e4eaa2135c`, on
`codex/73-refactor-lesson-runtime`. The working tree was clean before editing.
The final PR #72 live-demo prerequisite was confirmed by the user during Commit 1.

## Module boundary

`conversation-progression.ts` contains five pure helpers:

- `learnerRequestedNext`: the existing bounded navigation grammar, still re-exported
  from the reducer for compatibility.
- `closingTutorExchange`: finds the last tutor message and recognizes supported
  acknowledgment suffixes, including incomplete provider fragments. Substantive
  learner text rejects the exchange; this helper never establishes closure itself.
- `matchesTutorClosure`: compares an exchange's message index and exact text with
  an existing classified close. Both transcript updates and rechecks use it.
- `tutorAcknowledgedClosure`: interprets a validated tutor classification and latest
  speaker against the recognized exchange. The reducer still validates and consumes
  the exact classification source before calling it.
- `hasConversationCompletionEvidence`: evaluates existing learner navigation or
  tutor closure authority independently of concept mastery. Optional interrupted
  exchange semantics are preserved exactly, including the previous undefined result
  when neither learner transcript nor interrupted-exchange readiness exists.

The module imports only transcript parsing and the classifier's `TutorState` type;
there is no reducer dependency, mutable state, effect emission, or async behavior.

Deliberately retained in the reducer:

- `runtimeSource`, `classificationSource`, `sameSource`,
  `sameClassificationSource`, and `sameRender`: application identity authority.
- `meetsAuthoredCompletionPolicy`: existing concept-policy evaluation, untouched.
- `hasCurrentCompletionEvidence`: preserves the public API and dispatches between
  terminal output requirements, the extracted conversation predicate, and counting's
  accepted-answer/revision/concept-policy requirements.
- `outputHasDrained`: observed output and sustained quiet thresholds remain local
  to the reducer's media/timing authority.
- `finish`, `requestAuthoredTransition`, `stopped`, and the event switch: all state
  updates, authored edges, carry-forward, microphone candidates, render confirmation,
  and effects remain under reducer authority.

## File sizes

| Production file | Before lines | After lines | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: |
| `lesson-runtime-reducer.ts` | 891 | 836 | 37,857 | 34,798 |
| `conversation-progression.ts` | 0 | 94 | 0 | 4,421 |

## Verification

- Baseline and final uninstrumented `npm test`: **1,472 passed in 69 files** each.
- Temporary differential replay: saved the complete parent reducer before editing,
  imported it under a temporary sibling module name, and temporarily wrapped the
  extracted reducer. Every call ran both implementations with identical state,
  event, lesson, timestamp, and source inputs; Node's `isDeepStrictEqual` compared
  the complete returned state and effects. The extracted result fed subsequent
  events. **10,679 comparisons matched**, and all **1,472 tests in 69 files** passed.
  The baseline code, wrapper, and event counter are absent from the committed code.
- Focused progression/closure/navigation/terminal/counting tests: **302 passed in
  9 files**. Additional answer recovery, completed-exchange recovery, continuation,
  completion-policy, and completion-consistency tests: **65 passed in 5 files**.
- The full differential run includes October 16 recorded closure, interruption,
  terminal audio/microphone races, and October 17 recovery fixtures/reported words;
  it also covers correct answers, follow-up holds, brief acknowledgment retention,
  substantive interruptions, ambiguous answers, learner navigation, stale proposals,
  discarded/confirmed microphone candidates, active/quiet/unavailable audio,
  terminal render confirmation, and counting. Recorded fixtures are unchanged.
- Workspace baseline typecheck: **16 existing errors** in ignored historical UI
  copies. Workspace baseline lint: **759 errors / 10,594 warnings** in ignored
  review/generated files. These artifacts were preserved.
- Typecheck and lint both pass in a clean tracked-source copy from `git archive
  HEAD`, overlaid with the two changed production files and linked to installed
  dependencies. No environment files or historical review outputs were copied.
- New-module formatting and `git diff --check` pass.
- Provider-free browser verification uses the isolated copy, empty provider keys,
  disabled server reuse, and a temporary `--webpack` server option for the external
  dependency symlink. The first full run passed 24/25 tests; the synthetic-audio
  injection fixture failed with `Execution context was destroyed, most likely
  because of a navigation` while awaiting local playback. The same unmodified test
  passed on the parent reducer in a separate one-test run. The final full rerun passed **all 25 browser tests (1.3 minutes)**. No application code or fixture was changed in response; the
  initial browser navigation failure's root cause was not established.

## Limits

No live-provider calls were made. Deterministic equivalence applies to exercised
inputs, rather than measuring provider accuracy. No behavioral bug was corrected.
No prompts, lesson definitions, concept evidence code, classifier model/questions/
mapping/thresholds, event schemas, diagnostic journaling, frozen issue #42 artifacts,
recorded fixtures, dependencies, timers, or fallback paths changed. Diagnostic
extraction remains Commit 3 and was not started.
