# MAE386 evidence attribution: neutral source blocks

One bounded follow-up to approved help commit
`c25c9aaf82d58516636b18dcb8a58e1e3489d67b`. No mastery threshold, rubric criterion,
reference answer, cumulative retain-strongest policy, recovery/help behavior,
question navigation or frozen-recap rule changes.

## Captured failure and scope

The original [historical microphone export extract](evidence/README.md)
shows Q6's System 1 description/example judged independently demonstrated at
0.96/1.00, but source boundaries split across neutral tutor backchannels failed
the separate locator thresholds. Final live revision 207 (original event 2118)
therefore gave those observations null sources and retained only System 2 credit.

Q10's second sentence had a different location ambiguity: “They, yeah, they
collaborated on the project” split start probability between two occurrences of
“they.” Neither passed the gate, so the second-stage rewrite assessment was not
requested. This change supplies a canonical boundary instruction for harmless
lead-in repetitions; it does not infer a rewrite or combine locator probabilities.

The later helped-Q8 run had prompted semantic scores below 0.9. That is not merely
a boundary problem. It must remain unresolved unless actual learner evidence and
its accepted semantic judgment establish understanding; help alone earns no
credit. This commit does not force such answers into assisted demonstration.

## Bounded mechanism

Only for a MAE386 non-rewrite node, when multiple eligible learner messages are
separated entirely by neutral tutor backchannels, the classifier gets one
`sourceSpan_<criterion>` choice between `none` and the exact app-authored block.
No separate start/end decisions are needed in that case. The block retains the
literal words, original message indexes, and every intervening tutor message.
The model still judges the criterion and independent/assisted attribution
separately. Grouping is not proof of semantic coherence: instructions require
`none` for unsupported blocks or combinations of competing/separate attempts.

A standalone “Hmm” is neutral only for this MAE386 conceptual path, matching the
captured discussion. The shared acknowledgment predicate, counting, Catching
Unicorns and Q10 backchannel handling are unchanged. Substantive tutor speech, clarifications
or help between learner messages keep the existing start/end locator path. This
is deliberately not a general utterance reconstruction or new grading engine.

The normalizer accepts only the exact transcript-generated span ID and rejects
forged ranges, mixed schemas, missing transcript binding, and other-lesson use.
Fresh provider responses must match the requested block schema. Historical
start/end diagnostics retain their original interpretation; the old scores are
not retrospectively assigned new sources. New diagnostics round-trip against
the actual request transcript/revision. The reducer keeps its echo and prompting
guards and records authoritative original span messages, with null historical
turn identity where no single authenticated turn can represent the whole span.
No transcript, turn ID or confidence score is fabricated or replaced.

For Q10, stage-one instructions prefer the first repeated lead-in word of the
same current proposal, while explicitly excluding abandoned proposals, source
quotations, negation, substantive corrections and withdrawals. Stage two still
receives precisely the selected learner words, including ASR disfluencies, and
judges only that proposal. Latest-poorer, withdrawn and source-echo protections
remain mandatory. A prompt convention cannot guarantee that Jev will choose it
confidently; fresh provider evidence is required.

## Verification and remaining live check

- Full unit suite: 1,868 tests across 85 files pass (16 additional tests).
- New source-block regressions use the captured Q6 semantic scores with an
  explicitly mocked new source selection. They establish application mapping,
  not measured provider improvement. Tests cover original indexes and context,
  diagnostic round-trip, unchanged historical outputs, substantive-help fallback,
  other lessons and Q10 exclusion, uncertain semantics/locations, `none` for a
  competing block, copied tutor words, assisted provenance and forged schemas.
- A Q10 classifier regression checks that canonical boundaries preserve the
  actual “They, yeah, they” words in the second-stage request. Locator/assessment
  responses are mocked; broader latest-proposal/withdrawal regressions still run.
- All 35 provider-free browser tests passed against the production build on
  isolated port 3101 with provider credentials explicitly empty. The existing
  credential-enabled acceptance server was not reused by automated tests.
- Lint, typecheck, production webpack build, changed-file Prettier and diff checks
  pass. The append budget fixture is unchanged: 48 messages at most 344/348 offline
  proxy tokens, with existing 450-token and 2,000-byte regression ceilings.
- Independent precommit review found no actionable issues and reran 55 focused
  source-block, fragmented-attribution and rewrite-classifier tests.

No paid provider request was made during implementation or automated checks.
Fresh human microphone verification remains pending: Q6 with natural pauses and
neutral backchannels, then Q10's disfluent collaborative-project rewrite. Export
review must establish actual heard words, accepted source/assistance identities,
and frozen outcomes. A transcript replay or mocked locator cannot stand in for
that microphone check. No subsequent fix or integration starts before human
approval of this single attribution commit.
