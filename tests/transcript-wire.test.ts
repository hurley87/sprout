import { expect, it, vi } from "vitest";
import { parseProviderEvent } from "../lib/events";
import {
  describeTranscriptWire,
  transcriptDeliveryEvidence,
  type WireCapture,
  type WireRecord,
} from "./helpers/transcript-wire";
import type { LessonDiagnostic } from "../lib/lesson-runtime/lesson-runtime";

it("matches production transcript parsing while separating malformed, unrecognized, and invalid intervals", () => {
  const base = { type: "session.input_transcript.delta", delta: "secret transcript", start_ms: 10, end_ms: 20 };
  for (const raw of [
    base,
    { ...base, delta: 7 },
    { ...base, start_ms: null },
    { ...base, end_ms: "20" },
    { ...base, end_ms: 5 },
    { ...base, delta: "" },
    { ...base, type: "session.output_transcript.delta" },
  ]) {
    const described = describeTranscriptWire(JSON.stringify(raw));
    expect(described.disposition === "parser-transcript").toBe(parseProviderEvent(raw)?.type === "transcript");
  }
  expect(describeTranscriptWire(JSON.stringify({ ...base, end_ms: 5 }))).toMatchObject({
    disposition: "parser-transcript",
    intervalValid: false,
  });
  expect(
    describeTranscriptWire(JSON.stringify({ type: "session.input_transcript.completed", transcript: "secret" })),
  ).toMatchObject({
    disposition: "unrecognized-transcript",
    fields: { transcript: { present: true, validType: true } },
  });
  expect(describeTranscriptWire(JSON.stringify({ ...base, type: "new.secret.event" }))).toMatchObject({
    eventType: "unrecognized",
    disposition: "unrecognized-transcript",
  });
  expect(describeTranscriptWire(JSON.stringify({ ...base, type: "session.input_transcript.appended" }))).toMatchObject({
    disposition: "parser-other",
  });
  expect(describeTranscriptWire("bad secret json").disposition).toBe("unreadable");
  expect(describeTranscriptWire(" ".repeat(65_537)).disposition).toBe("uninspected");
  expect(describeTranscriptWire({ secret: true }).disposition).toBe("uninspected");
});

it("never persists provider text, arbitrary types, identities, nested payloads or errors", () => {
  for (const type of ["session.input_transcript.delta", "error", "secret-event-type"]) {
    const value = describeTranscriptWire(
      JSON.stringify({
        type,
        delta: "SECRET",
        transcript: "SECRET",
        text: "SECRET",
        start_ms: "SECRET",
        end_ms: { SECRET: true },
        event_id: "SECRET",
        item_id: "SECRET",
        response_id: "SECRET",
        error: { message: "SECRET", code: "SECRET" },
        arbitrary: "SECRET",
      }),
    );
    expect(JSON.stringify(value)).not.toContain("SECRET");
    expect(JSON.stringify(value)).not.toContain("secret-event-type");
  }
});

