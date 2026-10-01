# Lesson startup latency

## Investigation

The demo's attempt-relative timestamps were Live start at about 5,732 ms,
`lesson.started` at 5,733 ms, initial scene immediately afterward, and first tutor
transcript at about 8,722 ms. The old diagnostics cannot attribute the preceding
5.7 seconds to individual dependencies.

Before this change, startup followed this path:

1. The hydrated lesson's start button constructs one recorder, transport and
   `LessonSession`. The initial lesson/scene data is already local; there is no
   async lesson fetch. Page initialization and saved-record recovery do not block
   the start handler.
2. Durable session creation is queued independently; the app does not await it.
3. The transport registers callbacks and waits for `getUserMedia`.
4. It builds the recording mix, **awaits `AudioContext.resume()`**, then installs
   the microphone detector and track-end callbacks.
5. Only then does it create a peer, install track/connection/data-channel
   listeners, create the SDP offer, apply it, and wait for ICE gathering.
6. `/api/live` uses the server's configured credential to create one provider
   session and obtain the SDP answer. There is no separate browser auth/token
   exchange. The browser applies remote SDP and observes provider `session.started`.
7. `LessonSession` starts recording and lesson timers, marks the lesson active,
   and asks React to display the initial scene.
8. After React commits and two animation frames give a paint opportunity, the
   app sends the first `session.instructions.append`. Provider generation and
   media/transcript delivery follow.

Two controllable waits were unnecessary: recording resume preceded all connection
work, and rendering the local scene waited for Live. The post-instruction provider
generation delay is independent of those waits.

## Sequencing change

The initial scene and unchanged greeting are prepared at attempt start. React
displays the scene during `starting`, while the voice indicator says “Connecting…”.
The existing paint confirmation now accepts this initial scene during startup.

After microphone acquisition, recording/VAD initialization runs concurrently with
offer/ICE/provider/SDP setup. The microphone remains a real prerequisite of the
offer; no prewarming, persistent sessions, extra provider requests or speculative
connections are added.

Initial readiness joins completed media setup, applied remote SDP, an open data
channel and the provider's `session.started`. Media setup retains the existing
recording-unavailable/VAD-fallback behavior. The greeting is consumed and sent
exactly once after both this readiness and scene paint confirmation. Either may
finish first. Transport listeners are installed before negotiation, and late
callbacks after stop/failure cannot complete startup.

Lesson status stays `starting` until genuine readiness. Lesson timers, audio
capture and durable activation still begin at Live start. When the scene painted
earlier, its canonical evidence records the scene present at that Live origin;
the local diagnostics preserve the actual earlier paint timestamp. Scene advancement,
answer evaluation, Jev deadlines, response gates and source replacement retain
their existing rules.

## Timing diagnostics

The existing diagnostic download now includes `startup.*` milestones in `events`
and a `startup` timing summary. Startup milestones are observed once and the
summary survives rollover of the bounded general event log. Missing milestones
remain `null` on incomplete or failed attempts.

The summary covers attempt start, media start, microphone acquisition, media ready,
connection start, offer ready, ICE ready, provider request/response, remote SDP,
provider session start, usable Live readiness, lesson state, initial scene paint,
initial instruction, first provider output, first tutor transcript and first decoded
tutor speech. Derived durations include the requested attempt/Live/scene/instruction/
output intervals, plus media setup and provider request time.

Provider output observes the first output data-channel event (including output events
the lesson parser otherwise ignores), or a transcript/media observation when that
is the first available signal. Speech observes decoded remote media activity;
transcript and media observations do not prove that the child heard speech.

`provider_request_ms` includes the local API route, network round trip and provider
session creation. It cannot by itself distinguish those costs. SDP-to-provider-start
time exposes subsequent connection establishment when those observations occur in
that order. Provider generation and delivery after the initial instruction remain
outside this sequencing change. ICE and microphone permission/device timing remain
browser/network/device dependencies. No fresh live-provider before/after measurement
has been made; the supplied demo timestamps should not be compared to mocked tests
as a measured speedup.

## Verification

- `tests/browser-transport.test.ts`: deferred recording resume proves connection
  setup reaches remote SDP while media is still pending; readiness additionally
  waits for channel opening and emits once. Teardown during concurrent setup stops
  resources and rejects late completion.
- `tests/session-startup.test.ts`: scene-first and Live-first orderings, identical
  greeting, one start/prompt/scene/recording, durable creation concurrency, early
  scene evidence at Live origin, failure/timeout/stop/rejection/send failure, and
  exact diagnostic durations using a controlled clock.
- `tests/browser/lesson.spec.ts`: visible scene before microphone/Live readiness,
  one session/greeting, cleanup on provider failure and a valid fresh retry. Retry
  recording assertions wait for recording rather than equating scene visibility
  with readiness.
- Existing unit and real-WebRTC browser tests exercise Jev deadlines, scene
  progression, playback gates, stale-output discard and replacement cancellation.

Validation on this checkout: 693 unit tests passed; typecheck, lint and formatting
passed. All 33 lesson/transport browser tests other than the two baseline failures
passed after correcting the retry test's scene/readiness assumption. Those two
failures (linked delegation response and revised STAY's second evaluation) reproduce
with the saved pre-change lesson, session and transport in an isolated checkout.
They are outside this startup fix. The isolated baseline used Webpack because
Turbopack rejects the shared dependency symlink outside its filesystem root.
