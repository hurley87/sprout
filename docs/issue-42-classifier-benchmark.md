# Issue #42 classifier benchmark corpus v1

Commit 1 establishes provider-free inputs and **agent-authored draft labels**. It
contains no Decisions adapter, runner, tuning, or production changes. **Human
review is required before any provider evaluation.** No labels in this version
claim human adjudication. Existing replay annotations do not adjudicate the new
labels, and past normalized scores were already visible when drafts were written.

The frozen [manifest](../tests/fixtures/classifier-benchmark-v1/manifest.json)
pins PR #68's merge `fd40c9bc631770ab1220f85767ee2f6cdd56ab9a`, Jev
`jev-1.13.0`, endpoint, no retry/fallback, `conversation-state-v2`, and its existing
thresholds. Exact source hashes cover the shared classifier, question generation,
message projection/source options, mapping, reducer, assessment, and lesson files.
[Lessons](../tests/fixtures/classifier-benchmark-v1/lessons.json) freeze authored
criteria and context. Every case has exact input, question and projection hashes;
these include node-specific source locator choices and merged message indexes.
Thresholds record the baseline; they are not a recommendation for Decisions.

## Coverage and provenance

The [corpus](../tests/fixtures/classifier-benchmark-v1/corpus.json) has 71 snapshots:

| Inputs | Cases | Provenance |
| --- | ---: | --- |
| Historical counting adaptations | 29 | `scripts/jev-calibration.mjs`, `CASES/0` through `CASES/28`, recovered at `cc475589c384ac192e28cc5c8bdc061c10d12b4b` before deletion in `efafee48b1b27e3e28e4568ac2072072b0d51259` |
| Issue #57 clarification snapshots | 4 | `docs/issue-57-clarification-review-set.json`, `/recorded/0` through `/recorded/3` |
| Existing Catching Unicorns excerpts | 16 | Engram retry (4), Exogram (2), Compare/Exographics (2), completion consistency (4), provenance (4); exact file/JSON pointers in each case |
| October 14 supplied demo | 12 | Early and final actual classifier requests for Engram, Exogram, Compare, Exographics, arithmetic/memory extension, and culture |
| New adversarial controls | 10 | Echo, tutor-only success, partial explanation, correct-to-wrong correction, skip, irrelevant assent, ambiguous source, prompted own explanation, closure with gaps, instruction injection |

**Historical discrepancy:** issue #42 refers to 30 counting cases; the recovered
array contains 29. No 30th source entry, original calibration result set, or human
label review was located. The historical script is used as data only. Its
`shouldAdvance` booleans are retained as `legacy_expected_boolean`, not provider
outputs, human judgments, or current runtime labels. Adaptations add a neutral
Tutor question and revision 0; the toy name is removed from case 26, and the
suspected tutor echo in case 29 is explicitly Tutor-labelled. This intentionally
changes the old unlabelled input and is recorded in each source reference.
No deprecated `EvaluateAnswer`/`ADVANCE-STAY` path is executed or restored.

October 14 sources were supplied by the user after initial orientation:

- `sprout-catching-unicorns-58ede1b2-4cc6-4136-afa4-ad86c9d63fc8.json`, SHA-256
  `54d7a211e910d91f61814a04af847a37513af46cc7940ce941065cfef26e4fe3`.
  The export has 4,163 events and 36 `classifier.started` events on October 14.
  Selected zero-based request indexes: 137, 279, 383, 559, 794, 1021, 1131,
  2018, 2326, 3337, 3485, 4025. Only current-node lesson text is copied; source
  runtime identities, raw event streams, global summaries, provider bodies, and
  audio are excluded. These are exact requested snapshots, including fragments;
  a request does not establish a completed/accepted provider response.
- `transcript-d0xpn5rwzkz80pe.vtt`, SHA-256
  `3cddac3a4bca946302de21512e38a8d802837c48a076e6f3a270afb4df16a5e3`.
  It has 112 timed cues without speaker labels. No cue is incorporated as a
  classifier input; alignment and speaker attribution are unverified.

The private originals remain outside Git and are unnecessary for routine corpus
validation. Their hashes and exact export pointers permit authorized source
review. The export records only lesson id/scene, not the live checkout SHA or
full authored configuration. Its culture question asks for **two examples**;
PR #68's rubric requires **four characteristics**. Draft labels use the pinned
rubric and flag that mismatch instead of claiming live configuration parity.
The culture final response does not explicitly include arithmetic or all four
characteristics; the memory-extension response does not clearly establish
concept discovery. Both need human judgment. Existing undated replays are not
asserted to be October 14. Application, synthesis, recap, every request/revision,
silence/audio-only events, and all source-locator ambiguities are not exhaustively
covered. There is no acoustic verification or claim of complete regression coverage.

