import { immediateAcknowledgment } from "./immediate-acknowledgment";
import { expect, vi } from "vitest";
import { BrowserTransport } from "../../lib/browser-transport";
import { LessonSession } from "../../lib/session";
import type { EvaluateAnswer } from "../../lib/answer";
import type { CanonicalObservationRecord, ObserverProposal } from "../../lib/observation-contracts";
import type { SessionRecorder, TimelineEvent } from "../../lib/session-recorder";
import { UTTERANCE_GAP_MS } from "../../lib/transcript";

/** Synthetic WebRTC surfaces only; timing, input fences and lesson recording run production code. */
export function audioElement() {
  const audio = {
    muted: false,
    autoplay: false,
    srcObject: null as MediaStream | null,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  };
  return audio;
}

export function liveConnection(autoStarted = true) {
  const remoteTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const inputTrack = { enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
  const inputs: MediaStreamTrack[] = [];
  const micTrack = {
    stop: vi.fn(),
    clone: vi.fn(() => {
      const track = inputs.length ? ({ enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack) : inputTrack;
      inputs.push(track);
      return track;
    }),
  } as unknown as MediaStreamTrack;
  class Stream {
    constructor(private tracks: MediaStreamTrack[]) {}
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks;
    }
  }
  const channel = {
    readyState: "open",
    onmessage: null as ((event: { data: string }) => void) | null,
    onerror: null,
    onclose: null,
    onopen: null as (() => void) | null,
    send: vi.fn(),
    close: vi.fn(),
  };
  const peer = {
    connectionState: "connected",
    iceGatheringState: "complete",
    localDescription: { sdp: "offer" },
    ontrack: null as ((event: { track: MediaStreamTrack }) => void) | null,
    onconnectionstatechange: null,
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {
      if (autoStarted) channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
    }),
    close: vi.fn(),
  };
  vi.stubGlobal("MediaStream", Stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => new Stream([micTrack])) } });
  const Peer = class {
    constructor() {
      return peer;
    }
  };
  vi.stubGlobal("window", { RTCPeerConnection: Peer });
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ transport: { sdp: "answer" } }) })),
  );
  return { channel, peer, remoteTrack, micTrack, inputTrack, inputs };
}

