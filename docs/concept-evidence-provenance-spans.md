# Complete concept-evidence provenance

## Root cause

Commit `63291ed` let Jev recognize a cumulative explanation but asked its source
Choice to identify only the introducing learner message. The reducer persisted
that one message. These contracts disagreed whenever a later learner message
completed the explanation.

The runtime orders incoming transcript deltas by provider interval. The
`transcriptMessages()` projection coalesces consecutive same-speaker lines,
including consecutive learner fragments. An intervening tutor acknowledgment
creates a real message boundary: October 16 messages 5 and 7 are separate learner
messages, with tutor “Mm-hmm.” at message 6. No transcript words were lost.

## Approach

Use explicit start/end boundaries plus corrected source-selection instructions.
A single source index or better wording alone cannot represent multi-message
provenance. Each concept now has two source Choices in the same Jev request:
`source_<criterion>` and `sourceEnd_<criterion>`. Each uses the actual learner
message options. Both boundaries must pass the unchanged confidence/margin gate,
be ordered, and refer to learner messages in the exact request snapshot. A missing,
uncertain, reversed or unresolved current boundary yields no accepted source.

Both questions identify the same earliest coherent explanation. Single-message
explanations select the same boundary twice. Split explanations include their
necessary completion; partial or unrelated answers must not be joined into a
complete explanation. There is no fixed span-length limit or quadratic list of
overlapping spans. Concept assessment remains cumulative, and the same span can
support multiple criteria. This adds one Choice per criterion, not another
provider call or a retry. Objective/tutor classification and navigation are unchanged.

The reducer persists the entire contiguous span, including all intervening
messages. Every entry is copied from the snapshot with its original index,
speaker and text. It never joins separated learner quotations into a new sentence
or relabels tutor explanations as learner words. Tutor entries are prompting
context only. Copied definitions remain partial. Relevant tutor-help labels can
remain prompted; an independent label spanning tutor speech outside a narrow
neutral-acknowledgment allowlist is conservatively partial with unknown prompting,
rather than silently accepted as independent or guessed to be prompted.

Accepted spans retain their original revision and quotations through identical
reclassification. Later locators cannot shorten or shift the accepted explanation
to a contained fragment. A partial source can grow into a complete span without
creating a new attempt. Existing cumulative mastery protections still apply.

## Additive schema and compatibility

- Proposals add optional `childMessageEndIndex`, strictly greater than the start
  when present. Omission retains the existing single-message format.
- Multi-message evidence references add `childMessageEndIndex` and `messages`, an
  ordered array of `{ messageIndex, speaker, text }`. This array is authoritative
  complete provenance. `childMessageIndex` and `childTranscript` retain their
  legacy meaning as the first learner anchor, and `childTurnId` is null for a span
  covering multiple turns rather than inventing one turn identity.
- Single-message references keep their old shape. Historical boundary-less scores
  can still be replayed offline, using their original candidate rules. This does
  not retrospectively repair old exports. Live provider validation requires both
  boundaries; missing end answers cannot silently fall back to the start.
- Existing consumers reading only `childTranscript` still see the first anchor;
  complete span-aware consumers must inspect `messages`. No UI was changed here.

## Validation and limitations

Thirteen regression tests cover single and consecutive fragments, neutral
acknowledgments, substantive hints, unrelated follow-ups, copied content, long
spans, source expansion, stable reclassification, multiple criteria, malformed/
uncertain boundaries, legacy replay, and the recorded October 16 examples.
Controlled source scores test the contract and reducer, not semantic accuracy.
The recorded cultural-agreement example uses span 5–7; abstraction can use the
complete learner explanation at message 7.

Live Jev replays also exercised the October 16 transcript and realistic neutral,
hinted and unrelated controls. Some boundaries remain below the existing .90
source gate, including cultural agreement in the final October 16 replay, while
abstraction locates message 7. Those cases deliberately retain uncertainty; this
fix does not claim to calibrate Jev or guarantee source recall. Model judgments
still determine coherence and sufficiency. The neutral-tutor guard can also
withhold independent status for harmless wording outside its allowlist.

All 1,177 tests across the 59 files outside the frozen experiment guards pass,
including every previously passing concept-evidence test. The exact staged tree
also passes 209 targeted tests across eight files and a clean TypeScript check
after `next typegen` in an isolated directory. Scoped ESLint and TypeScript
checks pass; the temporary TypeScript config excludes ignored stale
review copies in `test-results/` and `.sprout-evidence/`. The full suite has 1,191
passing tests, one historical prompt-hash failure, and two historical experiment
suites rejected by source-hash guards (48 skipped), as before this fix. Issue #42
artifacts and provider implementations were not rebaselined or edited. Three test
mocks and the source-output helper now supply the extra boundary answer.

No confidence thresholds, authored lesson graph, GPT-Live prompts, navigation,
recap UI or provider selection changed. Commit 3 is outside this change.
