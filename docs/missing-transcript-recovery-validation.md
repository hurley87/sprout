# Missing-transcript recovery after a captured discussion

Scope: one local improvement on parent `98509e803375855efd520ca2cf93cedca06c9555`. The two-example culture question and yep-prefixed navigation commits remain intact.

## Cause and boundary

The human export `sprout-catching-unicorns-8e0a754a-785b-4b2f-9ecb-f0587f47d450.json` shows captured answers for the four original culture characteristics, the tutor asking whether anything remained, learner “Nope”, and tutor “Okay, thanks.” At 611948 ms, the runtime rechecked the interrupted exchange at visit 6, turn 108, revision 1019. At 612190 ms, the classifier returned `tutorState: unknown`. At 616192 ms, missing-transcript recovery appended “no answer transcript is available” and instructed the tutor to invite repetition after confirming presence. The subsequent “Yep, next question” and “I've already answered” received repetition demands.

This is conversational closure in the transcript, not established runtime completion. A microphone-only turn revokes current answer/acknowledgment authority while preserving accumulated concept evidence and visit-local transcript. A quiet, exact-source recheck may establish closure using a fresh observer proposal; a held recheck falls back to recovery. The fallback incorrectly equated missing current-turn text with absence of an answer and supplied a persistent repeat-answer instruction. Context acknowledgment only confirms instruction delivery; it is not learner evidence or tutor closure.

## Result

Conversation-first recovery now receives the current visit transcript, identifies substantive captured learner contributions, and describes only the latest turn as missing. The presence check preserves existing answers, forbids demanding repetition of demonstrated material, respects an already closed discussion and “I've already answered”, and explicitly yields to navigation and new learner words. An unanswered question still permits asking for its missing answer. Neither presence, refusal nor tutor thanks grants mastery or advances the runtime.

Recovery observation and the transport boundary suppress prompts when closure/navigation is already authorized. The boundary also verifies runtime, visit, node, turn and revision, live/active status, absence of steering or learner activity, and quiet output. Existing candidate, stale transcript, interruption and output-drain behavior remains in place. Classification and completion policy are unchanged.

## Verification

- Full unit suite: 58 files, 1181 tests passed. Six new controlled runtime cases cover captured discussion with unknown closure, successful closure recheck, same-turn delayed transcript immediately before/after dispatch, navigation during recovery wait with active audio, and genuinely missing answers. Instruction assertions cover captured evidence, already-answered responses, bounded text and supersession.
- Clean candidate copy: unchanged lint configuration passed; `next typegen` plus TypeScript passed; production build passed. The first build attempt with symlinked dependencies failed because Turbopack rejects paths outside its root; a filesystem clone of installed dependencies resolved it.
- Original root lint: 759 errors and 10594 warnings; all error files (54) are existing ignored generated copies under `test-results`. These counts match the prior validation record. No source errors were reported. Artifacts and lint rules were preserved.
- Changed TypeScript files pass Prettier and whitespace checks.

The credential-free candidate copy is `/tmp/sprout-recovery-validation.umdIa6`. Logs are `/tmp/sprout-recovery-{unit,lint-clean,typecheck,build}.log` and `/tmp/sprout-recovery-lint.json`. No credential files were inspected or copied.

These are controlled transcript/observer/transport checks, not live voice acceptance. The export establishes the original provider failure, but the changed instruction has not been exercised with a live provider or human microphone. A human walkthrough must verify that a completed discussion followed by missing ASR gets at most a presence check, that “I've already answered” receives no repetition demand, and that “Yep, next question” advances after audio drain. Also verify an actually unheard answer can still be recovered. Unknown observer closure can still hold the runtime until fresh closure or explicit navigation; this change does not reinterpret arbitrary thanks/refusal as completion.
