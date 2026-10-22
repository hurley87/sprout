# Q10 spoken meaning feedback

## Current user calibration

This rubric update follows local commit
`da409a755f1d913791798725beef3f7bf1300569`. The user accepts the Q10-3 use-based
rewrites as right answers, though less precise, and requests that the tutor may
point out lost nuance. This supersedes the earlier requirement that every
composition/building relationship remain explicit.

For Q10-3, all three resources (habits, heuristics, external scaffolds) and his
use of them for thinking are the required core meaning. Explicit toolkit
composition and building details are optional nuance. Both “He uses habits,
heuristics, and external scaffolds to think” and the variant adding “he builds”
are acceptable shorter spoken rewrites. An abandoned initial “His” before a
complete “he uses…” proposal is a speech repair, not a grammar error. These are
examples, not exact-match keys. Tutor feedback may briefly note the nuance
without rejecting an acceptable answer or demanding further revision. Once a
revision is sufficient, acknowledge it once without asking for more polishing.

Missing a category or the thinking purpose remains incomplete; materially
contradicting use for thinking remains incorrect. Q10-1's causal direction and
Q10-2's joint work requirement remain unchanged. Required criterion IDs, confidence
thresholds, assistance attribution, latest-complete-proposal/withdrawal guards,
recovery/help and conversation-first navigation remain unchanged. Existing frozen
recaps are historical records and are not regraded by this update.

## Human evidence and earlier interpretation

The original locally retained extract
`mae386-live-2026-10-21-c7d94b28.json` (see the
[historical artifact archive](evidence/README.md)), events 6206/6341, records
“He uses habits, heuristics, and external scaffolds, to think” followed by tutor
approval. Its unresolved recap is preserved. The earlier strict interpretation
called that approval unsupported; under the user's new calibration this rewrite
is acceptable, and lost composition/building detail is optional feedback.

The later user-supplied session
`sprout-mae386-1a176403-7463-43f7-baab-44628090cdb2.json` contains a valid
composition-based rewrite, then the use-based version, then a spoken repair into
the use-based version with building restored. Tutor feedback first accepted the
fuller version, noted lost composition/building nuance in the use-based version,
and accepted the final version. The user accepts these rewrites; the rubric now
reflects that judgment. Final attribution remained unresolved in that historical
session; this content calibration does not fix deferred locator limitations or
change its frozen result.

## Provider context and verification

`createLiveSessionConfig` serializes full criteria for the initial node. The
normal lesson starts at Q1; later speech updates use compact
`mae386TeachingInstruction` cues. Q10-3's full criteria, cumulative/live assessment
projections and compact tutor cue now share the core/nuance distinction. Reference
solutions remain private. The separate uncommitted debug shortcut starts at Q10-3
and therefore supplies fuller initial Q10 context; it is not part of this commit.

Authored examples cover both accepted use-based variants, spoken repair, missing
thinking purpose, material contradiction, and a voluntary revision after a
substantive tutor cue with conservative assisted provenance. Provider-free tests
verify instruction projection and mocked two-stage selection/grading transport;
they cannot establish live provider semantic accuracy or generated speech.

Fresh human microphone validation remains pending under the revised standard.
Test the two accepted use-based variants in separate fresh sessions. Expect brief
acceptance; an optional nuance note must not require another revision. Compare a
missing-category or materially contradictory rewrite, where targeted feedback is
appropriate. Also test through the normal Q1-to-Q10 flow to exercise compact
scene updates separately from the direct-start provider context. Inspect tutor
speech and assessment/recap outcomes separately. Full issue #76 acceptance and
deferred attribution work remain outside this change.

Provider-free validation in the current checkout (including the separate pending
shortcut): 1,882 unit tests, lint, typecheck, production build, generated rubric
synchronization, formatting and whitespace checks pass. Offline append-budget
recalibration keeps the unchanged limits: maximum 1,983 bytes and 392 tokens with
`cl100k_base` (385 with `o200k_base`). Tokenizers are regression proxies, not the
provider's exact counter. The shortcut's pending API test assertion was updated
to the calibrated criterion wording, but its files remain outside this commit.
