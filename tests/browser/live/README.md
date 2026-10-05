# Reactive live lesson harness

Fourteen opt-in tests use `/`, the synthetic microphone `MediaStream`, app-owned
VAD, GPT-Live transcription, canonical `conversation-state-v2`, reducer and React
scene. Live cases contain no route mocks, transcript injection, test-time TTS,
child recordings or additional models. Normal `npm run test:browser` excludes the
entire directory and starts its server with empty provider credential overrides.

| Selection                           | Behavior and assertion                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@baseline @happy-path`             | All three authored answers; exactly one completion per scene and terminal lesson completion.                                                                                                                   |
| `@baseline @incorrect-then-correct` | Three ducks on the two-duck node; non-completion decision and three-second hold; fresh two-duck answer recovers.                                                                                               |
| `@baseline @self-correction`        | Continuous “Three. Uh, I mean two.”; authority must include the settled correction.                                                                                                                            |
| `@support @help`                    | Help request, classified tutor scaffold, three-second hold, fresh learner answer and full completion.                                                                                                          |
| `@support @incomplete`              | Partial count, tutor response and hold, then fresh learner total.                                                                                                                                              |
| `@support @ambiguous`               | Explicit undecided two-or-three response holds; fresh total recovers.                                                                                                                                          |
| `@support @off-topic`               | Toy response holds; fresh authored answer recovers.                                                                                                                                                            |
| `@support @silence`                 | Five seconds of connected silence without child authority; fresh answer recovers.                                                                                                                              |
| `@support @stop`                    | Parent Stop authority ends the session and prevents progression for three seconds. Spoken `requestStop()` alone grants no authority.                                                                           |
| `@butterfly @barge-in-output`       | Hesitant correct three; genuine “Wait! I want to say something.” during post-answer tutor output. Requires VAD confirmation, invalidated earlier authority, current heard words and fresh semantic held state. |
| `@butterfly @noise-output`          | Same answer; 40 ms seeded noise during post-answer output.                                                                                                                                                     |
| `@butterfly @noise-confirmation`    | Noise after heard confirmation, while current tutor stabilization is scheduled and output is quiet.                                                                                                            |
| `@butterfly @filler-confirmation`   | Short voiced “Uh.” in that confirmation/stabilization window.                                                                                                                                                  |
| `@butterfly @filler-classifier`     | “Uh.” after heard confirmation, with a current tutor classifier request still in flight.                                                                                                                       |

Butterfly cases first complete the one- and two-duck visits using existing ready
and completion gates. They then play “Uh, I think, uh, there are three butterflies.” on
`count-3-butterflies`. Tags `@noise`, `@filler`, `@barge-in`, `@during-output`,
`@confirmation-quiet` and `@classifier-in-flight` select compact subsets. There is
one attempt per case, rather than a cross-product of timings.

## Commands and cost

Supply `OPENAI_API_KEY` and `TYPESAFE_API_KEY` through your secure invoking
environment. The config checks names without loading credential files. Every
execution command below can incur **GPT-Live and Jev charges**. Each case opens
one session and can issue multiple classifier requests; failure still costs
money. One worker, zero retries, 120 seconds per test and 600 seconds overall
bound execution. Prefer one case. The overall limit can interrupt a full suite.
Port 3100 must be available; the config refuses to reuse a running server.

```bash
npm run test:browser:live -- scenarios.spec.ts --grep '@happy-path'
npm run test:browser:live -- --grep '@baseline'
npm run test:browser:live -- support.spec.ts --grep '@help'
npm run test:browser:live -- support.spec.ts --grep '@incomplete|@ambiguous'

# Strict product regression: noise/filler must complete safely.
npm run test:browser:live -- butterfly.spec.ts --grep '@filler-classifier'
npm run test:browser:live -- butterfly.spec.ts --grep '@noise-confirmation'
npm run test:browser:live -- butterfly.spec.ts --grep '@barge-in-output'
npm run test:browser:live -- butterfly.spec.ts --grep '@noise|@filler'

