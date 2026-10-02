import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { validateObserverProposal, type ObserverProposal } from "../lib/observation-contracts";
import type { EvaluateAnswer } from "../lib/answer";
import { audioElement, captureMocks, liveConnection, recordedBrowserLesson } from "./helpers/recorded-browser-lesson";
import { responseSceneValidity, sessionSpeechInterval } from "../lib/evidence-timing";
import type { TimelineEvent } from "../lib/session-recorder";
import { REPLACEMENT_TIMEOUT_MS, BrowserTransport, microphoneTrackSettings } from "../lib/browser-transport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const seed = {
  sceneIndex: 2,
  evaluatedSceneIndex: 1,
  decision: "ADVANCE" as const,
  childUtterance: "Two",
  transcriptRevision: 1,
  answerVersion: "0:Two",
};

describe("raw WebRTC server diagnostics", () => {
  it("observes unknown events before parsing without trusting provider source identity", async () => {
    const connection = liveConnection();
    const events = vi.fn();
    const raw = vi.fn();
    const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
    transport.setRawServerEventSink(raw);
    await transport.start(events, vi.fn());
    const before = events.mock.calls.length;
    const data = JSON.stringify({
      type: "output_audio_buffer.stopped",
      event_id: "event_stop",
      response_id: "resp_probe",
      sourceId: 999,
    });
    connection.channel.onmessage?.({ data });
    expect(raw).toHaveBeenLastCalledWith({
      sourceId: 1,
      activeSourceId: 1,
      authoritative: true,
      receivedAt: expect.any(Number),
      data,
    });
    // Capturing an undocumented Live event does not manufacture internal support.
    expect(events).toHaveBeenCalledTimes(before);
    transport.close();
  });

  it("labels pending and retired traffic without forwarding it as current-source events", async () => {
    const a = liveConnection();
    const events = vi.fn();
    const raw = vi.fn();
    const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
    transport.setRawServerEventSink(raw);
    await transport.start(events, vi.fn());
    const b = liveConnection();
    const idB = await transport.prepareReplacement(seed);
    const data = JSON.stringify({ type: "session.output_transcript.delta", delta: "probe", start_ms: 0, end_ms: 1 });
    const before = events.mock.calls.length;
    b.channel.onmessage?.({ data });
    expect(raw).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: idB, activeSourceId: 1, authoritative: false }),
    );
    expect(events).toHaveBeenCalledTimes(before);
    expect(transport.activateSource(idB)).toBe(true);
    const promoted = events.mock.calls.length;
    a.channel.onmessage?.({ data });
    expect(raw).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: 1, activeSourceId: idB, authoritative: false }),
    );
    expect(events).toHaveBeenCalledTimes(promoted);
    b.channel.onmessage?.({ data });
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ type: "transcript", sourceId: idB }));
    transport.close();
    const captured = raw.mock.calls.length;
    b.channel.onmessage?.({ data });
    expect(raw).toHaveBeenCalledTimes(captured);
  });

  it("keeps provider dispatch intact when the diagnostic collector fails", async () => {
    const connection = liveConnection();
    const events = vi.fn();
    const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
    transport.setRawServerEventSink(() => {
      throw new Error("collector failed");
    });
    await transport.start(events, vi.fn());
    connection.channel.onmessage?.({ data: JSON.stringify({ type: "session.usage.updated", usage: { seconds: 1 } }) });
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "usage", sourceId: 1, usage: { seconds: 1 } }),
    );
    transport.close();
  });
});

it("exports only useful microphone settings and excludes device identifiers", () => {
  const track = {
    getSettings: () => ({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
      latency: 0.02,
      deviceId: "private-device",
      groupId: "private-group",
    }),
  } as unknown as MediaStreamTrack;
  expect(microphoneTrackSettings(track)).toEqual({
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
    latency: 0.02,
  });
});

describe("BrowserTransport output gating", () => {
  it("permanently discards stale output while retaining child input and routes the next response only through B", async () => {
    const audio = audioElement();
    const a = liveConnection();
    const events = vi.fn();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    await transport.start(events, vi.fn());
    a.peer.ontrack?.({ track: a.remoteTrack });
    expect(transport.discardOutput()).toBe(true);
    expect(audio.srcObject).toBeNull();
    expect(audio.muted).toBe(true);
    expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(a.peer.close).not.toHaveBeenCalled();
    expect(a.channel.close).not.toHaveBeenCalled();
    expect(a.micTrack.stop).not.toHaveBeenCalled();
    a.channel.onmessage?.({
      data: JSON.stringify({ type: "session.input_transcript.delta", delta: "no, two", start_ms: 0, end_ms: 100 }),
    });
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ speaker: "child", delta: "no, two", sourceId: 1 }));
    const lateTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    a.peer.ontrack?.({ track: lateTrack });
    transport.setOutputBlocked(false);
    expect(lateTrack.stop).toHaveBeenCalledOnce();
    expect(audio.srcObject).toBeNull();
    expect(audio.muted).toBe(true);
    const b = liveConnection();
    const id = await transport.prepareReplacement(seed);
    b.peer.ontrack?.({ track: b.remoteTrack });
    expect(audio.srcObject).toBeNull();
    expect(transport.activateSource(id)).toBe(true);
    transport.send({
      type: "session.instructions.append",
      event_id: "outcome",
      content: "Current scene",
      delegation_id: null,
    });
    transport.setOutputBlocked(false);
    expect(audio.srcObject).not.toBeNull();
    expect(audio.muted).toBe(false);
    expect(b.channel.send).toHaveBeenCalledOnce();
    expect(a.channel.send).not.toHaveBeenCalled();
    const count = events.mock.calls.length;
    a.channel.onmessage?.({
      data: JSON.stringify({ type: "session.output_transcript.delta", delta: "late A", start_ms: 0, end_ms: 100 }),
    });
    expect(events).toHaveBeenCalledTimes(count);
    transport.close();
  });

  it("discards before track arrival and rejects late play completion", async () => {
    const audio = audioElement();
    let resolvePlay!: () => void;
    audio.play.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvePlay = resolve;
        }),
    );
    const a = liveConnection();
    const failures = vi.fn();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    await transport.start(vi.fn(), failures);
    a.peer.ontrack?.({ track: a.remoteTrack });
    transport.discardOutput();
    resolvePlay();
    await Promise.resolve();
    expect(audio.srcObject).toBeNull();
    expect(audio.muted).toBe(true);
    expect(failures).not.toHaveBeenCalled();
    transport.close();

    const early = liveConnection();
    const nextAudio = audioElement();
    const next = new BrowserTransport(nextAudio as unknown as HTMLAudioElement);
    await next.start(vi.fn(), failures);
    expect(next.discardOutput()).toBe(true);
    early.peer.ontrack?.({ track: early.remoteTrack });
    expect(early.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(nextAudio.play).not.toHaveBeenCalled();
    expect(nextAudio.srcObject).toBeNull();
    next.close();
  });

  it("blocks before the remote track arrives, then unblocks during continuous playback", async () => {
    const audio = audioElement();
    const { channel, peer, remoteTrack } = liveConnection();
    const onEvent = vi.fn();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);

    transport.setOutputBlocked(true);
    transport.setOutputBlocked(true);
    expect(audio.muted).toBe(true);
    await transport.start(onEvent, vi.fn());
    peer.ontrack?.({ track: remoteTrack });
    expect(audio.srcObject).not.toBeNull();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.muted).toBe(true);
    expect(audio.pause).not.toHaveBeenCalled();

    channel.onmessage?.({
      data: JSON.stringify({ type: "session.output_transcript.delta", delta: "hello", start_ms: 0, end_ms: 500 }),
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "transcript", speaker: "sprout", delta: "hello" }),
    );
    transport.setOutputBlocked(false);
    transport.setOutputBlocked(false);
    expect(audio.muted).toBe(false);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(peer.close).not.toHaveBeenCalled();
    expect(channel.close).not.toHaveBeenCalled();
    expect(remoteTrack.stop).not.toHaveBeenCalled();
  });

  it("clears a blocked output on teardown and ignores late calls", async () => {
    const audio = audioElement();
    const { peer, remoteTrack } = liveConnection();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    await transport.start(vi.fn(), vi.fn());
    peer.ontrack?.({ track: remoteTrack });
    transport.setOutputBlocked(true);
    transport.stopMedia();
    expect(audio.muted).toBe(false);
    expect(audio.srcObject).toBeNull();
    expect(peer.close).toHaveBeenCalledOnce();
    transport.close();
    expect(peer.close).toHaveBeenCalledOnce();
    transport.setOutputBlocked(true);
    transport.close();
    expect(audio.muted).toBe(false);
  });
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

