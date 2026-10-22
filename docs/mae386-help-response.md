# MAE386 requested-help response

Help-only follow-up, based on approved recovery commit
`36a80359ee4183315ec5286431e60d7aeae98345`. Recovery expiry, classification
thresholds, evidence locators, grading criteria, question navigation and frozen
recap semantics are unchanged.

## Failure and bounded response

The original [historical live run](evidence/README.md) captured Q8's
“can you explain it” and “Are you explaining it” receiving promises without the
explanation. Q5-f's “What's the discovery test” also received an offer rather than
the definition before the learner continued. A prompt conflict was a plausible
contributor; the export cannot establish the provider's internal cause.

The MAE386 durable session and current teaching context now explicitly permit a
requested conceptual explanation before an initial answer and ask for one useful
idea in the current reply, followed by the learner's own application. They forbid
stopping at a promise or asking permission again. Private focus is not a checklist
to recite; explaining the concept when requested is allowed. Full reference
answers and exemplar responses remain private.

The Help button now passes the explicit lesson definition and receives the current
subpart's existing reviewed `unit.tutor.help`, plus the same response policy used
for spoken requests. No parallel help parser, fulfillment classifier, automatic
retry loop or fabricated learner turn is introduced. Repeat remains source access
without a hint. Counting and Catching Unicorns keep their existing support text.

Independent review found another conflict in Q8's authored tutor guidance: it
prohibited sound-combination help before an attempt without an exception for a
request. That prohibition now applies to unsolicited initial probing; explicit
help is allowed. The human-readable rubric copy was regenerated to match that
single tutor-conduct sentence. No criterion, source, reference answer or authored
learner example changed. The existing teacher PDF in untracked `output/` is
preserved and unstaged.

Help is not evidence of understanding. Existing attribution still requires actual
learner explanation after substantive tutor guidance, retains the learner's source
identity, and labels affected demonstrated criteria assisted. A mocked Q8
help/application regression checks these existing boundaries; it does not measure
Jev semantic accuracy or certify a generated tutor explanation.

## Verification

- Full unit suite: 1,852 tests across 84 files passed, including 20 new tests for
  help delivery policy, current-subpart UI wiring, requested versus unsolicited
  Q8 guidance, Repeat/other-lesson preservation, and assisted learner provenance.
- Eight provider-free browser tests cover MAE386 and the root route against a
  production build on isolated port 3101 with provider credentials explicitly
  empty. The credential-enabled dev server on port 3100 is not reused by tests.
- Lint, typecheck, production webpack build, changed-file Prettier, generated
  rubric synchronization and diff whitespace checks pass.
- All 48 append variants are recalibrated with exact content hashes. Maximum
  offline proxy counts are 344 `o200k_base` / 348 `cl100k_base` tokens and maximum
  text length is 1,915 UTF-8 bytes. The existing 450-token regression ceiling,
  documented 500-token provider limit and 2,000-byte browser ceiling remain.
- Independent review identified and verified the Q8 conflict correction and ran
  focused help, controls, source-context, recovery and token-budget checks. Final
  exact commit review is reported in the chat handoff.

No paid provider call is part of implementation or automated verification. The
human-run evidence below used actual providers afterward. Prompt and mock tests
establish delivered guidance and application boundaries, not reliable tutor
compliance.

## Actual help test: one explanation observed, assisted outcome unresolved

October 21, 2026, **20:29:46–20:31:43 America/Toronto**
(October 22, 00:29:46.442–00:31:43.938 UTC). Runtime
`a04fe1f9-1932-4e7b-9a9e-ba147b04aa34`, tested code
`7a87b3664de5f0f44d28ee8e0d2fabcc8f430c5e`. This single help commit is amended only
with documentation/evidence; production code is identical to the tested and
independently reviewed code. The user confirmed microphone participation and
supplied the export. Route was `/demos/mae386?debug=1`, using the existing server
with GPT-Live-1 and Jev 1.14 configured. No synthetic speech, transcript injection,
mocked provider response or paid replay was introduced by this inspection.

Original file, unchanged:
`/Users/davidhurley/Downloads/sprout-mae386-a04fe1f9-1932-4e7b-9a9e-ba147b04aa34.json`.
Bytes: `3989621`; SHA-256:
`c4f505fc6c4c308d79b2f51695c48b4be80a5218fac3e87919e5ce88295b19ea`.

Locally retained `mae386-help-live-2026-10-21-a04fe1f9.json`
(see the [historical artifact archive](evidence/README.md)) retains
all visit conversations, outcomes, navigation and secondary assessment, with
selected exact diagnostics and their zero-based original event indexes. It omits
repeated runtime/detector snapshots and retains only declared fields for the
ending event and support append. Its byte count and hash are recorded below.

| Expected behavior                                                 | Observed evidence                                                                                                                                                                                                                                                                                                                   | Result / limit                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requested help contains an explanation rather than only a promise | Q8 UI Help, event 548 at 37966.8 ms; current-unit instruction, event 549; acknowledgment, event 554. Tutor explains saying the sounds represented by unfamiliar letters and blending them to recognize a known spoken word, then asks for the learner's own example.                                                                | Useful explanation observed. The export records a button request, not an authenticated spoken help request.                                                                                                                                                                                        |
| Two help requests, including a Q5 case                            | Exactly one `learner.support_requested` exists. Visits are Q1, Q6, Q8 and Q10-1; Stop occurs immediately after Q10 begins. No Q5 visit or second help request is captured.                                                                                                                                                          | Q5 help and the planned spoken-request path remain unverified by this export. Do not infer what happened in a different run.                                                                                                                                                                       |
| Tutor guidance precedes the learner application                   | The learner's response follows the sound-blending explanation and mentions learning to read by sounding out words, then shifts to general advantages of words over pictures.                                                                                                                                                        | In-session assistance is visible. Help does not by itself establish a complete demonstration. The learner does not clearly articulate every required unfamiliar-written/known-spoken decoding relationship in their own words; the tutor's fuller paraphrase cannot fill that gap.                 |
| Settled demonstrated criteria use assisted provenance             | At final live revision 193, event 1830, prompted-demonstration probabilities are 0.79 and 0.71; independent probabilities 0.06 and 0.07. Both demonstration judgments remain below the unchanged 0.9 gate. Sound-decoding source selection is also below threshold (0.85). Final proposal has no concept observations (event 1831). | The classifier favors assistance but does **not** accept an assisted demonstration. No criterion evidence is retained and frozen Q8 is unresolved. No false independent credit was awarded. These are separate semantic-completeness and source-confidence limits, not merely a missing Help flag. |
| Late secondary review does not upgrade the frozen recap           | Secondary Q8 review also favors prompted demonstration (0.65/0.72), both normalized to uncertain. Final outcomes equal the snapshot in the original ending event and final runtime.                                                                                                                                                 | Recap stays unresolved. Neither tutor praise nor secondary review silently creates an assisted result.                                                                                                                                                                                             |

**Conclusion:** one useful Q8 Help-button explanation is confirmed. This run does
not establish two fulfilled help requests or correctly accepted assisted outcomes;
Q5 and spoken help remain unexercised in the supplied export. Do not lower grading
thresholds or treat a help request as mastery to make the test pass. No production
change or additional provider request was made during inspection. The existing
assessment/feedback limitations remain outside this help-only commit. Stop for
human approval before any further implementation.

Extract bytes: `135233`; SHA-256: `9ed40cd190c40b0f144e3a4750f1a4c2da780d34280d2ee327ad5f003ce42d9b`.
