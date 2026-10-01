# Legacy parent-review recovery

An immutable ready analysis can contain proposals from before session speech timing was recorded. Retrying that analysis cannot repair its original snapshot. Review inspection therefore keeps it `ready` and marks only affected proposals with `resolution: "reject_only"`.

For an undecided affected proposal, the parent can inspect the original sources and reject it with a reason. Acceptance, accept-all and correction remain unavailable. Once every proposal has a decision, the parent can finish with light correction or substantial repair. A rejection writes no reviewed evidence. Planning excludes rejected proposals and still includes valid, separately reviewed proposals in the same analysis or other prerequisite sessions.

This path applies only when validation reports the recognized timing failures and no trustworthy session speech interval exists. Other proposal corruption, changed canonical snapshots, invalid stored decisions and invalid reviewed-evidence links still fail closed. Review completeness is required before any evidence reaches planning.

Original events, proposals, saved decisions and completed reviews are never rewritten. Previously accepted or corrected proposals that now fail timing validation still block planning; their final decisions cannot be replaced by rejection. This patch does not provide a historical migration or uncertain-exchange downgrade. Exclusion is the conservative recovery path, because missing timing cannot establish scene association or the timing of recorded assistance.

The parent panel explains the limitation, disables unsupported actions, retains rejection controls for undecided affected proposals, and displays a warning instead of summarizing unsupported totals as current conclusions. Completed historical decisions remain visible without an ineffective analysis-retry control.

Regression coverage lives in `tests/parent-review.test.ts`, `tests/parent-review-summary.test.ts`, and `tests/browser/parent-review.spec.ts`. Browser tests use synthetic API responses, not live sessions.
