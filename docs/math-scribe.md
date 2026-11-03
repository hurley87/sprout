# Math scribe

`/demos/math-steps` is a voice-first scribe: the learner directs, Sprout renders, and the independent [#90 math checker](math-step-checker.md) checks a transition only on request. The interpretation model parses speech into typed interpretations supported by verbatim learner quotes; it does not apply operations or solve. The application applies only its fixed operations. Sprout cannot see paper: it checks **what you tell it**, not what you wrote. There is no handwriting recognition, OCR, upload, or typed math editor in this flow.

## Pipeline and trust boundaries

Speech fragments are grouped by speaker and learner turn. Once output is quiet, a debounce sends unconsumed substantive learner speech to `POST /api/math-scribe`; interruption cancels in-flight work. The input contains working and base LaTeX, pending status, learner turns and tutor turns. The server validates bounds and LaTeX, derives addressable parts (IDs, descriptions, aliases and LaTeX) from the working line, and requests the strict `SCRIBE_SCHEMA` from the Responses provider. At most three interpretations are admitted. The validator drops invalid shapes, expressions, unknown parts and unquoted/non-learner evidence; malformed envelopes and provider failures are separate statuses. Tutor speech is context, never evidence.

The session reducer records proposals as pending versions with operation, origin, quote, parent and timestamp. Corrections preserve earlier versions. Confirm records recognition; undo moves to a parent or withdraws a checked history line. An explicit spoken or UI check invokes the checker; a check also sets the pending version's `confirmed` flag, even without a separate confirmation. Equivalent transitions enter history; invalid ones remain pending; unsupported/ambiguous checks may be continued explicitly as unverified. A revision guard rejects stale interpretations; after a UI change the runtime re-reads unconsumed speech. In one response, once a line changes, subsequent operations referencing an old part ID are dropped and a clarification is requested.

These are distinct states: an **interpreted proposal** is provisional; a **student-confirmed step** records the intended on-screen expression, not mathematical correctness; a **math-verified transition** passed the checker relative to the preceding line (subject to its domain/coverage limits); **unseen paper** is never verified. A recognition correction changes what the learner meant; underspecification asks for missing scope or a result; only a faithfully understood but invalid transition warrants mathematical feedback. The implementation treats a check request as confirmation, so an unnoticed misrecognition can still reach the checker: this is a live-evaluation risk, not a guarantee of perfect separation.

The runtime frames messages as application instructions to the tutor, asking it to add no mathematics. Exact instruction texts include:

- Spoken expression: “It's on the screen. Is that what you meant?”; mechanical operation: “Okay, it's on the screen — say check when you're ready.”
- Confirm: “Okay, I've recorded that as what you meant.” Undo: “Okay, I've undone that.” Continue: “Okay, we'll continue without verifying that step.”
- Equivalent: “That step follows. What would you like to do next?” Unsupported: “I couldn't check that expression. You can rephrase it or continue.”
- Invalid: “I checked the expression you told me (not your paper) and it doesn't follow from the previous line.” This is followed by “Please look at [area] again.” or “Please look at it again.”
- Strategy alone: “What would you like to change?” Provider retry exhaustion: “I might have misheard. Please say that again.” A stale part asks: “I might have misheard. Which part did you mean?” Clarifications relay their question.

## Operations

| Operation | Effect | Origin |
| --- | --- | --- |
| `replace-line` | Replace the complete line with the dictated expression. | spoken-expression |
| `replace-part` | Replace the addressed expression or integer exponent. | spoken-expression |
| `division-to-reciprocal` | Multiply by the reciprocal of the selected division's denominator. | scribed-operation |
| `negative-power-to-denominator` | Move a selected negative power into a denominator. | scribed-operation |
| `denominator-to-negative-power` | Rewrite a selected denominator as a negative power. | scribed-operation |
| `set-sign` | Set the sign of a selected term. | scribed-operation |
| `non-unique` | Ask for the result of factor, expand, simplify, cancel, combine or other work; no rewrite. | no proposal |

Never repair a learner's mathematics or choose their strategy. A mere goal is logged as strategy; a non-unique action needs the learner's result. Even a uniquely determined rewrite is a provisional scribed operation, not independent evidence of handwriting.

## Optional speech conventions

Learners need not memorize a grammar. Helpful optional conventions include “open bracket … close bracket,” “all over,” “to the power of,” “squared”/“cubed,” “times,” and “negative two.” Corrections such as “no, I meant …” can revise a proposal. If exponent attachment or fraction scope is ambiguous, request clarification and, when available, present candidate readings—for example `(x^2+2x)^{-2}` versus `x^2+(2x)^{-2}`—rather than guessing.

## Debug export and metrics

With `?debug=1`, **Session details** displays the active visit's metrics and arrays `speechEndToProposalMs` and `checkRequestToInstructionMs`, and offers **Export session**. The downloaded scrubbed runtime report contains the transcript and journal plus `scribe.visits`: problem and visit IDs, request records (learner turns, revision, status, timing and available provider diagnostics/raw output and drops), session log (including proposal versions, quotes, corrections, check results and confirmation events), metrics and both timing arrays. These records may contain sensitive spoken content; handle exports accordingly. Metrics count proposals, recognition corrections, clarifications, check verdicts, undos and stale drops; `stepTimes` measures first proposal to check, not total narration time. The timing arrays measure speech-end to proposal and check processing/request-start to instruction respectively; they are not end-to-end user-perceived completion measures. Confirmation flags include implicit confirmation by checking.

## Limits and deferred work

V1 handles the two authored problems and the bounded algebra AST and operations supported by the checker, not arbitrary mathematics. A deterministic rewrite may be wrong as mathematics or differ from paper; unsupported and domain-sensitive checks are not proof of a complete solution. Recognition and tutor behavior remain probabilistic, and fixtures do not establish real-microphone accuracy. The current terminal recap is “Thanks for practicing.” Non-leading hints and richer feedback, a recap of checked/corrected transitions, and the voice-interface go/no-go belong to [#92](https://github.com/hurley87/sprout/issues/92), alongside instructor and learner evaluation. No fallback modality is scoped here.

## Fixture benchmark

With `OPENAI_API_KEY` in the environment, run `node scripts/issue-91-scribe-benchmark.mjs --repeats 3` (default 3; 1–100). This makes paid provider calls, without loading environment files, and writes a JSON report to gitignored `test-results/issue-91/`. It runs every fixture against the real provider and production validation. Rates use runs as denominator, except faithful-expression and clarification rates use only cases with expected expressions and clarifications. Exact match compares the entire ordered output, including wording and quote; intent match compares ordered intents; expression fidelity compares structural ASTs, not algebraic equivalence. False commits count runs with a propose/correct when the expected result is clarify or empty. Drops count rejected interpretations; failures count against applicable match rates. Latencies are nearest-rank p50/p95. Synthetic fixtures and provider outputs are not live microphone findings.

## Live evaluation protocol

**PENDING real sessions.** Obtain consent and use a screen and microphone; paper is optional and unseen. For both the reciprocal problem `\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}` and `(2+3x^2)^3(x^2+2x)^{-2}`, compare: (A) full-line dictation, optionally using brackets; (B) describe only the change from the displayed line. Counterbalance order where possible. In appropriate steps deliberately dictate the missing-x numerator `12+30y`, inspect and check it, then correct to `12x+30y`; also try an ambiguous exponent, undo, and an early Stop in a separate attempt. Do not describe a successful check as a check of paper. Capture errors and corrections as actually experienced, not as assumed from fixtures.

Export after each session. Record participant/role and consent separately, problem and flow, completed/abandoned and reason, speech turns per step, clarification rate, first-pass incorrect parses, recognition corrections, false confirmations (including check-implied confirmations), time per step and subjective usability/frustration. Derive turns and clarification rates from transcript, request and log timestamps; annotate incorrect parses and false confirmations against participant intent, and collect subjective ratings/interviews separately: these are not automatically computed by the export. Note how often full dictation or repetitions were necessary. Include at least one instructor and one real learner for #92; preserve anonymized evidence appropriately.

| Session | Role | Problem | Flow | Completed / stopped | Turns per step | Clarifications / turns | Incorrect parses / false confirmations | Corrections | Time per step | Usability / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PENDING | | | | | | | | | | |

### Findings

**PENDING.** Where does speech become too cumbersome to recommend? Does this feel like directing a scribe or programming an editor? Compare both flows and problems, identify recognition and confirmation failure modes, and report task completion, timing, repetition, frustration and instructor/learner feedback. The #92 go/no-go remains pending until evidence exists.

## Issue #91 acceptance mapping

Tests below are deterministic or mocked; they do not establish live-provider or microphone performance. Test names following `accepts fixture:` are parameterized in `tests/math-scribe-interpretation.test.ts`.

| Acceptance checkbox | Evidence / status |
| --- | --- |
| Negative-power rewrite without full fraction | `tests/math-scribe-runtime.test.ts` — “verifies the negative exponent rewrite”; fixture “negative exponent rewrite”. |
| Conversational subexpression or focused question | `tests/math-scribe-interpretation.test.ts` — fixtures “second factor”, “ambiguous denominator”. |
| Preserve erroneous speech without premature verification | `tests/math-scribe-runtime.test.ts` — “preserves the missing x, localizes the failed check, and verifies a correction”. |
| Measure turns, clarification, transcription and time on microphones | **PENDING live session.** |
| Quoted learner proposals, no silent repairs | `tests/math-scribe-interpretation.test.ts` — “drops invalid or non-learner evidence and rejects malformed envelopes”; fixture “faithful wrong numerator”. |
| Record wrong numerator and correction | `tests/math-scribe-runtime.test.ts` — “preserves the missing x, localizes the failed check, and verifies a correction”. |
| Check only on request or line completion | `tests/math-scribe-runtime.test.ts` — “checks a spoken request only once”; `tests/math-scribe-interpretation.test.ts` — fixtures “check step”, “done line”. |
| Distinguish instruction/report and unseen paper | `tests/math-scribe-interpretation.test.ts` — fixtures “flip second fraction”, “faithful wrong numerator”; `tests/math-scribe-runtime.test.ts` — “never exposes discrepancy expressions in instructions”. |
| Ambiguous speech and partial fractions clarify | `tests/math-scribe-interpretation.test.ts` — fixtures “ambiguous exponent”, “half fraction”. |
| Undo/revisions resist stale responses | `tests/math-scribe-session.test.ts` — “drops stale responses and supports branching undo and withdrawn checks”; `tests/math-scribe-runtime.test.ts` — “re-reads speech whose response went stale after a UI undo”. |
| Pauses, interruptions, tutor speech, repetition, early Stop | `tests/math-scribe-runtime.test.ts` — “combines pauses, excludes tutor speech, and does not resend applied turns”, “aborts interrupted requests and resends both learner turns”, “ignores filler and retries once before asking again”, “ignores late responses after stop or a revision-changing undo”. |
| Export retains proposals, quotes, revisions, corrections and confirmation | `tests/math-scribe-session.test.ts` — “clarifies, logs strategy, and distinguishes recognition corrections”; `tests/math-scribe-lesson-runtime.test.ts` — “routes speech, actions, navigation and cancellation through the scribe”. Export completeness requires **PENDING live session** inspection. |
| Complex product correctly interpreted or flagged ambiguous | `tests/math-scribe-interpretation.test.ts` — fixtures “full bracket dictation”, “ambiguous exponent”; real recognition **PENDING live session**. |
| Describe change without repeating expression | `tests/math-scribe-interpretation.test.ts` — fixture “negative exponent rewrite”; actual usability **PENDING live session**. |
| Misrecognition separated from math error | `tests/math-scribe-session.test.ts` — “clarifies, logs strategy, and distinguishes recognition corrections”; checking implicitly confirms, so the stronger no-direct-feed guarantee is **not established; PENDING live session**. |
| Findings state where voice is too cumbersome | **PENDING live session.** |
