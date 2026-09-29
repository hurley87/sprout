# Response-gate latency baseline

Measurement slice for [issue #36](https://github.com/hurley87/sprout/issues/36),
following the [250 ms stabilization experiment](answer-stabilization-experiment.md).
This commit documents the baseline and an architecture recommendation. It changes
no production policy, provider command, prompt, or harness assertion.

## Finding and decision

The fresh baseline reproduced an **ADVANCE response held for 9,054 ms after
deterministic commit**. Seventeen Sprout fragments generated behind the muted
output gate repeatedly extended `outputQuietAt`. The last fragment was followed
by a 2,500 ms transcript-quiet wait and 1 ms of callback delay. Scene display was
already complete; evaluation, display and child activity do not explain this hold.

The next change should distinguish **actual output media activity** from caption
grouping, and supersede old scene context while playback remains blocked. Do not
simply shorten `UTTERANCE_GAP_MS`, treat an instruction acknowledgment as safe
playback, or invent a GPT-Live response-completion/cancellation event. The
transport currently lacks the output activity and stale-media recovery signals
needed to qualify an event-driven release policy. Establish those in commit 3's
deterministic/browser tests before changing when playback is permitted.

The goal is a release rule based on application-controlled media state with
bounded recovery. Whether it can safely remove the entire hidden-generation
period, rather than only the final transcript-quiet tail, remains unproved.

## Configuration and evidence

Executed on 2026-09-28 against a clean checkout at
`db01d46fac023e803f3f95deb46765efd03eb420`, parent
`3b7b9974cfe3f7d09d614ef0127d93039477d9ca`, on
`codex/response-gate-latency`. The existing Next 16.3.5 dev process served
`http://127.0.0.1:3000` from this checkout and had started after both commits.
The harness launched Chromium **153.0.8010.12** and used macOS synthesized speech
through the real browser microphone, GPT-Live and Jev paths.

- Voice model: `gpt-live-1`; prompt: `counting-jev-4`; voice: `marin`.
- Evaluator: `jev-1.13.0`; correction policy: **250 ms**.
- Transcript utterance gap and current gate quiet interval: **2,500 ms**.
- Real services were billed; no new configuration or credentials were required.
- The source SHA and process establish checkout provenance, not an independently
  embedded browser bundle hash. No code changed during the live runs.

Commands, executed sequentially in fresh directories:

```sh
LIVE_OUT=test-results/issue-36-baseline-db01d46-20260928 npm run test:live:reactive happy-path continuation corrected-to-wrong
LIVE_OUT=test-results/issue-36-baseline-continuation-retry-db01d46-20260928 npm run test:live:reactive continuation
```

| Run                | Started at (UTC, harness) | Outcome and observed coverage                                                                                                                                                                                                                     |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path         | 19:34:49.804              | Passed all three correct answers and exactly-once scene advances; second answer had the long quiet hold.                                                                                                                                          |
| Continuation       | 19:35:50.636              | Passed the pre-commit branch; only “And two” was transcribed/evaluated, STAY on scene 0. Initial “One!” playback produced no child transcript. This does not validate a two-transcript continuation.                                              |
| Corrected-to-wrong | 19:36:22.672              | Passed the post-commit new-turn branch: “One” advanced scene 0, then “No Two” produced STAY on scene 1. No retroactive rollback is expected.                                                                                                      |
| Continuation retry | 19:37:46.857              | Failed the tutor-turn observer wait after both “One” and “And two” reached Jev and advanced scenes 0 and 1. Raw transcripts were observed after the second release. Retained as diagnostic evidence; excluded from successful-scenario summaries. |

Every attempt ended through parent cleanup, with application `parent_stop`.
Artifacts remain local under the two ignored `test-results/` directories above:
`diagnostics.json`, `log.json`, `timeline.txt`, and retry `failure.txt`. Preserve
these exports; the Convex durable session record does not contain the detailed
gate observations/deadline updates or all raw transcript fragments.

Diagnostic file SHA-256 values pin the evidence used in the tables:

| Directory / scenario              | `diagnostics.json` SHA-256                                         |
| --------------------------------- | ------------------------------------------------------------------ |
| Baseline / happy-path             | `aa4f017787ebac45b300bde12a2308d90d59b19b6896e9180b46bada3c24ab68` |
| Baseline / continuation           | `e5d7e02f215bb39c31b1d63fcb8ce7afbfc87cc4f275989241f39ed3a2f939ee` |
| Baseline / corrected-to-wrong     | `8d2df76f9d5b8268fc54ef7bd622b1a1d69cb669705bdd439b10731811aff69d` |
| Continuation retry / continuation | `124336448e046bac25032f62622512fca282ec28dfc2e68410fee699c3dc0da1` |

## Clocks and interpretation

The following tables use **application milliseconds since attempt creation**,
from `diagnostics.events[].at`. Exported application deadlines/context-send times
use that same origin. The harness `log[].at` uses a different browser-arrival
origin; provider `start_ms`/`end_ms` and context-injection intervals use the
provider session timeline. Compare provider intervals only with provider
intervals. Do not subtract either clock from application time.

`answerTimelines` correlates scene, transcript revision and answer version.
Condition intervals can overlap: microphone activity can occur during evaluation,
and display can occur during output quiet. Their durations are not additive.
Eligibility is the first **observation** with known release blockers cleared,
not proof of the earliest physical instant that playback could have opened.
The separate scheduled deadline is not observed eligibility.

“First observed” means the first Sprout transcript fragment after release in
the application event stream, bounded by the next answer. It does not prove
which command caused that fragment, provider generation onset, audible onset,
or acoustic turn-taking safety. BrowserTransport has no trustworthy delivery
attribution for transcript intervals; permitted playback is not delivery proof.

## Per-answer application baseline

Only the three successful scenarios are included below. `—` means no scene
change. All ADVANCE rows release after commit and confirmed scene display.
STAY releases the existing scene instruction without a commit.

| Run / scene / revision / answer version | Decision | Final transcript | Evaluation requested → complete | Commit → display | Observed eligibility → release | First observed Sprout fragment |
| --------------------------------------- | -------- | ---------------: | ------------------------------- | ---------------- | ------------------------------ | -----------------------------: |
| Happy / 0 / 1 / `13600:One`             | ADVANCE  |           15,600 | 16,007 → 16,282                 | 16,283 → 16,322  | 16,322 → 16,322                |                         16,656 |
| Happy / 1 / 2 / `26200:Two`             | ADVANCE  |           27,989 | 28,323 → 28,548                 | 28,548 → 28,572  | 37,602 → 37,602                |                         39,097 |
| Happy / 2 / 3 / `49000:Three`           | ADVANCE  |           49,249 | 49,501 → 49,797                 | 49,798 → 49,835  | 49,835 → 49,835                |                         49,949 |
| Continuation / 0 / 2 / `15800:And two`  | STAY     |           17,969 | 18,349 → 18,601                 | —                | 18,601 → 18,603                |                         19,858 |
| Corrected / 0 / 1 / `13000:One`         | ADVANCE  |           12,909 | 13,162 → 13,372                 | 13,373 → 13,397  | 13,397 → 13,397                |                         13,520 |
| Corrected / 1 / 3 / `16800:No Two`      | STAY     |           17,301 | 17,553 → 17,830                 | —                | 17,831 → 17,831                |                         18,510 |

| Answer               | Transcript → evaluation | Evaluation → response release | Release → first observed fragment | Transcript → first observed fragment | Release reason            |
| -------------------- | ----------------------: | ----------------------------: | --------------------------------: | -----------------------------------: | ------------------------- |
| Happy One            |                     682 |                            40 |                               334 |                                1,056 | `scene_displayed`         |
| Happy Two            |                     559 |                     **9,054** |                             1,495 |                           **11,108** | `output_transcript_quiet` |
| Happy Three          |                     548 |                            38 |                               114 |                                  700 | `scene_displayed`         |
| Continuation And two |                     632 |                             2 |                             1,255 |                                1,889 | `correction_window`       |
| Corrected One        |                     463 |                            25 |                               123 |                                  611 | `scene_displayed`         |
| Corrected No Two     |                     529 |                             1 |                               679 |                                1,209 | `correction_window`       |

The two non-stalled happy answers have release-to-first-fragment times of
114–334 ms. This is **not** evidence of faster answer delivery than issue #34's
985 ms happy-path mean: these first fragments are backchannels before the new
instruction's acknowledged provider injection interval. The happy Two row is
a reproduced stall and must not be pooled as ordinary happy-path latency.
No optimization or controlled before/after latency comparison was performed.

## Why the 9-second hold occurred

Happy Two's gate started at **27,990 ms**. The first blocked fragment arrived at
**28,517 ms**, setting a deadline of **31,017 ms**, before evaluation completed.
ADVANCE committed at **28,548 ms** and displayed at **28,572 ms**. Thereafter,
only the output-quiet condition remained in the observed gate snapshots.

Seventeen deadline updates correspond to this blocked generated text:

> Mm-hm. Hooray! You counted them. Let's look at the ducks again. How many can you count?

This is synthetic-session provider text, not verified delivered speech. It
acknowledges success before receiving the outcome instruction and references
ducks while the application has displayed butterflies. The output gate remained blocked; the
transcript does not show that this stale speech was audible.

| Milestone                                        | Application time (ms) | Interpretation                                         |
| ------------------------------------------------ | --------------------: | ------------------------------------------------------ |
| First blocked output                             |                28,517 | Begins observed output-quiet condition.                |
| Commit / display                                 |       28,548 / 28,572 | Ready scene; context instruction is still withheld.    |
| Last blocked output                              |                35,101 | Deadline update sets `outputQuietAt` to 37,601.        |
| Scheduled quiet deadline                         |                37,601 | 2,500 ms after the last deadline-update event.         |
| Observed eligibility / context sent / release    |                37,602 | All conditions clear; 1 ms after deadline.             |
| Matching instruction acknowledgment (`sprout_5`) |                38,131 | Acceptance/injection evidence, not a playback barrier. |
| First post-release fragment                      |                39,097 | “You did”; provider interval 38,400–38,600 ms.         |

Display-to-release is **9,030 ms**: 6,529 ms from display to the last blocked
fragment, then 2,500 ms of quiet policy and 1 ms of callback delay. Measured
output-quiet condition duration is **9,084 ms**, starting before commit;
it overlaps evaluation and the 24 ms scene-display interval. Total observed
gate blocking is **9,612 ms**, including the earlier answer-evaluation hold.

The behavior is directly reproduced by `heard()` assigning
`Date.now() + UTTERANCE_GAP_MS` to every gated Sprout fragment and rescheduling
displayed release. It is not just the harness's 2.5-second tutor-turn grouping:
the production diagnostics show the gate's deadline updates and muted playback
throughout. Continuous provider output without a sufficiently long quiet gap can
keep extending this hold; an output-specific bounded recovery policy is absent.
The session lifecycle still has a hard end.

The earlier stabilization artifacts independently showed the same mechanism:
continuation had 4,445 ms commit-to-release with a 2,501 ms final quiet tail;
corrected-to-wrong had 5,089 ms evaluation-to-release with a 2,502 ms tail. The
new baseline confirms that the mechanism can also affect a normal correct
answer. Fresh STAY rows had no blocked output; they do not establish STAY's
frequency or worst case. UNAVAILABLE was not exercised live in this slice.

## What remains after release

For all six successful-scenario decisions, context send and release share an
application millisecond. Matching `session.instructions.appended` events arrive
**398–597 ms later**. That interval includes transport, provider context injection
and observation; it cannot be separated into those components with this harness.
Observed eligibility-to-release is **0–2 ms**.

Three first-fragment observations precede their matching instruction
acknowledgment and refer to earlier provider intervals:

- Happy One: “Mhm” interval 14,600–14,800; context injection 14,800–15,000.
- Happy Three: “Mm-h” interval 49,600–49,800; context injection 50,200–50,400.
- Corrected One: “[hum” interval 13,600–13,800; context injection 14,000–14,200.

These provider intervals do not prove generation wall-clock latency. They show
why the earliest post-release transcript cannot reliably stand for the response
to the deterministic outcome. There is no voice-response ID or spoken-response
completion event to establish that causal join. Actual WebRTC playback, jitter
buffering, physical speakers and acoustic onset remain unmeasured.

## Provider capabilities checked on 2026-09-28

The source uses `/v1/live/sessions`, not the Realtime voice-response API. Raw
traffic in these runs contains transcript deltas, session start/close/usage,
instruction acknowledgments, and, in two successful runs, client delegations
that the application refused with quiet context. It contains no voice-response
completion or cancellation confirmation. Delegations were **3 / 0 / 2** in
happy/continuation/corrected respectively; their refusal acknowledgments are not
speech lifecycle events. No provider `error` event appeared in the three baseline
traffic logs.

Current official sources establish these boundaries:

- GPT-Live supplies no equivalent to Realtime's per-spoken-response
  `response.output_audio.done` / `response.done`. Backend Responses events are
  not the voice frontend's completion signal.
  [Migration guide](https://developers.openai.com/api/docs/guides/live-migration).
- Transcript delivery can be uneven; fragments have approximate intervals,
  without an item ID or completed-turn event. WebRTC audio arrives through its
  media track.
  [Session management](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas).
- `session.instructions.append` can interrupt and steer ongoing speech. Its
  matching acknowledgment reports estimated context injection, not safe playback
  recovery. Output muting/dropping, clearing queued audio and safe resumption are
  application responsibilities. Output VAD must be implemented by the client;
  it is not supplied by GPT-Live. Audio silence alone does not establish that a
  complete answer has finished.
  [Server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live#control-playback-when-needed).

No documented command establishing cancellation of a specific frontend voice
response was found. Do not substitute Realtime `response.cancel`, microphone
muting, delegation refusal, or `session.close` for such a capability. Closing
ends the conversation; the existing app deliberately keeps its microphone and
provider media running while muting speaker output and recording gain.

## Commit 3 recommendation and review gate

Choose **application-controlled output activity/recovery**, keeping transcript
utterance grouping independent. First establish a trustworthy remote-media
activity signal and what control the existing WebRTC player actually offers over
late/buffered audio. Keep output muted while superseding context when the current
decision becomes authoritative (ADVANCE still requires committed/displayed scene;
STAY still requires the current settled answer). An instruction acknowledgment
must not, by itself, open the gate.

The smallest hypothesis to test is whether a qualified media-quiet boundary can
replace the final 2.5-second transcript-quiet tail without exposing stale audio.
Use a measured/bounded output-specific recovery rule, not a global utterance-gap
change. Early steering may also shorten hidden output, but that benefit and its
safe release boundary are separate hypotheses, not demonstrated here.

Before adopting the candidate, deterministic and browser tests must exercise
multi-fragment stale output, late/duplicate transcripts and media, paused speech
that resumes, child activity and revised STAY, scene display, failed steering,
and missing media/lifecycle signals. There must be bounded recovery without
unblocking stale speech. If BrowserTransport cannot establish that boundary,
retain the conservative gate and make the required player/media-relay change
explicit; do not claim a timer reduction preserves acoustic safety.

This baseline answers the application cause and rules out a nonexistent provider
completion event. It does not prove how much of release-to-observation is voice
generation versus transcript arrival, whether hidden media was queued locally,
or what audio the child actually heard. The failed continuation retry also shows
that transcript-derived tutor turns can miss post-release output when provider
intervals remain grouped; preserve that limitation when judging subsequent live tests.

## Validation

The three baseline live scenarios passed. The single continuation retry failed
its observer wait as described above, with its full evidence retained. No
assertion was weakened and no harness or production fix was made in this slice.

Validation on the measured checkout passed: **390 unit tests**, **15
provider-free browser tests**, lint, typecheck, production build, changed-document
Prettier and `git diff --check`. The existing Vite native-config warning remained.
No new tests are needed for this documentation-only slice; the prior diagnostics
tests and fresh live exports exercise the measured implementation.

Browser verification used the existing server on port 3000 with a temporary
Playwright config importing the repository config, retaining the same test
directory/settings and changing only `baseURL` and disabling managed server
startup. This avoided a second Next dev process competing for the checkout's
dev lock. The original port-3000 server remains running. Unit/browser checks do
not invoke billed models; only the four explicitly listed live attempts did.

## Commit 3: media investigation and bounded fallback

The direct WebRTC player cannot establish a safe response boundary. Commit 3
therefore **retains the conservative transcript-quiet release policy**. It does
not reduce the 2,500 ms tail, implement early outcome steering, or claim reduced
latency. `CORRECTION_WINDOW_MS` remains 250 ms and `UTTERANCE_GAP_MS` remains
2,500 ms. Jev, curriculum and Convex recording are unchanged.

### Transport evidence

`BrowserTransport` assigns the provider track to an `HTMLAudioElement` and keeps
it playing while blocked. Blocking changes `audio.muted` and the remote recording
gain. It does not discard a response, reset the receiver, clear the browser's
jitter/decoder buffers, or associate PCM with a deterministic answer. Disconnecting
a Web Audio source, detaching `srcObject`, or replacing an analyser would not
identify late RTP from that same provider generation. Stopping the track or closing
the peer ends reception; it does not supply a fresh response on the existing track.

The new provider-free browser fixture negotiates real local WebRTC offer/answer,
RTP and data channels, using the production transport with synthesized PCM. It
shows remote energy while the audio element is muted, a quiet pause exceeding
2,500 ms followed by resumed energy on the **same source**, and no source isolation
when the transport is unmuted. Seventeen transcript fragments and an instruction
acknowledgment do not change that source. The acknowledgment is fixture data,
not a test of provider interruption semantics. Decoding actual MediaRecorder
output confirms blocked remote PCM remains silent in the mix; a separate positive
control records permitted PCM with RMS above 0.01. Physical speaker acoustics and
provider-specific buffer delays are not measured by these tests.

The standards describe receiver jitter-buffer tuning rather than a response-aware
flush operation, and analyser data measures the current audio graph:
[WebRTC specification](https://www.w3.org/TR/webrtc/),
[Web Audio specification](https://www.w3.org/TR/webaudio/).
Provider steering can interrupt ongoing speech, but application playback recovery
remains separate:
[GPT-Live server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live#control-playback-when-needed).

### Output activity and recovery

`OutputActivityObserver` samples decoded remote PCM every 50 ms, before playback
muting and independently of the recording graph and transcript accumulator. A
separate inaudible Web Audio branch reports transitions among `active`, `quiet`
and `unavailable`; samples are not retained. Its fixed 0.005 RMS energy floor is
an observation threshold, not a speech or completion detector. Suspended contexts,
muted/ended tracks and failed reads report unavailable. Replacement and teardown
disconnect the observer and suppress late callbacks. Provider JSON cannot fabricate
these local signals.

Diagnostics include `output.media_activity`, `output_media_activity` and
`output_media_is_release_barrier: false`. No media observation reschedules or
shortens the retained transcript deadline. Quiet can mean a speech pause, and
active PCM cannot identify its response. A separate observer can fail without
changing capture or the existing release policy. Timer scheduling/background
throttling, subthreshold energy and decoded-media delay limit these observations;
they are not proof of delivered or completed speech.

A fixed **15,000 ms recovery budget** starts when an answer gate first blocks.
Fragments, duplicate media states, revised STAY answers and scene display cannot
renew it. If still blocked at expiry, the attempt ends with a retry explanation;
media stops before gate cancellation can request an unmute. It never recovers by
opening playback. This is an operational fail-stop limit, not a measured safe
silence interval or a guarantee of retry success. It bounds unresolved evaluation,
display, child-activity and output holds; browser event-loop suspension can delay
the callback. Existing successful gate releases clear it.

### Why early steering is deferred

An ADVANCE outcome could supersede context after deterministic commit **and
confirmed display**. STAY/UNAVAILABLE could supersede context only after the current
answer's correction window and child-activity arbitration settle. A revised STAY
must invalidate the earlier identity and context. Those are necessary application
conditions, but none labels the resulting PCM. Sending context at those points
while muted would change generation without giving the player a safe reopening
boundary. A failed send can stop the attempt; a missing acknowledgment can time
out; a successful acknowledgment still cannot qualify playback. Commit 3 leaves
outcome sends at the existing release points until isolation is available.

The required change is a source-level response/generation boundary plus a player
that can discard queued PCM and reject all late frames from superseded generations.
A relay with tagged, cancellable output could provide this only if the provider
supplies an authoritative generation/cancellation boundary. Tagging arbitrary
arrival times or waiting for silence at a relay cannot invent one. Alternatively,
a fresh isolated provider connection for each authoritative outcome could reject
all old-connection audio, but requires conversation reconstruction and lifecycle,
cost and timing validation. Neither is implemented here. Clearing a local player
queue alone would still admit late old-generation frames.

The retained policy is a compatibility fallback, **not a newly proved acoustic
safety barrier**: it still cannot rule out stale speech resuming after its quiet
interval. This limitation blocks claiming the requested latency optimization or
complete acoustic safety. The new code does prove fail-stop recovery does not
expose gated media and makes decoded output observable for the transport redesign.

### Commit 3 verification

Deterministic tests cover fragmented output, quiet/resumed energy, unavailable
signals, duplicate local states, revised STAY, missing evaluation/display,
child activity, failed steering, fixed-budget expiry, late tracks/play promises
and teardown. Existing correction/display/stop tests remain in place. Browser
tests exercise actual WebRTC and decoded recording PCM, plus application scene
ordering, revised STAY, failed steering and a 17-fragment recovery timeout.
No billed live experiment runs in this slice. Live latency comparison remains a
subsequent validation slice after a safe transport boundary is available.

Validation passed: **404 unit tests**, **21 provider-free browser tests**, lint,
typecheck, production build, changed-file Prettier and `git diff --check`.
The existing Vite native-config and Playwright color-environment warnings remain.
Browser verification used the existing port-3000 dev server with an ignored
`test-results/commit3-playwright.config.ts` importing the repository config and
changing only server startup, base URL and explicit directory resolution. The
port-3000 server remains running. The real transport tests serve compiled fixture
modules from the current source; application tests exercise the dev bundle.

## Commit 4: trustworthy live observation preparation

The retained continuation retry remains a historical failure. Its raw log shows
the answer's outcome instruction at browser-arrival time 18,017 ms followed by
“Nice counting!” at 19,011 ms and subsequent transcript fragments. Provider
intervals for these fragments remained within the prior grouped turn under the
unchanged 2,500 ms gap, so the harness's wait for a new tutor-turn start timed
out despite observing post-release transcript arrival. This change adds a
separate fragment-level wait that requires the current answer's evaluation
checkpoint and a following application outcome instruction. Existing provider
turn grouping and scenario scene/advance assertions remain intact.

The fragment wait means only that a transcript fragment was observed after the
answer's outcome instruction. It does not prove a new grouped turn, response
identity, that output was generated for the current answer, acoustic delivery,
or response completion. First transcript observed after release and first
decoded-media activity after release are reported as separate application-clock
observations. If decoded media was already active at release, that is recorded
explicitly rather than counted as a new transition. Missing/unavailable signals,
cancelled gates, revised answer identities and recovery-failed events remain
distinguishable in answer timelines. A 15-second recovery failure is reported
against the active scene, transcript revision and answer version.

The earlier live baseline tables and outcomes above are historical evidence and
are not rewritten by this observer change. The next targeted live validation
commands are documented in `scripts/live/REACTIVE.md`; they have not been run in
this slice. No billed scenario or live model was used. Latency optimization and
safe source isolation remain unresolved. Transcript or decoded-media activity
does not establish acoustic delivery or a safe boundary for releasing stale
output.


## Fresh targeted live validation (2026-09-28)

Executed exactly one attempt of each authorized scenario, sequentially, against
measured source SHA `dacf4dba25182a61de9ed46660332c46bde89327` (the expected parent
for the documentation results commit). The checkout was clean on
`codex/response-gate-latency` before the runs. Existing local Next dev server PID
`47041` served this checkout from
`/Users/davidhurley/Desktop/sprout`; its `next dev` process used this checkout's
`node_modules/next` and the successful diagnostics contain the response-gate and
media events from the measured source. It was already running and was reused.
The app used `http://127.0.0.1:3000`, Playwright Chromium `153.0.8010.12`, model
`gpt-live-1`, and evaluator `jev-1.13.0`. Credentials/configuration were not
changed. Scenario timestamps below are the harness start timestamps in UTC.

Commands were run one at a time, with a shared fresh ignored evidence root:

```sh
LIVE_OUT=test-results/issue-36-live-validation-20260928 npm run test:live:reactive happy-path
LIVE_OUT=test-results/issue-36-live-validation-20260928 npm run test:live:reactive continuation
LIVE_OUT=test-results/issue-36-live-validation-20260928 npm run test:live:reactive corrected-to-wrong
```

| Attempt | Harness start (UTC) | Result | Branch and verified coverage |
| --- | --- | --- | --- |
| `happy-path` | `2026-09-28T20:40:56.086Z` | Passed | Three numeric child transcripts (`1`, `2`, `3`), three Jev ADVANCE decisions, three scene transitions. First gate used `output_transcript_quiet`; the next two used `scene_displayed`. |
| `continuation` | `2026-09-28T20:41:51.667Z` | Passed | `post-commit-new-turn`: “One!” was transcribed/evaluated on scene 0 and committed to scene 1 before “And two!” playback. Both intended child utterances were transcribed; the second final transcript was “And 2” (revision 3), Jev STAY on scene 1. |
| `corrected-to-wrong` | `2026-09-28T20:42:28.547Z` | Passed | `post-commit-new-turn`: initial “One” advanced scene 0 to 1 before the delayed “No, Two” utterance. Both intended utterances were transcribed. The correction arrived as revisions 2 (“No”) and 3 (“No. Two”), was evaluated against the *current scene 1*, and Jev ADVANCE moved scene 1 to 2. This is a new-turn interpretation after commit, not a retroactive correction or rollback. |

All three attempt endings were `parent_stop` during harness cleanup; no response
gate recovery failure was recorded. These are ordinary outcomes for this measured
slice; the 2026-09-28 stalled case below is separated from them. The transcript
and harness checks establish the exercised logical branches, not acoustic delivery.

### Per-answer gate and media evidence

Times in this table are application session-relative milliseconds, read from
`diagnostics.json` and `log.json`. Evaluation requested/completed, deterministic
decision, scene commit/display, release and media state use this clock. The
harness browser-arrival clock and provider transcript interval clock have
independent origins and are deliberately not combined with it. `eligible →
release` is shown where useful; blocker durations may overlap and are not
additive. “First transcript” is the first post-release Sprout fragment observed,
not proof that the current answer caused it. Media state is the decoded-media
activity observation, not acoustic onset.

| Run / scene / revision / answer version | Final child transcript; Jev | Eval request → complete; decision | Commit → display | Eligibility → release; reason | Blocker durations; blocked union | Blocked output fragments / deadline updates | Media at release → first post-release active; first Sprout transcript |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Happy / 0 / 1 / `13000:1` | `1` @ 14,837; ADVANCE | 15,088 → 15,510; ADVANCE | 15,511 → 15,546 | 17,563 → 17,563; `output_transcript_quiet` | evaluation 673, output-quiet 2,716, scene display 35 ms (overlap); union 2,725 ms | 2 fragments; deadline 14,845 → 17,345 (+2,500), then 15,061 → 17,561 (+216) | quiet at 17,563 → active 19,413 (+1,850); first transcript 19,024 (+1,461) |
| Happy / 1 / 2 / `27800:2` | `2` @ 29,335; ADVANCE | 29,696 → 29,903; ADVANCE | 29,903 → 29,928 | 29,928 → 29,928; `scene_displayed` | evaluation 567, mic 109, scene display 25 ms (overlap); union 592 ms | 0; none | quiet at 29,928 → active 31,314 (+1,386); first transcript 31,044 (+1,116) |
| Happy / 2 / 3 / `39800:3` | `3` @ 41,203; ADVANCE | 41,528 → 41,723; ADVANCE | 41,723 → 41,761 | 41,761 → 41,761; `scene_displayed` | evaluation 520, mic 75, scene display 38 ms (overlap); union 558 ms | 0; none | quiet at 41,761 → active 42,564 (+803); first transcript 42,294 (+533) |
| Continuation / 0 / 1 / `12400:One` | `One` @ 13,629; ADVANCE | 14,015 → 14,277; ADVANCE | 14,277 → 14,314 | 14,314 → 14,314; `scene_displayed` | evaluation 648, mic 135, scene display 37 ms (overlap); union 685 ms | 0; none | quiet at 14,314 → active 15,583 (+1,269); first transcript 15,322 (+1,008) |
| Continuation / 1 / 3 / `15600:And 2` | `And 2` @ 16,990; STAY | 17,314 → 17,474; STAY | — | 17,474 → 17,475; `correction_window` | evaluation 484, mic 73 ms (overlap); union 485 ms | 0; none | quiet at 17,475 → active 18,983 (+1,508); first transcript 18,652 (+1,177) |
| Corrected / 0 / 1 / `13400:One` | `One` @ 14,861; ADVANCE | 15,197 → 15,866; ADVANCE | 15,867 → 15,896 | 15,896 → 15,896; `scene_displayed` | evaluation 1,004, mic 84, commit 1, display 29 ms (overlap); union 1,034 ms | 0; none | quiet at 15,896 → active 16,703 (+807); first transcript 16,385 (+489) |
| Corrected / 1 / 3 / `18400:No. Two` | `No. Two` @ 19,699; ADVANCE | 19,980 → 20,204; ADVANCE | 20,205 → 20,246 | 20,246 → 20,246; `scene_displayed` | evaluation 505, mic 30, commit 1, display 41 ms (overlap); union 547 ms | 0; none | quiet at 20,246 → active 20,901 (+655); first transcript 20,576 (+330) |

Each release had zero eligibility-to-release delay except the continuation STAY,
which released 1 ms after eligibility. Happy scene 0's observed eligibility and
release were both 17,563 ms, 2 ms after its scheduled quiet deadline of 17,561 ms.
At release, all seven answer gates reported decoded
media **quiet**; each had a later active transition as listed. No case was already
active at release. The application observed no `responseGateRecoveryFailed`
event. For all seven answer gates, provider output completion and acoustic onset
remain unobserved. Media transitions have no answer identity; activity following
release cannot be joined to the current answer or taken as delivered speech.

The only fresh blocked generated output was on happy scene 0: two transcript
fragments extended the transcript-quiet deadline. The 2,725 ms blocked union
includes a 2,716 ms `output_transcript_quiet` interval that overlapped the
673 ms answer-evaluation interval and 35 ms scene-display interval. The other six
answer gates had no blocked provider output fragments or output-quiet deadlines;
their blocker unions were 485–1,034 ms. These ordinary runs did not exercise the
fixed 15-second fail-stop recovery path.

### Historical comparison and interpretation

The historical `db01d46` happy-path baseline held its second answer from
28,548 ms evaluation completion to 37,602 ms release: **9,054 ms**, with
transcript-quiet as the release reason. The fresh happy-path's only output-quiet
release was its first answer: evaluation completed at 15,510 ms and it released
at 17,563 ms (**2,053 ms** later), after two blocked fragments and a 2,500 ms
quiet deadline. These are different answer positions and different observed
branches; this comparison does not estimate an improvement or show that the
retained release policy reduced latency. The remaining fresh happy answers
released at scene display, 25 ms and 38 ms after evaluation completion,
respectively. The historical
9,054 ms stalled answer remains the relevant ordinary-case regression target.

The historical continuation baseline transcribed only “And two” and did not
transcribe/evaluate its initial “One!”; a later retry failed its grouped tutor-turn
observer after both “One” and “And two” had been transcribed and evaluated. Both
that retry and fresh continuation exercised `post-commit-new-turn`, with scene 1
displayed before second-utterance playback. The retry advanced scenes 0 and 1;
the fresh run confirmed both transcripts but produced STAY on the second/current
scene. The fresh run therefore provides evidence for the same logical branch,
with a different decision outcome; it is not a matched reproduction of the
retry's grouped-turn observer failure. Neither run exercised pre-commit
continuation.

The historical corrected-to-wrong baseline exercised a post-commit new turn and
ended STAY on scene 1 for “No Two”. Fresh corrected-to-wrong again exercised the
post-commit branch and transcribed both “One” and “No. Two”, but Jev accepted the
latter against scene 1 and advanced to scene 2. The branch therefore verified
post-commit interpretation without rollback, while its final Jev outcome differs
from the historical run. Keep those outcomes separate; neither one-attempt result
establishes correction quality or comparative safety.

Happy-path and both post-commit cases completed their intended harness assertions.
They are **ordinary**, not recovery-ended, attempts. The single 2.7-second
transcript-quiet gate is a shorter observed hold than the historical 9.054-second
stall, but there is no matched answer/branch, repeat sample, or policy change to
attribute that difference to a latency improvement. Decoded-media observation
here is descriptive only; it was not a release barrier. Transcript arrival,
grouped tutor-turn end, instruction acknowledgment and decoded-media energy do
not establish current-answer generation, acoustic delivery, response completion
or safe stale-audio isolation. Passing these targeted runs does not establish
complete acoustic safety.

### Evidence retained locally

All evidence remains ignored/local under
`test-results/issue-36-live-validation-20260928/<scenario>/`; only documentation is
included in the results commit. Each directory contains `log.json`,
`diagnostics.json`, and `timeline.txt`. SHA-256 hashes pin the correlated evidence:

| Scenario | `log.json` | `diagnostics.json` | `timeline.txt` |
| --- | --- | --- | --- |
| `happy-path` | `ca025fc2e5f5b7059388475d1206f1118f09b725696ceb80fc0eb25dcc518b1f` | `06e3d1b46044a915ce30eea4f889332d9f01f4d09c8bfa2733dee35faa37fc6f` | `ab46084f8c41cecc0d88695923a5584d931a2b4ac173b76e528ea565d2515c5f` |
| `continuation` | `8343a8eac775b25c2f3a66496c0908a3d531b9305bc70c42cbc6bf3587485bd0` | `b59d2267b4359b90ea02656b2973ef62ae6fafceabf1bc563cd5a91dd7152e36` | `6dd01d1f5b9e3bfbe8c4099641e6cef95072152d0901116743d18229b2247612` |
| `corrected-to-wrong` | `7b003bafb52ac53a8d2e230f46811870c954a365fe49caefa8a22c03bf9af6c5` | `5dccc1f90057539d676c76a240456c9ed7ce30650e15c616b1e4a7fd9e7b12d8` | `9f0e2621a00a8318fb0cb5076c9a24b2789cf35f6b6fa0e63fc4a481b19e0b78` |

No audio recordings or private data were added to the repository. This targeted
slice does not resolve the safe source-level boundary for stale audio or whether
output-media observation can safely shorten hidden-generation waits. The next
architecture decision remains the one above: establish reliable output-media
activity and controllable flushing/suppression semantics at the player or media
relay boundary, with a bounded recovery path that fails closed, before considering
an event-driven release policy. Do not infer end-to-end safety from this sample.

## Commit 3: seeded replacement qualification — 2026-09-29

This slice adds and measures replacement preparation without calling it from
LessonSession or changing any answer gate. The base is `cde7686` on
`feat/response-gate-source-isolation`. Initial `start()` retains its existing
SDP completion behavior.

A replacement is **READY only when its own SDP answer has been applied AND its
own live data channel has supplied a parsed `session.started`**. A source-local
readiness promise is installed before negotiation, so an early event cannot be
missed and A cannot qualify B. Opening B's channel, transcripts, decoded PCM and
instruction acknowledgments do not qualify it. A 30-second deadline covers the
whole preparation, including offer/ICE/local endpoint/SDP/startup. Provider error,
session or channel close, peer failure, retirement and lesson teardown reject
preparation and permanently close B. Pending output/transcripts stay internal;
B's stream has no playback or recording path. A remains authoritative until
explicit activation. Promotion still blocks playback; separate permission is
required to hear or record B.

The browser sends only `{ sdp, replacement: { sceneIndex, decision,
childUtterance } }`. The scene index means the **current displayed scene after
the application outcome**, not the group the child just counted. Validation
requires an integer within the lesson, ADVANCE/STAY/UNAVAILABLE, a nonempty
utterance of at most 1,000 characters with no control characters, exactly the
three seed fields, and no ADVANCE to the initial scene. The endpoint rejects
extra request/seed fields before contacting OpenAI. `replacementSessionInput`
in `lib/lesson.ts` builds text history: the utterance in a user message and
trusted scene/outcome/app ownership/wait-for-outcome context in a developer
message. It overrides the base prompt's initial one-duck assumption for the
replacement and prohibits inferring an earlier scene. UNAVAILABLE prohibits
right/wrong judgments. Startup requests do not ask for speech. The route always
uses `LIVE_CONFIG`, adding only this generated `input`; browser instructions,
model, voice, delegation, storage and arbitrary session configuration cannot
replace it. Loopback protection, body limit, key secrecy, error redaction and
single-attempt billed creation remain in place.

### Targeted billed measurement

Ran `node scripts/live-replacement-startup.mjs` against the existing configured
local app at `http://127.0.0.1:3000`, starting at **2026-09-29 15:28:50.881 UTC**.
One initial A plus three fresh B sessions were created sequentially with synthetic
silence as microphone input. Each B was qualified while A remained authoritative,
B stayed detached, and output was blocked. The first two replacements were then
retired; the third was explicitly promoted for a separate diagnostic probe.
There were no creation retries or Jev evaluations. All connections were closed
on completion.

All timestamps below are **browser `performance.now()` milliseconds in the same
document**, rounded to 0.1 ms. `POST begun` observes the browser's call to the
local `/api/live`; it is not a server/provider clock. `SDP received` observes
successful answer-body parsing, including local server/network work. These are
application startup observations, not acoustic latency or response delivery.

| Seed / source | Replacement requested | POST begun | SDP received | Remote description applied | `session.started` | READY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ADVANCE / 2: “Two” | 1925.6 | 2047.1 | 2571.5 | 2572.7 | 3115.5 | 3115.6 |
| STAY / 3: “Five” | 3119.9 | 3250.7 | 3641.2 | 3643.7 | 4602.0 | 4602.0 |
| UNAVAILABLE / 4: “Three” | 4603.9 | 4719.8 | 4947.9 | 4949.1 | 5504.8 | 5504.8 |

| Seed | Requested → SDP | Local POST → SDP | SDP → `session.started` | Requested → READY |
| --- | ---: | ---: | ---: | ---: |
| ADVANCE | 645.9 ms | 524.4 ms | 544.0 ms | **1190.0 ms** |
| STAY | 521.3 ms | 390.5 ms | 960.8 ms | **1482.1 ms** |
| UNAVAILABLE | 344.0 ms | 228.1 ms | 556.9 ms | **900.9 ms** |

All three provider `session.started.session.input` arrays echoed the generated
history: the child's exact synthetic utterance plus scene 2 (`butterfly-garden`),
three butterflies, the correct deterministic decision, application scene
ownership and silence until the outcome instruction. This verifies provider
receipt of seeded current-scene context. It does not verify the model's use of
that context in conversation. A post-readiness diagnostic instruction on the
third source asked for the displayed object name without a count or judgment;
**no output transcript arrived within the 20-second observation plus 2-second
follow-up**, so there is no speech/context-use or conversational-quality claim.
The replacement was kept muted during that probe.

In these three samples, startup (0.901–1.482 seconds) is faster than both the
historical **9.054-second** post-evaluation stall and the later **2.7-second**
transcript-quiet hold recorded above. This makes clean seeded startup a plausible
alternative worth integrating experimentally. It is not a matched comparison,
load/reliability distribution, full response-latency measurement or final policy.
It does not measure outcome-instruction delivery, first audible response or
child interruption during the handoff.

Local evidence: `test-results/replacement-startup/results.json`, SHA-256
`0d010f4b960c16f41b718f96c1c0a4d5b7da18c2b67773a4220c748981c5624b`.
The script additionally checks exact provider input echo and isolation on future
runs. The retained run predates those additional explicit script assertions;
the same checks were verified directly from its recorded provider input and
per-sample isolation fields. No credentials or audio were committed.

### Verification and next slice

Route, BrowserTransport, seed-context and response-source isolation tests pass,
as does the full 462-test unit suite. Five provider-free Playwright transport
tests exercise actual Chromium WebRTC/RTP, media observation and recording,
including SDP/open-channel-without-started, source-specific qualification,
hidden B output, explicit promotion/permission and teardown before started.
The tests reused the already-running port-3000 app with a temporary local
Playwright config because starting port 3100 conflicts with the existing Next
dev lock. Lint, typecheck and production build pass.

Commit 4 remains unimplemented: select the pathological stale-output trigger,
construct the authoritative seed at the correct scene/answer boundary, handle
superseded answers/child interruptions and startup failure within recovery,
promote explicitly, then send the outcome instruction and grant permission.
Verify that complete flow before deciding a release policy. This commit leaves
ADVANCE/STAY gates, `output_transcript_quiet`, `UTTERANCE_GAP_MS`, Jev, the
250 ms correction window and 15-second recovery unchanged.

### Follow-up: real ADVANCE instruction after promotion — 2026-09-29

**B did not respond; speech resumption remains unqualified for commit 4.**
One fresh replacement was tested on top of `65a49b1` at **15:51:26.966 UTC**,
using the configured port-3000 app. No retries or Jev calls were made. The
harness displayed two ducks (scene 1), then three butterflies (scene 2), and
seeded B with `{ sceneIndex: 2, decision: "ADVANCE", childUtterance: "Two" }`.
The provider echoed the exact generated history. B became READY in **1690.7 ms**
while A remained authoritative and B detached/muted. Explicit promotion closed
A; B stayed blocked while receiving the exact `advanceContext(sceneAt(2))`
production instruction, with no diagnostic prompt or clarification:

> The child's count was right, so the app has just changed the screen. Briefly celebrate that, then move on. The screen now shows exactly 3 butterflies. Invite the child to count them, for example "How many can you count?", without saying the total yourself. Wait and listen.

The command was `session.instructions.append`, `delegation_id: null`, event ID
`replacement-authoritative-advance`. Successful local send was recorded on B's
data channel, then output was permitted. That does not prove provider acceptance.
All observations below use one document's browser `performance.now()` clock:

| Event | Browser time (ms) |
| --- | ---: |
| Replacement READY | 3156.9 |
| Promotion completed | 3159.2 |
| Outcome instruction sent to B | 3159.3 |
| Output permitted | 3159.3 |
| Matching append ACK | Not observed |
| First B output transcript | Not observed |
| First B output media activity `active` | Not observed |
| Observation ended | 23171.8 |

READY → instruction was **2.4 ms**. Instruction → ACK, instruction → transcript,
permission → transcript, permission → media activity and READY → transcript are
**unmeasured**: none arrived in **20.013 seconds after send**. That window is not
response or acoustic latency. No B transcript preceded the instruction either.

At the end B remained **open/connected, authoritative and permitted**, with
playback attached and `paused: false`. Media activity remained **unavailable**
(unknown, not measured silence). No provider error, `session.closed` or transport
failure occurred. The UI stayed on scene 2 / `butterfly-garden`. No response
means scene correctness or spoken references to earlier/future scenes cannot be
verified. The harness does not run LessonSession; unchanged UI alone cannot
prove conversational correctness or acoustic delivery.

The harness now explicitly resumes its synthetic microphone AudioContext in the
Start gesture and records state. It was **already running before resume** and
remained running during this sample, so suspension is not an established cause.
No production fix was justified or made. Missing ACK/output remains unexplained;
provider timeline progression and command acceptance were not established.
Further investigation is needed before commit 4; answer-gate policy is unchanged.

Validation: **36 focused unit tests**, **six provider-free WebRTC tests**, lint
and typecheck passed. The added browser test verifies the real ADVANCE command
reaches promoted B while blocked, a matching synthetic ACK is routed, and
permission enables attached playback. The single billed experiment exited
nonzero for its failed response criterion, saved diagnostics and closed both
connections. Local evidence: `test-results/replacement-response-20260929/results.json`,
SHA-256 `1dda2683f5e9819eeddb5c2d18154fa65c9cfb790c6a7472d798918b3da574e4`.
No credentials or audio were committed.

### Input RTP controls — 2026-09-29

**The old silent harness sent no audio RTP. Low-level continuous input restored
both the instruction ACK and GPT-Live output.** Two targeted billed controls
were run sequentially on top of `d4e4f60`, one fresh A plus one fresh B each,
without retries or Jev calls. Both used the same scene-2 ADVANCE seed (“Two”
after two ducks, with three butterflies now displayed), exact
`advanceContext(sceneAt(2))`, explicit promotion while blocked, then output
permission and approximately 20 seconds of observation.

- **Silent control**, 16:06:12.095 UTC: the existing empty
  MediaStreamDestination, with no connected source; AudioContext running.
- **Continuous control**, 16:06:47.290 UTC: only the test microphone graph changed
  to a 440 Hz sine oscillator → gain **0.001** → MediaStreamDestination. Nonzero,
  low amplitude, no speech content, no connection to speakers; context running.

The experiment selects B's audio RTCRtpSender and calls **sender.getStats()**.
Snapshot times below are browser `performance.now()` milliseconds, with a
separate document/clock origin per run. Each artifact also retains the original
RTCStats report ID and native `timestamp` verbatim; those timestamps are not
mixed with the application clock. Immediate READY/promotion snapshots can share
a cached stats timestamp; the later snapshots demonstrate progression.

| Snapshot | Silent: sampled at / packets / bytes | Continuous: sampled at / packets / bytes |
| --- | ---: | ---: |
| Immediately after READY | 3341.1 / 0 / 0 | 2176.6 / 14 / 690 |
| Immediately after promotion | 3369.3 / 0 / 0 | 2206.2 / 14 / 690 |
| About 1 s after instruction | 4376.8 / 0 / 0 | 3214.5 / 66 / 4789 |
| Observation end | 23383.1 / 0 / 0 | 22217.9 / 1022 / 81739 |

Silent deltas were **0 packets / 0 bytes** in every interval. Continuous deltas
were **0 / 0** READY → promotion, **52 / 4099** promotion → first-second snapshot,
and **956 / 76950** thereafter. Total continuous growth after READY and after
promotion was **1008 packets / 81049 bytes**, over about 20 seconds. Growth was
confirmed by the post-instruction snapshots, not by track/context/connection
state or by assuming transmission at READY.

| Observation | Silent source | Continuous source |
| --- | --- | --- |
| Outbound packets/bytes increasing after READY and promotion | No | Yes |
| Matching `session.instructions.appended` ACK | No | Yes |
| B output transcript | No | Yes |
| B media activity `active` | No; remained unavailable | Yes; quiet at end |
| Provider errors / closes / transport failure | None | None |
| Final peer / channel | Connected / open | Connected / open |
| Final authority / permission / playback attachment | B / permitted / attached | B / permitted / attached |

The continuous run produced:

> Oh, nice job just now. Look, there are some butterflies here. How many can you count?

It referred to the seeded current butterflies, with no duck reference or
independent scene change; the screen stayed on index 2 / `butterfly-garden`.
No B transcript preceded the instruction. Continuous-run browser observations:
READY **2174.9**, promotion **2181.4**, instruction **2206.6**, permission
**2206.8**, first transcript **3160.4**, matching ACK **3160.6**, first observed
active media **3490.6** ms. Derived: READY → instruction **31.7 ms**,
instruction → ACK **954.0 ms**, instruction → transcript **953.8 ms**,
READY → transcript **985.5 ms**, permission → transcript **953.6 ms**,
permission → media activity **1283.8 ms**. These are application/media observations,
not acoustic latency, audible onset, or proof that the ACK is a playback barrier.
All corresponding ACK/output intervals were unmeasured for the silent run.

This pair strongly associates the prior no-response result with the harness's
failure to transmit audio, rather than disproving replacement itself. Increasing
outbound RTP alone does not prove provider timeline progression; the matching
provider ACK and output provide the additional evidence here. With continuous
input, a seeded replacement reached READY, was promoted, accepted the real
outcome instruction and resumed GPT-Live output while preserving source
isolation. **The response path is qualified enough to proceed to a commit-4
experiment**, which remains unimplemented. One sample per control cannot
establish reliability, pedagogy, acoustic safety or end-to-end latency improvement
inside the real answer gate.

The harness now defaults to continuous input; `REPLACEMENT_MICROPHONE=silent`
retains the original control. Continuous runs fail their RTP regression criterion
if counters do not increase after promotion. Production microphone, transport,
seed semantics, LessonSession and all gate policies are unchanged. Validation:
**39 focused unit tests**, **seven provider-free WebRTC tests**, lint and
typecheck passed. The added browser check observes actual low nonzero input PCM
and increasing RTP against a local peer; unit stats fixtures test extraction and
missing-data handling only, not OpenAI behavior. Both live controls closed all
sources and saved diagnostics; silent exited nonzero for no response, continuous
passed both RTP and response criteria.

Local evidence under `test-results/replacement-timeline-20260929/`:

| Artifact | SHA-256 |
| --- | --- |
| `silent/results.json` | `3bc3ddf77ca6bae59a4796d5e2b72ed1d5c5687d04d529d63f7bb313c4e395f4` |
| `continuous/results.json` | `0ac793ae869eea6165e5f4817d94f0b93d161efd519da06fa26b750c7aa646f3` |

## Commit 4: integrated stale-output source isolation — 2026-09-29

The response gate now has two paths. **Normal fast path:** correction/VAD/evaluation
and scene display finish; A's `output_transcript_quiet` expires (or there is no
blocked output); the production outcome context is sent to A and its playback
is permitted. The app does not prepare another connection just because an
answer gate exists. The 2,500 ms `UTTERANCE_GAP_MS` remains unchanged.

**Stale-output path:** if the *only* remaining blocker is a moving A output
transcript deadline for 2,500 continuous milliseconds, prepare a replacement.
The threshold is an additional provider-only hold, measured after all
application-owned prerequisites clear. It is deliberately conservative:
replacement startup previously measured about 0.9–1.7 s, while an isolated
~2 s hold does not yet justify another billed connection. This is a first
bounded policy, not a tuning claim from a single run. `STALE_OUTPUT_REPLACEMENT_MS`
is independent of the ordinary transcript gap.

For ADVANCE, the Jev decision, 250 ms correction window, scene commit, and
actual display must already be complete. For STAY/UNAVAILABLE, evaluation and
correction/VAD protection must be complete, and the scene must be unchanged.
Neither PCM quiet, instruction ACK, nor provider-generated text authorizes
replacement. B is seeded from the gate's answer plus the displayed scene and
application decision. Its own `session.started` is required for READY. When
READY, the app rechecks the original scene/revision/answer identity and safety
state, blocks output, promotes B (permanently retiring A), sends the production
ADVANCE/STAY/UNAVAILABLE context to B, then permits output. The release reason
is `replacement_source`; A's quiet deadline is retained in diagnostics rather
than marked satisfied. Transcript quiet remains the normal and failed-startup
fallback.

A replacement attempt belongs to one gate identity. New child transcript or
VAD activity cancels and retires pending B. For a committed ADVANCE, its new
scene stays displayed and the new child turn can be evaluated against it; the
old response stays blocked. Gate replacement, lesson end, startup failure, and
recovery expiry also cancel B. A late preparation result is retired. Startup
failure leaves A behind the original gate; the original 15-second deadline is
never restarted. Promotion failure fails closed. The source contract keeps
retired peers/channels closed and ignores their callbacks.

Provider-free validation: 480 unit tests, including 14 new LessonSession
handoff cases and a transport abort case; 28 Playwright tests, including the
integrated real-WebRTC handoff, post-retirement callback rejection, recording
PCM gate, child-activity cancellation, and a pending-B recovery-expiry case.
Lint, typecheck, and production build passed. The provider-free fixture uses
real Chromium peers, audio playback, and recording, with only the provider
replaced.

### Small billed Live/Jev probe

Evidence: `test-results/integrated-replacement/results.json` (normal pass and
an inconclusive stale attempt); `test-results/integrated-replacement-stale-retry/results.json`
(stale pass). Both successful samples used the actual LessonSession,
BrowserTransport, GPT-Live connections and Jev endpoint. Child VAD/transcript
were synthetic, and a low continuous experiment-only microphone supplied real
outbound RTP. These are transport/decision probes, not spoken-child end-to-end
latency samples. The first stale attempt emitted no greeting transcript and
could not reproduce a hold; it is retained as an inconclusive sample. The
retry sent the long-output prompt after a bounded startup wait.

| Category | Safe decision/display from answer | Replacement trigger | B READY after trigger | Outcome instruction after safe | First B/current-source transcript after instruction | First observed media activity after instruction | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Normal | 647 ms | None | — | 0.4 ms on A | 1,513 ms | 1,716 ms | ADVANCE on A; first transcript 2,161 ms from injected answer; no replacement |
| Reproduced stale output | 497 ms | 2,502 ms after safe | 1,194 ms | 3,700 ms on B | 1,423 ms | 1,578 ms | ADVANCE on B; first transcript 5,620 ms from injected answer |

The stale trigger occurred with 1,786 ms remaining on A's then-current quiet
deadline. A generated more hidden fragments while B prepared, moving that
remaining deadline to 2,191 ms at promotion. Twelve hidden A fragments
extended the gate in the successful stale sample. A's peer and channel were
closed at promotion; no A output transcript was observed afterward. The
production ADVANCE instruction was sent only to B, while playback remained
blocked. The displayed scene and seeded B scene were the committed next scene,
and outbound microphone RTP increased. In this reproduced case, source
replacement retired the stale GPT-Live source and resumed the authoritative
response without waiting for A's remaining transcript-quiet deadline.

The normal sample had no replacement and cannot by itself establish a
statistically meaningful latency change. The two categories were deliberately
different, so their total answer latencies are not a strict before/after
comparison. More natural spoken-child runs, repeated normal-path samples,
real stale-output reproducibility, and final qualification are still needed
before closing #36. No issue-closing policy or commit is included here.

### Child interruption correction — 2026-09-29

A later review found that cancelling B on child activity also erased the
committed ADVANCE gate's `displayedRelease` state. A discarded provisional VAD
could then strand the gate until recovery; a non-answer transcript could cancel
the gate and expose stale A. The correction separates replacement ownership
from answer-gate ownership. Cancelling B preserves the displayed ADVANCE and
its original transcript-quiet fallback. While provisional or confirmed child
speech is active, that fallback waits. If the activity is discarded with no
transcript, the original gate can release on A only after its quiet deadline.
A non-answer child turn is retained and likewise waits for that safe fallback.
A new answer-bearing transcript supersedes the old gate on the displayed scene
without unblocking A, and inherits the original recovery budget. A child stop
ends the lesson with media stopped before gate cleanup. Late B readiness still
cannot promote the retired source. No threshold, seed, Jev, microphone, or
transport-source policy changed.

The focused unit regressions exercise provisional discard, non-answer and
answer-bearing transcripts, and stop during B preparation. Real-WebRTC
provider-free coverage verifies that B closes while A remains current and
muted, blocked A PCM stays out of the recording, and provisional discard can
release through the original A fallback. The earlier Live measurements above
are historical; this correctness fix has no new billed Live timing claim.
