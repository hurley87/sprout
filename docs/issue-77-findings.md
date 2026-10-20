# Issue #77 findings and policy recommendation

This report records the original tracking-only analysis. The later
[counting learner-answer policy](lesson-runtime-reducer.md#counting-learner-answer-policy)
separately introduces correctness and commitment judgments following manual
conversation testing. Its new behavior and tests are not part of the historical
measurements or hash-bound source set below; the recommendation here describes
the evidence available at that earlier stage.

**Recommendation: defer behavioral policy changes; keep the delivered separate
tracking.** The saved evidence demonstrates rechecks, conservative holds and
context-sensitive judgments. It does not demonstrate a valid accepted answer
being lost solely because the tutor spoke, or establish a safe advancement change.
This is insufficient evidence for a policy experiment now, rather than evidence
that the runtime has no defects. Jev remains the semantic observer and the authored
reducer remains transition authority. No models, prompts, thresholds or policy
were changed for this report.

## Evidence and reproduction

Analysis parent: `19151508e1ea0aa1ba9aac77a4b67fab6fcb9753`. Read alongside the
[tracking contract](issue-77-tracking-contract.md) and
[preservation replay](issue-77-tracking-replay.md). The latter establishes software
invariants separately from the recorded observations below.

Run from the repository root with Node, without network, installation or provider
credentials:

```sh
node scripts/issue-77-findings.mjs
```

The [extractor](../scripts/issue-77-findings.mjs) checks exact reproduction of the
[machine-readable findings](issue-77-findings.json), including SHA-256 for every
consumed evidence file, original source metadata, request identities, event indexes
and calculated intervals. `--write` regenerates after deliberate input review.
It only reads the explicitly listed checked-in files; paths in provenance are
metadata and are never opened. Original export hashes are retained where supplied,
but cannot be reverified without those exports. No raw Downloads export, temporary
browser log or fresh provider response is used.

The counting review sets use the historical nine-score contract. The butterfly
mapping uses saved `conversation-state-v2` Choice outputs. Catching Unicorns files
mix recorded inputs/scores, later classifier replays and manually supplied source
locators, as their provenance states. None is a fresh evaluation of active Jev
1.14 or the current rubric. Mapping old outputs through current contracts is
compatibility/interpretation evidence, not current model performance. Do not pool
these sources into an accuracy or latency benchmark.

## Recorded request and acceptance findings

Counts below describe saved selections only, not complete sessions, children,
per-turn totals or independent samples. “Accepted” means the saved **mapping**
decision; it does not prove reducer acceptance, mastery, playback or advancement.
All checkpoint indexes below are zero-based; named request/mapping event indexes
retain the source export's numbering.

| Saved selection | Available Jev evidence | What can be concluded |
| --- | --- | --- |
| [Final-node counting review](issue-57-final-node-review-set.json), runtime `8adca88d-2e69-4869-a512-dc31682fc071` | 9 request/mapping pairs: 2 accepted, 7 abstained; 16 synthetic contrasts excluded | Requests span multiple nodes/turns. These are not all requests in the runtime. |
| [Clarification review](issue-57-clarification-review-set.json), runtime `39abf02a-8c9a-4144-ada0-9430673ab5d4` | 4 request/mapping pairs: 1 accepted, 3 abstained; 10 synthetic contrasts excluded | Tutor-only context changes and a child reaffirmation are inspectable. |
| [Butterfly reduced trace](../tests/fixtures/butterfly-filler-confirmation.json), runtime `969d045e-9dcb-454e-8b69-2382b607796b` | 1 saved mapping at revision 55; no saved classifier-start timestamp | `objectiveState_no_winner`; initial and final answer authority are false. This is not an accepted answer later dropped. |
| [Catching Unicorns boundaries](../tests/fixtures/catching-unicorns-source-boundaries-oct16.json), recording `469a81f7-d59f-4d53-a1a3-a336279bf334` | 20 ordered recorded input/output checkpoints | Identical node/revision/text occurs at pairs 3–4, 8–9, 17–18. Without full request identities/timing, these do not establish duplicate scheduling defects or full-session request totals. |

Selected rechecks with unchanged learner text:

- Final-node request events **150 → 384**, same turn 2, revisions 12 → 26:
  tutor adds “Point to the duck and count it.” Both mappings abstain. A changed
  helping context warrants interpretation; unnecessary work is not demonstrated.
- Final-node **1135 → 1155**, revision 76: identical transcript, but turn 6 → 7
  (`finished-butterfly-count` → `same-count-after-discard`). Both abstain. This
  is an identity-related repeat, not a tutor-only revision or proof of wasted work.
- Final-node **1209 → 1286**, same turn 8, revisions 79 → 84: after “Is that all”,
  tutor adds “Yes, you counted all the butterflies.” Both mappings abstain.
  This is a tutor-only recheck; the status question versus numeric doubt remains
  uncertain in the existing human text review.
- Clarification **606 → 751**, same turn 5, revisions 37 → 47: tutor extends
  “Yes, one duck. You counted carefully” with “are you finished with your answer,
  or would you like some help?” Both abstain for `support_ambiguous` (.40 → .36
  help). This combined tutor block changes the conversational question; it does
  not demonstrate that earlier difficulty caused the support judgment.
- Clarification **796 → 855**, same turn 6, revisions 51 → 55: after “Yeah, I
  answered one”, the tutor adds “Thanks for telling me.” The mapping changes from
  accepted to `tutor_no_winner`; correctness stays .97 and acknowledgment falls
  .95 → .43. The earlier accepted proposal ends on child text, which cannot
  establish fresh tutor acknowledgment. This is semantic reclassification after
  tutor words, not proof of lost independent mastery or an erroneous hold.

The tracking implementation now preserves earlier acceptance and records authority
suspension on new transcript revisions. That mechanical reset is covered by
`evidence-tracking.test.ts` and the differential replay; it is not itself a labeled
valid-answer loss. These saved selections lack a complete before/after reducer
acceptance ledger proving such loss solely from tutor speech. **Dropped-valid-answer
and unnecessary-recheck rates remain unknown.**

## Context, independence and correctness

In Catching Unicorns boundary checkpoints **2 → 3**, exogram revisions **34 → 50**,
the learner text stays “Information stored outside of our brain or mind.” Tutor
adds “Could a note or a diagram … keep information outside of you?” Objective
completion probability changes .68 → .31, but independent exogram demonstration
remains .98 → .97. The later identical-input checkpoint 4 reports .96 independence.
These observations show changing whole-exchange judgments without a demonstrated
loss of the learner's concept evidence. Human interpretation: this is compatible
with revalidating a new tutor act while retaining earlier learner evidence;
it does not justify treating every tutor-only recheck as harmful.

At checkpoints **17–19**, revisions **252/259**, the same recording retains the
learner's substantive “Math is a good example … we have a shared understanding or
a set of symbols” before “Sounds good” and “Will we move on”. The
[closure fixture](../tests/fixtures/catching-unicorns-closure-oct16.json) retains
accepted cultural-agreement evidence from revision 252, learner message 3, with
its original quote and nullable turn. Later closure/navigation does not itself
prove the other criteria or fresh mastery.

The [exogram confirmation fixture](../tests/fixtures/catching-unicorns-exogram-confirmation-replay.json)
retains “That's right. It's more durable” after the tutor supplied a note/sketch
example. Its source locators are explicitly manually reviewed regression inputs,
not recorded provider results. Human interpretation: later prompted assent cannot
establish independent invention of that example; the earlier learner explanation
must be examined separately. This mixed record cannot measure source-attribution
accuracy. The [October 17 attribution fixture](../tests/fixtures/catching-unicorns-attribution-oct17.json)
is explicitly synthetic because the original export is unavailable; its neutral
backchannel and tutor-introduced shared meaning are useful guard cases, not
recorded context-contamination findings.

For counting, [fragmented confirmation event 414](../tests/fixtures/issue-57-fragmented-confirmation.json)
records “Three … Uh, no wait … two … Two” across tutor “Yes, two … ducks.”
The existing human text interpretation says completed, while historical scores
abstain (`tutor_no_winner`, correct .97, acknowledgment .64). Attribution and
acoustics are unverified. This is a self-correction/context review candidate,
not a verified false rejection. Similarly, the final-node review regards “One two
three” as correct text while its saved mapping abstains; that discrepancy is not
a calibrated label for independent mastery.

**Correctness, false advancement and false mastery rates are unknown.** There is
no adjudicated, audio-reviewed ground truth with complete transition outcomes for
these selections. Text-review opinions, normalized probabilities, manual locators
and numbers of test cases cannot supply those denominators. No causal effect of
combined context on semantic correctness or independence is isolated here.

## Timing and presentation: available stages only

All intervals below are arithmetic on the same saved local clock unless explicitly
identified as metadata. Values are rounded to 0.1 ms. They are observations, not
latency improvements or response-level delivery claims.

| Sample / stage | Available result | Missing or limited evidence |
| --- | --- | --- |
| Final-node request → mapping journal, n=9 | 168.8–266.9 ms; individual rows in JSON | Journal interval includes orchestration/receipt; neither pure evaluator compute nor endpoint/browser duration. Answer end, audio and render chain absent. |
| Clarification request → mapping journal, n=4 | 165.1–258.7 ms; individual rows in JSON | Same limitations; correlated selected snapshots, not a population distribution. |
| Butterfly first saved speech stop → last answer text → first saved active PCM, n=1 segment | 33892.8 → 34066.1 → 34157.3 local ms; last text receipt to PCM activity 91.2 ms | The final answer fragment's provider interval is 32800–33000 ms on a separate clock. Receipt and microphone stop are not acoustic answer end. PCM onset is not confirmed audible wording. |
| Butterfly saved mapping elapsed, n=1 | 207.1 ms endpoint mapping metadata | No saved local request/result timestamps; no end-to-end subtraction or model-compute attribution possible. No render request/confirmation or element playback facts in this segment. |
| Catching Unicorns closure, n=1 segment | Last saved child stop 214119.5; final PCM quiet 216851.4; proposal 217785.8; recorded render request 217786.0; confirmation 217819.5 local ms | Last child stop follows “Will we move on”, not the substantive answer end. Response identity, actual audio and playback-element stages absent. |
| Same closure, adjacent stages | Quiet → request 934.6 ms; proposal → request 0.2 ms; request → confirmation 33.5 ms | Saved classifier latency is 349.4 ms, with endpoint/browser attribution unestablished here. Residual intervals cannot be allocated to generation, playback or scheduling. |

The closure fixture distinguishes recorded request/confirmation times from a
controlled replay that serves a saved final proposal for earlier conversational
acts. That replay's earlier transition is not a measured real-audio improvement.
The [commit 4 report](issue-77-tracking-replay.md) likewise labels its synthetic
counting timing, mocked playback and synthetic setup visits. Those are preservation
checks, excluded from the recorded table. No median/p95 or answer-end-to-heard
feedback/confirmed-scene distribution is supported.

## Delivered observation and bounded follow-up

Tracking now exposes source/scene/turn/revision provenance, accepted evidence and
mechanical supersession history, Jev feedback interpretation/mapping, separate
PCM and locally observed playback facts, current eligibility and render identities.
Historical acceptance cannot authorize current progression. Existing exact render
confirmation remains distinct from a request. Unsupported tutor correction,
contradiction or general prompting semantics remain unknown; the current semantic
contract must not be relabeled to invent them. Response ID, response completion
and speech heard remain unknown even for new tracked playback. Counting still
lacks fine-grained answer/independence source attribution. Old recordings cannot
be retrofitted with these absent observations.

Keep current scheduling, acceptance, interruption, stale-source, audio-drain and
presentation-confirmation protections. Proposed follow-ups, **documentation only**:

1. Review a small counting set of correct-answer-plus-“Why?”, feedback interruption
   and resume, and self-correction before/after acknowledgment. Preserve original
   acceptance alongside new evidence; have humans label current correctness,
   independence, retraction and relevant feedback from actual audio.
2. Collect complete tracked request/cancellation, evidence, PCM/playback and render
   chains for those same cases. Adjudicate whether any tutor-only recheck is
   semantically redundant and whether any valid answer is actually lost. Keep
   missing response completion/hearing unknown.
3. Only after a demonstrated problem, propose a separately reviewed, minimal opt-in
   counting policy comparison with identical lesson, Jev settings and evaluator
   contract. Prioritize false advancement/mastery and retain correction,
   interruption, stale identity, drain and render guards. Require human-reviewed
   actual audio before claiming audible benefit; do not generalize counting
   behavior to concept mastery, conversation-first closure or recap.

No prototype, Grok migration or new classifier is proposed in this commit.

## Issue done-when map

- [x] Separate evidence, feedback and playback inspection, unknowns and mechanical
  supersession: delivered by commits 2–3; contract and tracking tests document it.
- [x] Baseline transition and scheduling preservation: commit 4 differential and
  runtime on/off checks in the replay report. Its prior verified suite totals and
  browser results are historical validation, not rerun or empirical sample counts.
- [x] Correct/incorrect/help, prompting/leakage, contradiction-as-unknown,
  corrections, interruptions, late/duplicate/stale, missing playback and
  conversation-first/recap: replay coverage matrix maps the regression checks.
- [x] Findings cite saved identities, exact events/checkpoints, request counts and
  available timing: this report and hash-bound JSON. **Gaps:** full-session totals,
  valid-answer-loss causality, fine-grained counting independence, calibrated
  correctness and real audible/response delivery remain unknown; no meaningful
  behavioral defect sufficient to justify policy change is demonstrated here.
- [x] Recommendation separates delivered tracking from deferred behavior work;
  any later comparison needs the same settings, false advancement/mastery review
  and a human-reviewed real-audio walkthrough.

Validation for this docs/analysis-only commit: extractor reproduction and source
hash checks, Node syntax check, focused ESLint, touched-file Prettier and
`git diff --check`; all passed. An isolated temporary-copy check also confirmed
that a source-byte change with unchanged JSON meaning fails reproduction. No app
source or app tests changed; the full suites were not rerun. Existing
ignored/generated review files remain untouched.
