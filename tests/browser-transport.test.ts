import { afterEach, expect, it, vi } from "vitest";
import { audioElement, liveConnection } from "./helpers/browser-transport";
import { parseProviderEvent } from "../lib/events";
import { BrowserTransport, microphoneTrackSettings } from "../lib/browser-transport";

afterEach(() => {
  vi.unstubAllGlobals();
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

it("only forwards microphone settings when the attempt explicitly opts in", async () => {
  const { micTrack } = liveConnection();
  Object.assign(micTrack, { getSettings: () => ({ sampleRate: 48000, deviceId: "private" }) });
  const off = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  const offSink = vi.fn();
  off.setMicrophoneDiagnosticSink(offSink);
  await off.start(vi.fn(), vi.fn());
  expect(offSink).not.toHaveBeenCalled();
  off.close();

  const optedIn = liveConnection();
  Object.assign(optedIn.micTrack, { getSettings: () => ({ sampleRate: 48000, deviceId: "private" }) });
  const on = new BrowserTransport(audioElement() as unknown as HTMLAudioElement, true);
  const onSink = vi.fn();
  on.setMicrophoneDiagnosticSink(onSink);
  await on.start(vi.fn(), vi.fn());
  expect(onSink).toHaveBeenCalledWith({ type: "microphone.track_settings", detail: { sampleRate: 48000 } });
  on.close();
});

it("joins provider start, remote description, and channel readiness exactly once", async () => {
  const { peer, channel } = liveConnection(false);
  channel.readyState = "connecting";
  let finish!: () => void;
  peer.setRemoteDescription.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const events = vi.fn();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  const starting = transport.start(events, vi.fn());
  await vi.waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalledOnce());
  channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  channel.readyState = "open";
  channel.onopen?.();
  expect(events.mock.calls.filter(([event]) => event.type === "session.started")).toHaveLength(0);
  finish();
  await starting;
  channel.onopen?.();
  channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(events.mock.calls.filter(([event]) => event.type === "session.started")).toHaveLength(1);
  transport.close();
});

it("opens provider microphone only after the runtime fence, and sends bounded commands", async () => {
  const { channel, inputTrack } = liveConnection();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement, false);
  await transport.start(vi.fn(), vi.fn(), "test-patterns");
  expect(inputTrack.enabled).toBe(false);
  const fence = vi.fn(() => expect(inputTrack.enabled).toBe(false));
  expect(transport.openInput(fence)).toBe(true);
  expect(fence).toHaveBeenCalledWith(transport.activeSourceId);
  expect(inputTrack.enabled).toBe(true);
  transport.openInput(fence);
  expect(fence).toHaveBeenCalledOnce();
  const command = {
    type: "session.instructions.append" as const,
    event_id: "steer",
    delegation_id: null,
    content: "Current node",
  };
  transport.send(command);
  expect(channel.send).toHaveBeenCalledWith(JSON.stringify(command));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
    sdp: "offer",
    lessonId: "test-patterns",
  });
  transport.close();
  expect(transport.openInput(fence)).toBe(false);
  expect(() => transport.send(command)).toThrow("Channel unavailable");
});

it("plays current output and ignores late media, provider, and playback callbacks after close", async () => {
  const { channel, peer, remoteTrack, micTrack, inputTrack } = liveConnection();
  const audio = audioElement();
  let rejectPlay!: (error: Error) => void;
  audio.play.mockImplementation(
    () =>
      new Promise<void>((_, reject) => {
        rejectPlay = reject;
      }),
  );
  const events = vi.fn();
  const failures = vi.fn();
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  await transport.start(events, failures);
  peer.ontrack?.({ track: remoteTrack });
  expect(audio.srcObject).not.toBeNull();
  expect(audio.muted).toBe(false);
  channel.onmessage?.({
    data: JSON.stringify({
      type: "session.output_transcript.delta",
      delta: "Hello",
      start_ms: 0,
      end_ms: 1,
      sourceId: 999,
    }),
  });
  expect(events).toHaveBeenCalledWith(
    expect.objectContaining({ type: "transcript", sourceId: transport.activeSourceId }),
  );
  transport.close();
  transport.close();
  const count = events.mock.calls.length;
  channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  channel.onopen?.();
  const late = { stop: vi.fn() } as unknown as MediaStreamTrack;
  peer.ontrack?.({ track: late });
  rejectPlay(new Error("Late playback error"));
  await Promise.resolve();
  await Promise.resolve();
  expect(late.stop).toHaveBeenCalledOnce();
  expect(events).toHaveBeenCalledTimes(count);
  expect(failures).not.toHaveBeenCalled();
  for (const track of [remoteTrack, micTrack, inputTrack]) expect(track.stop).toHaveBeenCalledOnce();
  expect(peer.close).toHaveBeenCalledOnce();
  expect(audio.srcObject).toBeNull();
});

