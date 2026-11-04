# Math scribe

`/demos/math-steps` is a voice-first scribe: the learner directs, Sprout renders, and the independent [#90 math checker](math-step-checker.md) checks a transition only on request. The interpretation model parses speech into typed interpretations supported by verbatim learner quotes; it does not apply operations or solve. The application applies only its fixed operations. Sprout cannot see paper: it checks **what you tell it**, not what you wrote. There is no handwriting recognition, OCR, upload, or typed math editor in this flow.

`/demos/math-steps/difference-quotient` presents “Simplify the following expression, where h ≠ 0” with `\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`. The session keeps the original expression's restrictions as its problem domain, including the given `h ≠ 0`, even after a valid cancellation removes that restriction from a displayed line.

## Pipeline and trust boundaries

Speech fragments are grouped by speaker and learner turn. Once output is quiet, a debounce sends unconsumed substantive learner speech to `POST /api/math-scribe`. Unfinished phrase endings use a bounded longer debounce to allow a learner to finish. New transcribed learner words supersede a read in flight (it is cancelled or its result discarded, then everything is re-read); speech onset without words (noise, the tutor's echo) does not. If the latest turn never gets a transcript, earlier unconsumed speech is read after a longer wait. The input contains working and base LaTeX, pending status, learner turns and tutor turns. The server validates bounds and LaTeX, derives addressable parts (IDs, descriptions, aliases and LaTeX) from the working line, and requests the strict `SCRIBE_SCHEMA` from the Responses provider. At most three interpretations are admitted. The validator drops invalid shapes, expressions, unknown parts and unquoted/non-learner evidence; malformed envelopes and provider failures are separate statuses. Tutor speech is context, never evidence.

The session reducer records proposals as pending versions with operation, origin, quote, parent and timestamp. Corrections preserve earlier versions. Confirm records recognition; undo moves to a parent or withdraws a checked history line. An explicit spoken or UI check invokes the checker; a check also sets the pending version's `confirmed` flag, even without a separate confirmation. Equivalent transitions enter history; invalid ones remain pending; unsupported/ambiguous checks may be continued explicitly as unverified. A revision guard rejects stale interpretations; after a UI change the runtime re-reads unconsumed speech. In one response, a later part reference is carried across an earlier edit when no edit touched that part or its ancestors (same path, same expression); otherwise it is dropped and a clarification is requested.

An open clarification carries its question, prior learner prompt, addressed part and non-unique operation into the next read. This is context for interpreting a short answer, not evidence: interpretation quotes must still come from the current learner turns. Resolution, undo or check clears the context.

These are distinct states: an **interpreted proposal** is provisional; a **student-confirmed step** records the intended on-screen expression, not mathematical correctness; a **math-verified transition** passed the checker relative to the preceding line (subject to its domain/coverage limits); **unseen paper** is never verified. A recognition correction changes what the learner meant; underspecification asks for missing scope or a result; only a faithfully understood but invalid transition warrants mathematical feedback. A check request confirms the displayed line, and the runtime holds any check or confirmation spoken in the same reply as a change ("flip it and check"), so a line is only checked after it has been on screen. A learner can still say "check" without noticing a misrecognition on screen: that residual risk is measured in live evaluation, not guaranteed away.

The runtime frames messages as application instructions to the tutor, asking it to add no mathematics. Exact instruction texts include:

- Proposal: “Got it — say check when you're ready.” the first time in a problem, then just “Got it.” (the line is on screen marked “Not checked yet”; asking “Is that what you meant?” after every edit wore on testers).
- Confirm: “Okay.” Undo: “Okay, I've undone that.” Continue: “Okay, we'll continue without verifying that step.”
- Finish: “I'm done” is intended to move to the next problem or recap (navigation is not yet wired through the reducer); if a line is pending, the tutor says “Say check first, then I'm done.”
- Equivalent: “That step follows. What would you like to do next?” Unsupported: “I couldn't check that expression. You can rephrase it or continue.”
- If an equivalent step changes the domain, the spoken message says the allowed values changed and points to the screen; if the domain is unverified, it says the values could not be verified and points to the screen.
- Each session retains the original expression's restrictions as its problem domain. When a lost line restriction is deterministically implied by that domain, the step is presented as preserving the problem domain, with the retained restriction available in the history; added and unverified restrictions still receive warnings. The audit trail retains the raw line-to-line comparison.
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
| `factor-out` | Factor a named factor from the selected polynomial using exact bounded division. | scribed-operation |
| `combine-fractions` | Combine exactly two selected fractions without expanding, retaining their sign. | scribed-operation |
| `scale-fraction` | Multiply both numerator and denominator by the named factor. | scribed-operation |
| `multiply-part` | Multiply only the selected part by the named factor. | scribed-operation |
| `flatten-nested-fraction` | Flatten one nested division; for `(a/b)/c`, place `c` before the factors of `b`. | scribed-operation |
| `cancel-common-factor` | Remove one literally matching factor from a numerator and denominator in the selected product or line. | scribed-operation |
| `non-unique` | Ask for the result of factor, expand, simplify, cancel, combine or other work; no rewrite. | no proposal |

Never repair a learner's mathematics or choose their strategy. A mere goal is logged as strategy; a non-unique action needs the learner's result. Even a uniquely determined rewrite is a provisional scribed operation, not independent evidence of handwriting.

Requests for a limit or derivative are recognized as `non-unique` calculus drift: the tutor redirects to simplification without proposing a line. Concept hints depend on the current expression and suggest a rule or concept, not the next expression.

## Optional speech conventions

Learners need not memorize a grammar. Helpful optional conventions include “open bracket … close bracket,” “all over,” “to the power of,” “squared”/“cubed,” “times,” and “negative two.” Corrections such as “no, I meant …” can revise a proposal. If exponent attachment or fraction scope is ambiguous, request clarification and, when available, present candidate readings—for example `(x^2+2x)^{-2}` versus `x^2+(2x)^{-2}`—rather than guessing.

For the nested fraction, “the top” addresses the outer numerator, “the outside denominator” addresses `h`, and “the second fraction on top” identifies the second inner fraction. “Bring the h down” can direct a flattening operation; ambiguous references such as “cancel the denominator” need clarification rather than a guessed target.

“Factor 2x out of the denominator of the second fraction,” “take out a 6 from the second numerator,” and “pull out y from the first numerator” name both the factor and its part. “Cancel 6x minus 5y” names a literal factor shared by numerator and denominator. If factoring cannot be done exactly with whole-number coefficients inside the brackets (taking 4 out of 12x+30y would need 15/2) or within limits, or the cancellation cannot be located, the scribe asks for the learner's result instead. If the complete result is dictated, it takes precedence over the operation. A follow-up answer uses the open question as context, but its quote must come from the current learner turn.

## Debug export and metrics

With `?debug=1`, **Session details** displays the active visit's metrics and arrays `speechEndToProposalMs` and `checkRequestToInstructionMs`, and offers **Export session**. The downloaded scrubbed runtime report contains the transcript and journal plus `scribe.visits`: problem and visit IDs, request records (learner turns, revision, status, timing and available provider diagnostics/raw output and drops), session log (including proposal versions, quotes, corrections, check results and confirmation events), metrics and both timing arrays. These records may contain sensitive spoken content; handle exports accordingly. Metrics count proposals, recognition corrections, clarifications, check verdicts, undos and stale drops; `stepTimes` measures first proposal to check, not total narration time. The timing arrays measure speech-end to proposal and check processing/request-start to instruction respectively; they are not end-to-end user-perceived completion measures. Confirmation flags include implicit confirmation by checking.

## Limits and deferred work

V1 handles the authored problems and the bounded algebra AST and operations supported by the checker, not arbitrary mathematics. A deterministic rewrite may be wrong as mathematics or differ from paper; unsupported and domain-sensitive checks are not proof of a complete solution. Recognition and tutor behavior remain probabilistic, and fixtures do not establish real-microphone accuracy. The current terminal recap is “Thanks for practicing.” Richer feedback, a recap of checked/corrected transitions, and the voice-interface go/no-go belong to [#92](https://github.com/hurley87/sprout/issues/92), alongside instructor and learner evaluation. No fallback modality is scoped here.

## Fixture benchmark

With `OPENAI_API_KEY` in the environment, run `node scripts/issue-91-scribe-benchmark.mjs --repeats 3` (default 3; 1–100). This makes paid provider calls, without loading environment files, and writes a JSON report to gitignored `test-results/issue-91/`. It runs every fixture against the real provider and production validation. Rates use runs as denominator, except faithful-expression and clarification rates use only cases with expected expressions and clarifications. Exact match compares the entire ordered output, including wording and quote; intent match compares ordered intents; expression fidelity compares structural ASTs, not algebraic equivalence. False commits count runs with a propose/correct when the expected result is clarify or empty. Drops count rejected interpretations; failures count against applicable match rates. Latencies are nearest-rank p50/p95. Synthetic fixtures and provider outputs are not live microphone findings.

## Live evaluation protocol

**Full protocol pending for #92 (a developer pilot on the reciprocal problem is recorded below).** Obtain consent and use a screen and microphone; paper is optional and unseen. For both the reciprocal problem `\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}` and `(2+3x^2)^3(x^2+2x)^{-2}`, compare: (A) full-line dictation, optionally using brackets; (B) describe only the change from the displayed line. Counterbalance order where possible. In appropriate steps deliberately dictate the missing-x numerator `12+30y`, inspect and check it, then correct to `12x+30y`; also try an ambiguous exponent, undo, and an early Stop in a separate attempt. Do not describe a successful check as a check of paper. Capture errors and corrections as actually experienced, not as assumed from fixtures.

Export after each session. Record participant/role and consent separately, problem and flow, completed/abandoned and reason, speech turns per step, clarification rate, first-pass incorrect parses, recognition corrections, false confirmations (including check-implied confirmations), time per step and subjective usability/frustration. Derive turns and clarification rates from transcript, request and log timestamps; annotate incorrect parses and false confirmations against participant intent, and collect subjective ratings/interviews separately: these are not automatically computed by the export. Note how often full dictation or repetitions were necessary. Include at least one instructor and one real learner for #92; preserve anonymized evidence appropriately.

| Session | Role | Problem | Flow | Completed / stopped | Turns per step | Clarifications / turns | Incorrect parses / false confirmations | Corrections | Time per step | Usability / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 (11-03) | developer (adult, self-test) | reciprocal | B (describe changes) | stopped before final line | ~2.5 learner turns per proposal | 4 clarify / 9 proposals | 3 second edits dropped as stale parts (fixed in `7b7cced`); 1 real algebra slip (`6x^2-5y`) caught by the check | 1 | 239 s over 7 steps | tutor talked over itself; quotes beside wrong lines |
| 2 (11-04) | developer | reciprocal | B | abandoned after 2 lost edits | — | 0 / 1 | tutor echo cancelled reads that were never retried (fixed in `a0895aa`); tutor claimed edits it had not made | 0 | — | edits silently lost |
| 3 (11-04) | developer | reciprocal | B | completed `3y/(2x)` | ~2 | 1 / 9 | 0; 11 of 25 reads superseded by mid-sentence pauses (fixed in `7a423cf`) | 0 | 135 s | "much better"; card cluttered |
| 4 (11-04) | developer | reciprocal | B | completed | ~1.5 | 0 / 7 | 1 read rejected for a misquote, 13 s silent gap (fixed in `5919beb`) | 0 | 137 s | tutor still sometimes spoke ahead of the screen |
| 5 (11-04) | developer | reciprocal (one-problem demo, audio gate, redesign) | B | completed | ~2 | 6 / 7 | 5-turn clarification loop after a stuttered "open bracket" (fixed in `8628039`) | 1 | 218 s | "Is that what you meant?" after every edit annoying (removed) |
| 6 (11-04) | developer | reciprocal | B | completed | ~1.5 | 1 / 7 | 0 | 0 | 108 s | "much better"; asked for "factor out 2x" phrasing |
| 7 (11-04) | developer | reciprocal | B with factor-out | completed, ended with "I'm done" | ~1.3 | 0 / 7 | 0; 4 factor-outs applied first time | 0 | 71 s | "feels much better" |

### Findings

**Pilot only: one adult tester (the developer), seven sessions on the reciprocal problem, flow B, 2026-11-03/04, with fixes landing between sessions.** No learner or instructor, no counterbalanced A/B, and the negative-exponent problem was not run live; the #92 go/no-go still needs that evidence.

- **Where voice became too cumbersome:** dictating whole factored expressions ("two x times open bracket six x minus five y close bracket"), especially with mid-sentence pauses and stutters ("open bracket— open bracket"). Naming the move instead ("factor 2x out of the denominator of the second fraction", "cancel the 6x minus 5y") removed this: session 7 needed no clarification and took 71 s against 135–239 s earlier.
- **Scribe vs editor:** with confirmation prompts after every edit it felt like programming an editor; with brief acknowledgements, a visible "Not checked yet" line and an explicit "check", it felt like directing a scribe.
- **Failure modes found live, all fixed and regression-tested:** dropped second edits in one breath; tutor speech overlapping or dropped; tutor echo cancelling reads that were never retried; reads firing on mid-sentence pauses; rejected reads leaving silence; clarification answers losing their context; "I'm done" not finishing.
- **Remaining risk:** GPT-Live decides when to speak. The client-side audio gate muted about three quarters of improvised false claims in a replay of four sessions, but a claim already in progress when an instruction arrives can still be heard. The screen and the checker remain the source of truth.
- **Latency:** speech end to proposal was typically 0.3–3 s; checks returned in 1.2–2.7 s. Provider read time (3–7 s) dominates when slow.

## Issue #91 acceptance mapping

Tests below are deterministic or mocked; they do not establish live-provider or microphone performance. Test names following `accepts fixture:` are parameterized in `tests/math-scribe-interpretation.test.ts`.

| Acceptance checkbox | Evidence / status |
| --- | --- |
| Negative-power rewrite without full fraction | `tests/math-scribe-runtime.test.ts` — “verifies the negative exponent rewrite”; fixture “negative exponent rewrite”. |
| Conversational subexpression or focused question | `tests/math-scribe-interpretation.test.ts` — fixtures “second factor”, “ambiguous denominator”. |
| Preserve erroneous speech without premature verification | `tests/math-scribe-runtime.test.ts` — “preserves the missing x, localizes the failed check, and verifies a correction”. |
| Measure turns, clarification, transcription and time on microphones | Pilot table above (single developer, seven sessions); learner/instructor sessions still pending for #92. |
| Quoted learner proposals, no silent repairs | `tests/math-scribe-interpretation.test.ts` — “drops invalid or non-learner evidence and rejects malformed envelopes”; fixture “faithful wrong numerator”. |
| Record wrong numerator and correction | `tests/math-scribe-runtime.test.ts` — “preserves the missing x, localizes the failed check, and verifies a correction”. |
| Check only on request or line completion | `tests/math-scribe-runtime.test.ts` — “checks a spoken request only once”; `tests/math-scribe-interpretation.test.ts` — fixtures “check step”, “done line”. |
| Distinguish instruction/report and unseen paper | `tests/math-scribe-interpretation.test.ts` — fixtures “flip second fraction”, “faithful wrong numerator”; `tests/math-scribe-runtime.test.ts` — “never exposes discrepancy expressions in instructions”. |
| Ambiguous speech and partial fractions clarify | `tests/math-scribe-interpretation.test.ts` — fixtures “ambiguous exponent”, “half fraction”. |
| Undo/revisions resist stale responses | `tests/math-scribe-session.test.ts` — “drops stale responses and supports branching undo and withdrawn checks”; `tests/math-scribe-runtime.test.ts` — “re-reads speech whose response went stale after a UI undo”. |
| Pauses, interruptions, tutor speech, repetition, early Stop | `tests/math-scribe-runtime.test.ts` — “combines pauses, excludes tutor speech, and does not resend applied turns”, “aborts interrupted requests and resends both learner turns”, “ignores filler and retries once before asking again”, “ignores late responses after stop or a revision-changing undo”. |
| Export retains proposals, quotes, revisions, corrections and confirmation | `tests/math-scribe-session.test.ts` — “clarifies, logs strategy, and distinguishes recognition corrections”; `tests/math-scribe-lesson-runtime.test.ts` — “routes speech, actions, navigation and cancellation through the scribe”. Seven live exports inspected; each retained proposals, quotes, revisions, requests, checks and tutor-audio gate events. |
| Complex product correctly interpreted or flagged ambiguous | `tests/math-scribe-interpretation.test.ts` — fixtures “full bracket dictation”, “ambiguous exponent”; live: dictated factored products were mostly transcribed correctly; a stuttered bracket (session 5) caused a clarification loop, since fixed by carrying the open question. |
| Describe change without repeating expression | `tests/math-scribe-interpretation.test.ts` — fixture “negative exponent rewrite”; live (reciprocal problem): describing changes worked; naming the factor (session 7) removed repetition. Negative-exponent live use pending. |
| Misrecognition separated from math error | `tests/math-scribe-session.test.ts` — “clarifies, logs strategy, and distinguishes recognition corrections”; `tests/math-scribe-runtime.test.ts` — “holds a check spoken in the same breath as the change it would judge” (a line is checked only after it was displayed). Live: a dictation slip (`6x^2-5y`, session 1) was caught by the check and then corrected; whether learners notice misrecognitions on screen before saying check is untested. |
| Findings state where voice is too cumbersome | Findings above (pilot): full-expression dictation; resolved by naming moves (`factor-out`, `cancel-common-factor`). |
## Issue #99 acceptance mapping

| Acceptance criterion | Evidence or remaining work |
| --- | --- |
| Dedicated route and nested notation | `tests/browser/math-steps.spec.ts` — “difference quotient shows the original nested expression” at desktop and mobile widths. |
| Voice and workspace without repeated full dictation | `tests/math-scribe-difference-quotient.test.ts` — “verifies contextual reference path and retains the given domain”; real voice use remains pending. |
| Reference path and given domain | “verifies contextual reference path and retains the given domain” checks each step and retained `h ≠ 0`. |
| Alternate valid route | “accepts flattening first by multiplying by the reciprocal” checks a distinct first step; “accepts expanded numerator and reordered factors without checkpoints” checks equivalent expansion and reordered factors. An entire alternate route to completion remains untested. |
| Failure cases | “rejects an inner sign error without leaking an expression”, “preserves a dropped term in the invalid attempted numerator”, “clarifies premature cancellation before and after combining”, “rejects a dictated premature cancellation”, “clarifies ambiguous speech”, “records recognition correction before verifying minus h”, and “recognizes calculus drift without proposing a step”. Validator rejection of guessed ambiguous parts and localized dropped-term feedback still need dedicated coverage. |
| Undo, correction, clarification, check, hint and Stop | “keeps verified state through hint, check and undo” and the correction and clarification tests above; `tests/math-scribe-runtime.test.ts` — “ignores late responses after stop or a revision-changing undo” covers generic Stop behavior, not the difference-quotient lesson. |
| Tutor does not pre-solve or claim to see paper | Sign-error and reference-path instruction assertions; exhaustive instruction coverage across all scenarios remains untested. |
| Real microphone metrics | **Pending — requires a real microphone session.** |
| Demo recording and voice suitability findings | **Pending — requires a real microphone session.** |

Pilot row template (no results recorded):

| Session | Speech-end → proposal latency | Check → feedback latency | Transcription corrections | Unnecessary clarifications | Invalid-check rate | Full-expression dictation frequency | Recording and limitations |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

# Experimental tutor audio gate

The math-scribe lesson gates playback to application-instructed responses because [GPT-Live decides when to speak](https://developers.openai.com/api/docs/guides/live-migration); the documented alternative is to [control playback at the client or media relay](https://developers.openai.com/api/docs/guides/voice-server-controls). This can mute harmless acknowledgements, and unheard speech remains in the model's own context even though the scribe interpreter excludes it. Transcript delivery timing is only a best-effort indication of what was heard. Timings (`lib/lesson-runtime/tutor-audio-gate.ts`): close after 2.2 s of quiet, close if no reply starts within 6.5 s, never stay open beyond 20 s; speech already playing when an instruction arrives does not count as its reply. A replay of four live sessions estimated these settings mute about three quarters of improvised false claims and clip about 8 s of instructed speech; an instruction arriving mid-improvisation still lets that sentence's tail through, so the gate is a mitigation, not a guarantee.
