# Butterfly learner transcript diagnostics and voice comparison

This is harness-only observation and fixture selection. Production transport,
parsing, VAD, prompts, thresholds and semantic authority gates are unchanged.
No live provider execution has been authorized or performed for this work.
Missing provider events versus parser rejection remains unproven for the earlier
missing-transcript attempt. A voice comparison can reveal a recognition difference,
but cannot establish its cause from two attempts.

## Observation boundaries

`tests/helpers/transcript-wire.ts` installs an init script before navigation.
It wraps `RTCPeerConnection.prototype.createDataChannel`, returning the original
channel unchanged and adding a message listener only to `oai-events`. Because the
listener is registered before production assigns `onmessage`, records describe
arrival before `parseProviderEvent` runs. It never sends data or invokes lesson
transitions. Teardown removes its listeners and restores the method.

Each record has an attempt-clock arrival time, local channel number, channel's
runtime ID at creation, and **arrival-time** runtime/visit/node/child-turn/revision
and journal offset from the read-only production bridge. These are correlation
metadata, not provider-supplied source authority. An old channel arriving during
another runtime must not be attributed to the new runtime solely by arrival scope.
Provider `event_id`, `item_id` and `response_id` have presence/type metadata only.
No provider transcript strings, arbitrary event type strings, payloads, IDs or
error messages are retained by the wire observer. Recognized event names are
allowlisted; other types are labeled `unrecognized`. The ordinary production
report still contains its existing accepted transcript evidence.