it("overlaps recording resume with connection setup and joins media, SDP, provider start and channel readiness once", async () => {
  const { peer, channel } = liveConnection();
  const { context } = captureMocks();
  const media = deferred();
  const sdp = deferred();
  context.resume.mockImplementation(() => media.promise);
  channel.readyState = "connecting";
  peer.setRemoteDescription.mockImplementation(async () => {
    channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
    sdp.resolve();
  });
  const events = vi.fn();
  const diagnostic = vi.fn();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  transport.setStartupDiagnosticSink(diagnostic);
  const starting = transport.start(events, vi.fn());
  await sdp.promise;
  // SDP/provider setup finishes while recording resume is deliberately unresolved.
  expect(fetch).toHaveBeenCalledOnce();
  expect(events.mock.calls.filter(([event]) => event.type === "session.started")).toHaveLength(0);
  expect(diagnostic).toHaveBeenCalledWith("startup.provider_request_started");
  expect(diagnostic).not.toHaveBeenCalledWith("startup.media_ready");
  media.resolve();
  await starting;
  expect(events.mock.calls.filter(([event]) => event.type === "session.started")).toHaveLength(0);
  channel.readyState = "open";
  channel.onopen?.();
  channel.onopen?.();
  channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(events.mock.calls.filter(([event]) => event.type === "session.started")).toHaveLength(1);
  expect(peer.createOffer).toHaveBeenCalledOnce();
  channel.onmessage?.({ data: JSON.stringify({ type: "session.output_audio.delta" }) });
  expect(diagnostic).toHaveBeenCalledWith("startup.first_provider_output");
  transport.close();
});

it("closes parallel startup safely while media resume is delayed, ignoring late completions", async () => {
  const { peer, channel, micTrack } = liveConnection();
  const { context } = captureMocks();
  const media = deferred();
  const sdp = deferred();
  context.resume.mockImplementation(() => media.promise);
  peer.setRemoteDescription.mockImplementation(async () => {
    channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
    sdp.resolve();
  });
  const events = vi.fn();
  const failures = vi.fn();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  const starting = transport.start(events, failures);
  await sdp.promise;
  transport.close();
  media.resolve();
  await starting;
  channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  channel.onopen?.();
  expect(events.mock.calls.filter(([event]) => event.type === "session.started")).toHaveLength(0);
  expect(micTrack.stop).toHaveBeenCalledOnce();
  expect(peer.close).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(failures).not.toHaveBeenCalled();
});

it("only forwards microphone settings when the attempt explicitly opts in", async () => {
  const { micTrack } = liveConnection();
  Object.assign(micTrack, { getSettings: () => ({ sampleRate: 48000, deviceId: "private" }) });
  captureMocks();
  const off = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  const offSink = vi.fn();
  off.setMicrophoneDiagnosticSink(offSink);
  await off.start(vi.fn(), vi.fn());
  expect(offSink).not.toHaveBeenCalled();
  off.stopMedia();

  const optedIn = liveConnection();
  Object.assign(optedIn.micTrack, { getSettings: () => ({ sampleRate: 48000, deviceId: "private" }) });
  captureMocks();
  const on = new BrowserTransport(audioElement() as unknown as HTMLAudioElement, true);
  const onSink = vi.fn();
  on.setMicrophoneDiagnosticSink(onSink);
  await on.start(vi.fn(), vi.fn());
  expect(onSink).toHaveBeenCalledWith({ type: "microphone.track_settings", detail: { sampleRate: 48000 } });
  on.stopMedia();
});

it("mixes mic and permitted remote audio, starts at live boundary, and finishes once", async () => {
  const { peer, remoteTrack, micTrack } = liveConnection();
  const { sources, gain, mix, context, recorders } = captureMocks();
  const audio = audioElement();
  let play!: () => void;
  audio.play.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        play = resolve;
      }),
  );
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  expect(recorders).toHaveLength(0);
  peer.ontrack?.({ track: remoteTrack });
  expect(gain.gain.value).toBe(0);
  transport.startRecording();
  transport.startRecording();
  expect(recorders).toHaveLength(1);
  expect(recorders[0].stream).toBe(mix.stream);
  expect(sources[0].connect).toHaveBeenCalledWith(mix);
  expect(sources.at(-1)?.connect).toHaveBeenCalledWith(gain);
  expect(gain.connect).toHaveBeenCalledWith(mix);
  play();
  await Promise.resolve();
  expect(gain.gain.value).toBe(1);
  transport.setOutputBlocked(true);
  expect(audio.muted).toBe(true);
  expect(gain.gain.value).toBe(0);
  expect(sources[0].disconnect).not.toHaveBeenCalled();
  transport.setOutputBlocked(false);
  expect(audio.muted).toBe(false);
  expect(gain.gain.value).toBe(1);
  transport.stopMedia();
  transport.stopMedia();
  transport.close();
  transport.close();
  const recording = await transport.recording();
  expect(recording).toMatchObject({ startOffsetMs: 0, mimeType: "audio/webm;codecs=opus" });
  expect(recording?.blob.size).toBeGreaterThan(0);
  expect(recording?.durationMs).toBeGreaterThanOrEqual(0);
  expect(context.close).toHaveBeenCalledOnce();
  expect(micTrack.stop).toHaveBeenCalledOnce();
  expect(remoteTrack.stop).toHaveBeenCalledOnce();
  expect(peer.close).toHaveBeenCalledOnce();
});

