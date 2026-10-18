# Commit 3: completed exchanges and answer recovery

Starting commit: `b910781` on `codex/issue-71-catching-unicorns-demo` (PR #72).

## Evidence and root cause

The October 17 export `sprout-catching-unicorns-af06ed93-d150-4dc5-935e-f2db02934db6.json`
was not available in the repository or supplied attachments. The new fixture
`tests/fixtures/catching-unicorns-recovery-oct17.json` records the incident ordering
reported in the implementation request. The close and "Great." are reported
quotes; the learner explanation, all test timing, provider event envelopes, and
classifier responses are synthetic. This is a faithful ordering regression, not
an exact diagnostic replay. The October 16 exact replay remains covered by
`tests/catching-unicorns-closure.test.ts`.

The reported recovery was armed by a confirmed `microphone.speech_stopped` with
no matching current-turn learner transcript. The runtime calls `AnswerRecovery.arm`
there; after four seconds of quiet it tries `conversation.recheck.requested` before
sending the connection-check instruction. The incident says Jev recognized the
close, but the available evidence does not establish the original classifier's
exact request/response timing or whether its proposal was accepted by the reducer.
It also does not establish what caused the microphone event or whether meaningful
new speech occurred. Missing text is missing evidence, not evidence of confusion.

The verified current-branch gap was the latest-speaker restriction on rechecks:
with "Great." last, `transcriptSource` is `child`, so recheck was rejected and
recovery immediately dispatched the connection check. In addition, a confirmed
microphone turn suspends `conversationAdvanceRequested` but retains `tutorClosure`;
the retained close was not reused by recovery. Tests reproduced both failures
before production edits, including an already accepted close followed by a
microphone-only turn and a simulated unavailable classifier.

## Interaction with Commits 1 and 2

Commit 1 already resolves the ordinary close → "Great." → accepted classification
sequence. Commit 2 already resolves "Let's move on. I've answered the question.",
including subsequent microphone-only segmentation. Neither path prompts recovery
in the new runtime tests. Discarded energy already preserves closure authority.

Thus those commits prevent the reported stall when they can finish before the
later confirmed microphone event. They do not cover all required event orderings:
a confirmed microphone-only turn can still supersede classification or suspend
accepted closure before the scene commits. That is why a production change is
necessary for this commit's acceptance criterion.

## Small production change

At the existing missing-transcript recovery boundary, include the exact current
transcript in the source-validated recheck event. Permit a recheck after a complete
brief acknowledgment using Commit 1's existing exchange matcher. Without an
accepted close, this only permits classification; it grants no progression or
mastery evidence.

If that unchanged exchange already has classifier-accepted `tutorClosure`, restore
its suspended progression authority without requiring a second successful
classification. Require matching tutor message position/text and a complete
acknowledgment suffix. Substantive learner words, revised answers, and new tutor
output continue to invalidate the cached close. Discarded candidates retain it.

Cancel pending answer recovery when current conversational completion authority
exists, and exclude resolved conversations from semantic recovery arming. The
recheck callback consumes recovery when dispatch restores authority or commits the
next visit, preventing a prompt from falling through after the transition.

No changes to `AnswerRecovery`'s state machine or prompt instructions were needed.
No new timer, mastery requirement, confidence threshold, navigation matcher,
lesson graph, terminal recap rule, microphone bypass, or drain bypass was added.

## Lifecycle before and after

| Situation | Before Commit 3 | After Commit 3 |
| --- | --- | --- |
| Close → Great → classification, uninterrupted | Accepted close → safe progression (Commit 1) | Same |
| Explicit learner navigation | Navigation debounce → safe progression (Commit 2) | Same |
| Accepted close → discarded candidate | Suspend while speaking → preserve close on discard | Same |
| Accepted close → confirmed microphone-only turn | Suspend authority → missing recovery → rejected child-last recheck → connection prompt | Suspend authority → existing quiet recovery window → validate retained close → restore authority → safe progression; no prompt |
| Close → Great → microphone-only turn before acceptance | Missing recovery → rejected recheck → connection prompt | Missing recovery → exact-source closure classification → cancel recovery on acceptance → safe progression |
| Recheck fails, times out, or does not close | Bounded fallback recovery | Same: existing classifier timeout (10 seconds) then four-second quiet fallback |
| New substantive words or tutor follow-up | Invalidate previous closure | Same; legitimate recovery remains possible |

The existing microphone-only recheck never attributes old learner words as fresh
concept evidence. Source identity remains runtime/visit/node/turn/revision-bound.
The existing classification cancellation, input safety, and tutor audio drain
continue to control eligibility and scene commitment. A slow recheck sends no
recovery while its decision is pending; failure/timeout permits the existing
fallback rather than waiting indefinitely.

## Validation

`tests/completed-exchange-recovery.test.ts` runs the real `LessonRuntime`,
`AnswerRecovery`, reducer, tutor stabilization, clocks and recovery scheduling;
only transport and classifier HTTP responses are mocked. Its 16 cases cover all
12 requested regression categories, including cached closes with/without Great,
a failed second classifier, stale classification, timeout, substantive revisions,
new follow-ups, connection checks, exactly one scene transition, and speech/audio
safety. Controlled proposals use no concept evidence and an unclear answer outcome,
so progression cannot depend on concept mastery.

- Focused new runtime suite: 16/16 passed.
- Runtime/recovery/navigation/closure/scheduling integration group: 243/243 passed
  before the last two added runtime variants; those variants pass in the new suite.
- Targeted ESLint and `git diff --check`: passed.
- Full test run: 1,328 tests passed, 48 skipped; two suites failed at setup
  and one test failed. These three existing benchmark failures reproduce unchanged
  at `b910781`: frozen lesson compatibility hashes in
  `decisions-calibration` and `provider-comparison`, and the frozen question hash in
  `classifier-benchmark`. Their inputs were not changed by this commit.
- Workspace `npm run typecheck` encounters existing stale UI copies under ignored
  `test-results/commit3-review/app` and `test-results/ui-review/app`. Typecheck passes
  both on a clean starting-commit source snapshot and on that snapshot with this
  commit's source/tests applied, using the same installed dependencies.

## Live-provider follow-up

No live GPT-Live/Jev session was run. Verify actual VAD segmentation, delayed
transcripts around the four-second recovery window, classifier timeout/abort
behavior, and uninterrupted playback/drain in a provider session. Synthetic tests
establish lifecycle correctness, not whether the recorded microphone event was
meaningful speech or provider recognition accuracy. A transcript arriving after a
scene commits remains subject to the existing source/render boundary rules.

This commit stops at Commit 3; Commit 4 is out of scope.