export async function recordedBrowserLesson(
  evaluator: EvaluateAnswer = async () => ({ status: "unavailable", reason: "synthetic", latencyMs: 1 }),
  startupDelayMs = 2000,
  persistence?: { recorder: SessionRecorder; fetcher: typeof fetch },
) {
  vi.useFakeTimers();
  const connection = liveConnection(false);
  if (persistence) vi.stubGlobal("fetch", persistence.fetcher);
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  const record: CanonicalObservationRecord = {
    session: { _id: "recorded-browser-session", state: "ended", recordStatus: "complete" },
    events: [],
  };
  const timelines: { eventKey: string; atMs: number; timeline: TimelineEvent }[] = [];
  const recorder: SessionRecorder = {
    create: async () => {
      if (persistence) record.session._id = (await persistence.recorder.create())!;
      return record.session._id;
    },
    activate: async startedAt => {
      await persistence?.recorder.activate(startedAt);
    },
    append: async (key, atMs, evidence) => {
      record.events.push({ _id: key, atMs, evidence });
      await persistence?.recorder.append(key, atMs, evidence);
    },
    appendTimeline: async (eventKey, atMs, timeline) => {
      timelines.push({ eventKey, atMs, timeline: structuredClone(timeline) });
      await persistence?.recorder.appendTimeline(eventKey, atMs, timeline);
    },
    attachRecording: async audio => {
      await persistence?.recorder.attachRecording(audio);
    },
    markIncomplete: async () => {
      await persistence?.recorder.markIncomplete();
    },
    finalize: async (reason, incomplete) => {
      await persistence?.recorder.finalize(reason, incomplete);
    },
  };
  immediateAcknowledgment(transport, () => session.snapshot.choreographyPhase);
  const session = new LessonSession(transport, evaluator, vi.fn(), undefined, recorder);
  await session.start();
  // A realistic startup interval, measured by production before /api/live.
  // No test-supplied session timing or provider/browser clock mapping.
  await vi.advanceTimersByTimeAsync(startupDelayMs);
  connection.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(connection.inputTrack.enabled).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  session.displayed(0, session.snapshot.displayToken);
  expect(connection.inputTrack.enabled).toBe(true);
  let currentConnection = connection;
  const prepare = transport.prepareReplacement.bind(transport);
  let initialPeer = connection.peer;
  transport.prepareReplacement = (seed, signal) => {
    // Explicitly supplied pending providers are kept for readiness/retirement
    // tests. Other transcript tests get a fresh, immediately ready source.
    const probe = new RTCPeerConnection();
    if ((probe as unknown) === initialPeer) {
      const fetcher = globalThis.fetch;
      currentConnection = liveConnection();
      initialPeer = currentConnection.peer;
      vi.stubGlobal("fetch", fetcher);
    }
    return prepare(seed, signal);
  };
  const say = (text: string, startMs = 1000) => {
    // Existing evidence fixtures express offsets from the first provider request.
    // New provider sources restart their clock; translate the stimulus, never
    // production evidence or the frozen response identity.
    const shift = transport.activeSourceId === 1 ? 0 : (transport.replacementTiming?.provider_request_started_at ?? 0);
    const localStart = startMs - shift;
    currentConnection.channel.onmessage?.({
      data: JSON.stringify({
        type: "session.input_transcript.delta",
        delta: text,
        start_ms: localStart,
        end_ms: localStart + 200,
        // Provider JSON must never be able to supply these trust labels.
        sourceId: 999,
        sourceRequestedAt: -999999,
        sessionTiming: { provenance: "mapped_provider", startMs: 1, endMs: 2 },
      }),
    });
  };
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
    await session.recordingSettled();
  };
  const proposal = (): ObserverProposal => {
    const scene = record.events.find(event => event.evidence?.type === "scene_displayed")!;
    const response = record.events.find(event => event.evidence?.type === "utterance")!;
    return {
      kind: "observer_proposal",
      proposalId: "real-recorder-output",
      sessionId: record.session._id,
      exchangeAtMs: response.atMs,
      observation: {
        behavior: "quantity_identification",
        outcome: "correct",
        speakerAttribution: "child_or_nearby_speaker",
        statedTotal: 1,
        countSequenceObserved: false,
        targetQuantity: 1,
        description: "Said One about one duck.",
        support: { status: "not_established", kinds: [], sourceEventIds: [] },
        uncertaintyReasons: [],
      },
      sources: [
        { eventId: scene._id, role: "scene" },
        { eventId: response._id, role: "response" },
      ],
    };
  };
  return { connection, transport, session, record, timelines, say, flush, proposal };
}

export function captureMocks() {
  const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  const mixTrack = Object.assign(new EventTarget(), {
    readyState: "live",
    enabled: true,
    muted: false,
    stop: vi.fn(),
  });
  const mix = { stream: { getTracks: () => [mixTrack], getAudioTracks: () => [mixTrack] }, disconnect: vi.fn() };
  const context = Object.assign(new EventTarget(), {
    state: "running",
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createMediaStreamDestination: () => mix,
    createGain: () => gain,
    createMediaStreamSource: vi.fn(() => {
      const source = { connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }),
  });
  const recorders: Recorder[] = [];
  class Recorder {
    static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable?: ((event: { data: Blob }) => void) | null;
    onstop?: (() => void) | null;
    onerror?: (() => void) | null;
    constructor(readonly stream: unknown) {
      recorders.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  let contexts = 0;
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        // Recording, microphone VAD and remote observation own separate contexts.
        return contexts++ === 0 ? context : { ...context, close: vi.fn(async () => {}) };
      }
    },
  );
  vi.stubGlobal("MediaRecorder", Recorder);
  return { sources, gain, mix, mixTrack, context, recorders };
}