it("explicitly fails capture when unsupported without disrupting the connection", async () => {
  liveConnection();
  vi.stubGlobal("MediaRecorder", undefined);
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  expect(() => transport.startRecording()).toThrow("unavailable");
  transport.close();
  await expect(transport.recording()).rejects.toThrow("unavailable");
});

it("rejects unexpectedly stopped or errored capture", async () => {
  liveConnection();
  const { recorders } = captureMocks();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  transport.startRecording();
  recorders[0].stop();
  await Promise.resolve();
  transport.close();
  await expect(transport.recording()).rejects.toThrow("unexpectedly");
});

it.each(["error", "empty"])("reports %s recording instead of claiming usable audio", async failure => {
  liveConnection();
  const { recorders } = captureMocks();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  transport.startRecording();
  if (failure === "error") recorders[0].onerror?.();
  else
    recorders[0].stop = () => {
      recorders[0].state = "inactive";
      queueMicrotask(() => recorders[0].onstop?.());
    };
  transport.close();
  await expect(transport.recording()).rejects.toThrow(failure === "error" ? "failed" : "empty");
});

it("late remote tracks and play resolution cannot restore output after stop", async () => {
  const { peer, remoteTrack } = liveConnection();
  const audio = audioElement();
  let finishPlay!: () => void;
  audio.play.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finishPlay = resolve;
      }),
  );
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  transport.setOutputBlocked(true);
  await transport.start(vi.fn(), vi.fn());
  peer.ontrack?.({ track: remoteTrack });
  transport.stopMedia();
  finishPlay();
  await Promise.resolve();
  const late = { stop: vi.fn() } as unknown as MediaStreamTrack;
  peer.ontrack?.({ track: late });
  expect(late.stop).toHaveBeenCalledOnce();
  expect(audio.srcObject).toBeNull();
  expect(audio.pause).toHaveBeenCalledOnce();
  expect(audio.play).toHaveBeenCalledOnce();
  transport.close();
});

describe("production response-source isolation", () => {
  it("keeps B detached, retires A before promotion, rejects every late A callback, and routes send to B", async () => {
    const a = liveConnection();
    const audio = audioElement();
    let resolveA!: () => void;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveA = resolve;
        }),
    );
    const events = vi.fn();
    const failures = vi.fn();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    await transport.start(events, failures);
    const idA = transport.activeSourceId!;
    a.peer.ontrack?.({ track: a.remoteTrack });
    const streamA = audio.srcObject;
    const b = liveConnection();
    const idB = await transport.prepareReplacement(seed);
    expect(idB).toBeGreaterThan(idA);
    b.peer.ontrack?.({ track: b.remoteTrack });
    expect(audio.srcObject).toBe(streamA);
    expect(audio.play).toHaveBeenCalledOnce();
    const count = events.mock.calls.length;
    a.peer.connectionState = "failed";
    const lateA = () => {
      for (const raw of [
        { type: "session.output_transcript.delta", delta: "late", start_ms: 0, end_ms: 1 },
        { type: "session.closed" },
        { type: "error" },
      ])
        a.channel.onmessage?.({ data: JSON.stringify(raw) });
      a.channel.onmessage?.({ data: "invalid json" });
      (a.channel.onclose as (() => void) | null)?.();
      (a.channel.onerror as (() => void) | null)?.();
      (a.peer.onconnectionstatechange as (() => void) | null)?.();
    };
    const teardown: string[] = [];
    a.channel.close.mockImplementation(() => {
      teardown.push("channel");
      expect(transport.activeSourceId).toBeUndefined();
      expect(audio.srcObject).toBeNull();
      expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
      expect(transport.activateSource(idA)).toBe(false);
      lateA();
    });
    a.peer.close.mockImplementation(() => {
      teardown.push("peer");
      expect(a.channel.close).toHaveBeenCalledOnce();
      a.peer.connectionState = "closed";
      lateA();
    });
    // Synchronous media and network teardown callbacks see A invalidated.
    vi.mocked(a.remoteTrack.stop).mockImplementation(() => {
      expect(transport.activeSourceId).toBeUndefined();
      expect(audio.muted).toBe(true);
      expect(audio.srcObject).toBeNull();
      teardown.push("remote");
      lateA();
    });
    transport.retireSource(idA);
    transport.retireSource(idA);
    expect(teardown).toEqual(["remote", "channel", "peer"]);
    expect(a.channel.close).toHaveBeenCalledOnce();
    expect(a.peer.close).toHaveBeenCalledOnce();
    expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(b.channel.close).not.toHaveBeenCalled();
    expect(b.peer.close).not.toHaveBeenCalled();
    expect(b.remoteTrack.stop).not.toHaveBeenCalled();
    expect(a.micTrack.stop).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledTimes(count);
    transport.setOutputBlocked(false);
    expect(audio.muted).toBe(true);
    expect(transport.activateSource(idA)).toBe(false);
    expect(transport.activateSource(idB)).toBe(true);
    expect(audio.srcObject).not.toBe(streamA);
    expect(audio.muted).toBe(true);
    resolveA();
    await Promise.resolve();
    const lateTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    a.peer.ontrack?.({ track: lateTrack });
    lateA();
    expect(lateTrack.stop).toHaveBeenCalledOnce();
    expect(failures).not.toHaveBeenCalled();
    expect(events.mock.calls.slice(count)).toEqual([[{ type: "output.activity", state: "unavailable", sourceId: 2 }]]);
    transport.setOutputBlocked(false);
    expect(audio.muted).toBe(false);
    const command = { type: "session.close" as const, event_id: "test" };
    transport.send(command);
    expect(a.channel.send).not.toHaveBeenCalled();
    expect(b.channel.send).toHaveBeenCalledOnce();
    expect(b.channel.close).not.toHaveBeenCalled();
    expect(b.peer.close).not.toHaveBeenCalled();
    transport.close();
    transport.close();
    expect(a.peer.close).toHaveBeenCalledOnce();
    expect(b.peer.close).toHaveBeenCalledOnce();
    expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(b.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(a.micTrack.stop).toHaveBeenCalledOnce();
  });

  it("lesson teardown retires both current and pending and cannot promote after stop", async () => {
    const a = liveConnection();
    const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
    await transport.start(vi.fn(), vi.fn());
    a.peer.ontrack?.({ track: a.remoteTrack });
    const b = liveConnection();
    const idB = await transport.prepareReplacement(seed);
    b.peer.ontrack?.({ track: b.remoteTrack });
    transport.stopMedia();
    transport.stopMedia();
    expect(transport.activateSource(idB)).toBe(false);
    expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(b.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(a.micTrack.stop).toHaveBeenCalledOnce();
    transport.close();
    expect(a.peer.close).toHaveBeenCalledOnce();
    expect(b.peer.close).toHaveBeenCalledOnce();
  });

  it("rejects overlapping preparations and cancellation during setup without touching A", async () => {
    const a = liveConnection();
    const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
    await transport.start(vi.fn(), vi.fn());
    const idA = transport.activeSourceId;
    const b = liveConnection();
    let offer!: (value: { type: string; sdp: string }) => void;
    b.peer.createOffer.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          offer = resolve;
        }),
    );
    const preparing = transport.prepareReplacement(seed);
    await expect(transport.prepareReplacement(seed)).rejects.toThrow("already pending");
    // IDs are monotonically allocated, so the first pending source follows A.
    expect(transport.activateSource(idA! + 1)).toBe(false);
    transport.retireSource(idA! + 1);
    offer({ type: "offer", sdp: "offer" });
    await expect(preparing).rejects.toThrow("setup ended");
    expect(transport.activeSourceId).toBe(idA);
    expect(a.peer.close).not.toHaveBeenCalled();
    expect(b.peer.close).toHaveBeenCalledOnce();
    transport.close();
  });
});