it("keeps wire loss, parser discards, runtime rejection and snapshots independent and scoped", () => {
  const row = (raw: unknown, runtimeId = "current"): WireRecord => ({
    ...describeTranscriptWire(JSON.stringify(raw)),
    sequence: 0,
    channelId: 1,
    channelRuntimeId: runtimeId,
    atMs: 10,
    runtimeId,
    visitId: 3,
    childTurnId: 2,
    nodeId: "count-3-butterflies",
    transcriptRevision: 0,
    journalOffset: 0,
  });
  const valid = { type: "session.input_transcript.delta", delta: "Three", start_ms: 10, end_ms: 20 };
  const capture: WireCapture = {
    version: 1,
    channels: 1,
    frames: 4,
    dropped: 0,
    observationErrors: 0,
    records: [
      row(valid),
      row({ ...valid, delta: null }),
      row({ type: "session.input_transcript.done", transcript: "Three" }),
      row(valid, "old"),
    ],
  };
  const events = [
    {
      type: "transcript.ignored",
      atMs: 11,
      runtimeId: "current",
      visitId: 3,
      childTurnId: 2,
      detail: { speaker: "child", reason: "no_matching_child_turn" },
    },
    {
      type: "transcript.snapshot",
      atMs: 21,
      runtimeId: "current",
      visitId: 3,
      childTurnId: 2,
      transcriptRevision: 1,
      transcriptSpeaker: "child",
    },
    { type: "transcript.snapshot", atMs: 21, runtimeId: "old", transcriptSpeaker: "child" },
  ] as LessonDiagnostic[];
  expect(transcriptDeliveryEvidence(capture, events, "current")).toMatchObject({
    boundedCaptureComplete: false,
    learnerWireEvents: 2,
    parserDiscardedLearnerEvents: 1,
    unrecognizedTranscriptEvents: 1,
    parserValidLearnerEvents: 1,
    runtimeLearnerRejections: [{ reason: "no_matching_child_turn" }],
    learnerSnapshots: [{ transcriptRevision: 1 }],
  });
  const silent = { ...capture, frames: 1, records: [row({ type: "session.started" })] };
  expect(transcriptDeliveryEvidence(silent, [], "current")).toMatchObject({
    boundedCaptureComplete: true,
    learnerWireEvents: 0,
    learnerSnapshots: [],
  });
  expect(transcriptDeliveryEvidence({ ...silent, dropped: 1 }, [], "current").boundedCaptureComplete).toBe(false);
  expect(transcriptDeliveryEvidence(null, [], "current").boundedCaptureComplete).toBe(false);
});

it("bounds records and channels, preserves detached evidence and restores the channel method", async () => {
  const { observeTranscriptWireInBrowser } = await import("./helpers/transcript-wire");
  const { vi } = await import("vitest");
  class Peer {
    createDataChannel() {
      return new EventTarget();
    }
  }
  const original = Peer.prototype.createDataChannel;
  const host = { sproutTranscriptWire: undefined } as import("./helpers/transcript-wire").WireWindow;
  vi.stubGlobal("window", host);
  vi.stubGlobal("RTCPeerConnection", Peer);
  try {
    observeTranscriptWireInBrowser(describeTranscriptWire);
    const peer = new Peer() as unknown as RTCPeerConnection;
    const channel = peer.createDataChannel("oai-events");
    for (let i = 0; i < 2050; i++)
      channel.dispatchEvent(new MessageEvent("message", { data: '{"type":"session.started"}' }));
    const read = host.sproutTranscriptWire!.read();
    expect(read.records).toHaveLength(2048);
    expect(read.dropped).toBe(2);
    expect(read.records[0].atMs).toBeNull();
    read.records.length = 0;
    expect(host.sproutTranscriptWire!.read().records).toHaveLength(2048);
    for (let i = 0; i < 33; i++) peer.createDataChannel("oai-events");
    expect(host.sproutTranscriptWire!.read().observationErrors).toBe(2);
    host.sproutTranscriptWire!.dispose();
    expect(Peer.prototype.createDataChannel).toBe(original);
    channel.dispatchEvent(new MessageEvent("message", { data: "bad" }));
    expect(host.sproutTranscriptWire!.read().frames).toBe(2050);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("uses production parser authority and explains field rejection without upgrading interval validity", () => {
  const parse = vi.fn(() => null);
  const raw = JSON.stringify({ type: "session.input_transcript.delta", delta: "Three", start_ms: 1, end_ms: 2 });
  expect(describeTranscriptWire(raw, parse).disposition).toBe("parser-discard");
  expect(parse).toHaveBeenCalledOnce();
  expect(
    describeTranscriptWire(JSON.stringify({ type: "session.input_transcript.delta", delta: "Three", end_ms: "2" })),
  ).toMatchObject({ parserReasons: ["missing_start_ms", "malformed_end_ms"] });
  expect(
    describeTranscriptWire('{"type":"session.input_transcript.delta","delta":"Three","start_ms":3,"end_ms":2}'),
  ).toMatchObject({ disposition: "parser-transcript", intervalValid: false });
});
