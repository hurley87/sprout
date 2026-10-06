# Issue #30: saved filler-confirmation failure

Investigated on 5 October 2026 at `c5e253e426a85088ef04c4690bb95fd2da8c09a0`
on `codex/issue-30-reactive-child-harness` (parent
`f1c8407905ed177ed506f9190e708e0fbbc066d0`). The checkout began clean. No
provider calls, credential-file access, voice comparison, server interruption,
commit, or push was performed.

## Finding

This section describes the initial investigation before the later missing-text
attempt and fix below. It is not a claim that production behavior is still
unchanged.

This attempt demonstrates failed automatic completion after a confirmed filler
turn, **not classifier scheduling starvation**. Current-turn evidence arrived,
classification ran, and the canonical mapper abstained. The scene correctly
held under its existing safety contract. A recovery-policy gap remains: a
confirmed child turn revokes earlier acknowledgment authority, and the canonical
Choice path does not request clarification on abstention. Without new qualifying
evidence the application has no path to automatic completion.

This is not enough to establish a faulty reducer, an incorrect semantic model
decision, or the causal effect of the filler alone. In particular, the answer was
misrecognized and no pre-injection butterfly classification completed. No
production fix is justified by this run alone; thresholds and authority remain
unchanged. The strict product regression must remain failing for this attempt.

## Evidence and boundaries

Attempt `432ec987-e1d4-4faf-897e-efb2964bf99c`, runtime
`969d045e-9dcb-454e-8b69-2382b607796b`:

- Original output directory (subsequently replaced by the second run): `test-results/filler-confirmation-diagnostics-1/butterfly-butterfly-filler-confirmation-product-regression-lesson-live/`.
- Durable: `.sprout-evidence/432ec987-e1d4-4faf-897e-efb2964bf99c-969d045e-9dcb-454e-8b69-2382b607796b/`.
- Report, harness, and timeline copies were byte-identical at investigation time. Use the durable copy for this attempt. Its report SHA-256 was reverified after the second run:
  `991b7f1b03edb7a8de4f69981e9ffa12522e7ff71fbff4a08011877655fa3c52`.
- Both playbacks ended. Hesitant-three added 153 outbound packets / 12,382 bytes;
  uh added 12 packets / 1,110 bytes. Counters prove outbound activity, not exact
  provider perception or correct ASR.
- Wire capture: 61 frames, zero drops and observation errors. All 22 learner
  transcript candidates became learner wire events; saved learner delivery
  records are snapshots. No parser-loss explanation was found.
- Safety checks passed. Strict completion failed after 8,467 ms of observation.
  Summary category is `explicit-held`, not `bounded-starvation-or-pending`.

All times below use the attempt's monotonic clock, not wall-clock or provider
interval time. Provider intervals are a separate timeline.

| Time (ms) | Production observation | Consequence |
| --- | --- | --- |
| 29,993.5 / 30,077.1 | Answer candidate / confirmation creates turn 4 | Prior authority cleared; answer transcript accumulates |
| 33,892.8 | Turn 4 ends | Current answer can become classifiable |
| 34,376.4 | Tutor revision 53 ends with “there are three” | Still requires latest-snapshot classification |
| 34,506.2–34,506.3 | PCM quiet; tutor stabilization scheduled for 500 ms | Outstanding work exists; no accepted answer yet |
| 34,524.2–34,526.8 | Injection check/start window; uh playback starts at 34,525.5 | Valid selected quiet window |
| 34,564.7 | Microphone candidate starts turn 5; stabilization cancelled | Semantics/audio cleared; only eligibility/audio suspended |
| 34,643.5 | Local VAD confirms turn 5 | Suspended evidence permanently revoked |
| 34,708.6 | Output becomes active during child speech | Cannot establish relevant post-child output |
| 35,027.1 | Late tutor “butterflies.” produces revision 54 | Tutor text alone cannot grant current child eligibility |
| 35,714.5–35,714.6 | Turn 5 ends without its transcript; blocked diagnostic | Temporary missing-current-turn evidence, not a terminal block |
| 35,724.3 | Child “Oh” arrives, revision 55; debounce scheduled | Current-turn eligibility restored; old semantics/audio stay revoked |
| 36,008.5 | Fresh output onset after ended child with transcript | Relevant audio can now be recorded independently of semantics |
| 36,037.3 | Classifier starts on turn 5 / revision 55 | Rescheduling succeeded |
| 36,265.0 | `objectiveState_no_winner`; null proposal | No reducer semantic event; scene holds |
| 36,357.1 onward | Output quiet and drained | Audio satisfies its gate; answer/acknowledgment still absent |

