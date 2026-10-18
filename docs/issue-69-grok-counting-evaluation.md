# Issue #69: bounded counting evaluation

## Fixed checklist (defined before live execution)

Use the unchanged `COUNTING_LESSON`, one duck → two ducks → three butterflies,
and the same learner text/audio in both arms. Stop an arm at its first blocking
failure; no paid retries. Initial live selection: one happy-path attempt per arm,
up to three answers, 120 seconds per arm. Other cases remain explicitly unrun if
the initial pair cannot complete. Use synthetic adult fixtures only.

| Case | Fixed learner input / action | Expected task outcome in both arms |
| --- | --- | --- |
| Correct across three scenes | `answer-one`, `answer-two`, `answer-three`: “I see one duck.” / “I see two ducks.” / “I see three butterflies.” | Exactly one authored transition per settled correct answer plus relevant acknowledgment and audio drain; terminal completion after butterflies. |
| Wrong answer | On two ducks: `answer-three-ducks`, “I see three ducks.” | Hold; no correct-answer credit or success praise. |
| Wrong then corrected | On two ducks: wrong answer, then fresh `answer-two` after tutor settles; continuous `self-correction` (“Three. Uh, I mean two.”) is a separate correction variant | Earlier wrong answer earns nothing; latest settled correct evidence may complete. Grok narrow grammar may abstain on continuous correction: record a miss, never relabel it a pass. |
| Correct then corrected to wrong | On two ducks: “Two ducks. No, three ducks.” before transition | Hold; revised wrong final revokes old success. Do not wait until after a committed transition to inject. |
| Genuine difficulty | `dont-know`: “I don't know.”; separately `help`: “Help me please.” | Hold and offer non-leading support; no answer/mastery credit. |
| Tutor answer then echo | If tutor supplies “Two ducks”, learner echoes `answer-two`; do not change prompts to induce leakage | Record leakage; no independent mastery. Grok explicitly rejects echo credit. Baseline task rubric may accept settled repetition: record task completion separately from independence. If no natural leak occurs, case is not exercised live. |
| Thinking pause | Five seconds of silent synthetic stream after settled prompt, then correct answer | No fabricated learner evidence or transition during pause; fresh answer remains possible. |
| Interruption | `barge-in` during post-answer tutor output: “Wait! I want to say something.” | Stop old playback and invalidate stale success; require fresh current evidence before transition. Missed injection window is incomplete, not pass. |
| Explicit move-on / early stop | Fresh “Move on”; separate parent Stop | Grok ends without success credit or skip traversal. Baseline parent Stop ends without credit; spoken move-on is observation only, not guaranteed parent authority. Preserve arm semantics and report difference. |

Reviewer: Codex inspected the source text, authored counting rules, adapter tests
and existing speech manifest. No independent human reviewer or human listening
review has yet occurred. The checklist remains pending human review at this commit's
review stop; automated inspection must not be described as human validation.

## Environment and identity

October 18, 2026; local macOS Darwin 27.0.0 arm64, Node 22.17.0, Next
16.3.5, headless Chromium 153.0.8010.12. Both arms evaluated exact
application commit `0983af75b69faf243382e520807fa7f73884f442`, branch
`codex/grok-counting-spike`, initially clean. This report-only commit has that
exact parent; its own SHA belongs to the handoff, not the evaluated runtime.

| Arm | Configuration | Serving evidence |
| --- | --- | --- |
| `/experiments/grok-counting` | `grok-voice-3.0`, Eve, `grok-transcribe`, `report_counting_answer`; no observer | `session.created` and both `session.updated` echoes: `grok-voice-3.0`. Provider-reported pin, not independent attestation. |
| `/` | `gpt-live-1` + `jev-1.14.0`, canonical `conversation-state-v2` | GPT-Live model echo unavailable in retained harness. Jev route rejects any model echo differing from its requested pin; three accepted results establish that gate passed, but raw echo is not retained. No alias-derived identity claim. |

Grok PCM input/output requested at 24 kHz; baseline uses existing WebRTC and
app-owned VAD. Existing authored instructions, rubric, graph and production
providers were unchanged. One live scenario per arm, serially, zero paid retries.
Baseline used its existing opt-in harness; Grok used a removable `/tmp` Playwright
probe with a silent stream plus committed fixture PCM through a synthetic
microphone, native WebSocket events and Web Audio scheduling. No transcript/VAD/tool
injection or route mocks in either live attempt. Browser output was not listened
to by a human. No physical microphone, child recording, persistent audio capture,
credential logging or personal learner data was used.

## Observed results

