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

| Run | Started at (UTC, harness) | Outcome and observed coverage |
| --- | --- | --- |
| Happy path | 19:34:49.804 | Passed all three correct answers and exactly-once scene advances; second answer had the long quiet hold. |
| Continuation | 19:35:50.636 | Passed the pre-commit branch; only “And two” was transcribed/evaluated, STAY on scene 0. Initial “One!” playback produced no child transcript. This does not validate a two-transcript continuation. |
| Corrected-to-wrong | 19:36:22.672 | Passed the post-commit new-turn branch: “One” advanced scene 0, then “No Two” produced STAY on scene 1. No retroactive rollback is expected. |
| Continuation retry | 19:37:46.857 | Failed the tutor-turn observer wait after both “One” and “And two” reached Jev and advanced scenes 0 and 1. Raw transcripts were observed after the second release. Retained as diagnostic evidence; excluded from successful-scenario summaries. |

Every attempt ended through parent cleanup, with application `parent_stop`.
Artifacts remain local under the two ignored `test-results/` directories above:
`diagnostics.json`, `log.json`, `timeline.txt`, and retry `failure.txt`. Preserve
these exports; the Convex durable session record does not contain the detailed
gate observations/deadline updates or all raw transcript fragments.

Diagnostic file SHA-256 values pin the evidence used in the tables:

| Directory / scenario | `diagnostics.json` SHA-256 |
| --- | --- |
| Baseline / happy-path | `aa4f017787ebac45b300bde12a2308d90d59b19b6896e9180b46bada3c24ab68` |
| Baseline / continuation | `e5d7e02f215bb39c31b1d63fcb8ce7afbfc87cc4f275989241f39ed3a2f939ee` |
| Baseline / corrected-to-wrong | `8d2df76f9d5b8268fc54ef7bd622b1a1d69cb669705bdd439b10731811aff69d` |
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
| --- | --- | ---: | --- | --- | --- | ---: |
| Happy / 0 / 1 / `13600:One` | ADVANCE | 15,600 | 16,007 → 16,282 | 16,283 → 16,322 | 16,322 → 16,322 | 16,656 |
| Happy / 1 / 2 / `26200:Two` | ADVANCE | 27,989 | 28,323 → 28,548 | 28,548 → 28,572 | 37,602 → 37,602 | 39,097 |
| Happy / 2 / 3 / `49000:Three` | ADVANCE | 49,249 | 49,501 → 49,797 | 49,798 → 49,835 | 49,835 → 49,835 | 49,949 |
| Continuation / 0 / 2 / `15800:And two` | STAY | 17,969 | 18,349 → 18,601 | — | 18,601 → 18,603 | 19,858 |
| Corrected / 0 / 1 / `13000:One` | ADVANCE | 12,909 | 13,162 → 13,372 | 13,373 → 13,397 | 13,397 → 13,397 | 13,520 |
| Corrected / 1 / 3 / `16800:No Two` | STAY | 17,301 | 17,553 → 17,830 | — | 17,831 → 17,831 | 18,510 |

| Answer | Transcript → evaluation | Evaluation → response release | Release → first observed fragment | Transcript → first observed fragment | Release reason |
| --- | ---: | ---: | ---: | ---: | --- |
| Happy One | 682 | 40 | 334 | 1,056 | `scene_displayed` |
| Happy Two | 559 | **9,054** | 1,495 | **11,108** | `output_transcript_quiet` |
| Happy Three | 548 | 38 | 114 | 700 | `scene_displayed` |
| Continuation And two | 632 | 2 | 1,255 | 1,889 | `correction_window` |
| Corrected One | 463 | 25 | 123 | 611 | `scene_displayed` |
| Corrected No Two | 529 | 1 | 679 | 1,209 | `correction_window` |

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

| Milestone | Application time (ms) | Interpretation |
| --- | ---: | --- |
| First blocked output | 28,517 | Begins observed output-quiet condition. |
| Commit / display | 28,548 / 28,572 | Ready scene; context instruction is still withheld. |
| Last blocked output | 35,101 | Deadline update sets `outputQuietAt` to 37,601. |
| Scheduled quiet deadline | 37,601 | 2,500 ms after the last deadline-update event. |
| Observed eligibility / context sent / release | 37,602 | All conditions clear; 1 ms after deadline. |
| Matching instruction acknowledgment (`sprout_5`) | 38,131 | Acceptance/injection evidence, not a playback barrier. |
| First post-release fragment | 39,097 | “You did”; provider interval 38,400–38,600 ms. |

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
