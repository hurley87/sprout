# Calculus demo validation and local acceptance runbook

Status, October 23, 2026: implementation and automated regression checks are
complete through source commit `fa18bb45343e79aa1714baec8b10328d2b33ba2f`
(commit 10). Documentation is prepared; **live acceptance remains PENDING**.
This is not issue #80 completion. See [findings and provenance](issue-80-findings.md),
the [durable plan](issue-80-implementation-plan.md), and the
[commit 10 evidence record](issue-80-commit10-evidence.md).

## Start locally

```sh
npm ci
npm run dev
```

Configure server-only `OPENAI_API_KEY` and `TYPESAFE_API_KEY` locally, normally in
`.env.local`, then restart the server. The calculus voice session and
`/api/math-action` use `OPENAI_API_KEY`; the counting/MAE386 Jev path uses
`TYPESAFE_API_KEY`. Never use `NEXT_PUBLIC_*` for either credential. Refresh
invalid credentials on this computer through the provider's account tools; never
paste secrets into chat, evidence, commands, or exports.

Open [the calculus demo](http://127.0.0.1:3000/demos/calculus), allow microphone
access, and press **Start practice**. Actual voice/interpretation sessions make
provider calls and may incur costs. Use
[the debug route](http://127.0.0.1:3000/demos/calculus?debug=1) for evidence.
Only the exact single `?debug=1` value enables details; `?debug=true` and repeated
values do not. These are local routes; no database or deployment is needed.

The last production-adapter text replay attempted 17 cases and returned
non-mutating provider failures; a diagnostic request confirmed HTTP 401
`token_invalidated`. Do not repeatedly retry that key. After a local credential
refresh, the explicit text-only replay command is:

```sh
SPROUT_MATH_REPLAY=1 npx vitest run tests/calculus-math-interpreter.test.ts
```

It loads `.env.local` if `OPENAI_API_KEY` is absent and makes up to 17 serial
synthetic-text calls without retries. Record all failures as well as outputs.
This replay validates neither microphone recognition nor tutor speech. The
separate [live browser suite](browser-tests.md) covers other lesson scenarios;
it is not the calculus human acceptance matrix below. No network replay or live
session was run for this documentation commit.

## Learner walkthrough

1. Work through `x^3 - 4x`, `x^2 sin(x)`, and `(3x^2 + 1)^5`, one current prompt
   at a time. Dictate complete expressions, signs, powers, grouping, and every
   product term. “Use the product rule” records a strategy; it does not supply a
   derivative. For example, dictate “my derivative is two x times sine x plus
   x squared times cosine x” rather than asking the tutor to fill it in.
2. Inspect **Proposed actions — awaiting your confirmation**. Review the entire
   ordered batch, expressions, target steps, and exact quoted learner sources.
   Provisional work is not committed work. If the proposal mishears sine/sign,
   a power, or another term, correct your words instead of accepting it.
3. For one displayed action say exactly **confirm differentiation**, **confirm
   rewrite**, or **confirm without checking**. For mixed batches say, in order,
   `action 1 confirm rewrite; action 2 confirm differentiation`. The closed grammar
   allows at most eight actions, 600 characters and an eight-second reserved
   confirmation turn. Generic “yes”, tutor confirmation, reported/negated commands,
   and a command followed by correction words cannot accept. Speech must finish
   before mutation. If recognition cannot produce the bounded command, select an
   operation for every action and click **Confirm displayed actions**. Its default
   is **Without checking the operation**; choose Differentiation or Rewrite when
   that is your intent.
4. Confirmation verifies intended notation and operation only. The app separately
   checks supported mathematics; reasoning and independent understanding remain
   conservative/unassessed. A complete wrong expression can be retained visibly
   as an incorrect attempt. Unsupported or unassessed work is unresolved, not an
   official mark. Correct mathematics, a named rule, silence, praise, or a learner
   confirmation alone cannot establish mastery.
5. Say a complete correction such as “replace that with three x squared minus
   four”, inspect its proposal, and confirm the intended operation. Say “undo the
   last edit”, inspect the target and confirm without checking. Undo reverses the
   latest effective board edit; undoing a replacement restores its predecessor.
   History retains original attempts and help provenance.
6. Use **Help**, **Repeat problem**, **Skip problem**, or say “help”, “repeat”,
   “next”, or “stop”. Skip/navigation is separate from understanding. Correct
   equations do not automatically prove completion. **Stop** retains recorded
   work in page memory; hiding/leaving the page ends capture. Export before a
   refresh/restart clears the attempt.
7. In debug view open **Session details** and **Export session**, or use
   **Download diagnostics** after Stop. The `sprout-calculus-…` JSON includes
   source text/revisions/spans, pending and rejected proposals, confirmations,
   board history, checks, help provenance and local timings. UI clicks do not
   create spoken learner turns. Secret scrubbing is tested, but review and redact
   personal transcript content locally before selecting evidence to share. The
   app does not record microphone audio or persist sessions.

## Supported mathematical boundary

The parser accepts bounded structured integers, `x`, sums/products, subtraction,
negation, division, integer powers, sine/cosine, derivative notation and equality.
Syntax alone does not establish supported checking. Parser limits are 128 nodes,
depth 16, eight operands, integer magnitude 999999 and exponent magnitude 12.

The deterministic validator checks exact integer-coefficient polynomials and
`A(x) sin(x) + B(x) cos(x) + C(x)`, including reordered sums/products,
distribution, collection, and supported expanded/factored forms. Division requires
a literal nonzero integer and integral resulting coefficients. Derivatives use a
finite table of authored originals/subexpressions, not recursive symbolic solving.
Root equality checks both sides and the selected transformation against current
work. Limits include degree 24, 64 collected terms, coefficient magnitude
`10^15`, and 4096 term products. Every subtree is checked before cancellation.

Negative powers, variable denominators/cancellation, nonintegral coefficients,
trig products/identities, composite trig arguments, nested equality/derivatives
outside the authored table, other variables/functions and budget overflows are
unsupported. Zero powers require a verified nonzero constant base. A valid
alternative outside this domain stays unresolved. Display preserves supplied
syntax and wrong signs; comparison normalization never silently repairs it.
There is no arbitrary solver, problem ingestion, official grading or reasoning
assessment. The [validator source](../lib/calculus/math-validator.ts) and
[tests](../tests/calculus-math-validator.test.ts) define the finite boundary.

## Acceptance matrix and evidence classes

**D** below means authored deterministic unit fixtures (mocked provider output,
synthetic text/clocks). **B** means the eight calculus browser cases with synthetic
microphone audio, actual local WebRTC and injected transcripts/mock interpretation;
they do not test recognition. Coverage is bounded to the named cases, not every
possible utterance. **P** means actual current-adapter provider text replay;
**H** means human microphone and instructor observation. Every P/H row remains
**PENDING**. The failed adapter replay supplies no generated proposals for any row.
Historical spike evidence is described separately in [findings](issue-80-findings.md).

| Scenario and human observation to record                                                 | D: authored coverage                        | B: local browser coverage                                                                   | P / H status      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------- |
| Three fully dictated correct solutions; compare intended and displayed notation          | Problems, validator, runtime                | All three solutions; UI and spoken confirmation/export                                      | PENDING / PENDING |
| Strategy only; no invented derivative                                                    | Action, evidence, tutor-context, runtime    | Strategy confirmation leaves board empty                                                    | PENDING / PENDING |
| Incomplete operand; ambiguous sine/sign and powers; request clarification                | Interpretation fixtures, action, runtime    | Missing operand; other ambiguity is a mocked clarification path                             | PENDING / PENDING |
| Wrong signs/derivatives, missing product term or chain factor; retain error              | Validator, state, runtime                   | Wrong derivative seven remains visibly incorrect                                            | PENDING / PENDING |
| Correction, replacement, undo and predecessor/history fidelity                           | State, evidence, runtime                    | Wrong step → replacement → undo                                                             | PENDING / PENDING |
| Equivalent expanded/factored math, unsupported alternatives, absent/misleading reasoning | Validator, evidence, runtime                | Math checking is separate from reasoning/independence review; no equivalent-form browser matrix | PENDING / PENDING |
| Hint, echo, praise and supplied-answer provenance; no independent credit                 | Evidence, tutor-context, runtime            | Help event plus conservative evidence/export                                                | PENDING / PENDING |
| Pauses, streaming fragments, duplicate transcript/result events, stale responses         | Runtime event deduplication and stale gates | Synthetic speech/quiet; delayed extraction after Stop; no live recognition claim            | PENDING / PENDING |
| Rapid next/Stop, early exit, hide/unmount, media teardown                                | Runtime navigation/cancellation             | Spoken skip/next/recap, Stop, hide/unmount track cleanup                                    | PENDING / PENDING |

Primary tests: [runtime](../tests/calculus-runtime.test.ts),
[interpretation](../tests/calculus-math-interpreter.test.ts),
[evidence](../tests/calculus-math-evidence.test.ts),
[diagnostics](../tests/calculus-diagnostics.test.ts), and
[browser](../tests/browser/calculus.spec.ts). Authored assertions passing does not
mean zero live false commits or compliant spoken tutor behavior.

## Human session and evidence form

After credentials work, record the exact source SHA (`git rev-parse HEAD`), date,
browser/version, microphone/device, viewport, anonymized participant roles and
scenario IDs. Agree any numeric latency acceptance target before judging timing;
**none is currently agreed**. Start a fresh debug attempt, perform each matrix
scenario, inspect every full proposal before confirming, and export after Stop.
Use an instructor-authored intended expression/operation as ground truth; a parser
acceptance or a correct final answer is not sufficient. Exercise natural pauses,
interruption and rapid controls, then confirm capture has ended. Record tutor
answer leaks or overclaiming separately even when the board is safe.

Copy this form per case into a locally reviewed evidence note; replace PENDING
only with an observed result and artifact locator. Select sanitized artifacts for
`docs/evidence/` only after review; do not commit a full sensitive session dump.

```text
Case ID / matrix row:
Status: PENDING (then pass / fail / unverified, with reason)
SHA / local date / browser / microphone / viewport:
Evidence class: manual-session-review
Learner / instructor role labels (no identifying details):
Intended words, exact expression, target, operation and ground truth:
Observed transcript / proposal / display / confirmation method:
Export file + request ID / turn IDs / spans / board revisions / display token:
Interpretation faithful: null
False commit (committed action differs from intended action): null
Correction count (later learner repair actions for this case): null
Interpretation failure / unsupported disposition and reason:
Local timing fields and missing-data reason:
Tutor spoken behavior / assistance / leaks (human observation):
Stop / hide / exit and capture teardown observation:
Reviewer / result / bounded follow-up:
```

Keep manual annotations beside the export with `caseId`, `groundTruth`,
`evidence: manual-session-review`, `interpretationFaithful`, `falseCommit`, and
`correctionCount`. Manual review is separate from the live export, which contains
no evaluation fields. Report the evaluated population/denominator,
faithful count, false commits, correction counts/frequency and interpretation
failures only after all cases in that population have explicit labels; retain
unknown values as `null` and report exclusions. Never turn pending into zero.

Bill's qualitative review needs a separate dated note with SHA and session/case
references: readability, dictation burden, confirmation friction, correction and
undo usability, pacing, assistance/answer leaks, and usefulness to learner and
instructor. Record his own critique and unresolved concerns independently of
automated counts. Bill has not participated in this acceptance record.

## Timing interpretation

The journal uses `browser.performance.now-relative-to-attempt`. For each action,
the source anchor is the latest local speech end across all cited learner turns;
tutor events and provider media intervals cannot replace that anchor.
`speechEndToProposalDisplayMs` measures the provisional display;
`confirmationDelayMs` measures proposal display to authoritative commit;
`commitToBoardDisplayMs` and `speechEndToCommittedDisplayMs` describe committed
work. Do not combine learner confirmation wait with interpretation latency.
Transcript availability, interpretation start/end and feedback append are distinct.

Two `requestAnimationFrame` callbacks give a DOM paint-opportunity approximation,
not proof of physical paint. Missing/uncorrelated times remain `null`.
For actual human timing distributions retain count, missing count,
median/p95/range and clock definition separately for provisional and committed
work. **Live sample count, distributions, false-commit rate and correction rate
are PENDING/null**, not measured zero. Synthetic/browser timings and the old
HTTP spike timings cannot substitute for live speech-to-display statistics.
