# Microphone turn investigation baseline

Documentation baseline for [issue #37](https://github.com/hurley87/sprout/issues/37), at
`0d96a64648ce45f7c663b4d31fef10c63fc91595` on
`codex/issue-37-microphone-turn-investigation` (2026-09-29). This slice used a
read-only query of persisted session `j97cpnd4qrd766wxexb28nmefn8f6f2h` and
the current source. No new microphone or provider trial was run.

## Current finding and limits

Two short answers in the example reached evaluation through the 1,500 ms
transcript fallback. A microphone speech stop was recorded **after** each
evaluation request and scene display. The third answer had a stop before its
request and used the 250 ms microphone transcript tail. This establishes the
event ordering and selected paths, but not why the detector remained active.
The recording is attached and marked complete (`audio/webm;codecs=opus`,
57,333 ms), but its audio was **not auditioned or acoustically analyzed** in this
baseline. Speaker leakage, nearby speech, background noise, detector calibration,
and browser frame scheduling remain competing explanations.

The durable record supplies session-relative event times, provider transcript
positions, and recording metadata. It does not retain microphone RMS, threshold,
noise floor, quiet resets, frame gaps, track settings, provisional activity,
speech epoch, timer replacements, or the full in-memory diagnostics. The
recording's availability does not establish which sound held the detector open.
The complete record status establishes successful assembly, not acoustic quality.

## Opt-in detector measurements (commit 2)

Before starting an attempt, select **Include microphone turn measurements in this attempt’s local diagnostic download** on the welcome screen. After ending the attempt, expand **Parent testing notes · Prototype diagnostics** and choose **Download attempt diagnostics**. The checkbox is off by default and applies to the next attempt. The measurements stay in the bounded, in-memory diagnostic stream (up to 8,000 events); they are not canonical learner evidence or part of the durable session record. Download before starting another attempt or reloading the page.

`microphone.track_settings` records the browser's actual audio track settings when available: echo cancellation, noise suppression, automatic gain control, sample rate/size, channel count, and latency. It excludes device and group identifiers and labels. Settings establish what the browser reports, not whether processing was effective.

If Web Audio detector initialization fails, `microphone.detector_unavailable` records that fact without an error string. Transcript fallback remains available.

`microphone.detector_window` is emitted at most once per 250 ms animation-frame window. It includes frame count, RMS minimum/mean/maximum, last effective energy threshold and noise-floor estimate, above-threshold frame count, provisional (`candidate`) and confirmed state, current quiet duration, quiet-reset count and longest reset interval, largest frame gap, number of gaps over 100 ms, and AudioContext state. RMS, threshold, and noise floor are dimensionless energy estimates; no waveform samples are retained. A reset means an above-threshold frame interrupted a confirmed-speech quiet interval. A frame gap measures browser callback spacing, not acoustic silence.

Each event's `at` is milliseconds from the attempt's application `createdAt`, assigned when the session receives the measurement, so it joins existing `answer.*` and session diagnostics. The detector uses animation-frame timestamps only for its own state machine and gap/quiet durations. Provider transcript media positions and estimated acoustic end remain separate clocks and estimates. These measurements alone cannot identify the sound source or establish audible answer timing. This slice does not change detector or evaluation policy.

## Evaluation path diagnostics (commit 3)

The same opt-in diagnostic download now records provisional activity and confirmed speech with speech/transcript epochs, and transcript revisions with the current answer identity. A microphone `answer.turn_end` has `usable_for_latest_transcript` and `selection_reason`: `no_transcript`, `transcript_epoch_mismatch`, or `matching_speech_epoch`. A missing stop is visible as a fallback schedule without a preceding usable stop; the energy windows show whether detector quiet was repeatedly reset. These events describe ordering and eligibility, not the sound source.

`answer.evaluation_scheduled` includes the selected `path`, application-clock `deadline_at`, speech/transcript epochs, and microphone state. `answer.evaluation_replaced` names the prior schedule and why a new one replaced it. `answer.evaluation_cancelled` records session-end cancellation. `answer.evaluation_invalidated` records a stale callback identity. `answer.evaluation_timer_fired` records timer execution; only `answer.requesting` proves an evaluation request. `answer.evaluation_not_requested` gives the reason when `evaluate` returns without a request, including an already requested answer or a pending decision release. Fallback `answer.turn_end` is synthetic at timer firing and is not a microphone stop.

For an opt-in artifact, run the provider-free `diagnosticsTimelines(events)` parser in `scripts/live/metrics.mjs` against the downloaded JSON, or inspect `answerTimelines` in a live harness `log.json` and the evaluation lines in `timeline.txt`. Rows join scene index, transcript revision, and answer version. Each row reports latest transcript arrival → actual request, request → result, result → commit and release, and release → first **observed** Sprout transcript or decoded-media activity. Missing fields, old artifacts, or unjoinable identities show `null`/`unavailable`. A fallback `turnEndToRequestMs: 0` is ignored for pre-evaluation delay. These diagnostic times are milliseconds since attempt `createdAt`; durable `sessions:getRecord` times start at `session.started`. Provider media positions and animation-frame timestamps have different origins and must not be subtracted from either application clock without an explicit valid mapping. Observed transcript and decoded-media activity are proxies, not provider generation completion or acoustic onset; audible onset remains unavailable without synchronized acoustic evidence.

## Example session timing

All `at` values below are **application milliseconds since `session.started`**,
from `sessions:getRecord` event `atMs`. The first/last transcript observation
fields use that origin. Provider utterance start/end values use the provider's
media timeline and are listed only as context; they are not subtracted from
application timestamps. Recording seek positions use the recording offset and
are approximate. A VAD `estimatedAcousticEndAtMs` is the detector's first quiet
frame estimate, not a verified last audible word. In particular, no audible
answer-to-response latency follows from these transcript times.

| Answer / scene | Latest transcript first observed → request | Path and microphone events | Request → result → commit/display → release |
| --- | --- | --- | --- |
| “One” / 1 duck | 11,534 → 13,037 = **1,503 ms** | `transcript_fallback`; speech start 8,582, stop **15,314**; provider utterance 11,200–11,400 | result 13,330 (**292 ms** reported Jev latency); commit 13,331; display 13,348 (**1,814 ms** from transcript observation); playback permitted 15,774 (**2,443 ms** after commit) |
| “Two” / 2 ducks | 24,744 → 26,246 = **1,502 ms** | `transcript_fallback`; speech start 22,274, stop **27,512**; provider utterance 24,400–24,600 | result 26,474 (**227 ms** reported); commit 26,497; display 26,514 (**1,770 ms** from observation); playback permitted 28,930 (**2,433 ms** after commit) |
| “Two” / 3 butterflies | 38,530 → 39,493 = **963 ms** | `microphone_vad`; speech start 28,579, stop **39,243**, then 250 ms tail; provider utterance 38,200–38,400 | STAY result 39,732 (**238 ms** reported); no advance; playback permitted 39,734 |

The reported Jev latency is recorded by the application; one-millisecond
differences from subtracting rounded event times are possible. In the first two
rows, the fallback sets `turnEndAt` **when its timer fires**. Their persisted
`turnEndToRequestMs: 0` therefore does **not** mean zero answer-to-request
delay. The meaningful observed pre-evaluation interval is latest transcript
arrival to request. The stop events occurring later explain why those requests
could not use a preceding microphone stop, but cannot identify the acoustic
source or rule out an epoch/timer interaction without finer diagnostics. The
third row's stop is 713 ms after transcript observation; its request follows
that stop by 250 ms.

The roughly 2.4-second commit-to-permission intervals for the first two
advances belong to the [response-gate investigation](response-gate-latency-experiment.md)
and merged [PR #39](https://github.com/hurley87/sprout/pull/39). They are not
part of the pre-evaluation delay. Permission, provider transcript observation,
and remote media activity do not establish the onset of audible playback. This
session predates that merged work; no before/after comparison is made here.

## Current detector and scheduling policy

[`lib/microphone-turn.ts`](../lib/microphone-turn.ts) samples the authorized
microphone with a Web Audio analyser on animation frames. It calls a frame
voiced when RMS exceeds `max(0.015, noiseFloor * 3)`. The noise floor updates
only while inactive and outside a candidate. A provisional burst becomes
confirmed after 80 ms of accumulated above-threshold frame time; 150 ms of
quiet discards a provisional burst. Confirmed speech stops after 900 ms of
quiet, reset by any above-threshold frame. This energy detector does not label
the speaker or distinguish speech from non-speech. Browser capture
([`lib/browser-transport.ts`](../lib/browser-transport.ts)) requests echo
cancellation, noise suppression, and automatic gain control; their effective
settings and performance were not recorded for this session.

[`lib/session.ts`](../lib/session.ts) logs provisional/confirmed activity,
speech epochs, transcript revisions, schedules, invalidations, request timing,
and response-gate blockers in a bounded in-memory diagnostic stream. A clean
stop with a transcript in the matching speech epoch schedules evaluation after
the 250 ms transcript tail. Otherwise, each answer-bearing transcript revision
schedules or replaces a 1,500 ms fallback; a later clean stop may replace it.
The fallback can proceed despite ongoing confirmed or provisional activity to
preserve liveness. Answer stabilization after the detected end or latest
transcript is a separate 250 ms correction policy. Neither policy is changed
here. The persisted record is coarser than those in-memory diagnostics.

## Pending comparable trial protocol

Run only in a later authorized measurement slice. Use the same MacBook,
microphone input, browser and version, page/build SHA, room, speaker placement,
network, voice/model configuration, and evaluator for all trials. Note the
selected input/output devices, actual `MediaStreamTrack.getSettings()` where
available, OS input gain, microphone-to-mouth and microphone-to-speaker
distances, microphone orientation, room dimensions/noise sources, and a fixed
playback volume measured or recorded at the OS and app level. Keep the tab
visible. Record any browser audio-processing setting changes; do not assume the
requested constraints were applied.

Use a crossed design: headphones versus MacBook speakers, each in (a) quiet
room and (b) ordinary, documented background noise. Run **at least five
independent sessions per combination**, alternating condition order. For each
session, give the same three one-word counting answers. Start each answer about
one second after the tutor's audible question ends, measured by an observer or
recording, and aim for a 0.4–0.6-second spoken answer at a consistent mouth
position and level. Record actual answer start/end instead of assuming the aim
was met. Match speaker playback loudness at the listener's position as closely
as practical and record the level/setting; do not silently change it between
conditions. Include five two-second **quiet-room silence** windows and five
two-second **ordinary background-noise without learner speech** windows per
output condition, with normal tutor playback on and its end marked. These
controls test false microphone activity and quiet resets separately from the
spoken answers. Document interruptions, corrections, missing transcripts, and
failed runs; retain them in the report rather than replacing them invisibly.

For every answer, export the existing `answer.*`, `advance.*`, and response-gate
diagnostics and join by scene, answer version, correlation key, and a shared
application-relative clock. Capture provisional activity, confirmed speech,
stop, transcript revision, speech epoch, evaluation schedule/deadline and
replacement reason, request, result, commit, display, gate eligibility/release,
and first **observed** response. Preserve provider/media timestamps and
recording offsets in separate columns; use synchronized audio review to mark
actual acoustic answer end and possible leakage/noise, with uncertainty.
Report transcript arrival → request, request → result, result → commit/release,
and release → observed response independently. Gate intervals may overlap and
must not simply be added.

Report all repetitions by condition, per-answer path counts, fallback and
false-activity rates, median/range of each interval, and silence-control
behavior. A speaker-leakage attribution requires a repeatable speaker-versus-
headphone difference **and** synchronized audio or energy/quiet-reset evidence
showing tutor playback in the microphone channel at the relevant resets.
Similar delays under headphones, persistent activity in silence controls,
missing audio, or unmatched conditions leave that attribution inconclusive.
For an epoch or scheduling fault, show a transcript/stop pair whose epoch and
timer logs contradict the selected path. Decide whether current behavior is
expected, a scoped fix is justified, or more measurement is required. Any
proposed change must report its effect on fallback delay and false stops while
preserving correction protection, stale-result invalidation, exactly-once
advancement, immediate stop handling, and bounded fallback liveness. No
threshold or timer recommendation is justified by this single session.

## Interim trial findings — 2026-09-29 (commit 4)

Four user-supplied diagnostic exports cover one attempt in each condition, collected on September 29 in America/Toronto (September 30 UTC in the exports). All 12 actual evaluation requests used `microphone_vad`, and all 12 results were ADVANCE. No transcript fallback fired. Initial fallback schedules replaced by a usable microphone stop, and superseded transcript candidates, are not fallback evaluations. The original delayed-stop failure has not reproduced in this sample.

**Recommendation: retain the current detector and timing policy.** These observations do not establish a detector or integration fault, establish speaker leakage, or resolve the original session’s acoustic cause. This is an interim report, not completion of issue #37 or the planned repeated comparison. No scoped fix is justified yet.

### Provenance and conditions

Condition labels and session IDs were supplied by the user. The exports contain no durable session ID; those associations have not been independently checked against persisted records. The original files, trial metadata, and derived answer timelines are saved locally under the ignored `test-results/issue-37/` directory. Raw exports and recordings are not included in this documentation commit. SHA-256 values below identify the exact input bytes.

| Condition | User-supplied session ID | Export filename | SHA-256 |
| --- | --- | --- | --- |
| headphones / quiet | `j97csynefvw00g1xqfcdasaz6s8fdvvj` | `sprout-attempt-1790728585190.json` | `d1b86e331104f4f786bfeb1f3e419702d1e2a9357410388a19f8d7b2b129f4b8` |
| speakers / quiet | `j97bg9t90fa2a1z132zx1pp72d8fd38w` | `sprout-attempt-1790728829040.json` | `a1e69b3597434e89a1af6b8d50a2c1933dea67a5108607e88ed03641244d8cb3` |
| headphones / background noise | `j97awymkjdr89d82gmejcw7xz98fckm8` | `sprout-attempt-1790729012710.json` | `88c462e58ccb77f0dd79a0504981d857c2142881ddd6f0f9b57a9455d748d4b7` |
| speakers / background noise | `j975vc1f1fhc0syr4vfnj2ak558fcc8j` | `sprout-attempt-1790729238868.json` | `3784a7506bf0c2527a8a60f74f60c57ef8722288930a176c0fc47109a9b90287` |

All four exports report Chrome 153 on macOS, `gpt-live-1`, and prompt `counting-jev-4`. Reported microphone settings are identical: echo cancellation, noise suppression, and automatic gain control enabled; 48 kHz, 16-bit, mono, and 0.01-second latency. These settings do not identify the physical microphone or demonstrate processing effectiveness. Build SHA, microphone device, seating/microphone position, playback volume, and noise source/level were not supplied. Audio has not been auditioned. No separate silence-control windows were labeled.

### Per-answer timings

All intervals below are milliseconds computed within the diagnostic application clock (attempt `createdAt`). Each row represents an actual request, not an intermediate transcript revision. Result → commit was 1 ms for every row. Release means application playback permission. Observed transcript and decoded-media activity are separate proxies, not audible onset; unavailable means no matching observation was found within the parser’s answer window, not that no response was heard.

| Condition | Answer | Transcript arrival → request | Request → result | Result → release | Release → observed transcript | Release → decoded-media activity |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| headphones / quiet | One | 381 | 421 | 20 | 1086 | 1365 |
| headphones / quiet | Two | 535 | 209 | 15 | 1473 | 1764 |
| headphones / quiet | Three. | 252 | 315 | 12 | 1245 | 1693 |
| speakers / quiet | One | 253 | 234 | 16 | 1806 | 2055 |
| speakers / quiet | Two | 251 | 205 | 18 | 1046 | 1262 |
| speakers / quiet | 1, 2, 3 | 252 | 208 | 13 | 662 | 861 |
| headphones / background noise | One | 988 | 254 | 13 | unavailable | 928 |
| headphones / background noise | Two | 659 | 221 | 19 | unavailable | unavailable |
| headphones / background noise | Three | 252 | 216 | 13 | unavailable | unavailable |
| speakers / background noise | One | 256 | 242 | 17 | 1629 | 1965 |
| speakers / background noise | Two | 328 | 237 | 13 | 953 | 1302 |
| speakers / background noise | Three | 550 | 230 | 18 | 939 | 1191 |

### Detector comparison and interpretation

Quiet resets are totals across each captured attempt, not per-answer rates or calibrated false-positive counts. Attempts differ in duration and spoken content. Each reset means above-threshold energy interrupted a confirmed-speech quiet interval; it does not identify the sound source.

| Condition | Actual VAD requests | Actual fallback requests | Quiet resets | Transcript → request median (range), ms | Largest frame gap, ms |
| --- | ---: | ---: | ---: | --- | ---: |
| headphones / quiet | 3 | 0 | 0 | 381 (252–535) | 16.6 |
| speakers / quiet | 3 | 0 | 4 | 252 (251–253) | 9.7 |
| headphones / background noise | 3 | 0 | 39 | 659 (252–988) | 18.1 |
| speakers / background noise | 3 | 0 | 0 | 328 (256–550) | 10.5 |

- Headphones/quiet had no quiet resets. Its first two fallback schedules were replaced by VAD tails; the third transcript arrived after the microphone stop.
- Speakers/quiet had four resets during the third counting turn. That transcript was “1, 2, 3”, whereas the headphones/quiet answer was “Three.” Continued counting is a competing explanation; those trials do not isolate speaker leakage.
- Headphones/background noise had 39 resets and longer transcript-to-request waits on the first two answers. The detector still reached quiet in time to replace fallback with the VAD path. Noise, nearby speech, answer delivery, and unspecified setup differences remain competing causes.
- Speakers/background noise had no quiet resets, but two additional confirmed activity periods between the second and third answers ended without an associated transcript. Their acoustic source is unknown; absence of a transcript alone does not establish false detection.
- Every captured detector window reported a running AudioContext, and no frame gap exceeded 100 ms. These exports provide no evidence of large animation-frame scheduling gaps in these attempts.
- A stop can arrive before its transcript, so the stop event can correctly report `no_transcript` and the later transcript can still select the VAD tail. An unjoined stop field in the per-answer parser is not proof of an absent stop; the raw epoch and event ordering must also be inspected.

### Remaining work

Collect four more attempts per condition to reach the planned five, alternating conditions and keeping the physical microphone, position, answer form (“One”, “Two”, “Three”), playback level, and background-noise source consistent. Record actual device and room details, label silence controls, and retain failures and interruptions. Review synchronized audio, including the original problem session where available, before attributing detector activity to speech, speaker leakage, or noise. The current one-attempt-per-condition comparison is inconclusive for acoustic causation and does not support a claim that speakers are faster or slower.

Issue #37 remains open. Commit 5 remains conditional on a demonstrated failure with measured tradeoffs and a deterministic regression test. No detector, scheduling, threshold, or timer change is part of this report.