it("pending connection failure stays local and a late setup completion cannot survive lesson close", async () => {
  const a = liveConnection();
  const failure = vi.fn();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), failure);
  const idA = transport.activeSourceId;
  const b = liveConnection();
  const idB = await transport.prepareReplacement(seed);
  (b.channel.onerror as (() => void) | null)?.();
  expect(transport.activateSource(idB)).toBe(false);
  expect(transport.activeSourceId).toBe(idA);
  expect(b.channel.close).toHaveBeenCalledOnce();
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(a.channel.close).not.toHaveBeenCalled();
  expect(a.peer.close).not.toHaveBeenCalled();
  expect(a.micTrack.stop).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
  const c = liveConnection();
  let answer!: () => void;
  c.peer.setRemoteDescription.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        answer = resolve;
      }),
  );
  const preparing = transport.prepareReplacement(seed);
  // Let setup reach its final await, then end the lesson before it resolves.
  await vi.waitFor(() => expect(c.peer.setRemoteDescription).toHaveBeenCalledOnce());
  transport.close();
  answer();
  await expect(preparing).rejects.toThrow("setup ended");
  expect(transport.activeSourceId).toBeUndefined();
  expect(a.peer.close).toHaveBeenCalledOnce();
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(c.peer.close).toHaveBeenCalledOnce();
  expect(failure).not.toHaveBeenCalled();
});

it("promotion retires a playable A and leaves B's playback and recording blocked", async () => {
  const a = liveConnection();
  const { gain } = captureMocks();
  const audio = audioElement();
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  a.peer.ontrack?.({ track: a.remoteTrack });
  await Promise.resolve();
  expect(gain.gain.value).toBe(1);
  const b = liveConnection();
  const idB = await transport.prepareReplacement(seed);
  b.peer.ontrack?.({ track: b.remoteTrack });
  expect(gain.gain.value).toBe(1); // Pending B has no path into the mix.
  vi.mocked(a.remoteTrack.stop).mockImplementation(() => {
    expect(audio.muted).toBe(true);
    expect(audio.srcObject).toBeNull();
    expect(gain.gain.value).toBe(0);
    expect(transport.activeSourceId).toBeUndefined();
  });
  expect(transport.activateSource(idB)).toBe(true);
  await Promise.resolve();
  expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
  expect(audio.muted).toBe(true);
  expect(gain.gain.value).toBe(0);
  transport.setOutputBlocked(false);
  expect(audio.muted).toBe(false);
  expect(gain.gain.value).toBe(1);
  transport.close();
});

it("SDP and A events cannot qualify B; B started qualifies without promotion or event leakage", async () => {
  const a = liveConnection();
  const events = vi.fn();
  const audio = audioElement();
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  await transport.start(events, vi.fn());
  a.peer.ontrack?.({ track: a.remoteTrack });
  const streamA = audio.srcObject;
  const b = liveConnection(false);
  let resolved = false;
  const preparing = transport.prepareReplacement(seed).then(id => {
    resolved = true;
    return id;
  });
  await vi.waitFor(() => expect(b.peer.setRemoteDescription).toHaveBeenCalledOnce());
  const count = events.mock.calls.length;
  const emitB = (raw: unknown) => b.channel.onmessage?.({ data: JSON.stringify(raw) });
  emitB({ type: "session.output_transcript.delta", delta: "hidden", start_ms: 0, end_ms: 1 });
  emitB({ type: "session.instructions.appended" });
  emitB({ type: 42 });
  a.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  await Promise.resolve();
  expect(resolved).toBe(false);
  expect(transport.activateSource(2)).toBe(false);
  expect(a.peer.close).not.toHaveBeenCalled();
  emitB({ type: "session.started" });
  const id = await preparing;
  expect(id).toBe(2);
  // Initial readiness was already emitted for A. Repeated A readiness and all
  // pending B events stay out of the lesson; neither can promote B implicitly.
  expect(events.mock.calls.slice(count)).toEqual([]);
  expect(transport.activeSourceId).toBe(1);
  expect(audio.srcObject).toBe(streamA);
  expect(a.peer.close).not.toHaveBeenCalled();
  expect(transport.replacementTiming).toMatchObject({ sourceId: 2, clock: "browser.performance.now" });
  const timing = transport.replacementTiming!;
  expect(timing.total_prepare_ms).toBe(timing.replacement_ready_at! - timing.replacement_requested_at);
  expect(timing.request_to_sdp_ms).toBe(timing.provider_response_received_at! - timing.replacement_requested_at);
  expect(timing.sdp_to_session_started_ms).toBe(timing.session_started_at! - timing.provider_response_received_at!);
  expect(timing.remote_description_applied_at).toBeGreaterThanOrEqual(timing.provider_response_received_at!);
  const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(request).toEqual({ sdp: "offer", replacement: seed });
  transport.close();
});