## Exact authority and mapping paths

1. `lib/events.ts:parseProviderEvent` accepts input/output transcript deltas with
   provider intervals and speaker labels. `LessonRuntime.receive` captures
   app-owned runtime/visit/turn identity at delivery; event IDs deduplicate packets.
2. `lesson-runtime.ts:receive` cancels pending classification on microphone onset,
   dispatches `child.candidate.started`, and then `child.turn.confirmed` on VAD
   confirmation. `lesson-runtime-reducer.ts` increments the turn and clears
   authority. Candidate discard can restore eligibility/audio for fresh
   classification; confirmed speech cannot use that recovery path.
3. `observeTranscript` checks interval validity, visit floor/source, and child
   turn/floor. Accepted fragments sort by provider start interval and arrival
   order for ties. Adjacent same-speaker fragments merge only within the same
   delivery-bound child turn. Consequently a late earlier tutor fragment can be
   accepted in turn 5, but cannot replace turn 5's child transcript. This also
   explains the split tutor lines in the supplied classifier input.
4. Turn end logs the missing transcript and cannot schedule yet.
   The child snapshot arriving 9.8 ms later calls `scheduleClassification`:
   `classificationSource` is now eligible, so the independent 300 ms child
   debounce runs. Tutor snapshots use `TutorStabilizationGate` (600 ms stable text
   and 500 ms quiet). Output changes do not starve the child debounce.
5. `classify` captures source and the full transcript together, sends only
   node/revision/transcript to `/api/classify`, and uses one request per exact
   identity. The route and `conversationObserverState` pass the full ordered
   transcript with current authored scene/objective to the canonical observer.
   Runtime turn IDs, audio state, and harness fixture labels are not model input.
6. `mapConversationObservation` requires selected probability >= 0.9 and unchanged
   competitor/margin bounds for **both** questions. Here completed probability
   is 0.43 (confidence 0.28), unclear/incomplete 0.34, unresolved help 0.20. Tutor
   choice is helping at 0.41, with confirmed completion at 0.37 (confidence 0.26).
   The mapper exits on objective probability; confidence is diagnostic and is
   not the gate. These labels are not completion eligible either. Lowering only
   the objective threshold would not establish confirmed completion.
7. Null proposal logs abstention and dispatches no `proposal.received`. Quiet
   ticks cannot invent semantics. Even a hypothetical correct/acknowledging
   proposal at revision 55 would accept an answer but not acknowledgment:
   revision 55 is child-authored. The reducer requires a fresh tutor-authored
   revision and exact current proposal. Relevant audio alone is insufficient.
8. `finish` never emits `render.requested`, so display remains butterflies.
   `app/lesson.tsx` confirms committed render identities after two animation
   frames; it cannot supply the missing render request. Terminal
   `lesson.completed` and transport stop never occur. No render defect is
   implicated by this trace.

`SupportClarification` is present but the canonical runtime never calls
`consider`; the gate also requires tutor-authored evidence. The absence of a
Choice-abstention clarification trigger is explicit in `docs/lesson-classifier.md`,
not a newly discovered accidental omission to wire in without policy design.

## Confounds and harness assumptions

The classifier actually received:

```text
Tutor: How many butterflies do you see?
Child: Oh, I see two. There are three
Tutor: Yes,
Child: butterflies.
Tutor: there are three
Tutor: butterflies.
Child: Oh
```

