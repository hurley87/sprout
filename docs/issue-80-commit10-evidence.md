# Issue 80, commit 10: diagnostics and regression evidence

Base: `991ea21397d13c77cf9ba2640f3206e875b44cf4` on `codex/80-feasibility`.
This note accompanies one scoped implementation commit; no push or commit 11.

## Diagnostic contract

The existing runtime journal is the sole diagnostic history. Controller observations
retain extraction inputs/revisions, exact authenticated turns/spans, raw rejected
proposals, validated structured math, dispositions, display tokens, confirmations,
checks and before/after immutable board history. Invalid raw proposals never enter
the derived action/timing projection. Tutor context/help provenance and math checks
remain separate from unassessed reasoning and independent understanding.

Both UI and spoken acceptance have a journal time, proposal identity, operations
and the proposal display token in the diagnostic projection. Spoken acceptance
also links the exact command/fragments/reservation and local speech-end observation.
UI clicks create no spoken learner turn or independence credit. Request-level
`interpretationDisposition` describes extraction; `disposition` also distinguishes
committed or subsequently revoked proposals. Rejected confirmations remain visible.

All durations use the runtime's browser performance-relative clock. For each action,
the speech anchor is the **latest local speech end among all its cited learner
turns**. Tutor events cannot supply that anchor; confirmation speech end remains
separate. Transcript availability considers learner observations only. Provider
media intervals are retained as source metadata but never subtracted from local
timestamps.

The export separately records interpretation start/end, proposal first displayed,
authoritative commit, committed board first displayed and tutor feedback append.
Speech-end-to-proposal display, proposal-display-to-commit (confirmation delay),
commit-to-board display and speech-end-to-committed display are distinct intervals.
Feedback append requires the exact board display token and visit; later proposal
feedback cannot substitute. The two-requestAnimationFrame DOM callback indicates
a paint opportunity approximation, **not proof of physical paint**. Missing or
uncorrelated measurements remain null. Decoded audio activity is exported as
observed events; no per-feedback audio completion correlation or provider
conversation-completed signal exists, so those completion fields remain null.

`MathEvaluationAnnotation` defines case ID, explicit ground truth, synthetic/manual
evidence label, interpretation faithfulness, false commit and correction count.
The tests include labelled synthetic wrong-sign ground truth that disagrees with
parser acceptance. Live exports have no manual evaluation by default. Unreviewed
counts/rates remain null; neither a correct answer nor confirmation proves faithful
rendering. No diagnostics add scheduling, response or mathematical acceptance gates.

## Verification provenance

A clean `git archive HEAD` copy was overlaid with the eight changed/new code and
test files, then given its own dependencies using `npm ci` (no dependency symlink).
The untracked implementation plan and ignored historical artifacts were preserved
in the original checkout and excluded from the clean archive. No config exclusions
were changed. The source manifest SHA-256 (sorted `sha256  path` lines) was
`9b33c2f64b634765e056f0c84ab8d66e9867c5cb1fb1d9eab2df868d33f7c4cb`.
The staged binary patch for those eight files, before this note, was SHA-256
`e94da514c0110ae83d8d2ab976482aa4e2223f3e1bc4d0b35bcc948b3943a61a`.

Clean copy:
`/var/folders/vw/w8m6dv9x2_55cy400ky7_1fr0000gn/T/sprout-commit10-gate-8a11hoxq`.
Logs are local `/tmp/sprout-commit10-{unit,unit-with-history,browser,lint,types,build}.log`.

- Focused: `npx vitest run tests/calculus-*.test.ts tests/math-action-route.test.ts`
  — 280 passed, one live-provider replay skipped; final timing-only hardening then
  passed `npx vitest run tests/calculus-diagnostics.test.ts tests/calculus-runtime.test.ts`
  — 77 passed.
- Focused browser: `npx playwright test tests/browser/calculus.spec.ts --workers=1`
  — eight passed, before final correlation/timing hardening; final-source coverage
  is included in the full browser gate below.
- `npm ci` — passed in the clean copy.
- First clean-copy `npm test` — failed because historical benchmark tests require
  Git objects (`git show`); 101 files passed, three files failed. This was a
  verification setup failure, not a source regression. The justified rerun used:
  `GIT_DIR=/Users/davidhurley/Desktop/sprout/.git GIT_WORK_TREE=/var/folders/vw/w8m6dv9x2_55cy400ky7_1fr0000gn/T/sprout-commit10-gate-8a11hoxq npm test`
  — **2,240 passed, one live-provider replay skipped, 104 files**. Git was read only;
  all test source and installed dependencies came from the clean copy.
- `npm run test:browser -- --workers=1` — **43 passed**, including eight calculus tests, 4.9 minutes.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed (Next 16.3.5 / Turbopack, all 11 pages generated).
- `git diff --check` and `git diff --cached --check` — passed in the original checkout.

Browser evidence uses labelled deterministic interpretation responses, synthetic
microphone audio and the actual local WebRTC transport. All three successful
solutions supply their full mathematical words. The actual downloadable debug
export is checked for source fidelity/provenance, separate UI/spoken evidence,
board history/revisions, timing shape and secret-field scrubbing. No large session
dump is committed.

Real microphone recognition, spoken tutor compliance and Bill evaluation remain
pending. No provider replay/key retry was attempted: the existing credential had
returned `401 token_invalidated`. No live fidelity/false-commit rate is claimed.