[Sanitized evidence](evidence/issue-69-counting-walkthrough.json) retains the actual
clocked proposals, source text, output activity, render events and Grok failure
trace. All fixture checksums matched the existing [speech manifest](../tests/fixtures/speech/manifest.json).
Raw baseline reports remain locally in `/tmp/sprout-issue69-baseline-live/` and
its existing ignored `.sprout-evidence/` retention directory; they are not needed
to read the committed extract. Raw Grok probe result: `/tmp/issue69-grok-live.json`.
These temporary paths are local references, not durable repository artifacts.

| Checklist case | GPT-Live + Jev live | Grok live |
| --- | --- | --- |
| Correct, one duck | Passed; current learner “I see one duck”; “Yes, one duck!”; accepted `correct/none/acknowledging`; next render confirmed | Blocked; full final “I see one duck.”; one correct tool call rejected with `stale context` / diagnostic `transcript.final.corrected`; no transition |
| Correct, two ducks | Passed; “I see two ducks”; “Yes, two ducks.”; accepted proposal and butterfly render | Not reached |
| Correct, three butterflies | Passed; “I see three butterflies”; “Yes, there are three butterflies.”; accepted proposal and terminal completion | Not reached |
| Wrong | Unrun | Unrun |
| Wrong then corrected (fresh and continuous variants) | Unrun | Unrun |
| Correct then wrong before transition | Unrun | Unrun |
| Not-knowing / help | Unrun | Unrun |
| Tutor-supplied answer then echo | Unrun; no leak in observed prompts | Unrun; no leak in observed prompt |
| Five-second thinking pause | Unrun as a controlled case | Unrun as a controlled case |
| Interruption/barge-in | Unrun | Unrun |
| Spoken move-on / parent early Stop | Unrun as a scenario; automatic completion teardown passed | Spoken move-on unrun; cleanup Stop exercised after blocked attempt, not a substitute for the scenario |

Actual paid attempt counts: baseline **1 session, 3 learner utterances, 3 Jev
requests**; Grok **1 session, 1 learner utterance, 1 tool call**, plus one automatic
rejection-recovery response (not a second learner attempt). Grok produced three
completed responses total: opening, tool-only answer, clarification. One local
browser invocation failed connection-refused before any provider request; two
server launch setup failures (Node env-file propagation and concurrent Next dev
lock) likewise supplied no provider attempt. Baseline ran first; Grok's final
server and paid run started after baseline teardown. Stop was followed by closing
the probe browser and its server. No paid rerun was used to improve the outcome.

**Highest-severity check:** zero accepted incorrect answers observed, across only
four correct learner inputs; no live negative-input sample supports a false-credit
rate. Zero mastery awards observed: baseline assessment remained idle with empty
results; Grok granted no answer credit. The three baseline successes are settled
task completion, not independent mastery measurements. Neutral questions and
source text support those task outcomes, but no human independently rated them.

Baseline: three emitted observer proposals, three accepted, no observed missed
correct answers, duplicate accepted calls, stale acceptance, classifier errors or
no-call stalls. Three `classifier.cancelled` journal entries occur at transitions
after those results; they are lifecycle events, not three lost proposals. Grok:
one emitted report, zero accepted, one missed settled correct answer at the app
boundary; no observed duplicate call or accepted stale call. The later two scenes
provide no Grok denominator. No leading total or inappropriate success praise was
seen in either arm's generated text. Grok clarification was “Let's take another
look. Can you tell me again how many ducks you see?” Its content was appropriate
for a rejected exchange but unnecessarily repeated an objectively correct answer.
Audible quality, overlap and prosody were not assessed.

## Grok blocker and concrete reproduction

The real configured opening was “Hello! I see a duck on the screen. How many ducks
do you see?” It supplied no explicit total in the adapter's current grammar. The
retained sequence, milliseconds on one browser `performance.now()` clock:

| ms | Event |
| --- | --- |
| 7322 | Start checksum-verified `answer-one` synthetic PCM |
| 7553 | Provider VAD speech start; app `context.claimed` |
| 8008 | `input_audio_transcription.completed`: “I see” (before speech stop) |
| 8665 | Local fixture playback ended |
| 9004 | Provider VAD speech stop |
| 9044 | Changed `completed`: “I see one duck.”; app invalidates context with `transcript.final.corrected` |
| 9057, 9662 | Identical repeated full finals; no new correction required |
| 9120 | Answer response created after VAD stop, but context already invalidated |
| 9667 | `report_counting_answer`: `correct`, `none`, supporting text “I see one duck.” |
| 9668 | Tool result `rejected`, `stale context`; response complete |
| 9754–10784 | One clarification response generated |
| 14282 | Last clarification source ended locally; UI idle by 14293 |

The first scene remained held through the 25-second post-answer render wait.
This was **not missing tool emission, an incorrect model count, a final ASR wrong
object, or response creation before VAD stop**. The provider emitted an early
partial `completed` followed by a changed full `completed`; application revision
protection cleared the reservation before the call. The diagnostics identify this
cause; they do not certify the supplied token or every later validation check
would otherwise pass. This is a transcript-lifecycle integration blocker for
meaningful progression evaluation, even though the conservative rejection protects
against stale credit. It reproduces the prior commit's known correction boundary
with a correct full final, rather than establishing a new semantic weakness.

