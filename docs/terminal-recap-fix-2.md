# Fix 2: terminal recap transcript artifacts

Source: `sprout-catching-unicorns-469a81f7-d59f-4d53-a1a3-a336279bf334.json`
(October 16). The recap-only fixture preserves recorded runtime event sources,
arrival times and provider intervals. Text fragments are reconstructed from
successive `transcript.snapshot` entries: the export does not contain raw
provider packets, and leading whitespace trimmed at message boundaries cannot
be recovered. Punctuation normalization makes that whitespace immaterial here.

## Root cause and delivery path

- `evidenceRecap()` authors the close from accepted reducer evidence, rather
  than asynchronous cumulative assessment. The instruction appended at
  217820.2 ms contains the complete authored close beginning “You independently
  explained durability, sharing, revision, and shared meanings.”
- Steering acknowledgement arrives at 218495.2 ms with a provider boundary of
  229200 ms. Queued fragments are admitted against that boundary.
- The first snapshot is “You”, interval 229200–229400, at 218495.2 ms.
  The next adds another “You”, interval 230800–231000, at 220021 ms.
  Those intervals do **not** overlap. The application sorts fragments by provider
  start time and concatenates deltas without word separators, producing `YouYou`.
  Event-ID deduplication cannot identify distinct intervals as retransmissions.
- The remaining snapshots reproduce the authored close. The final period arrives
  at 233451.7 ms. `normalizeRecapSpeech()` preserves the extra letters in `YouYou`,
  so the original exact check never succeeds.
- Local PCM output observations include fresh activity **after** that final text
  (233801.4 ms); final quiet begins at 234750.5 ms. Transcript arrival alone is
  therefore insufficient to authorize completion.
- Confirmed microphone speech without learner text requires the existing bounded
  recovery. Late discarded microphone candidates do not clear that obligation.
  It resolves at 238750.9 ms. With the corrected check, render confirmation can
  complete the lesson once at that point, after drain. Originally the session
  instead ends on page-hidden at 238792.6 ms with `lessonComplete: false`.
- Completion still flows through reducer render confirmation → `lesson.completed`
  → `stop("lesson_completed")` → provider close and local transport cleanup.

The verified cause of the **string** `YouYou` is concatenation of two distinct
opening fragments. The journal cannot establish whether the first “You” was
actually audible or a provider transcription/restart artifact. The user-reported
single “You” in VTT supports an artifact interpretation; neither VTT nor source
media was available locally to independently verify it. There is no evidence of
an overlapping-interval bug to justify changing general transcript assembly.

## Focused correction

Raw transcript assembly, diagnostics and educational content are preserved.
Terminal verification now retains fragment boundaries and accepts only:

1. The entire authored close after normal punctuation/case normalization.
2. Identical delta retransmissions with the exact same provider start/end interval.
3. One standalone first-word fragment followed by the entire exact authored close.

The opening exception requires a separate whole-word fragment; a monolithic
`YouYou` is rejected. Internal repetition, multiple opening restarts, missing words,
substitutions, additions and reordering remain rejected. No fuzzy similarity,
edit distance, new timers or model/provider changes are involved.

The runtime freezes recap text before publishing the recap render, and shares
that string with the UI, steering instruction and verifier. Later render or
assessment updates cannot regenerate its expected text. A fresh runtime creates
a fresh snapshot on restart.

The existing observed-output, sustained quiet, interruption, unavailable-output,
late-audio render invalidation and idempotent completion gates are unchanged.
The replay retains microphone recovery rather than pretending the matcher was
the only gate. Tests cover manual Stop, page-hidden cleanup and restart as well
as transcript integrity, delayed text and repeated activity events.

## Validation

The October 16 replay fails completion with original recorded checks and completes
exactly once with the corrected verifier, with `lessonComplete: true`. Runtime
transport tests separately verify one close and no teardown while output is active.

Full-suite historical issue #42 benchmark failures reproduce on unchanged HEAD;
no artifacts were rebaselined. Standard typecheck/lint also include old application
copies and generated files under ignored `test-results/`; scoped source checks
exclude those copies without changing repository configuration.

The transcript exception deliberately does not recognize arbitrary partial overlaps
or other recognition errors. Live acoustic playback was not re-recorded in this fix.
