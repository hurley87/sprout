# Fix 3: conversational closure and October 16 transition replay

This change is based on `sprout-catching-unicorns-469a81f7-d59f-4d53-a1a3-a336279bf334.json`.
The bounded source extract is `tests/fixtures/catching-unicorns-closure-oct16.json`;
no historical issue #42 artifacts are changed.

## Root causes and changes

The Exogram scene brief explicitly requested clarification using notes or diagrams,
even after external memory had been explained. Comparison and Exographics retained
open-ended probing language despite the session's general closure guidance.
Their briefs now state sufficient meanings, accept accumulated explanations, and
request a brief acknowledgment and closure signal without another example or
restatement. Clarification remains available for genuinely ambiguous meaning.
The session also distinguishes accepting an accurate contribution from broadly
endorsing a mixed answer (including the unsupported short-term-memory claim).
These are GPT-Live instructions, not scripted responses or new assessment rules.

The transition delay was an exchange-eligibility and cancellation problem, not
slow React rendering or a mastery threshold. An energy candidate immediately
incremented `childTurnId`, cleared `hasChildTranscript` and closure authority, and
reset `interruptedExchange.ready`. Discarding it required fresh quiet and
classification. Consequently `classificationSource()` returned null when
`!hasChildTranscript && !interruptedExchange?.ready`. A discarded burst could
also abort an already-running closure classification. The 600 ms transcript
stability identity was restarted by microphone-only turn changes.

For conversation-first, nonterminal scenes, candidates now block navigation with
`childSpeaking` while retaining the exchange identity, transcript eligibility,
closure authority and independent PCM quiet history. A current in-flight proposal
may settle while a candidate is unresolved, but cannot navigate until it clears.
Discarding energy resumes the same exchange; confirmed speech or valid new learner
text creates the new turn, cancels classification and revokes pending closure.
Source/revision guards continue rejecting stale results. Counting, terminal recap
rules, microphone thresholds and all quiet/drain durations retain their policies.

## Recorded sequence and deterministic comparison

Times below are the export's monotonic session clock, in milliseconds.

| Time | Observation |
| ---: | --- |
| 191269.5 | Final substantive learner transcript's microphone turn ends. |
| 191402.8 | A subsequent candidate is confirmed as speech, but supplies no new text. The existing missing-text recovery remains necessary. |
| 194949.9 | Final tutor transcript: “That makes sense. We can move on.” |
| 195801.4 | Last active tutor PCM drains to quiet. |
| 196336.2–197869.5 | Further candidates are discarded; old behavior repeatedly invalidates eligibility. |
| 199801.8 | Existing 4-second missing-text recovery authorizes a closure-only recheck, independently of mastery. |
| 199801.9 | Tutor closure classification starts. |
| 200101.8 | Candidate onset cancels that request in the original runtime. |
| 200302.9 | Candidate is discarded. Fixed runtime can now transition immediately: the classification has settled and PCM has already drained. |
| 203819.5 onward | Later confirmed speech and “Sounds good / Will we move on?” occur during the original stall. |
| 217785.8 | Original runtime finally receives a usable tutor closure classification. |
| 217786.0 | Original render request. |
| 217819.5 | Original React render confirmation (33.5 ms later). |

There is **no accepted `conversation.advance.requested` event** in this window;
that path recognizes an explicit learner navigation utterance. Tutor closure is
established by the tutor proposal's `acknowledging` act. Mastery remains separate.

The scheduler test uses the recorded microphone/output timings and transcript
text deltas. It supplies the recorded final closure proposal at its recorded
349.4 ms latency, rebasing the application revision. Earlier canceled requests
have no captured response, so this is a **controlled scheduling comparison**, not
a prediction of how Jev would classify an earlier snapshot live. Running the same
test against parent `6b67743` produced a request at **217786.0 ms**; the changed
runtime produces **200302.9 ms**, **17483.1 ms earlier**. From final closure text,
that is **22836.1 → 5353.0 ms**. The remaining time preserves recovery for confirmed
speech without text; discarded energy no longer adds another wait. Reducer replay
of the recorded delivered proposals separately reproduces the original endpoint
(candidate identities are rebased for the new semantics).

## Recap provenance

The accepted reducer ledger remains the sole authority. For an independently
demonstrated criterion, personalization reads only its retained learner source,
including complete multi-message provenance when available. Neutral tutor
backchannels permit joining learner fragments; substantive tutor content breaks
the run. Whitespace is normalized and sentence boundaries yield readable excerpts
of 6–40 words, without cutting claims mid-sentence or generating a paraphrase.
The longest qualifying explanation takes precedence over shorter definitions.
Prompted, uncertain, partial and unresolved evidence cannot supply an independent
quotation; tutor echoes and instruction-like text are excluded. If no suitable
excerpt exists, the general recap remains. The redundant thanks sentence is omitted
when the recap already needs three attribution sentences.

The October 16 accepted shared-meaning explanation now qualifies despite its line
breaks and length. The existing frozen `terminalText` is unchanged: display,
steering and completion verification still share exactly one snapshot. A runtime
test delivers a personalized recap through automatic terminal completion.

## Validation

- Focused regressions cover sufficient closure, ambiguous clarification, discarded
  candidates, actual speech/text interruptions, in-flight and stale proposals,
  exact audio-drain boundaries, recorded timing, longer evidence, neutral tutor
  backchannels, unsupported attribution, and frozen recap delivery.
- Final application suite excluding those three historical benchmark files: 1216 tests passed in 62 files. Focused closure, steering and recap run: 32 passed.
- Browser: all 7 Catching Unicorns Playwright tests passed using an isolated copy and an independent webpack dev server, with provider credentials empty. The existing developer server remains running.
- Full Vitest run: 1228 passed, 48 skipped, one historical benchmark test failed;
  two additional historical benchmark suites fail during loading. All three
  failing files also fail against the parent code. Active source compatibility
  hash failures are left visible; frozen benchmark artifacts remain untouched.
- Production build: `npm run build -- --webpack` passed in the isolated copy, including the normal Next.js TypeScript step.
- TypeScript passes with a temporary config excluding ignored `test-results/`.
  Standard `npm run typecheck` includes stale saved app copies there and fails on
  their removed APIs. ESLint passes with `--ignore-pattern 'test-results/**'`;
  the standard lint command also scans generated files in those saved copies.

Live validation is still needed for GPT-Live's adherence to the refined briefs,
actual Jev decisions/latencies, microphone behavior with real learner interruptions,
and natural delivery of the personalized spoken close. No paid live provider test
is implied by deterministic replay.