The observer criteria say self-correction can settle an answer and fillers alone
do not undo settlement. They also forbid tutor confirmation from settling child
uncertainty. The conflicting “two”/“three”, interleaved attribution, and final
“Oh” prevent this trace from isolating whether uncertainty comes from ASR,
semantic observer behavior, or the interruption. No scores exist for the
uninterrupted final answer/confirmation in this attempt.

`attemptWindowInjection` requires current child text containing “three”, an
ended turn, post-answer output, tutor confirmation wording, and outstanding
stabilization. Those are timing checks, not proof of settled semantic success.
“Two ... three” passes the lexical total check. `confirmation-quiet` is local PCM
quiet while work is outstanding; output resumes shortly after injection and
the final tutor word arrives later. The window name does not prove the full
confirmation finished. The strict completion assertion measures the desired
product outcome regardless of these confounds; its failure is valid but does not
identify a single broken component.

## Provider-free coverage and next investigation

### Second live attempt: no filler injected

The user reran the same command and output directory. Attempt
`3644898e-e866-4618-a2f0-7e0bcd30db99`, runtime
`b26f076c-2efd-48d4-9d1d-04ee02a53af3`, is retained separately at
`.sprout-evidence/3644898e-e866-4618-a2f0-7e0bcd30db99-b26f076c-2efd-48d4-9d1d-04ee02a53af3/`.

Hesitant-three playback ended and outgoing counters increased by 151 packets /
12,227 bytes. The accepted child transcript contained “Three ... butterflies”,
but tutor fragments said “I didn't quite catch that. Could you say it one more
time?” rather than confirming completion. The classifier selected clarifying at
probability 1 and unresolved help at probability 0.78; the objective mapper
abstained. The confirmation-quiet trigger timed out without injecting any filler.
This is an `incomplete-trigger` attempt, not a second reproduction of failed
post-filler recovery. It cannot establish the filler's effect. The two durable
copies must remain distinct even though their ordinary output paths were reused.

The current observer rubric already says fillers alone do not undo a settled
answer, later self-correction can supersede earlier mistakes, and a tutor request
to repeat is clarification. A safe hold follows the observed mappings in both
runs. Whether the first run's semantic scores correctly apply that rubric is
unverified; the replay uses recorded scores and cannot answer that question.

### Replay scope

`tests/fixtures/butterfly-filler-confirmation.json` reduces the saved evidence to
initial state, reducer events, mapping output, exact classifier input, and final
state. Unlogged clock ticks are reconstructed only where changed-state records
prove their times. Incoming transcript fragments for the integration test are
reconstructed from consecutive speaker text and saved intervals; they are not
claimed to be byte-identical wire deltas.

`tests/butterfly-filler-confirmation-replay.test.ts` checks:

- Exact reducer replay reaches the saved held state without transition effects.
- Recorded probabilities map to abstention, not completion authority.
- With fake transport/fetch/timers, normal authored prerequisite transitions lead
  to the butterfly visit; saved final-node event ordering then produces one
  resumed request with the exact full transcript. It holds beyond eight seconds
  with no classifier retry or final render request. After the later recovery fix,
  it also verifies one conversational repetition request on the recorded hold.
- A hypothetical positive child-ending proposal still cannot acknowledge. A
  fresh matching tutor revision/proposal can complete using the already fresh,
  drained current-turn audio and terminal render confirmation.

These tests cover application behavior; they do not validate ASR, audible tutor
content, model accuracy, browser timing jitter, or an unobserved counterfactual.

Validation: five focused Vitest files passed, 206 tests total (saved replay,
runtime scheduling, reducer, canonical classifier, support clarification).
ESLint on the new test, `tsc --noEmit`, and `git diff --check` passed. A read-only
`git ls-remote` check confirmed the remote branch still points to the expected
HEAD. All added tests use fake transport/fetch or pure mapping/reducer functions.
The live strict completion test was not rerun and is not reported as passing.

