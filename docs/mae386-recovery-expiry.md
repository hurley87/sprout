# MAE386 missing-answer check expiry

Recovery-only follow-up to the actual October 21, 2026 microphone run, based on
`457cc50cf26578e632c48cd81d494568fcd2e45f`. Help fulfillment, assessment thresholds,
rewrite selection, evidence attribution and recap semantics are unchanged.

## Reported failure and bounded change

In runtime `c7d94b28-b76b-4ed1-9493-d008cb58d2d9`, the app sent Q12's missing-text
check at 746734 ms, before the first learner transcript at 750109 ms. A full answer
was available by 811448 ms, but the tutor then delivered the earlier “I didn't
catch your answer” instruction. See the original [live evidence extract](evidence/mae386-live-2026-10-21-c7d94b28.json)
and [acceptance report](mae386-demo-validation.md#commit-8-actual-microphone-evidence-october-21-2026).

MAE386 missing-text checks now carry their app-owned event identity (runtime,
visit, turn and revision), explicitly expire on subsequent learner speech/text or
screen changes, and forbid requesting repetition of an answer already received.
Once a check has been sent, accepted confirmed speech, authenticated answer text,
a committed navigation transition or an accepted UI support control sends one
superseding instruction. It asks for no spoken reply and grants no evidence or
navigation authority. Discarded microphone energy and rejected old-source text do
not invalidate an active check. A failed superseding send is logged and spent;
partial transcript deltas cannot cause repeated sends. No new steering gate or
provider transcript floor is installed. Existing late acknowledgments are merely
logged. Provider errors retain the existing fail-and-close policy.

Stop clears the pending check and uses the existing immediate close path; it never
waits for an acknowledgment. Ordinary confirmed speech may have already sent a
superseding instruction before a later transcript reveals a spoken Stop. That
instruction never delays closing. The existing once-per-visit recovery budgets,
quiet gates and classification authority are unchanged. Counting and Catching
Unicorns do not use the new protocol.

This uses the supported instructions-append channel, not a provider cancellation
API. It cannot guarantee interruption of speech already generated or playing.
Provider compliance with conditional/superseding instructions needs fresh live
verification; deterministic transport tests establish application behavior only.

## Validation

- `npm test`: 1,832 tests passed across 83 files. Fourteen new runtime cases cover
  the reported late-answer order, resumed confirmed speech, provisional candidates,
  early answer arrival, navigation/visit isolation, late append acknowledgments,
  Stop (UI and authenticated speech), failed sends, UI support invalidation,
  retired transport sources and both unchanged lessons.
- Provider-free Playwright: all 35 browser tests passed against the production
  build on isolated port 3101, with both provider credentials explicitly empty.
  The credential-enabled acceptance dev server on port 3100 was not reused.
- `npm run lint`, `npm run typecheck`, `npm run build -- --webpack`, changed-file
  Prettier and `git diff --check` passed.
- Append calibration covers 48 messages, including full UUID/MAX_SAFE_INTEGER
  identities. New check: 139 tokens in both offline proxies; superseding message:
  116/117 tokens. Overall maximum remains 294/297. The existing 450-token regression
  ceiling, 500-token provider limit and 2,000-byte browser ceiling remain intact.
- Independent reviewer inspected the source/tests and ran focused recovery and
  calibration tests with no actionable findings. Final commit identity is reported
  in the chat review handoff.

No paid provider calls were made during implementation or automated verification.
The following human-run verification used actual providers afterward. Earlier
failure evidence remains history for the earlier code.

## Focused human microphone verification

October 21, 2026, 16:24:21–16:26:51 America/Toronto
(20:24:21.073–20:26:51.042 UTC), runtime
`8d390e19-8cb9-4278-8b0f-296c596e86f4`. Tested code commit:
`4bfc6356d3af7c8fec6f78ee24738d5ff13324b4`. The final single recovery commit is
amended only to add this report and its evidence; production source is identical
to that tested and independently reviewed commit. The user confirmed microphone
participation and supplied the downloaded export after using the prepared Q12
answer. Same route/flags and pinned provider configuration as above; no injected
transcript, synthetic audio or mocked provider output was used in this run.

Original export, unchanged:
`/Users/davidhurley/Downloads/sprout-mae386-8d390e19-8cb9-4278-8b0f-296c596e86f4.json`.
Bytes: `6702407`; SHA-256:
`747daff5e05a0f984bb1dcd7e4322f6219948b45afe25c24352ec1d5c1e78397`.

Durable [scrubbed extract](evidence/mae386-recovery-live-2026-10-21-8d390e19.json),
146,374 bytes, SHA-256:
`e6e457502d588c2772b723c139bdf4e0a913c06aefcd55fc83719fe21c447dfc`.
It preserves full visit conversations, frozen outcomes, secondary assessment,
navigation, and 50 selected diagnostics with original zero-based event indexes.
Repeated runtime/detector/transient transcript snapshots are omitted; the ending
event retains its reason. No audio, SDP, auth token or raw provider body is added.

| Expected behavior                                          | Observed evidence                                                                                                                                                                                                                                                              | Limit                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Missing-answer check is scoped to its visit/turn           | Q8 check appended at 42089.2 ms, event 642, identity ending `:answer-recovery:3:1:59`; provider acknowledged event 646.                                                                                                                                                        | Real missing-transcript recovery path exercised.                                                                                      |
| Confirmed speech expires a sent check exactly once         | Q8 speech confirmed at 46338.1 ms, event 687; superseding append at 46338.3 ms, event 688, referring to the exact original check. Provider acknowledgment at 47111.1 ms, event 694; learner “Next question” transcript follows. No superseding-send failure or provider error. | Observes application send and provider acknowledgment, not provider internal cancellation.                                            |
| Expiry does not create a repeated spoken check-in          | Q8 has one “Hey, are you still there?” before resumed speech, with no repeat or spoken acknowledgment of the expiry. Navigation proceeds to Q10.                                                                                                                               | Original check was already spoken by 44471.6 ms, before expiry. Suppression of a still-undelivered check is **not exercised**.        |
| Q12 hears the answer and avoids the earlier repeat request | Learner supplies the four-characteristic answer. Tutor acknowledges its content and moves to Q14; no “I didn't catch” or repeat-answer request appears.                                                                                                                        | Q12 had semantic-hold recovery after “Um,” not a missing-transcript check. It does not independently reproduce the original Q12 race. |
| Stop and late secondary review preserve frozen claims      | UI Stop ends at Q14, reason parent_stop, no error; final outcomes equal the ending-event snapshot.                                                                                                                                                                             | JSON does not independently measure physical capture-track release latency.                                                           |

**Conclusion: the application expiry protocol was observed live and the original
repeat-answer symptom did not recur.** This is encouraging partial live
verification, not proof that provider-queued check-ins will always be suppressed.
No additional paid retries were made to force that race. That precise timing case
remains covered deterministically and unconfirmed live.

Q12's frozen outcome is still partial: literacy, coordination and qualified
assessment are retained; innovation and education remain below the demonstration
threshold. This is the previously identified assessment/feedback issue and was not
changed by the recovery fix. Help fulfillment also remains unchanged. Stop for
human approval of this recovery-only commit before starting those fixes.
