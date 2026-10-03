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
  await transport.start(vi.fn(), vi.fn());
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