it("releases a microphone obtained after startup was canceled without connecting", async () => {
  const { micTrack, peer } = liveConnection();
  let finish!: (stream: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  const events = vi.fn();
  const starting = transport.start(events, vi.fn());
  transport.close();
  finish(new MediaStream([micTrack]));
  await starting;
  expect(micTrack.stop).toHaveBeenCalledOnce();
  expect(peer.createOffer).not.toHaveBeenCalled();
  expect(events).not.toHaveBeenCalled();
});

it.each([{ id: "obsolete", target: "client" }, { id: "obsolete", target: "server" }, null])(
  "discards unused provider delegation events %j",
  delegation => {
    expect(parseProviderEvent({ type: "session.delegation.created", event_id: "obsolete", delegation })).toBeNull();
  },
);

it.each(["resolve", "reject"] as const)(
  "fences late play %s and saved element callbacks across replacement and stop",
  async settlement => {
    const { peer, remoteTrack } = liveConnection();
    const audio = audioElement();
    const listeners = new Map<string, EventListener>();
    const remove = vi.fn((type: string, listener: EventListener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    });
    Object.assign(audio, {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: remove,
    });
    const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
    audio.play.mockImplementation(() => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })));
    const sink = vi.fn();
    const failures = vi.fn();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    transport.setPlaybackDiagnosticSink(sink);
    await transport.start(vi.fn(), failures);
    peer.ontrack?.({ track: remoteTrack });
    const firstGeneration = transport.playbackAttachmentGeneration;
    const oldPlaying = listeners.get("playing")!;
    const queued = new Event("playing");
    // Ensure an event created before replacement has an older monotonic timestamp.
    await new Promise(resolve => setTimeout(resolve, 2));
    peer.ontrack?.({ track: { stop: vi.fn() } as unknown as MediaStreamTrack });
    const secondGeneration = transport.playbackAttachmentGeneration;
    expect(secondGeneration).not.toBe(firstGeneration);
    const count = sink.mock.calls.length;
    oldPlaying(new Event("playing"));
    listeners.get("playing")!(queued);
    pending[0][settlement](new Error("old"));
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(count);
    listeners.get("playing")!(new Event("playing"));
    expect(sink).toHaveBeenLastCalledWith({
      sourceId: 1,
      attachmentGeneration: secondGeneration,
      playbackFact: "playing",
    });
    const saved = listeners.get("ended")!;
    transport.close();
    const stoppedCount = sink.mock.calls.length;
    saved(new Event("ended"));
    pending[1][settlement](new Error("stopped"));
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(stoppedCount);
    expect(sink).toHaveBeenLastCalledWith({
      sourceId: 1,
      attachmentGeneration: secondGeneration,
      playbackFact: "teardown",
    });
    expect(listeners.size).toBe(0);
    expect(remove).toHaveBeenCalledTimes(8);
    expect(failures).not.toHaveBeenCalled();
  },
);

it("observes blocked playback independently of microphone diagnostics and preserves failure behavior", async () => {
  const { peer, remoteTrack } = liveConnection();
  const audio = audioElement();
  audio.play.mockRejectedValue(new Error("blocked"));
  const sink = vi.fn();
  const failures = vi.fn();
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement, false);
  transport.setPlaybackDiagnosticSink(sink);
  await transport.start(vi.fn(), failures);
  expect(sink).not.toHaveBeenCalled(); // Missing remote media is unknown.
  peer.ontrack?.({ track: remoteTrack });
  await Promise.resolve();
  expect(sink.mock.calls.map(([event]) => event.playbackFact)).toEqual(["play_requested", "play_rejected"]);
  expect(failures).toHaveBeenCalledWith(expect.stringContaining("blocked"));
  transport.close();
});