# Reproduction/evidence only; a passing probe never proves starvation recovered.
SPROUT_BUTTERFLY_OBSERVE_ONLY=1 npm run test:browser:live -- butterfly.spec.ts --grep '@filler-classifier'
```

Discovery alone needs nonempty strings, never valid credentials:

```bash
OPENAI_API_KEY=discovery-only TYPESAFE_API_KEY=discovery-only npm run test:browser:live -- --list
OPENAI_API_KEY=discovery-only TYPESAFE_API_KEY=discovery-only npm run test:browser:live -- butterfly.spec.ts --grep '@filler-classifier' --list
npm run test:browser -- --list
npm run test:browser -- tests/browser/live/butterfly.spec.ts --list
```

The first lists 14 tests; the second lists one. The final command must find no
tests and exit 1. **Never remove `--list` when using synthetic credentials.**

## Timing and evidence

Butterfly setup allows one fresh repetition of the authored correct answer per
duck prerequisite when a current, uncancelled canonical classifier abstains on
semantic scores despite choosing completed and confirmed completion. It requires
the correct total in current learner speech and a settled tutor response. The
abstention and scores are recorded in the harness journal; the repetition must
earn new classifier authority and normal rendering. Provider errors, incorrect
answers and semantic holds cannot trigger it. A second abstention fails setup.
This can add up to two learner utterances and their provider requests per case;
baseline scenarios retain their original assertions. Summaries distinguish a
prerequisite failure from an injection failure, retaining the last scores and
transcript when no target audio played.

`ready()` requires exact rendered identity, matching steering acknowledgment and
visit boundary, a stable tutor transcript and sustained output quiet. PCM quiet
alone is not semantic completion. Butterfly speech is checksum-verified and
predecoded before the answer. A browser polling check reads the current journal
and runtime, checks visit/turn/revision/output plus current work, then starts
preloaded audio synchronously in the same browser task. It rejects old active
output, expired/cancelled stabilization and completed/cancelled classifier calls.
No lesson-wide delay determines injection. Checks also reject overlapping audio.

`injectionLanded` records the actual attempt-clock interval surrounding
`AudioBufferSourceNode.start()`, playback duration, current and after-start state,
trigger, cursor, answer transcript and output/confirmation evidence. Assertions
reconstruct the window from the full journal and require timely app-owned VAD
onset; during-output onset must still have active output. This proves browser
scheduling and app detection, not sample-exact remote recognition timing.

Window checks require three in current learner speech; ASR need not retain the
authored hesitation words. Late windows additionally require tutor affirmation
followed by three. Speaker fragments are joined across interleaved transcript
lines, excluding speech before the answer checkpoint and from older turns. This
wording-specific check selects the regression window; canonical classifier
scores alone grant semantic authority. Providers
may phrase confirmation differently or return too quickly to hit an in-flight
window. Such cases fail as missed-window evidence, never as successful injections.

Both probes and strict regressions enforce safety. Cancelled/stale classifier
identity cannot supply authority; completion requires the unchanged existing
full lesson replay, exact render tokens/order, relevant tutor acknowledgment and
output, current learner turn/revision and one final completion. Genuine barge-in
must invalidate prior answer and acknowledgment at confirmation and cannot reuse
that answer for recovery. It ends in an explicit fresh semantic held state.
A discarded noise/filler candidate may preserve the earlier confirmed answer's
transcript and output eligibility. The completion assertion accepts that path
only after replaying the exact candidate-start/discard reducer states, proving
no intervening confirmed speech/child transcript, and requiring a new classifier
request/result with the current turn/revision. Old semantic authority is never
restored. Confirmed speech cannot use this candidate allowance; genuine barge-in
cannot use it at all. Noise/filler strict regressions additionally demand terminal completion within
eight seconds after injection start. Probes can retain a live held or bounded
starvation outcome; `recoveryVerified` is true only after full safe completion.
Eight seconds without a decision is reported as **bounded starvation or pending**,
not proof of permanent starvation. Provider errors/missing diagnostics fail safety.

Every attempt writes the existing `attempt-…-report.json`, `…-harness.json` and
`…-timeline.txt` under `test-results/playwright-live/<test-output>/`, before cleanup
Stop and microphone disposal. Playwright attaches these plus `butterfly-summary.json`
and readable `butterfly-summary.txt`. The summary identifies injected bytes/noise,
what VAD/transcription heard, normalized objective/tutor scores and confidences,
mapped outcome/reasons/latency and node/revision identities, cancelled/blocked/
rescheduled/reevaluated work and the final state. Full production records remain
unchanged. A missed trigger or assertion retains failure evidence; outer browser
termination can still leave incomplete artifacts.

## Fixtures, validation and limitations

`tests/fixtures/speech/manifest.json` records exact text, SHA-256, format, duration
and per-fixture offline commands. `hesitant-three.wav` uses a full hesitant counting sentence at 130 words/minute;
`barge-in.wav` uses 150 words/minute. Both use macOS Albert, FFmpeg loudness
normalization and mono 24 kHz signed 16-bit PCM. Existing answer/correction/support fixtures retain their individual
provenance. Tests use committed bytes, never invoke synthesis. Noise uses seed
30, amplitude 0.2 and duration 40 ms through the same microphone destination;
seed/options/sample-rate determine samples. Synthetic adult TTS does not represent
preschool speech or acoustic room/device conditions. Samples are deterministic;
provider wording, transcript fragmentation and browser timing are not.

The historical real butterfly failure included a correct tentative answer,
tutor confirmation, child “uh”, cancellation with `child_turn_started` and no
completion before parent Stop. No VAD/cancellation fix is included here. These
new reproduction and strict recovery cases have **not been provider-validated**;
a starved run stays a failing strict regression outside `@baseline`.

The commit-6 handoff reports saved help and self-correction completion, with help
completion evidence replay passing. Those prior live runs were not rerun in this
slice. Clean revised happy-path, incorrect-then-correct and remaining support
cases remain unconfirmed. No provider calls were authorized or made by the agent for commit 7. A subsequent
user-run filler-confirmation attempt confirmed VAD and tutor confirmation but
supplied no child transcript, so classification was blocked and no filler was
injected. The revised full-sentence hesitant fixture and specific timeout diagnosis
are offline-validated; provider recognition and window entry remain pending.
Offline tests validate the harness and assertions, not provider success. See
[issue 30 acceptance mapping](../../../docs/issue-30-harness-acceptance.md) for the
implementation boundary and remaining validation. The issue stays open.

## Learner wire diagnostics and voice comparison

All attempt artifacts now include bounded pre-parser WebRTC wire metadata in
`harness.json` and `timeline.txt`, with independent parser, runtime rejection and
learner snapshot counts. Albert remains the default hesitant answer;
`SPROUT_BUTTERFLY_ANSWER_VOICE=Samantha` selects a matched-text offline fixture.
See [transcript diagnostics and controlled comparison](../../../docs/transcript-wire-comparison.md)
for limits, checksums, interpretation, discovery commands and separate-output
single-case execution commands. Live comparison remains pending explicit authorization.


Attempt artifacts also retain fragment-to-journal correlation, real fixture
playback boundaries and bounded outgoing audio RTP counters. Unique attempt/runtime
copies are indexed under `.sprout-evidence/`, outside Playwright output cleanup.
Admission is bounded to 100 attempts / 8 MiB each, with no automatic pruning.
See [retention and interpretation limits](../../../docs/transcript-wire-comparison.md)
before comparing live runs; transmission does not establish provider recognition.