The next bounded investigation is an offline review of this exact transcript
and its fragment attribution against the existing observer rubric, explicitly
separating recognition uncertainty from the desired filler semantics. Provider-free
counterfactual inputs with a clean settled three and with the final filler removed
can check input construction/authority, but cannot establish model scores. Then
specify the confirmed-turn recovery policy: require a fresh learner reaffirmation
and tutor confirmation, or design a bounded clarification prompt on eligible
semantic holds, preserving interruption invalidation and current revision gates.
Do not add retries, widen thresholds, restore old acknowledgment, or relabel
confirmed speech as discarded noise. Any model evaluation or fresh live run
remains a separately authorized billed investigation; none was run here.

## Third attempt and implemented missing-transcript recovery

The user supplied a third run: attempt `dc7becda-012b-4f1d-aedf-3b563d5e2ea8`,
runtime `46174ce3-e74c-4f63-a02e-705b60853a78`. Its durable directory is
`.sprout-evidence/dc7becda-012b-4f1d-aedf-3b563d5e2ea8-46174ce3-e74c-4f63-a02e-705b60853a78/`.
Filler playback ended, outgoing counters increased by 13 packets / 1,131 bytes,
and local VAD confirmed a new child turn. No documented learner transcript event
arrived after injection in the complete bounded capture (52 frames, zero drops
or observation errors). A late tutor fragment arrived, but supplied no current
child evidence. Classification remained blocked and never rescheduled through
8,463 ms of observation. This supports a missing-text recovery gap, without
establishing why no input transcript reached the browser.

The production fix adds `AnswerRecovery`. A confirmed microphone turn
ending without child text arms a four-second sustained-quiet wait. The runtime
then sends one conversational request per visit to repeat the answer. Tutor
fragments may update its diagnostic revision without cancelling the wait. New
speech, current child text, inactive phases, steering, Stop and disconnect cancel
it; active/unavailable tutor output delays it until sustained quiet. Send failures
spend the visit budget. The timer never fabricates text, classifies old evidence,
restores revoked acknowledgment or requests a render.

Provider-free runtime coverage exercises cancelled answer work, a late tutor
fragment, the missing-child wait, append acknowledgment with no progression,
then fresh child answer and fresh tutor confirmation leading to the normal next
render. Additional tests cover late text, new speech, Stop/disconnect, output
activity, per-visit bounds and send failure. The earlier semantic-abstention replay
still holds without granting completion, but now verifies a bounded repetition request.

This fixes the absence of a bounded conversational recovery request. Real-provider
delivery and response remain unverified. The existing strict butterfly test does
not answer a recovery prompt; it can still fail its automatic-completion assertion
while the new conversational recovery behaves correctly. Do not report that test
as passing or convert a recovery request into completion evidence. A live
conversational recovery check must supply a fresh child answer only after a fresh
heard tutor clarification, and validate current classification and render authority.

The live harness now offers that separate check with
`SPROUT_BUTTERFLY_REPLY_TO_RECOVERY=1`. It waits for a current production recovery
request plus fresh heard repetition wording and settled tutor audio, then plays
one fresh `answer-three`. It uses the normal completion checks without the
discarded-candidate prior-answer allowance. Summaries label the recovery mode;
default automatic-completion expectations remain unchanged. See the live guide
for the single-case command. The agent made no billed calls.

## Fourth attempt: current text, semantic abstention

Runtime `6a14ccb2-2818-4373-b3c1-610f09ff701a` supplied a fresh filler transcript
“Ah”. There was no missing-text block. Current classification selected completed
at probability 0.87 and confirmed completion at 0.78, below the unchanged 0.9
gate. No missing-text recovery was eligible and no fresh learner response played.

The recovery policy now also handles canonical semantic holds for the exact
current runtime/visit/turn/revision. It shares the same once-per-visit budget with
missing-text recovery. Newer revisions cancel pending semantic recovery; only a
fresh held response can rearm it. The request asks for new child evidence and
grants no progression. Current positive proposals, stale responses and network
errors do not arm this path. The opt-in harness listens to `answer_recovery.requested`
for either cause and still requires a fresh heard prompt before answering.

Validation after this extension: 816 unit tests, typecheck and lint passed. No
agent live provider run was performed; actual provider recovery remains pending.
