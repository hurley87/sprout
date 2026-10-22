# Evidence, recap and Q10 feedback follow-up

This follows `87e40db` and the October 22 human microphone session exported as
`sprout-mae386-c4a80de1-3047-493a-a362-d2e4df43e9d1.json`. The original export's
SHA-256 is retained in the [curated regression fixture](../tests/fixtures/mae386-evidence-2026-10-22.json).
The original stopped-session outcomes remain historical records; this change
does not regrade or mutate that export.

## Findings and changes

- **Accepted evidence discarded on a textless-turn recheck.** Local microphone
  activity can create a turn without transcript words. The existing recheck could
  establish tutor closure but deliberately ignored conceptual evidence and Q10
  proposals. In this recording, final Q6 classification accepted the System 2
  description, and final Q10-2 classification accepted all rewrite criteria, yet
  neither was projected into the recap.
- **Bounded historical assessment.** For MAE386 only, the runtime now retains
  app-authenticated character intervals for conceptual learner transcripts, as it
  already does for Q10. A recheck can assess selected words only when the entire
  selected learner span is authenticated in the exact current-visit snapshot.
  Conceptual provenance uses a null historical turn ID rather than crediting the
  textless turn. Q10 retains its original per-word learner turn IDs. Navigation,
  source echoes and tutor echoes remain excluded. No new attempt is invented for
  the textless turn, and a new visit clears conceptual transcript binding.
- **Paraphrase and assistance calibration.** Classifier guidance explicitly
  accepts external storage freeing limited memory, deliberate choices in the
  same concrete System 1/2 situation, and unfamiliar-word decoding linked to
  known speech. Naming a task in a neutral probe does not supply its explanatory
  mechanism. Feedback or a request for a final rewrite alone does not supply edit
  content; naming redundant words or suggesting an edit remains substantive help.
  Source options retain earlier complete explanation blocks even when each block
  is a single message separated by a tutor question. A singleton locator omits a
  redundant end index, preserving the proposal schema's strict span validation.
- **Spoken repairs and specific Q10 feedback.** The second-stage assessor keeps
  the exact raw proposal but interprets abandoned syllables/immediate restarts as
  speech repairs. It cannot combine competing complete proposals or supply
  omitted meaning. Live guidance requires comparing core meaning before praise
  and naming a specific meaning, tense, grammar or redundancy gap before asking
  for revision. `Worked together` is a valid alternative to `collaborated`;
  maximum compression is not required. The original spoken `work together`
  changes tense, so feedback may clarify tense rather than invent redundancy.

No confidence threshold was lowered. Uncertain semantics or provenance still
remain unresolved; tutor praise never grants mastery. The cumulative strongest
concept ledger, latest non-withdrawn rewrite rule, withdrawal handling, immediate
Stop and immutable recap/late-assessment rules are unchanged. Counting and
Catching Unicorns keep their assessment paths.

## Actual Jev text replay

The [retained replay](evidence/mae386-evidence-replay-2026-10-22.json) records actual
Jev responses for the five captured visits, against the working-tree classifier
fixes after `87e40db`. It includes the source export hash and implementation file
hashes at replay time. Later reducer-only guard review also excluded authenticated
navigation/source-only words from historical concept assessment; deterministic
tests cover that guard. This was not a new GPT-Live or microphone run.

An initial prompt iteration still left Q8 attribution and Q10-2 assistance
uncertain. Clarifying the difference between a task probe and supplied answer
content produced the final recorded results below, using the same thresholds.
These are observations on these texts, not a broad reliability benchmark.

| Captured answer | Final replay and deterministic frozen projection |
| --- | --- |
| Q1: external ideas and memory support | Both criteria independently demonstrated with the original learner span; component is independent. |
| Q6: immediate driving reaction and deliberate response selection | All four criteria independently demonstrated with the original span; component is independent. |
| Q8: sounds/pictures followed by sounding out a word known from speech | Both criteria independently demonstrated, with separate original learner sources; component is independent. |
| Q10-1: `He was late because he overs he overslept` | Exact words retained; restart is harmless; all three rewrite criteria demonstrated independently. |
| Q10-2: `They collaborated on the project` | Latest proposal selected; all three criteria demonstrated; prior nonspecific feedback does not supply the revision. |

The recorded provider results are replayed through the reducer in deterministic
tests, including a textless turn before the final classification, and checked
against frozen component outcomes. Negative cases reject altered/unbound words,
navigation-only evidence, tutor echoes, unbound rewrite words and late post-Stop
mutation. Withdrawal stays unresolved without resurrecting an earlier answer.

## Verification and review boundary

Full unit suite: **1,904 tests across 87 files passed**. ESLint, type checking,
production build, changed-file formatting and `git diff --check` passed.
The final provider-free browser suite passed **36/36** in the matching temporary
checkout, including counting, Catching Unicorns and MAE386.
The three edited Q10 teaching messages were recalibrated with offline tokenizers;
the unchanged 450-token/2,000-byte limits pass (maximum 378 `o200k_base` / 384
`cl100k_base` proxy tokens across the fixture).

The original checkout's browser run reached the retained-evidence limit of 100
attempt directories. Its evidence was preserved, and browser checks were rerun
in a temporary checkout with identical code and a fresh evidence directory.
No retention limit was increased and no earlier evidence was deleted.

The existing mixed-recap browser test also read the snapshot as soon as the node
ID became recap, before React's render acknowledgment committed the frozen
outcomes. It now polls for all eight frozen questions before making the same
outcome, attribution, spoken/visible consistency and late-review assertions.
Production render/audio timing and snapshot freeze rules are unchanged.
The final browser evidence and test results were archived locally at
`.sprout-evidence/evidence-recap-browser-2026-10-22.tar.gz` before removing the
temporary verification checkout.

Fresh human microphone verification remains pending for streaming fragmentation,
the final recap and the revised spoken feedback. The separate Q10 focused-start
shortcut and generated teacher PDF remain pending local work. No commit or push
is part of this review handoff.
