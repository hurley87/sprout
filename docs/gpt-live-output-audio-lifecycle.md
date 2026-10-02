# GPT-Live WebRTC output lifecycle investigation

On 2026-10-02, a real `/v1/live/sessions` WebRTC session confirmed its model as
`gpt-live-1` and produced two spoken replies. Neither
`output_audio_buffer.started` nor `output_audio_buffer.stopped` appeared in the
raw data-channel traffic. No alternate output lifecycle event appeared either.
This is a bounded negative observation from one session, not proof that every
GPT-Live configuration or future version behaves identically.

## Method and evidence

The probe uses production `BrowserTransport` and the configured local `/api/live`
route, without `LessonSession`, Jev, scene transitions, or replacement sources.
Two synthetic microphone utterances request a greeting/counting introduction
and a short description of ducks. Each has a 20-second observation window after
microphone playback. These waits only collect evidence; they do not establish
provider playback completion. Production prompts are unchanged.

The optional diagnostic sink captures the original data-channel message before
parsing, alongside application-owned source identity, current source identity,
authority, and `performance.now()` receipt time. Provider fields cannot overwrite
these labels. Capturing an unknown event does not forward it to the lesson layer.

The successful run began at 2026-10-02 16:42:54 EDT. From `session.started` to
`session.closed`, it captured 49,697 ms and 48 raw messages, all from source 1:

| Event | Count |
| --- | ---: |
| `session.started` | 1 |
| `session.input_transcript.delta` | 17 |
| `session.output_transcript.delta` | 26 |
| `session.usage.updated` | 3 |
| `session.closed` | 1 |
| `output_audio_buffer.started` | 0 |
| `output_audio_buffer.stopped` | 0 |

The two replies greeted the speaker and described ducks. There were 18 local
active-media observations, 206,020 inbound audio bytes, and 2,387 inbound packets.
Before close, the peer was connected and the audio element was attached,
unmuted, and not paused. No transport failure occurred; closure was
`close_requested`. Local media activity is not response completion.

Raw evidence is saved locally in the ignored file
`test-results/output-audio-lifecycle/2026-10-02-probe-1/results.json`.

## Repeat the probe

With the configured local app running, execute:

```sh
node scripts/live-output-audio-lifecycle.mjs
```

This invokes one billed GPT-Live session. `BASE_URL` selects the local app;
`LIVE_OUT` selects an artifact directory. The default directory is unique per
run. The probe saves all raw messages, event counts, microphone actions, and media
statistics, including partial evidence if it fails. No lifecycle parser/types,
response correlation, completion timer, or choreography change was added.
