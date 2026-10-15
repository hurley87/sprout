# Issue #42 decision: retain Jev 1.14

Retain active **Jev 1.14**. After reviewing an authorized six-snapshot diagnostic,
the user chose to keep Jev and fix the separate tutor-recovery stall. This closes
the current provider-switch investigation with a retain decision; it does not
claim the original broad empirical benchmark or its held-out success criteria
were completed. Further factored, calibrated and held-out evaluation remains
optional follow-up before reconsidering migration.

## Evidence supporting the decision

The [sanitized result summary](issue-42-six-snapshot-results.json) records six
fresh direct Decisions calls on the exact final snapshots of the October 15
session, compared with recorded Jev observations. Six requests were explicitly
authorized after the user reviewed labels and the single calibration group;
there were no retries or additional Jev calls. All Decisions responses normalized
successfully. The separately authorized local runner and its exact input/review/
result hashes are recorded in the summary. The original private export, source
transcripts, credentials and full provider responses remain outside Git.

| Raw comparison against reviewed labels | Recorded Jev 1.14 | Direct Decisions |
| --- | ---: | ---: |
| Exact concept-label agreement, including prompting | 13/19 | 10/19 |
| Supporting source-selection agreement | 19/19 | 17/19 |
| Demonstration selected where review expected none | 3 | 1 |
| Demonstration missed where review expected it | 1 | 2 |
| Wrong prompting attribution on reviewed demonstrations | 0 | 3 |

Decisions improved the reification and education labels in this sample, but
classified the three Compare demonstrations as prompted and missed the
idea-discoverers demonstration. The tradeoff did not establish a replacement
advantage. The exact per-criterion selections are retained in the summary.

These are **raw-label disagreements**, not false mastery awards. Jev's gates
blocked the three raw demonstration disagreements from becoming demonstrated
evidence in the supplied export. Decisions had no configured mapping policy and
created no proposals. Probability scales are not compared as interchangeable.

The recorded Jev median mapping time was about 188 ms; fresh Decisions median
adapter wall time was about 298 ms. Collection conditions and measurement
boundaries differ, with only six samples and one Decisions repetition. This is
not a controlled speed comparison or a tail-latency estimate. Decisions usage
was 23,353 input tokens; Jev usage/cost and actual Decisions billing are unknown.
The JSON retains the original dated base-price estimate with its qualifications,
not a verified invoice or cost comparison.

## Provenance and limits

This is a separate October 15 session, not the frozen October 14 corpus. Labels
were approved after recorded Jev outputs were inspected and before Decisions
outputs, so adjudication is not blind. Earlier definitions absent from a
current-node snapshot do not erase carried session evidence. Optional provider
objective/tutor Choices were not separately adjudicated and are unscored.

The export does not retain the returned Jev model or executing checkout SHA.
Running-app source/compiled-bundle and start-time checks support the operator's
Jev 1.14 identification; that is weaker than per-response model provenance.
Recorded scene contexts match, but original complete Jev wire bytes were not
captured: questions were reconstructed from committed source. Decisions returned
`gpt-6-luna`, checked by the direct adapter.

There is no empirical factored comparison, calibrated Decisions policy, repeated
stability estimate, held-out accuracy, integrated false-mastery comparison, or
live migration test. The six-call approval authorizes no further calls. The
[earlier readiness report](issue-42-benchmark-readiness.md) and its evidence JSON
remain historical audits of commit `7262930`; their zero-observation inventory
predates this diagnostic and is not the final evidence state.

## Runtime fix and benchmark reproduction

Commit `4b3c268` addresses the separate culture stall: a conversation-first
connection check no longer exhausts the later answer-recovery allowance. Each
stage remains bounded per visit, including failed sends. Counting retains its
shared support budget. Regression coverage exercises recovery, no repeated
semantic prompts, navigation on a learner request, and preservation of partial
evidence without mastery. Spoken behavior still needs a fresh manual retest.

That orchestration change initially caused the benchmark's strict current-source
checks to reject the checkout. `RECOVERY_SOURCE_COMPATIBILITY` now pins exactly
the two reviewed recovery/runtime files and records their hashes separately in
`activeRuntime.recoverySourceHashes`. Both original baseline Git blobs are still
checked against the immutable manifest. Other runtime drift continues to fail;
negative tests cover both new exceptions. These orchestration modules are not
executed by isolated reducer replay, whose questions, mapping and reducer remain
unchanged. Source and plan identities change, invalidating older run approvals.

The frozen 71-case v1 corpus and its historical Jev **1.13** arm remain intact.
The active app and the recorded October 15 diagnostic use **1.14**; they are
never relabeled as 1.13 results. The direct Decisions adapter remains byte-pinned.
Factored deadlines and selected-label stability retain their reviewed fixes.
Future paid experiments still require compatible review, explicit finite budgets
and, for held-out factored evaluation, a separately locked policy.

## PR validation

The full branch passes 1,222 unit tests across 58 files, source ESLint with
ignored `test-results/**` excluded, scoped TypeScript, changed-file formatting
and diff checks. Default TypeScript still reports the seven pre-existing errors
in ignored review copies. Both offline variants validate 71 frozen snapshots
and process 142 arm slots with zero new provider observations. Missing-data
calibration reports `calibration_unavailable`. The sanitized selections and
agreement counts were cross-checked against the local normalized result artifact;
its exact hash is retained. This review made no additional provider calls.
The user-owned untracked October 14 review remains unchanged and excluded.