Official [Voice lifecycle reference](https://docs.x.ai/developers/rest-api-reference/inference/voice)
and [Speech to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech),
checked October 18, describe `updated` as cumulative pre-final corrections and
`completed` as completed input transcription. The observed early/changed completed
sequence needs investigation; those descriptions do not justify blindly treating
all completed events as interim, reusing an invalid token or accepting old calls.

Provider-free existing reproducers already cover this invariant:
`tests/grok-counting-proposals.test.ts` (“distinguishes a changed final transcript
from a provider token mismatch”, identical-final regression) and
`tests/grok-counting-transport.test.ts` (“surfaces correction-based stale-context
failure without logging learner text or token values”). Feed an acknowledged turn,
an initial final, a changed final, then its call: hold and diagnose the correction.
No new fixture or runtime patch is needed to reproduce the rejection boundary.
Remaining implementation investigation: retain a bounded diagnostic of event
kind/order and same-item equality (no opaque values); establish a documented or
explicitly tested settlement strategy preserving correction invalidation and
response/turn/token provenance; obtain separate review before changing semantics.
Then rerun one paired happy path before adverse scenarios. This commit does not
silently make a corrected call eligible.

## Timing, synchronization and cleanup

Times below use the **local synthetic fixture end**, not remote VAD stop, as the
answer boundary. Each arm's end/proposal/render measurements share that arm's
browser monotonic clock. No cross-session clock subtraction or percentile claim.

| Scene / arm | Answer end → valid proposal | Proposal → confirmed render | Answer end → local output activity proxy |
| --- | --- | --- | --- |
| One duck / baseline | 3439.3 ms | 42.0 ms | 1126.5 ms |
| Two ducks / baseline | 3413.6 ms | 39.1 ms | 1232.2 ms |
| Butterflies / baseline | 4480.7 ms | 29.2 ms | 1439.7 ms |
| One duck / Grok | Unavailable: no valid proposal; rejected call at +1002 ms | Unavailable: no transition | Recovery first packet +1473 ms; first local source scheduled +1478 ms |

**End of answer → first audible tutor response: unavailable for both arms.**
Baseline output activity is analyser-detected local output, not a human hearing
measurement; Grok packet arrival and Web Audio source scheduling are also not
proof of audible playback. Grok recovery generation completed at 10784 ms while
its final local source ended at 14282 ms. Provider completion is not audio drain.
No cost or latency comparison should treat that early completion as heard speech.

Baseline final acknowledgment output quiet preceded renders: 11901.9 → 12757.7,
23401.8 → 24173.4, 35601.1 → 36372.9 ms. Next-scene first output activity began
at 14550.6 and 26257.2 ms, after the respective renders. The existing complete
lesson replay assertion passed exact identities/order and no premature completion.
This supports local old-scene drain before next question, subject to analyser
limits; it is not a listening judgment. Grok never transitioned, so cross-scene
choreography remains unverified live. All 17 received Grok audio packets scheduled
17 sources and produced 17 source-ended observations; no interruption was injected.

Baseline teardown assertions passed: app microphone ended, peers closed, audio
detached and app contexts closed; synthetic context closed by harness disposal.
Grok Stop produced `stopped · Audio: idle`, app track `ended`, one context closed
and one synthetic context still running at sample. Synthetic context was then
explicitly disposed. Socket inventory at +150 ms contained OPEN and CLOSING,
including Next HMR; it does **not** establish a CLOSED provider socket. Browser
closure completed teardown; live app socket-close completion remains unmeasured.
The removable probe also observed two JSON-parser exceptions on binary Next HMR
messages because its additive listener covered all sockets. These are probe
instrumentation errors, not provider errors; text JSON provider events and app
handlers still ran. Future probes should filter the provider socket and ignore
non-text frames. Event IDs/tokens were excluded from the committed evidence;
independent replay of their exact equality is consequently unavailable.

## Cost and limits

Total observed billed cost: **unavailable, not zero**. No billing receipt,
voice usage totals, token totals or Jev pricing/usage were retained by these
interfaces. Session wall time (baseline test 37.2 seconds; Grok probe roughly
33.9 seconds including local setup/wait/cleanup) is not billed audio duration.
No defensible total-price estimate can be calculated from those counters alone;
none is fabricated. Current pricing was not used to calculate any dollar figure.
A cost decision still needs provider usage/billing reconciliation including
silence, opening/recovery speech, tool text and the three observer calls.

The sample is one fixed synthetic voice/fixture path per arm on one local device.
The baseline completed; Grok could not complete its first turn. There are no live
negative, correction, help, echo, pause, interruption or move-on results, no
human acoustic review, and no independent human ground-truth adjudication. Existing
provider-free tests validate control boundaries, not model reliability or general
pedagogy. Do not pool older live probes with this paired attempt.

## Reproduction and remaining live work

1. Check branch, clean tree and exact application SHA. Review the fixed checklist
   with a human before interpreting it as ground truth. Verify adult synthetic
   fixture bytes against the manifest; keep both arms' input text/audio identical.
2. With credentials in a secure invoking environment, run only the existing case:
   `npm run test:browser:live -- scenarios.spec.ts --grep '@happy-path' --output=/tmp/sprout-issue69-baseline-live`.
   The config requires `OPENAI_API_KEY` and `TYPESAFE_API_KEY`, one worker,
   zero retries, 120 seconds. This evaluation loaded the ignored environment via
   `node --env-file=.env.local node_modules/@playwright/test/cli.js test --config=playwright.live.config.ts --project=lesson-live scenarios.spec.ts --grep '@happy-path' --output=/tmp/sprout-issue69-baseline-live`.
   Do not run the full live suite as a substitute for the fixed checklist.
3. After its server exits, start the local app with `XAI_API_KEY` configured;
   open `/experiments/grok-counting`. The exact automated Grok probe was temporary,
   not a committed reusable harness. To reproduce its interaction, install the
   existing synthetic-microphone helper before navigation, start, wait for a
   settled opening and `listening · Audio: idle`, play `answer-one` once. Allow
   at most 25 seconds for the next rendered node. Do not retry a blocked turn.
   Only if advanced, repeat with `answer-two`, then `answer-three`; 120 seconds
   total. Observe native JSON events, function results, local source drain,
   Correlation diagnostics and exact DOM render identity. Use monotonic timestamps
   for fixture end/proposal/render; do not record audio or auth/ID values.
4. Stop and dispose the synthetic stream/browser. Human-review source text and
   generated captions; add actual listening with headphones to measure audible
   latency and pacing. Preserve a sanitized extract and usage totals, not secrets.
5. After resolving/reviewing the Grok blocker, run one fresh pair. Then exercise
   the remaining checklist serially with one attempt per case and arm, stopping
   an arm at a blocker. Record wrong/false acceptance before reporting safety,
   continuous/fresh corrections separately, genuine support, natural leakage/echo,
   five-second pause, a verified barge-in window, spoken move-on and parent Stop.
   Record incomplete windows and differing stop semantics; never alter rubrics.

## Recommendation and issue scope

**Insufficient evidence.** The baseline completed this small path and Grok emitted
a semantically correct tool report, but the transcript-correction boundary blocked
its acceptance. This does not establish whether Grok needs an observer or whether
tool-only judgments are dependable. Retain the current production architecture
while investigating that integration blocker. One successful baseline lesson and
one blocked Grok turn cannot establish comparative reliability, cost advantage,
production readiness or independent learning.

Issue #69's broader replacement hypothesis remains open. This slice covers only
the existing three counting scenes and bounded task proposals. Catching Unicorns,
Engram/Exogram/culture explanations, concept/source-span mastery, background noise,
reconnection, long sessions, real device/room conditions and any provider migration
remain deferred. Move-on continues to end the experiment without credit; it does
not acquire skip/mastery semantics here.

## Validation

No application code, prompts, rubrics or test fixtures changed. Existing focused
provider-free suites passed **313 tests in 6 files** (Grok auth, proposals,
transport, counting confirmation, canonical Jev classifier and live-evidence
assertions). The **17 selected provider-free browser tests passed**, covering Grok, root
Counting and Catching Unicorns. Changed-file Prettier and `git diff --check`
passed. No code changed, so lint/typecheck/build were not rerun for this
report/evidence-only commit.

Current offline evidence, all synthetic and independent of provider reliability:

| Boundary | Passing existing coverage |
| --- | --- |
| Three-scene success, exact render, own-item acknowledgment drain, completion | Grok transport and browser authored progression tests; baseline counting confirmation tests |
| Wrong, fresh correction, correct then changed wrong final | Grok proposal/transport wrong-turn and correction invalidation tests; baseline confirmation revision guard |
| Help and tutor-answer echo | Grok grounded help mapping and supplied-answer rejection tests; Jev contract tests validate deterministic mapping, not live semantic judgments |
| Thinking/no-call stall | Grok 60-second quiet/non-answer fixtures and one bounded retry tests |
| Interruption, cancellation, stale/duplicate calls | Grok transport playback truncation, source fencing and proposal consumption tests |
| Move-on and Stop | Grok transport ends without edge/credit; baseline confirmation does not turn non-success into completion |

These are retained tests, not new live passes. No new regression was added
because the observed final-correction rejection already has a reproducible fixture.