## Draft label schema

`expected.objective` and every authored current-node `expected.concepts[id]`
contain separate dimensions, with rationale:

- `demonstration`: `demonstrated` or `no_demonstration` under the pinned criterion.
- `attempt`: `complete`, `partial`, or `not_attempted`. A complete wrong counting
  attempt can still be `no_demonstration`; partial evidence is distinct from absence.
- `attribution`: `independent`, `prompted`, or `unresolved` for demonstration;
  `not_applicable` otherwise. Unknown or unseen earlier help is never invented.
- `tutorConfirmation`: `yes`, `no`, or `unresolved` on the objective. In
  conversation-first lessons, `yes` includes explicit closure and does not imply
  mastery. Concept labels use `not_applicable` rather than attributing a tutor's
  general acknowledgment to each individual criterion.
- `learnerEvidence`: `valid`, `none`, or `unresolved`, with zero-based supporting
  indexes in the shared `transcriptMessages` projection. Consecutive same-speaker
  fragments merge. `valid` means substantive learner-authored, relevant supporting
  text, not independently correct or sufficient mastery. Echoes and partial
  explanations can have valid authorship while remaining `no_demonstration`.
  `unresolved` marks locator ambiguity; multiple candidates do not assert a
  uniquely supported provider locator. Tutor text and assent alone cannot support
  a label. The reducer still owns accepted evidence.

Counting has no authored concept criteria, so its concept map is empty; task
completion is not independent concept mastery. Current-node inputs do not carry
runtime evidence from earlier nodes: absent prior-scene criteria remain absent
rather than inferred from tutor speech. Objective aggregate labels are review
annotations; they are not literal objective Choice outputs or permission to
advance. `historicalObservation` only preserves legacy booleans or source
references to old normalized mappings/scores/requests. New synthetic controls
have no historical observation. Existing locator annotations may be manually
constructed controls; consult the original artifact before interpreting scores.

## Freeze, split, and review gate

All 61 historical/recorded snapshots are **calibration**, including the entire
October 14 demo. Related snapshots/known variants share an exchange group;
previously viewed outputs cannot become a blind held-out set. The ten new
synthetic controls are provisional **held_out** groups. They have not been run
against a provider, but are agent-authored and visible, not a blind population
sample. Do not tune on them. Human reviewers must confirm semantic labels,
source indexes, prompting ambiguity, closure versus mastery, and grouping/split
boundaries before runs. A later comparison needs broader independently reviewed
held-out material; small synthetic sets cannot establish real-world accuracy.

v1 is immutable. Do not regenerate its hashes to accommodate changed production
criteria or silently revise expectations. Record adjudication in a separately
versioned review artifact tied to these file/input hashes, with actual reviewer
identity, decisions and date; any changed input/label requires a new corpus
version. Keep review locked before inspecting **new** provider outputs. There is
no review artifact yet and `providerRunsAllowed` is false. Any future runner must
require reviewed labels and authorization before paid requests.

Later analysis must distinguish semantic disagreement, confidence/mapping
rejection, source-locator failure, incomplete/cancelled request snapshots,
reducer acceptance, and assessment/recap inconsistencies. The manifest pins both
live mapping and assessment implementations; it does not fix their differing
handling of combined independent/prompted demonstration probabilities.

## Provider-free validation

Run `npx vitest run tests/classifier-benchmark.test.ts`. The closed schema helper
checks identity, authored criterion coverage, label combinations, substantive
learner evidence, reference pointers, source and input hashes, question/projection
reproducibility, and exchange/prefix split isolation. Negative cases verify that
corrupt identities, tutor evidence, invented labels/adjudication, leaked variants,
and synthetic history fail. No private source or provider credential is required.
Git must contain the pinned baseline and historical script commit; fetch those
objects if using a shallow checkout. Production contract drift intentionally
fails the baseline reproduction check and requires a newly versioned benchmark.

Validation for commit 1: all 1,057 unit tests (52 files), targeted ESLint and
Prettier checks, and TypeScript with the pre-existing ignored `test-results/`
review copies excluded passed. The default `tsc --noEmit` still fails on seven
errors in `test-results/commit3-review/app/`; those unrelated files were preserved.
All 12 selected private-source pointers, request identities/revisions and both
supplied export hashes were checked locally without printing private content.
No paid provider calls or live sessions were launched.