it.each([
  "provider error",
  "provider close",
  "channel error",
  "channel close",
  "peer failure",
  "retire",
  "stop",
  "timeout",
  "stalled SDP",
])("%s before started rejects, closes B, and ignores late started", async cause => {
  const a = liveConnection();
  const failure = vi.fn();
  const events = vi.fn();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(events, failure);
  const b = liveConnection(false);
  if (cause === "stalled SDP") b.peer.setRemoteDescription.mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers();
  const preparing = transport.prepareReplacement(seed);
  const rejection = expect(preparing).rejects.toThrow();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(b.peer.setRemoteDescription).toHaveBeenCalledOnce();
  if (cause === "provider error" || cause === "provider close")
    b.channel.onmessage?.({ data: JSON.stringify({ type: cause === "provider error" ? "error" : "session.closed" }) });
  else if (cause === "channel error") (b.channel.onerror as (() => void) | null)?.();
  else if (cause === "channel close") (b.channel.onclose as (() => void) | null)?.();
  else if (cause === "peer failure") {
    b.peer.connectionState = "failed";
    (b.peer.onconnectionstatechange as (() => void) | null)?.();
  } else if (cause === "retire") transport.retireSource(2);
  else if (cause === "stop") transport.stopMedia();
  else await vi.advanceTimersByTimeAsync(REPLACEMENT_TIMEOUT_MS);
  await rejection;
  const count = events.mock.calls.length;
  b.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(events).toHaveBeenCalledTimes(count);
  expect(transport.activateSource(2)).toBe(false);
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(b.channel.close).toHaveBeenCalledOnce();
  expect(transport.replacementTiming?.replacement_ready_at).toBeUndefined();
  if (cause !== "stop") {
    expect(transport.activeSourceId).toBe(1);
    expect(a.peer.close).not.toHaveBeenCalled();
  }
  expect(failure).not.toHaveBeenCalled();
  transport.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("invalid replacement seed fails before creating a connection or paid request", async () => {
  const a = liveConnection();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  vi.mocked(fetch).mockClear();
  await expect(transport.prepareReplacement({ ...seed, sceneIndex: -1 })).rejects.toThrow("Invalid");
  expect(fetch).not.toHaveBeenCalled();
  expect(a.peer.close).not.toHaveBeenCalled();
  transport.close();
});

it("gate cancellation signal immediately retires pending B without stopping A", async () => {
  const a = liveConnection();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  const b = liveConnection(false);
  const abort = new AbortController();
  const preparing = transport.prepareReplacement(seed, abort.signal);
  const rejected = expect(preparing).rejects.toThrow("setup ended");
  await vi.waitFor(() => expect(b.peer.setRemoteDescription).toHaveBeenCalledOnce());
  abort.abort();
  await rejected;
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(b.channel.close).toHaveBeenCalledOnce();
  expect(a.peer.close).not.toHaveBeenCalled();
  b.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(transport.activateSource(2)).toBe(false);
  expect(transport.activeSourceId).toBe(1);
  transport.close();
});

function responseEvaluations(f: Awaited<ReturnType<typeof recordedBrowserLesson>>, text: string) {
  const response = f.record.events.find(e => e.evidence?.type === "utterance" && e.evidence.text === text)?.evidence;
  if (response?.type !== "utterance") throw new Error("expected canonical response");
  const keys = new Set(response.transcriptFragments?.map(fragment => fragment.key));
  return f.timelines
    .map(event => event.timeline)
    .filter(
      (timeline): timeline is Extract<TimelineEvent, { type: "evaluation_control" }> =>
        timeline.type === "evaluation_control" &&
        Boolean(timeline.responseIdentity?.fragmentKeys.some(key => keys.has(key))),
    );
}

it("publishes concrete evidence from actual transport, LessonSession and recorder output without a provider clock offset", async () => {
  const f = await recordedBrowserLesson();
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One");
  await f.flush();
  const speech = f.record.events.find(e => e.evidence?.type === "utterance")!.evidence;
  expect(speech).toMatchObject({
    providerTiming: { sourceId: 1, startMs: 1000 },
    firstObservedAtMs: 1100,
    sessionTiming: {
      provenance: "source_timeline_bound",
      sourceId: 1,
      sourceRequestedAtMs: -2000,
      inputOpenedAtMs: 100,
      startMs: 100,
      endMs: 1100,
    },
  });
  expect(validateObserverProposal(f.proposal(), f.record)).toMatchObject({ ok: true });
  // Support must precede every possible start, rather than just receipt.
  const proposal = f.proposal();
  proposal.observation.support = { status: "recorded", kinds: ["hint"], sourceEventIds: ["support"] };
  proposal.sources.push({ eventId: "support", role: "support" });
  f.record.events.push({
    _id: "support",
    atMs: 99,
    evidence: { type: "support", source: "parent", mode: "spoken", description: "Count them." },
  });
  expect(validateObserverProposal(proposal, f.record).ok).toBe(true);
  f.record.events.at(-1)!.atMs = 101;
  expect(validateObserverProposal(proposal, f.record).ok).toBe(false);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("keeps genuine scene ambiguity uncertain even if VAD and arrival agree about the current scene", async () => {
  const f = await recordedBrowserLesson();
  await vi.advanceTimersByTimeAsync(1000);
  // Source input has spanned a transition. No nearest-VAD matching can remove
  // older buffered audio from the possible input interval.
  f.record.events.push({
    _id: "transition",
    atMs: 500,
    evidence: { type: "scene_displayed", sceneId: "other", targetQuantity: 2, items: [], arrangement: "row" },
  });
  f.session.receive({ type: "microphone.speech_started" });
  f.say("One");
  f.session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
  await f.flush();
  const proposal = f.proposal();
  expect(validateObserverProposal(proposal, f.record).ok).toBe(false);
  proposal.observation = {
    behavior: "uncertain_exchange",
    outcome: "uncertain",
    speakerAttribution: "child_or_nearby_speaker",
    countSequenceObserved: false,
    description: "Scene timing is ambiguous.",
    support: { status: "not_established", kinds: [], sourceEventIds: [] },
    uncertaintyReasons: ["conflicting_context"],
  };
  expect(validateObserverProposal(proposal, f.record).ok).toBe(true);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("fences each replacement independently and never supplies microphone audio to a warmup source", async () => {
  const f = await recordedBrowserLesson();
  const b = liveConnection();
  const id = await f.transport.prepareReplacement(seed);
  expect(f.connection.inputs[1].enabled).toBe(false);
  expect(f.connection.inputs[0].enabled).toBe(true);
  expect(f.transport.activateSource(id)).toBe(true);
  expect(f.connection.inputs[0].stop).toHaveBeenCalledOnce();
  expect(f.connection.inputs[1].enabled).toBe(false);
  const fence = vi.fn((sourceId: number) => {
    expect(sourceId).toBe(id);
    expect(f.connection.inputs[1].enabled).toBe(false);
  });
  f.transport.openInput(fence);
  f.transport.openInput(fence);
  expect(fence).toHaveBeenCalledOnce();
  expect(f.connection.inputs[1].enabled).toBe(true);
  b.channel.onmessage?.({
    data: JSON.stringify({ type: "session.input_transcript.delta", delta: "One", start_ms: 0, end_ms: 100 }),
  });
  await f.flush();
  // Promotion without LessonSession's fence cannot reuse A's bound for B.
  expect(f.record.events.find(e => e.evidence?.type === "utterance")?.evidence).not.toHaveProperty("sessionTiming");
  expect(validateObserverProposal(f.proposal(), f.record).ok).toBe(false);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

const advances: EvaluateAnswer = async () => ({
  status: "evaluated",
  probability: 0.99,
  model: "synthetic",
  latencyMs: 1,
});

function proposalForResponse(f: Awaited<ReturnType<typeof recordedBrowserLesson>>, text: string): ObserverProposal {
  const response = f.record.events.find(event => event.evidence?.type === "utterance" && event.evidence.text === text)!;
  const context = response.evidence?.type === "utterance" ? response.evidence.responseScene : undefined;
  const scene = f.record.events.find(
    event => event.evidence?.type === "scene_displayed" && event.evidence.sceneId === context?.sceneId,
  )!;
  const total = text === "One" ? 1 : text === "Two" ? 2 : 3;
  const proposal = f.proposal();
  proposal.exchangeAtMs = response.atMs;
  proposal.observation.statedTotal = total;
  proposal.observation.targetQuantity = total;
  proposal.observation.description = `Said ${text} for ${total} objects.`;
  proposal.sources = [
    { eventId: scene._id, role: "scene" },
    { eventId: response._id, role: "response" },
  ];
  return proposal;
}

it("keeps One -> Two -> Three concrete on consecutive scenes with one real provider source", async () => {
  const f = await recordedBrowserLesson(advances);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 1000);
  await f.flush();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  // An app commit changes the snapshot, but the response and canonical scene
  // stay on the display it answered, including before/after the next display.
  expect(validateObserverProposal(proposalForResponse(f, "One"), f.record).ok).toBe(true);
  f.session.displayed(1);
  expect(validateObserverProposal(proposalForResponse(f, "One"), f.record).ok).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Two", 6000);
  await f.flush();
  expect(f.session.snapshot.sceneIndex).toBe(2);
  expect(validateObserverProposal(proposalForResponse(f, "Two"), f.record).ok).toBe(true);
  f.session.displayed(2);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Three", 9500);
  await f.flush();
  expect(f.session.snapshot.sceneIndex).toBe(3);
  expect(validateObserverProposal(proposalForResponse(f, "Three"), f.record).ok).toBe(true);
  f.session.displayed(3);
  for (const text of ["One", "Two", "Three"]) {
    expect(validateObserverProposal(proposalForResponse(f, text), f.record).ok).toBe(true);
  }
  const two = f.record.events.find(e => e.evidence?.type === "utterance" && e.evidence.text === "Two")!;
  expect(two.evidence).toMatchObject({
    sessionTiming: { sourceId: 1, inputOpenedAtMs: 100, startMs: 4000, endMs: 4600 },
    responseScene: { sceneId: "duck-friends", status: "stable" },
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(f.transport.activeSourceId).toBe(1);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("links a butterfly evaluation after strawberries display and durable flush through immutable fragment joins", async () => {
  const f = await recordedBrowserLesson(advances);
  for (const [index, text, offset] of [
    [0, "One", 1000],
    [1, "Two", 6000],
  ] as const) {
    await vi.advanceTimersByTimeAsync(1000);
    f.say(text, offset);
    await f.flush();
    f.session.displayed(index + 1);
  }
  await f.session.recordingSettled();
  const butterfly = f.record.events.find(
    e => e.evidence?.type === "scene_displayed" && e.evidence.sceneId === "butterfly-garden",
  )!;
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Three", 9500);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.session.snapshot.sceneIndex).toBe(3);
  expect(f.record.events.some(e => e.evidence?.type === "utterance" && e.evidence.text === "Three")).toBe(false);
  f.session.displayed(3);
  await f.flush();
  const evaluated = responseEvaluations(f, "Three").find(e => e.action === "evaluation_result")!;
  expect(evaluated).toMatchObject({
    correlationKey: "2|3|9500:Three|1",
    sceneIndex: 2,
    transcriptRevision: 3,
    answerVersion: "9500:Three",
    sourceId: 1,
    applicationAction: "ADVANCE",
    responseIdentity: {
      provenance: "application_evaluation",
      fragmentKeys: ["transcript_3"],
      sourceStatus: "known",
      evaluatedScene: { sceneId: "butterfly-garden", displayedAtMs: butterfly.atMs },
    },
  });
  const stages = f.timelines
    .map(e => e.timeline)
    .filter(e => "correlationKey" in e && e.correlationKey === evaluated.correlationKey);
  expect(stages.map(e => e.type)).toEqual(
    expect.arrayContaining(["answer_evaluation_requested", "answer_evaluation_resolved", "scene_advance_committed"]),
  );
  expect(validateObserverProposal(proposalForResponse(f, "Three"), f.record).ok).toBe(true);
  // This relationship is retained even when no trustworthy acoustic interval exists.
  const response = f.record.events.find(e => e.evidence?.type === "utterance" && e.evidence.text === "Three")!;
  if (response.evidence?.type !== "utterance") throw new Error("expected speech");
  delete response.evidence.sessionTiming;
  expect(responseEvaluations(f, "Three")).toContainEqual(evaluated);
  expect(validateObserverProposal(proposalForResponse(f, "Three"), f.record).ok).toBe(false);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("keeps corrected and superseded evaluation identities on one canonical utterance", async () => {
  const pending: Array<(result: Awaited<ReturnType<EvaluateAnswer>>) => void> = [];
  const f = await recordedBrowserLesson(() => new Promise(resolve => pending.push(resolve)));
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Two", 2500);
  await vi.advanceTimersByTimeAsync(1501);
  expect(pending).toHaveLength(1);
  f.say(" no, One", 2600);
  await vi.advanceTimersByTimeAsync(1501);
  expect(pending).toHaveLength(2);
  pending[0]({ status: "evaluated", probability: 1, model: "late", latencyMs: 1 });
  pending[1]({ status: "unavailable", reason: "synthetic", latencyMs: 1 });
  await f.flush();
  const evaluations = responseEvaluations(f, "Two no, One");
  expect(evaluations.find(e => e.action === "superseded")).toMatchObject({
    correlationKey: "0|1|2500:Two|1",
    transcriptRevision: 1,
    answerVersion: "2500:Two",
    status: "superseded",
    responseIdentity: { fragmentKeys: ["transcript_1"] },
  });
  expect(evaluations.find(e => e.action === "evaluation_result")).toMatchObject({
    correlationKey: "0|2|2500:Two no, One|1",
    transcriptRevision: 2,
    answerVersion: "2500:Two no, One",
    responseIdentity: { fragmentKeys: ["transcript_1", "transcript_2"] },
  });
  const response = f.record.events.find(e => e.evidence?.type === "utterance")!;
  expect(response.evidence).toMatchObject({
    transcriptFragments: [
      { key: "transcript_1", textStart: 0, textEnd: 3 },
      { key: "transcript_2", textStart: 3, textEnd: 11 },
    ],
  });
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("links one revised answer window to multiple utterances including speech flushed before evaluation", async () => {
  const f = await recordedBrowserLesson();
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Two", 2500);
  // Generated tutor text ends canonical child speech, but not the answer window.
  f.connection.channel.onmessage?.({
    data: JSON.stringify({
      type: "session.output_transcript.delta",
      delta: "hidden",
      start_ms: 2500,
      end_ms: 2600,
    }),
  });
  await f.session.recordingSettled();
  expect(f.record.events.find(e => e.evidence?.type === "utterance")?.evidence).toMatchObject({ text: "Two" });
  f.say(" no, One", 2600);
  await f.flush();
  const first = responseEvaluations(f, "Two").find(e => e.action === "evaluation_result")!;
  const second = responseEvaluations(f, " no, One").find(e => e.action === "evaluation_result")!;
  expect(first).toEqual(second);
  expect(first.responseIdentity?.fragmentKeys).toEqual(["transcript_1", "transcript_2"]);
  expect(first.answerVersion).toBe("2500:Two no, One");
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("keeps genuinely delayed old speech ambiguous after a normal display, even with matching local VAD", async () => {
  const f = await recordedBrowserLesson(advances);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 1000);
  await f.flush();
  f.session.displayed(1);
  await vi.advanceTimersByTimeAsync(1000);
  f.session.receive({ type: "microphone.speech_started" });
  f.say("Two", 3000); // Old timeline position, delayed until the new display.
  f.session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
  await f.flush();
  const proposal = proposalForResponse(f, "Two");
  expect(responseEvaluations(f, "Two").find(e => e.action === "evaluation_result")).toMatchObject({
    sceneIndex: 1,
    responseIdentity: { sourceStatus: "known", evaluatedScene: { sceneId: "duck-friends" } },
  });
  expect(validateObserverProposal(proposal, f.record).ok).toBe(false);
  proposal.observation = {
    behavior: "uncertain_exchange",
    outcome: "uncertain",
    speakerAttribution: "child_or_nearby_speaker",
    countSequenceObserved: false,
    description: "Delayed speech crosses a display boundary.",
    support: { status: "not_established", kinds: [], sourceEventIds: [] },
    uncertaintyReasons: ["conflicting_context"],
  };
  expect(validateObserverProposal(proposal, f.record).ok).toBe(true);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("requires support before the narrowed lower bound on later scenes", async () => {
  const f = await recordedBrowserLesson(advances);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 1000);
  await f.flush();
  f.session.displayed(1);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Two", 6000);
  await f.flush();
  const proposal = proposalForResponse(f, "Two");
  proposal.observation.support = { status: "recorded", kinds: ["hint"], sourceEventIds: ["help"] };
  proposal.sources.push({ eventId: "help", role: "support" });
  const help = {
    _id: "help",
    atMs: 3999,
    evidence: {
      type: "support" as const,
      source: "parent" as const,
      mode: "spoken" as const,
      description: "Count them.",
    },
  };
  f.record.events.push(help);
  expect(validateObserverProposal(proposal, f.record).ok).toBe(true);
  for (const atMs of [4000, 4100, 4600]) {
    help.atMs = atMs;
    expect(validateObserverProposal(proposal, f.record).ok).toBe(false);
  }
  f.record.recording = { recordingId: "synthetic-recording", startOffsetMs: 0, durationMs: 10000 };
  proposal.sources = proposal.sources.filter(source => source.role !== "support");
  proposal.observation.support = {
    status: "recorded",
    kinds: ["hint"],
    sourceEventIds: [],
    recordingSourceIds: ["recording-help"],
  };
  const recordingHelp = {
    role: "recording_support" as const,
    sourceId: "recording-help",
    provenance: "recording_review" as const,
    sessionId: f.record.session._id,
    recordingId: "synthetic-recording",
    recordingStartMs: 3800,
    recordingEndMs: 3999,
    sessionStartMs: 3800,
    sessionEndMs: 3999,
  };
  proposal.sources.push(recordingHelp);
  expect(validateObserverProposal(proposal, f.record).ok).toBe(true);
  for (const endMs of [4000, 4100, 4600]) {
    recordingHelp.recordingEndMs = recordingHelp.sessionEndMs = endMs;
    expect(validateObserverProposal(proposal, f.record).ok).toBe(false);
  }
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("fails closed on impossible provider offsets", async () => {
  const f = await recordedBrowserLesson();
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 50000); // Farther in the timeline than this source could exist.
  await f.flush();
  expect(sessionSpeechInterval(f.record.events.find(e => e.evidence?.type === "utterance")!.evidence)).toBeUndefined();
  expect(validateObserverProposal(f.proposal(), f.record).ok).toBe(false);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("retains self-corrections within a scene and refuses corrections that cross displays", async () => {
  const f = await recordedBrowserLesson();
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Two", 2500);
  await vi.advanceTimersByTimeAsync(100);
  f.say(" no, One", 2600);
  await f.flush();
  const response = f.record.events.find(e => e.evidence?.type === "utterance")!;
  const scene = f.record.events.find(e => e.evidence?.type === "scene_displayed")!;
  expect(response.evidence).toMatchObject({ text: "Two no, One", sessionTiming: { startMs: 500, endMs: 1200 } });
  expect(responseSceneValidity(response.evidence, scene, [scene]).valid).toBe(true);
  // Use real production capture across displays: change the displayed scene
  // through app advancement before an adjacent provider correction fragment.
  f.session.end("parent_stop");
  await f.session.recordingSettled();
  const g = await recordedBrowserLesson(advances);
  await vi.advanceTimersByTimeAsync(1000);
  g.say("One", 1000);
  // Commit can precede canonical flush; advance the evaluator fallback only.
  await vi.advanceTimersByTimeAsync(2000);
  expect(g.session.snapshot.sceneIndex).toBe(1);
  g.session.displayed(1);
  g.say(" no, Two", 1200);
  await g.flush();
  const corrected = g.record.events.find(e => e.evidence?.type === "utterance")!;
  expect(corrected.evidence).toMatchObject({ text: "One no, Two", responseScene: { status: "changed" } });
  expect(
    responseSceneValidity(
      corrected.evidence,
      g.record.events[0],
      g.record.events.filter(e => e.evidence?.type === "scene_displayed"),
    ).valid,
  ).toBe(false);
  const proposal = g.proposal();
  expect(validateObserverProposal(proposal, g.record).ok).toBe(false);
  g.session.end("parent_stop");
  await g.session.recordingSettled();
});

it("records a promoted replacement with its own request anchor and microphone fence", async () => {
  const f = await recordedBrowserLesson(advances);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 1000);
  await f.flush();
  const b = liveConnection(false);
  // Stale generated output exercises the production replacement path. No
  // test code opens input or manufactures a LessonSession fence for B.
  f.connection.channel.onmessage?.({
    data: JSON.stringify({
      type: "session.output_transcript.delta",
      delta: "stale",
      start_ms: 5000,
      end_ms: 5100,
    }),
  });
  f.session.displayed(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(b.peer.setRemoteDescription).toHaveBeenCalledOnce();
  expect(f.connection.inputs[1].enabled).toBe(false);
  b.channel.onmessage?.({
    data: JSON.stringify({
      type: "session.input_transcript.delta",
      delta: "hidden warmup",
      start_ms: 0,
      end_ms: 100,
    }),
  });
  b.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  await vi.advanceTimersByTimeAsync(1);
  expect(f.transport.activeSourceId).toBe(2);
  expect(f.connection.inputs[1].enabled).toBe(true);
  expect(f.connection.inputs[0].stop).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  b.channel.onmessage?.({
    data: JSON.stringify({
      type: "session.input_transcript.delta",
      delta: "Two",
      start_ms: 900,
      end_ms: 1000,
    }),
  });
  // Retired source callbacks cannot supply new evidence or source anchors.
  f.say("retired", 6000);
  await f.flush();
  const response = f.record.events.find(e => e.evidence?.type === "utterance" && e.evidence.text === "Two")!;
  expect(response.evidence).toMatchObject({
    providerTiming: { sourceId: 2, startMs: 900 },
    sessionTiming: { provenance: "source_timeline_bound", sourceId: 2, sourceRequestedAtMs: 3600, startMs: 4500 },
  });
  const a = responseEvaluations(f, "One").find(e => e.action === "evaluation_result")!;
  const replacement = responseEvaluations(f, "Two").find(e => e.action === "evaluation_result")!;
  expect(a).toMatchObject({ sourceId: 1, responseIdentity: { fragmentKeys: ["transcript_1"] } });
  expect(replacement).toMatchObject({
    sourceId: 2,
    transcriptRevision: 2,
    answerVersion: "900:Two",
    responseIdentity: {
      sourceStatus: "known",
      fragmentKeys: ["transcript_2"],
      evaluatedScene: { sceneId: "duck-friends" },
    },
  });
  expect(replacement.correlationKey).not.toBe(a.correlationKey);
  expect(validateObserverProposal(proposalForResponse(f, "Two"), f.record).ok).toBe(true);
  expect(f.record.events.some(e => e.evidence?.type === "utterance" && /hidden|retired/.test(e.evidence.text))).toBe(
    false,
  );
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("does not recover trust after an invalid adjacent correction fragment", async () => {
  const f = await recordedBrowserLesson();
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 2500);
  f.say(" no, Two", -1);
  f.say(" no, One", 2600);
  await f.flush();
  const response = f.record.events.find(e => e.evidence?.type === "utterance")!;
  expect(response.evidence).toMatchObject({ text: "One no, Two no, One" });
  expect(sessionSpeechInterval(response.evidence)).toBeUndefined();
  expect(validateObserverProposal(f.proposal(), f.record).ok).toBe(false);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("keeps an interrupted response from establishing a concrete observation", async () => {
  const f = await recordedBrowserLesson();
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 2500);
  f.session.end("parent_stop");
  await f.session.recordingSettled();
  const response = f.record.events.find(e => e.evidence?.type === "utterance")!;
  expect(response.evidence).toMatchObject({ state: "interrupted" });
  expect(validateObserverProposal(f.proposal(), f.record).ok).toBe(false);
});

it("validates responses before evaluator commits and preserves attribution after commits and displays", async () => {
  let resolve!: (value: Awaited<ReturnType<EvaluateAnswer>>) => void;
  const f = await recordedBrowserLesson(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  for (const [index, text, providerStart] of [
    [0, "One", 1000],
    [1, "Two", 6000],
    [2, "Three", 9500],
  ] as const) {
    await vi.advanceTimersByTimeAsync(1000);
    f.say(text, providerStart);
    await f.flush();
    expect(f.session.snapshot.sceneIndex).toBe(index);
    expect(validateObserverProposal(proposalForResponse(f, text), f.record).ok).toBe(true);
    resolve({ status: "evaluated", probability: 0.99, model: "synthetic", latencyMs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.session.snapshot.sceneIndex).toBe(index + 1);
    expect(validateObserverProposal(proposalForResponse(f, text), f.record).ok).toBe(true);
    f.session.displayed(index + 1);
    expect(validateObserverProposal(proposalForResponse(f, text), f.record).ok).toBe(true);
  }
  expect(fetch).toHaveBeenCalledOnce();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("round-trips real recorder bounds through Convex and rejects mismatched persisted anchors", async () => {
  const f = await recordedBrowserLesson(advances);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("One", 1000);
  await f.flush();
  f.session.displayed(1);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Two", 6000);
  await f.flush();
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.activate, { sessionId });
  for (const event of f.record.events) {
    await t.mutation(api.sessions.appendEvent, {
      sessionId,
      eventKey: event._id,
      atMs: event.atMs,
      evidence: event.evidence,
    });
  }
  for (const event of f.timelines) {
    await t.mutation(api.sessions.appendEvent, { sessionId, ...event });
  }
  const persisted = await t.query(api.sessions.getRecord, { sessionId });
  expect(persisted?.events.filter(e => e.evidence).map(e => e.evidence)).toEqual(f.record.events.map(e => e.evidence));
  expect(persisted?.events.filter(e => e.timeline).map(e => e.timeline)).toEqual(f.timelines.map(e => e.timeline));
  const evaluations = responseEvaluations(f, "Two");
  expect(evaluations.find(e => e.action === "evaluation_result")).toMatchObject({
    correlationKey: "1|2|6000:Two|1",
    transcriptRevision: 2,
    answerVersion: "6000:Two",
    sourceId: 1,
    responseIdentity: { fragmentKeys: ["transcript_2"], evaluatedScene: { sceneId: "duck-friends" } },
  });
  const response = structuredClone(
    f.record.events.find(e => e.evidence?.type === "utterance" && e.evidence.text === "Two")!,
  );
  if (
    response.evidence?.type !== "utterance" ||
    response.evidence.sessionTiming?.provenance !== "source_timeline_bound"
  )
    throw new Error("expected real bound");
  for (const mutation of ["source", "anchor", "start", "receipt"] as const) {
    const evidence = structuredClone(response.evidence);
    if (evidence.sessionTiming?.provenance !== "source_timeline_bound") throw new Error("expected bound");
    if (mutation === "source") evidence.sessionTiming.sourceId = 99;
    if (mutation === "anchor") evidence.sessionTiming.sourceRequestedAtMs += 1;
    if (mutation === "start") evidence.sessionTiming.startMs += 1;
    if (mutation === "receipt") evidence.sessionTiming.endMs -= 1;
    await expect(
      t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: `invalid-${mutation}`,
        atMs: response.atMs,
        evidence,
      }),
    ).rejects.toThrow("Source timeline bound");
  }
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it.each([0, 2000, 6000])(
  "keeps successive scene evidence with a measured %i ms source startup",
  async startupDelayMs => {
    const f = await recordedBrowserLesson(advances, startupDelayMs);
    for (const [index, text, sourceElapsed] of [
      [0, "One", 500],
      [1, "Two", 4000],
      [2, "Three", 7500],
    ] as const) {
      await vi.advanceTimersByTimeAsync(1000);
      f.say(text, startupDelayMs + sourceElapsed);
      await f.flush();
      expect(validateObserverProposal(proposalForResponse(f, text), f.record).ok).toBe(true);
      f.session.displayed(index + 1);
    }
    expect(fetch).toHaveBeenCalledOnce();
    f.session.end("parent_stop");
    await f.session.recordingSettled();
  },
);