`delta`, `transcript`, `text`, `start_ms`, `end_ms` have presence/type metadata;
strings record only emptiness. Timing records numeric values within ±24 hours,
finite status, and interval validity. `parser-transcript` means the current
production parser returned a transcript. The harness reads and transpiles the
installed `lib/events.ts` source for its independent diagnostic invocation; it
does not deliver those results or change production parsing. `parserReasons`
records missing/malformed required fields or unexpected transcript event types.
Interval validity is separate: reversed/nonfinite numeric intervals can pass the
parser and be rejected by the runtime. The event names/fields can be compared to
[the official session guide](https://developers.openai.com/api/docs/guides/live-conversations). It does **not** mean runtime acceptance. Empty deltas, inactive
phases, unchanged cumulative text or a stale transport source can yield no learner
snapshot without a logged transcript rejection. Do not infer rejection or ASR
success from parser-valid events alone.

Capture is bounded to 2,048 frames, 32 observed channels, and 65,536 characters per
inspected JSON frame. `dropped`, `observationErrors`, `uninspected`, missing clock or
runtime identities, and absent channels make absence evidence inconclusive. The
limits never suppress delivery to the production transport. Non-string or oversized
frames remain uninspected; malformed JSON is labeled unreadable without retaining
its contents. The observer does not prevent the production unreadable-event failure.

## Attempt artifacts

Every `installChildScenarios` attempt saves wire records and a `transcriptDelivery`
summary in its `attempt-*-harness.json` (version 2). Wire rows also appear alongside
runtime and harness rows in `attempt-*-timeline.txt`, sorted by attempt-clock time.
The production `report.json` is unchanged. Filter records to the answer's runtime,
visit, new child turn, and playback interval; whole-attempt totals include setup
answers. Use `channelRuntimeId` and `journalOffset` to check channel ownership and
what runtime events followed delivery. Near the first utterance fragment, the
arrival child turn may precede local VAD binding; retain that fact rather than
assuming a match.

Interpret these layers independently:

| Evidence | Interpretation |
| --- | --- |
| No input transcript wire event in the answer interval, complete bounded capture, active channel and observed tutor/channel traffic | No documented learner transcript event reached this browser observer during that interval. This does not establish provider root cause. |
| Input delta with `parser-discard` | Documented event arrived but required transcript/timing field types did not meet current parser requirements. |
| `unrecognized-transcript` | Transcript-like metadata arrived in an unrecognized schema; inspect field metadata and compare current parser rules without logging payload text. |
| `parser-transcript` followed by current-scope `transcript.ignored` | Runtime rejected transcript; read the existing rejection reason, interval and source identities. |
| Current-scope child `transcript.snapshot` | Runtime accepted learner text; inspect the existing production report for actual recognized wording. This is not independent semantic completion authority. |
| Parser-valid input with neither rejection nor snapshot | Unresolved downstream acceptance/delivery gap, empty/no-change text, phase or source issue. No automatic attribution. |

Tutor confirmation text is never proof that a learner snapshot exists. Neither
wire metadata nor a snapshot replaces canonical semantic completion and normal
render authority. A missing confirmation/injection window continues to fail the
regression; the target answer is played once, with no automatic retry. Existing
bounded prerequisite clarification behavior remains unchanged.

## Fragment correlation and outbound audio

`transcriptDelivery.fragments` correlates accepted learner **and tutor** fragments
with journal entries by arrival runtime/visit/child-turn, numeric provider interval
and the pre/post synchronous dispatch journal window. A unique matching snapshot
is `snapshot`; a unique logged ignore is `runtime-rejected` with its actual reason.
Old-channel ownership, repeated intervals or ambiguous/missing journal entries
remain `unknown`. `awaitingSteeringAtArrival` is read-only evidence, but queue
membership and deduplication are **unknown**: production exposes neither operation
in its journal. A later unique snapshot can resolve a previously unknown fragment.
Empty text and unchanged snapshots are not labeled dropped. Counts distinguish
documented deltas from directional transcript candidates such as `.done` events.
These diagnostics never create provider events or completion authority.

`outboundAudio.records` contains exact synthetic-source start/ended/cancelled
boundaries, including window-injected audio. Boundaries use the attempt clock;
AudioContext time is excluded. `getStats` runs asynchronously beside playback,
with a 500 ms limit per peer. Each sample retains only local peer/stream numbers,
audio outbound RTP packets/bytes, connection/ICE state and audio sender track
`enabled`, `muted`, `readyState`. `sampledAtMs` is the attempt clock at completion;
the counters are browser snapshots near each boundary, not atomic acoustic timing.
No IP/ICE addresses, raw RTCStats IDs, SSRCs, device IDs, credentials, codec
metadata or unrelated streams are persisted. Capture is capped at 256 boundaries,
32 peers and 16 outbound audio streams per peer; caps/errors are explicit.

`outboundPlayback` subtracts only monotonic counters from the same local peer and
stream. Closed peers, reset counters, unavailable/timed-out samples, and unmatched
boundaries produce `unknown`, never zero-as-proof. No peer/stream counter is merged
across restarts. Teardown/cancellation preserves recorded boundaries. Stats errors
never abort playback or replace the original scenario failure.

Local VAD establishes local detection. Positive packet/byte deltas establish
browser transmission during the sampled interval; idle silence also sends RTP.
They do not establish fixture intelligibility, provider receipt, recognition,
semantic correctness, or filler recovery. Only an authorized live comparison can
supply new provider recognition evidence.

## Retention outside Playwright cleanup

The usual three Playwright attachments and version-2 harness/report/timeline files
remain compatible. Every attempt additionally reserves an exclusive directory:

```text
.sprout-evidence/<attempt UUID>-<runtime ID or runtime-unknown>/
  index.json       # identity, scenario, timestamp, file list and byte budget
  report.json
  harness.json     # attemptId and retention path, wire/runtime/audio evidence
  timeline.txt     # includes wire and audio boundary rows
  complete.json    # written only after all retained payloads were saved
```

This ignored local directory is outside the default live and provider-free
Playwright output directories. Unique Playwright filenames alone would still be
deleted by output cleanup; these retained copies survive reruns. Each attachment's
harness points to the index. An absent `complete.json` marks a partial save.
Attempts with no production report retain an explicit null runtime identity.

Admission is limited to 100 attempt directories, with at most 8 MiB of payloads
per attempt (800 MiB payload ceiling plus small indexes). There is **no automatic
pruning or deletion of existing evidence**. At capacity, oversized attempts or a
reservation-lock failure, retain the ordinary attachments and report the retention
problem; the original scenario failure remains the thrown error. Archive the
whole directory to user-chosen storage before manually freeing capacity. A crash
can leave a partial directory or `.reservation-lock`; inspect it before manually
removing the lock when no harness writer is running. Alternate roots are supported
by `installChildScenarios(..., { retentionRoot })`, and roots inside the configured
Playwright `project.outputDir` are refused. Do not set `--output` to a parent of
`.sprout-evidence`: Playwright cleans output **before** the harness can validate it.

Provider-free checks, including cleanup across two separate invocations:

```bash
npm test -- tests/transcript-wire.test.ts tests/outbound-audio.test.ts tests/retained-evidence.test.ts tests/transcript-wire-artifacts.test.ts tests/lesson-runtime-scheduling.test.ts
npm run test:browser -- tests/browser/transport-output.spec.ts --grep 'wire diagnostics|outbound counters'
npm run test:browser -- tests/browser/retained-diagnostics.spec.ts
npm run test:browser -- tests/browser/retained-diagnostics.spec.ts
rg --files --hidden --no-ignore .sprout-evidence -g index.json
```

The retention browser test uses an isolated HTML page and mock observation bridge,
real fixture audio, and actual filesystem retention. The second invocation compares
all previous indexed payload bytes for this fixture. The local WebRTC peer test
uses real RTP and the production transport/parser; the runtime unit test uses the
real parser and runtime with a mock transport. None establishes live recognition.
When a developer Next server already holds the checkout lock, use an isolated
source copy with blank provider credential environment variables for browser
verification, without interrupting that server.

After authorized live voice runs, compare the **retained** paths listed in each
index, rather than relying on the latest Playwright directory:

```bash
node -e 'const fs=require("node:fs"); for (const p of process.argv.slice(1)) { const h=JSON.parse(fs.readFileSync(p,"utf8")); console.log(JSON.stringify({path:p,attemptId:h.attemptId,runtimeId:h.runtimeId,delivery:h.transcriptDelivery,playback:h.outboundPlayback,problems:h.problems},null,2)); }' .sprout-evidence/<Albert-attempt-runtime>/harness.json .sprout-evidence/<Samantha-attempt-runtime>/harness.json
```

Also inspect the ordinary reports for current-turn recognized text, classifier
reason and injection outcome. Playback and transport evidence cannot retroactively
recover the overwritten `1a9ded60-7b1b-4abd-8890-5c72a7f7bc1a` wire events. Live
recognition and filler recovery remain unverified; no production fix is claimed.

## Controlled voice comparison

Both fixtures author exactly `Uh, I think, uh, there are three butterflies.` at
130 words/minute using local macOS `say`. Both use the existing microphone loader,
SHA-256 verification, Web Audio decoding and destination `MediaStream` playback.
FFmpeg settings match: `loudnorm=I=-16:TP=-1.5:LRA=11`, mono 24 kHz signed 16-bit PCM
WAV, with metadata removed. Only the requested synthesis voice changes. No
stretching or trimming is used to equalize durations; duration/prosody are intrinsic
to this voice change, so this is not a phoneme-controlled experiment.

| Selection | Fixture | Duration | SHA-256 |
| --- | --- | --- | --- |
| Albert (default) | `hesitant-three.wav` | 3.019708 s | `e3f009524cefe2ed9dd7b16a2b19be1071e01a6d44f50bb55a39db51381f0144` |
| Samantha | `hesitant-three-samantha.wav` | 3.706458 s | `a7be61d3b5f59507121f00bb5856cd24577703c7dbaf74772a1458e4923cca0b` |

`tests/fixtures/speech/manifest.json` stores exact synthesis/conversion argv and
local tool versions. Run those commands on the same macOS/voice/FFmpeg versions
to reproduce; version changes may change checksums. Keep the committed bytes for
comparison. No voice download, network synthesis or billed service is required.
`tests/speech-voice-comparison.test.ts` verifies text/settings/checksums, actual WAV
format, duration and unclipped nonzero samples. Chromium verifies both fixtures
play fully through the same synthetic microphone path.

Provider-free checks:

```bash
npm test -- tests/transcript-wire.test.ts tests/speech-voice-comparison.test.ts tests/child-scenario.test.ts
npm run test:browser -- tests/browser/transport-output.spec.ts --grep 'wire diagnostics'
npm run test:browser -- tests/browser/injection-window.spec.ts

# Discovery only: retain --list, use synthetic credentials, no provider calls.
SPROUT_BUTTERFLY_ANSWER_VOICE=Albert OPENAI_API_KEY=discovery-only TYPESAFE_API_KEY=discovery-only npm run test:browser:live -- butterfly.spec.ts --grep '@filler-confirmation' --list
SPROUT_BUTTERFLY_ANSWER_VOICE=Samantha OPENAI_API_KEY=discovery-only TYPESAFE_API_KEY=discovery-only npm run test:browser:live -- butterfly.spec.ts --grep '@filler-confirmation' --list
```

**Pending explicit live authorization.** The following execution commands incur
GPT-Live and Jev charges. Use real credentials only through the secure invoking
environment; do not read credential files. There is one session per command,
zero Playwright retries, one worker, the same 120-second test budget, the same
prerequisites, short Albert `uh` filler, injection requirements, observation
budget and semantic assertions. Each session may make multiple classifier calls,
including at most one fresh clarification per prerequisite after the existing
verified semantic abstention; failures still incur charges. No precise dollar
cost is estimated because provider usage and request count vary.

```bash
# Run only after explicit authorization. Use a fresh run suffix each time.
SPROUT_BUTTERFLY_ANSWER_VOICE=Albert npm run test:browser:live -- butterfly.spec.ts --grep '@filler-confirmation' --output=test-results/voice-comparison/albert-run-1
SPROUT_BUTTERFLY_ANSWER_VOICE=Samantha npm run test:browser:live -- butterfly.spec.ts --grep '@filler-confirmation' --output=test-results/voice-comparison/samantha-run-1
```

Separate output directories avoid overwriting the other voice's evidence.
Record runtime IDs from each report before comparing; archive directories before
reusing names. Confirm `preload` and `sayFixture` records name the intended fixture,
full playback ended, then compare wire delivery, rejection/snapshot evidence,
recognized learner wording, classifier decision and injection outcome. Do not
compare only pass/fail. A prerequisite failure or incomplete capture does not
establish target voice behavior. Invalid voice selections fail discovery before
any test runs. Default Albert selection preserves existing harness behavior.

## Prior evidence provenance

The handoff reports missing learner snapshots/rejections for runtime
`1a9ded60-7b1b-4abd-8890-5c72a7f7bc1a`, with playback around 26.065–29.161 s,
VAD onset 26.260 s and end 30.077 s, tutor confirmation, and classification blocked
for `missing_current_turn_child_transcript`. Those artifacts were overwritten;
this is handoff evidence, not newly verified wire evidence. The handoff also
reports misrecognition of “I think” as “I see two” in runtime
`faef4831-7133-4f69-9904-f769b1739eae`. Current artifact inspection during this work
found runtime `270555b4-1be3-40c2-a8f0-7e84e772e1e8`, so neither earlier runtime is
attributed to that directory. New diagnostics cannot retroactively recover those
missing wire events. Live delivery and comparative ASR behavior remain pending.
