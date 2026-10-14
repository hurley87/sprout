# Completion and redundant prompting: October 7, 2026

Scope: completion wording and redundant settled-point questions. Existing uncommitted runtime, presentation, classifier, and documentation work was retained. No commit was created. Evidence provenance and partial-progress changes remain outside this slice.

## Recorded evidence

Diagnostic input: `/Users/davidhurley/Downloads/sprout-catching-unicorns-508d2143-11c3-48cc-843b-5187678a41a3.json`. Its contents were treated as data. Times below are export `atMs` relative to runtime preparation.

- Engram: the initial learner explanation is “An engram is a biological… Idea. Um, stored in your mind.” At 18.53 seconds, after verbal acceptance, mapping abstains: independent plus prompted concept probabilities total 0.89, below the existing 0.90 demonstration gate. Recovery at 22.53 seconds asks for the unresolved Engram target; the next tutor turn asks where the memory exists even though the learner already supplied its location. Later evidence is accepted and normal advancement follows. This slice does not retroactively accept the initial recorded scores.
- Why external symbols matter: at 265.97 seconds (about 4:26), the tutor transcript includes “That completes this question,” but discovery has probabilities partial 0.20, independent 0.55, prompted 0.25. Mapping holds the scene; reification and memory extension have usable demonstrated evidence. Recovery at 270.16 seconds focuses on discovery. The learner subsequently explains using written representations to arrive at a new idea or solution beyond recorded thoughts. At 303.42 seconds all three concepts have accepted evidence; completion guidance is appended at 304.42 seconds. At 308.68 seconds (about 5:09), a valid tutor confirmation maps to semantic completion and advancement follows.

## Bounded changes

- `lib/lesson-runtime/live-context.ts`: durable startup guidance reserves overall completion language for the application's accepted-evidence assessment. A sufficient-looking answer receives acknowledgment and a pause without another question. Completion must end the tutor turn without a quick follow-up. Held recovery distinguishes uncertainty from omitted content: clarify meaning or use of the learner's example instead of asking again for a supplied fact or location.
- `lib/lesson-runtime/catching-unicorns-lesson.ts`: aligns tutor guidance with application authorization and makes the existing internal-memory paraphrase rule explicit for an idea stored in the mind. Engram must not re-ask location after it has been supplied.
- `tests/fixtures/catching-unicorns-completion-consistency-replay.json`: four compact recorded transcript/score checkpoints from this export; scores are unchanged.
- `tests/catching-unicorns-completion-consistency.test.ts`: replays the premature discovery completion, accepted discovery, and valid confirmation through mapping and the reducer; tests Engram uncertainty and recovery, controlled valid Engram acceptance without another location answer, and a genuinely partial discovery hold with settled targets retained. Controlled acceptance scores are explicitly synthetic, not new provider results.

Confidence thresholds, classifier mapping, authored completion policies, reducer transitions, and media/acknowledgment gates are unchanged in this slice.

## Verification and limits

- `npm test`: 47 files, 938 tests pass, including five new regressions.
- `npm run typecheck`: passes.
- ESLint on the two changed source files and new test: passes. Source-wide ESLint excluding generated `test-results/**`: zero errors or warnings.
- `git diff --check`: passes.
- `npm run lint`: fails on generated files under `test-results/ui-review/app/.next` (410 errors and 5,833 warnings). Those pre-existing artifacts and lint configuration were left untouched.
- Installed Next.js 16.3.5 Vitest guidance was consulted. This slice changes lesson text and pure runtime regression coverage, with no Next.js component or route changes.

No live provider call or microphone/browser recording was run. Tests verify the application mapping, holds, acceptance, and emitted instruction contract; they cannot prove spoken-provider compliance or that revised Engram wording will produce sufficiently confident live scores. The application still holds uncertain evidence. Audio already spoken cannot be retracted, and instruction append timing cannot enforce a hard audio-level completion barrier.
