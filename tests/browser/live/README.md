# Deliberate provider-backed lesson scenarios

These three tests use `/`, the real synthetic-microphone `MediaStream`, app-owned
VAD, GPT-Live transcript transport, canonical `conversation-state-v2`, production
reducer and React scene. There are no route mocks, supplied transcripts, injected
classifier results, test-time TTS, or additional AI models in the live suite.
Only the explicit `lesson-live` config selects them. One worker, zero retries,
120 seconds per test and 600 seconds overall keep the baseline bounded.
Observation waits fail before the outer timeout with 20 seconds reserved for
artifact collection and cleanup. Browser termination can still leave incomplete
evidence, which the existing companion artifact explicitly records.

| Tag | Child behavior | Scope |
| --- | --- | --- |
| `@happy-path` | “I see one duck.”; “I see two ducks.”; “I see three butterflies.” | All three nodes and final completion |
| `@incorrect-then-correct` | One-duck sentence; three-duck sentence on two ducks; two-duck sentence; three-butterfly sentence | Wrong answer on two ducks, three-second hold after a non-completion decision, recovery, final completion |
| `@self-correction` | One-duck sentence; “Three. Uh, I mean two.”; three-butterfly sentence | Single continuous correction fixture on two ducks, final completion |

All have `@baseline`; each test runs one attempt. Use the existing secure setup
to supply server-only `OPENAI_API_KEY` and `TYPESAFE_API_KEY` in the invoking
environment. The config checks names without loading credential files. These
commands can make **billed GPT-Live and Jev calls**; no such runs were made while
preparing this slice:

```bash
npm run test:browser:live -- scenarios.spec.ts --grep '@happy-path'
npm run test:browser:live -- scenarios.spec.ts --grep '@incorrect-then-correct'
npm run test:browser:live -- scenarios.spec.ts --grep '@self-correction'
npm run test:browser:live -- --grep '@baseline'
```

Pricing, transcript fragmentation and classifier latency vary; there is no
fixed dollar estimate. Each scenario opens one GPT-Live session and may issue
multiple Jev requests per node as transcripts settle. Failures still cost money;
there are no automatic retries. A local server must be able to start on port 3100.

For discovery **only**, synthetic nonempty configuration strings are safe:

```bash
OPENAI_API_KEY=discovery-only TYPESAFE_API_KEY=discovery-only npm run test:browser:live -- --list
npm run test:browser -- --list
npm run test:browser -- tests/browser/live/scenarios.spec.ts --list
```

The first command must list exactly three live tests; the last must report no
tests (exit 1). Never remove `--list` from a command with synthetic credentials.
Offline assertions run with `npm test` and include adversarial report mutations.
They validate scenario logic, **not** live provider behavior.

## Observation and assertions

Child actions wait for exact observed render identity, matching steering
acknowledgment and visit boundary, tutor transcript settlement and sustained
output quiet using production timing constants. These are physical/readiness
signals; PCM quiet is never called semantic turn completion. No exact tutor
wording is required. Fresh cursors are captured before speech so events arriving
during playback remain observable. The wrong-answer hold monitors state and the
full journal, not just a final screenshot. It starts at the pre-speech checkpoint
and continues at least three seconds after a canonical hold or semantic abstention.
Only then, after the tutor response settles, is the correct fixture sent.

`evidence.ts` requires exactly three success transitions in authored visit order.
Each must have a fresh request/result/mapping identity matching the runtime's
node, visit, child turn and revision, canonical normalized scores, an accepted
production proposal, child/tutor transcript evidence, confirmed VAD start/end,
a post-answer tutor output onset, and the production quiet drain. It replays the
recorded transition trigger through the unchanged production reducer. Every
requested render must be confirmed with its exact token/node/scene before the
next steering append; completion requires the final null scene, completion
effect and `lesson_completed` end reason. Self-correction additionally forbids
any success authority on the two-duck visit unless the request already includes
the heard three → “I mean” → two correction. This text check establishes what was
heard; production classification still supplies all semantic authority.

The browser resource inventory subclasses native constructors to retain local
references without changing their behavior. Completion checks stopped app capture,
closed peer connections and app audio contexts, and detached audio. The synthetic
destination remains alive until reports are collected, then is disposed too.
Every attempt retains the existing production `report.json`, companion
`harness.json` and chronological `timeline.txt` before cleanup; resource teardown
is attached separately. Failures within the scenario are recorded by `run()`.

## Startup silence regression

The first user-run happy path connected to GPT-Live but ended on the production
steering-acknowledgment timeout before any child speech. A provider-free local
WebRTC reproduction confirmed that the idle synthetic destination exposed a live
track while sending zero audio packets. The helper now keeps a zero-valued
`ConstantSourceNode` connected so real silent frames advance the audio clock
before speech and after cancellation. Disposal stops this source too. The new
local-peer regression failed before the fix and passes afterward; existing VAD
and teardown tests still apply. This is a microphone harness fix; production
gates, event parsing and timeouts remain unchanged.

