# Issue #73: diagnostic journal extraction (Commit 3)

Parent: `5d6758afe464bec94f8731ef89a96a7699c46c0d`, on
`codex/73-refactor-lesson-runtime`. The working tree was clean before editing.

## Existing contracts audited before extraction

- Event order is append order. There is no separate sequence field: cursor offsets
  count events in the complete attempt-local array, starting at zero.
- The complete history is retained in memory for the attempt. Only snapshot display
  is bounded, using `events.slice(-100)`. There is no eviction or compaction policy.
- Each log call samples its ISO wall timestamp first, then the attempt-relative
  performance clock. Classifier-prefixed events include `CLASSIFIER_VERSION`.
  Explicit captured source fields override current runtime fields; unspecified
  speaker attribution falls back to the current transcript source, then unknown.
- `observe(after)` rejects another runtime's cursor and non-safe-integer, negative,
  or beyond-end offsets with the existing error. It samples `nowMs`, returns the
  end cursor, current snapshot, and the events starting at the requested offset,
  with one structured clone detaching the complete observation from runtime state.
- `snapshot()` is the existing publication projection, including recent diagnostics,
  runtime/display references, optional recap text, and assessment. Publication is
  controlled by the runtime, not by every diagnostic append.
- `report()` preserves version 1, property order, clock/timing metadata, current
  runtime/status/error/transcript, the full event array, conversation visits, and
  assessment. Conversation/assessment remain optional in its public return type.
  It copies the events array but does not deep-clone its entries or runtime data.
- Stop, failure, completion, and asynchronous final assessment leave diagnostics
  readable in the same runtime object. No persistence or upload is involved.

Consumers reviewed: Catching Unicorns' diagnostic display and `safeExport()`;
counting's `app/lesson.tsx` UI; `browser-observation.ts`; observation,
scheduling, continuation, recovery, classifier, and terminal unit tests; and the
Playwright observation, injection, child-scenario, retained-evidence, and diagnostic
export paths. Catching Unicorns' `safeExport()` augments the report with lesson,
accepted evidence, reveal context, and transcript, then recursively removes keys
matching credentials/secrets/authorization/API keys/SDP/raw or provider bodies/access
tokens. Counting uses the existing report download. The opt-in browser bridge clones
reports, and runtime observation already clones its complete result. Those security,
reference, and post-session download contracts must remain unchanged.

## Extracted responsibilities

`DiagnosticJournal` owns the mutable event array, event construction and metadata
fallbacks, last-100 snapshot projection, cursor validation and cloned observation
assembly, and version-1 report assembly. Its small API is `append`, `recent`,
`observe`, and `report`. A class represents the existing mutable per-attempt history;
it introduces no framework, timers, storage, or provider operations.

`LessonRuntime` passes current state, transcript revision, explicit captured source
and speaker to append; supplies the original attempt-relative clock callback; passes
snapshot construction to observation; and explicitly provides timing, runtime,
status, error, transcript, conversation visits, and assessment to report assembly.
The journal imports neither `LessonRuntime` nor transports or UI components. Runtime
state/source dependencies are type-only imports from the reducer. Diagnostic types
and cursor types live with the journal and remain re-exported from `lesson-runtime`;
all existing public imports remain valid.

The runtime retains every logging call site and the pre-transition event-source
capture helper. It still owns provider lifecycle, steering, classifier/assessment
requests, transcript assembly, state transitions, recovery and timers, snapshot
construction/publication, Start, Stop, completion, and teardown. No decisions about
when to append or publish moved to the journal.

## File sizes

| Production file | Before lines | After lines | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: |
| `lesson-runtime.ts` | 1,096 | 1,049 | 45,970 | 44,323 |
| `diagnostic-journal.ts` | 0 | 119 | 0 | 3,721 |

## Verification

- Baseline and final uninstrumented `npm test`: **1,472 passed in 69 files** each.
- Focused observation, scheduling, continuation, closure, terminal, counting,
  classifier, and provider-comparison tests: **318 passed in 9 files**.
- Provider-free Playwright suite: **all 25 passed (1.3 minutes)**, including default
  and debug completion, post-session exports, observation, startup failure, real
  local audio/microphone paths, and all-skipped navigation.
- New-module/document formatting and `git diff --check` pass.
- Temporary differential replay instantiated the saved complete parent runtime and
  the extracted runtime independently, with the same fixed UUID, wall clock,
  performance clock, controlled timers, mock transport, and deterministic fetch
  responses. Fifteen paired scenarios compared complete diagnostic events, source
  attribution, timestamp values, snapshot publication sequences, transport commands
  and close counts, full reports, repeated report reads, and observations from the
  same cursors. Repeated cursors, end cursors, invalid offsets, and foreign runtime
  cursors were exercised. Structural equality and exact `JSON.stringify` equality
  both passed, with no timestamp/identity normalization or omitted payloads.
- Coverage comprised **1,712 final journal events, 297 read checkpoints, and 472
  snapshot publications**, including classifier mapping acceptance, abstention,
  rejected schema, stale results, HTTP failure, tutor acknowledgment, learner
  navigation, microphone activity/transcripts, audio active/quiet/unavailable,
  render confirmation, terminal completion, startup/steering/terminal timeouts,
  provider errors, active Stop, idempotent Stop, and post-session reads. Counting
  and Catching Unicorns were both exercised. The October 16 recorded closure
  provider-event sequence and October 17 recovery words were replayed unchanged.
- The temporary baseline and differential test were removed from the repository
  before final verification; no production instrumentation remains.
- Workspace baseline typecheck reproduces **16 existing errors** in ignored
  historical UI copies. Baseline lint reproduces **759 errors / 10,594 warnings**
  in ignored review/generated artifacts. Those files were preserved.
- `npm run typecheck` and `npm run lint` both pass in an isolated tracked-source
  copy from `git archive HEAD`, overlaid with the changed production files and
  linked to installed dependencies. No environment files or ignored artifacts
  were copied. Browser tests run only after those checks, with provider keys empty,
  server reuse disabled, and a temporary `--webpack` option for the external
  dependency symlink.

## Boundaries and limitations

The runtime and journal still share the reducer's state/source types and existing
assessment types through explicit data inputs. The original shallow `report()`
reference behavior, complete in-memory retention, and snapshot references are
preserved. Changing these, compacting logs, adding persistence, or changing export
schemas requires a separate proposal. No diagnostic behavior bug was identified or
silently corrected. The existing UI export scrubber and downloads are unchanged.
No paid-provider calls or accuracy claims are involved in this verification.

There are no changes to prompts, lessons, Jev models/questions/mapping/thresholds,
reducers, runtime event types, frozen issue #42 artifacts, recorded fixtures,
expected results, UI, dependencies, timer policy, retention policy, or database
integration. Commit 3 completes the requested extraction sequence; no PR was opened
and no additional refactoring was started.
