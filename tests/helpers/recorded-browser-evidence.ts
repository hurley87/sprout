import { expect, vi } from "vitest";
import { BrowserTransport } from "../../lib/browser-transport";
import { SessionEvidenceRecorder } from "../../lib/session-evidence-recorder";
import type { CanonicalObservationRecord, ObserverProposal } from "../../lib/observation-contracts";
import type { SessionRecorder, TimelineEvent } from "../../lib/session-recorder";
import { UTTERANCE_GAP_MS } from "../../lib/transcript";

/** Synthetic WebRTC surfaces; transport and reusable evidence recording run production code. */
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

export async function recordedBrowserEvidence(
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
  const errors: unknown[] = [];
  const capture = new SessionEvidenceRecorder(transport, recorder, (operation, error) =>
    errors.push({ operation, error }),
  );
  const scenes = [
    { id: "hello-duck", quantity: 1, emoji: "🦆", label: "duck" },
    { id: "duck-friends", quantity: 2, emoji: "🦆", label: "duck" },
    { id: "butterfly-garden", quantity: 3, emoji: "🦋", label: "butterfly" },
    { id: "picnic", quantity: 3, emoji: "🍓", label: "strawberry" },
  ];
  let text = "";
  let fragmentKeys: string[] = [];
  let sourceId: number | undefined;
  let lastEnd = -Infinity;
  let fragments = 0;
  const session = {
    recordingSettled: () => capture.recordingSettled(),
    end: (reason: "parent_stop") => {
      capture.end(reason);
      transport.close();
    },
    displayed: (index: number) => {
      const scene = scenes[index];
      capture.displayed({
        type: "scene_displayed",
        sceneId: scene.id,
        targetQuantity: scene.quantity,
        items: Array.from({ length: scene.quantity }, () => ({ emoji: scene.emoji, label: scene.label })),
        arrangement: "row",
      });
    },
    receive: (event: import("../../lib/events").TranscriptEvent) => {
      capture.receive(event);
      const key = `transcript_${++fragments}`;
      if (event.speaker !== "child") return;
      if (event.startMs - lastEnd > UTTERANCE_GAP_MS || sourceId !== event.sourceId) {
        text = "";
        fragmentKeys = [];
      }
      sourceId = event.sourceId;
      lastEnd = event.endMs;
      text += event.delta;
      fragmentKeys.push(key);
      // Explicit synthetic recognition fixture, not a semantic lesson decision.
      capture.retainRecognition(
        { text, fragmentsComplete: true, fragments: fragmentKeys.map(key => ({ key, sourceId })) },
        "no_ambiguity_detected",
      );
    },
  };
  capture.create();
  await transport.start(
    event => {
      if (event.type === "session.started") capture.begin();
      if (event.type === "transcript") session.receive(event);
    },
    error => errors.push(error),
  );
  // A realistic startup interval, measured by production before /api/live.
  // No test-supplied session timing or provider/browser clock mapping.
  await vi.advanceTimersByTimeAsync(startupDelayMs);
  connection.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(connection.inputTrack.enabled).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  session.displayed(0);
  expect(connection.inputTrack.enabled).toBe(true);
  const say = (text: string, startMs = 1000) =>
    connection.channel.onmessage?.({
      data: JSON.stringify({
        type: "session.input_transcript.delta",
        delta: text,
        start_ms: startMs,
        end_ms: startMs + 200,
        // Provider JSON must never be able to supply these trust labels.
        sourceId: 999,
        sourceRequestedAt: -999999,
        sessionTiming: { provenance: "mapped_provider", startMs: 1, endMs: 2 },
      }),
    });
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
  return { connection, transport, session, record, timelines, say, flush, proposal, errors };
}

export function captureMocks() {
  const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  const mix = { stream: { getTracks: () => [] }, disconnect: vi.fn() };
  const context = {
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
  };
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
  return { sources, gain, mix, context, recorders };
}