GPT-Live's [session guidance](https://developers.openai.com/api/docs/guides/live-conversations)
requires continuous audio during startup, including silence, and explains that
append acknowledgments can remain pending if the timeline stops. The connection
between the reproduced stall and the user's timeout is strongly supported by
that contract; the patched live run still needs validation.

The next user-run happy path received a matching append acknowledgment and
visit boundary, confirming the silence fix unblocked the timeline. It then
remained live with quiet output and no tutor transcript. The initial session
requires an application start instruction; initial steering now explicitly
identifies the parent's Start action and asks GPT-Live to speak first immediately.
This is a production startup-prompt candidate, requested during diagnosis after
the original scenario slice. It is sent only for the initial render; later node
steering remains unchanged. Offline tests verify that it is sent once after
render and that acknowledgment alone cannot satisfy tutor readiness or authorize
progression. The subsequent user run received the first counting question, confirming initial
speech now occurs. It still failed to advance: local VAD confirmed the 0.384-second
Albert “One” clip, but no child transcript arrived and the classifier recorded
`missing_current_turn_child_transcript`. The requested second render never occurred.

A provider-free local peer now verifies decoded incoming speech energy for each
answer fixture after the production input fence opens, and silence before it.
An active receiver playback sink is necessary for Chromium's decoded audio energy
statistics; zero energy from an unconsumed receiver is not evidence of missing RTP.
The live scenarios now use longer natural-voice counting sentences as a recognition
candidate, keeping the original short primitives for transport coverage. A separate
wait for the observed current-turn child transcript reports this failure directly
before waiting for the next render. This does not supply a transcript or loosen any
production gate. Recognition and full-lesson completion still need live validation.

## Fixtures and limits

`answer-one`, `answer-two`, and `answer-three` contain “I see one duck.”,
“I see two ducks.”, and “I see three butterflies.” in the offline Samantha voice at
130 words/minute (about 1.3–1.8 seconds each). `self-correction.wav` uses that
same voice for “Three. Uh, I mean two.” (about 2.3 seconds). The original short
Albert primitives remain unchanged. `tests/fixtures/speech/manifest.json`
records exact text, command arguments, tool versions, duration and SHA-256.
Committed bytes are verified before browser decoding. Execution needs neither
macOS speech synthesis nor FFmpeg. No child recordings or remote speech
generation are used.

Synthetic adult speech is not preschool speech, acoustic/device coverage or a
promise of recognition reliability. A provider may fragment the correction into
multiple VAD turns or omit words; the test then fails with evidence rather than
supplying the expected transcript or relaxing gates. A stalled tutor, ambiguous
classifier, lost steering acknowledgment or starvation may fail current product
behavior. VAD/cancellation, thresholds, reducer and classifier-switching
policy remain unchanged. The explicit initial start directive is the only
production prompting change in the follow-up diagnosis. Help, silence, noise, barge-in and broad curriculum
scenarios remain outside this slice.

Authorized targeted live runs of **all three scenarios remain pending**. Review
these changes and choose one command above first; offline green checks cannot
establish that a provider-backed complete lesson passes.

The next user run advanced through the first two scenes but waited indefinitely
on the final scene. Its heard answer was “I see three ducks” while the scene
showed butterflies; the tutor requested clarification. This was a fixture mapping
error introduced in the sentence update. The final fixture now says “I see three
butterflies.” A separate three-duck fixture remains for the deliberately wrong
answer on two ducks. An offline regression checks the exact scene-to-fixture
texts and distinct fixture hashes. Full completion remains unverified.

The following user run completed all three production transitions and ended with
`lesson_completed`. Its final evidence assertion falsely failed because it inspected
only the last child transcript line. Provider backchannels split the two-duck
answer into “I see two” / tutor “Yes,” / child “ducks” (and similarly for butterflies).
The assertion now reads all current-turn child fragments, excludes tutor text,
and removes the earlier child-turn prefix from the cumulative visit transcript.
Regressions accept the observed fragmentation and reject answers present only in
tutor speech or an older child turn. Replaying this saved completed live report
passes the repaired production-evidence assertions without another provider call.
The full Playwright happy path still needs a clean run of the repaired assertions;
the incorrect-answer and self-correction scenarios remain unverified live.

The first incorrect-then-correct user run heard “I see three ducks” on two ducks
and safely remained on the scene while the tutor offered counting help. The
classifier abstained with valid scores (`objectiveState_no_winner`,
`unresolved_help` probability 0.75), rather than emitting the test's expected
`classifier.held` / incorrect verdict. The scenario now accepts a canonical hold
or semantic score-based abstention with no completion eligibility and a
non-completed objective choice. Provider errors, absent scores, missing heard
wrong-answer evidence and success authority still fail. The three-second full
journal hold and later correct-answer completion requirements remain intact.
Saved-report replay validates the observed abstention and hold; live recovery
with the updated scenario remains pending.
