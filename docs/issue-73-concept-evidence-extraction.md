# Issue #73: concept evidence extraction (Commit 1)

Starting parent: `2b25d1da8f3130abcdf2e1a885e1016aebae13c1`, the merged PR #72,
on `codex/73-refactor-lesson-runtime`. The working tree was clean before editing.
The user confirmed in this implementation chat that the final PR #72 implementation
passed a live demo. No additional live-provider run was performed for this extraction.

`concept-evidence.ts` now owns source/span validation, tutor echo and intervening-help
checks, attribution, evidence preservation, prompting history, and reveal effects.
It accepts only the ledger, current node's criteria, application-owned source identity,
observations, and transcript snapshot. It returns a ledger and reveal effects and has
no dependency on the reducer. Evidence types live with these operations; the reducer
re-exports the existing public type names. The reveal event member is an equivalent
type alias. No separate shared-types module was needed.

The reducer still validates event identities and parsed proposals, determines whether
the current turn may contribute evidence, applies the returned ledger, and owns every
state transition and authored carry-forward operation. Conversation progression and
diagnostic journal extraction are deferred to Commits 2 and 3.

## File sizes

Sizes are lines and bytes from `wc -lc` (including this extraction's formatting).

| Production file | Before lines | After lines | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: |
| `lib/lesson-runtime/lesson-runtime-reducer.ts` | 1,056 | 891 | 48,001 | 37,857 |
| `lib/lesson-runtime/concept-evidence.ts` | 0 | 253 | 0 | 11,749 |

## Verification

- Baseline `npm test`: **1,472 passed in 69 files**; no benchmark failures.
- Differential replay: saved the complete parent reducer beside the extracted reducer
  under a temporary module name, then temporarily wrapped the exported reducer.
  Each invocation ran both implementations on the same state, event, and lesson,
  comparing their complete returned state and effects with Node's `isDeepStrictEqual`.
  The wrapper returned the extracted result, so successive events followed the
  extracted state sequence. The full existing suite passed **1,472 tests in 69 files**
  with no divergence. This includes recorded October 16/17 regressions and focused
  source spans, backchannels, tutor echoes, prompting, retained/carried evidence,
  stale classification, navigation, recovery, microphone/audio drain, rendering,
  counting, and recap coverage. The temporary baseline and wrapper were removed.
- Final uninstrumented `npm test`: **1,472 passed in 69 files**.
- Workspace baseline typecheck: **16 pre-existing errors** in ignored historical UI
  copies under `test-results/commit3-review/app` and `test-results/ui-review/app`.
- Workspace baseline lint: **759 errors and 10,594 warnings** in ignored review copies
  and generated outputs. These artifacts were preserved.
- `npm run typecheck` and `npm run lint` both pass in an isolated tracked-source copy
  made from `git archive HEAD`, overlaid with the two changed production files and
  linked to the existing dependencies. No environment files or ignored review outputs
  were copied. The final source was checked again after formatting.
- New module formatting and `git diff --check` pass.

No prompts, lesson definitions, classifier model/mapping/thresholds, frozen issue #42
inputs, recorded fixtures, runtime event payloads, timers, fallback paths, VAD policy,
or diagnostic schemas changed. No behavioral bug was identified or corrected.
Deterministic equivalence covers exercised inputs; it is not a new measurement of
live tutor or provider accuracy. No browser run was needed for this pure extraction.
