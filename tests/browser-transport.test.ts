import { afterEach, describe, expect, it, vi } from "vitest";
import { audioElement, captureMocks, liveConnection } from "./helpers/recorded-browser-evidence";
import { BrowserTransport, microphoneTrackSettings } from "../lib/browser-transport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
