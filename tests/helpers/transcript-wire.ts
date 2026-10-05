import { parseProviderEvent } from "../../lib/events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { Page } from "@playwright/test";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import type { LessonDiagnostic } from "../../lib/lesson-runtime/lesson-runtime";

/** Metadata only. Never retain provider text, IDs, error strings, or arbitrary payloads. */
export function describeTranscriptWire(data: unknown, parse = parseProviderEvent) {
  const field = (raw: Record<string, unknown>, key: string, expected: "string" | "number") => {
    const value = raw[key];
    return {
      present: Object.hasOwn(raw, key),
      type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      validType: typeof value === expected,
      ...(typeof value === "string" ? { empty: value.length === 0 } : {}),
      ...(typeof value === "number" ? { finite: Number.isFinite(value) } : {}),
    };
  };
  if (typeof data !== "string") return { eventType: "non-string-frame", disposition: "uninspected" };
  if (data.length > 65_536) return { eventType: "oversized-frame", disposition: "uninspected" };
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return { eventType: "invalid-json", disposition: "unreadable" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { eventType: "non-object-json", disposition: "parser-discard" };
  const raw = value as Record<string, unknown>;
  const known = [
    "session.started",
    "session.closed",
    "error",
    "session.input_transcript.delta",
    "session.output_transcript.delta",
    "session.input_transcript.done",
    "session.output_transcript.done",
    "session.input_transcript.completed",
    "session.output_transcript.completed",
  ];
  const eventType = typeof raw.type === "string" && known.includes(raw.type) ? raw.type : "unrecognized";
  const documented = eventType === "session.input_transcript.delta" || eventType === "session.output_transcript.delta";
  const candidate =
    documented ||
    (typeof raw.type === "string" && raw.type.includes("transcript")) ||
    ["delta", "transcript", "text", "start_ms", "end_ms"].some(key => Object.hasOwn(raw, key));
  const parsed = parse(raw);
  const parserAccepts = parsed?.type === "transcript";
  const parserOther = parsed !== null && !parserAccepts;
  const reasons =
    documented && !parserAccepts
      ? ["delta", "start_ms", "end_ms"].flatMap(key =>
          typeof raw[key] === (key === "delta" ? "string" : "number")
            ? []
            : [`${Object.hasOwn(raw, key) ? "malformed" : "missing"}_${key}`],
        )
      : candidate && !parsed
        ? ["unexpected_transcript_event_type"]
        : [];
  return {
    eventType,
    parserAuthority: "lib/events.ts:parseProviderEvent",
    parserReasons: reasons,
    typeField: field(raw, "type", "string"),
    transcriptCandidate: candidate,
    transcriptDirection:
      candidate && typeof raw.type === "string"
        ? raw.type.startsWith("session.input_transcript.")
          ? "learner"
          : raw.type.startsWith("session.output_transcript.")
            ? "tutor"
            : "unknown"
        : null,
    disposition: documented
      ? parserAccepts
        ? "parser-transcript"
        : "parser-discard"
      : parserOther
        ? "parser-other"
        : candidate
          ? "unrecognized-transcript"
          : "parser-discard",
    ...(candidate
      ? {
          fields: Object.fromEntries(["delta", "transcript", "text"].map(key => [key, field(raw, key, "string")])),
          timing: Object.fromEntries(
            ["start_ms", "end_ms"].map(key => [
              key,
              {
                ...field(raw, key, "number"),
                // Numeric intervals only, never string values. Bound the persisted numbers.
                valueMs:
                  typeof raw[key] === "number" && Number.isFinite(raw[key]) && Math.abs(raw[key]) <= 86_400_000
                    ? raw[key]
                    : null,
              },
            ]),
          ),
          intervalValid:
            typeof raw.start_ms === "number" &&
            Number.isFinite(raw.start_ms) &&
            typeof raw.end_ms === "number" &&
            Number.isFinite(raw.end_ms) &&
            raw.end_ms >= raw.start_ms,
        }
      : {}),
    // Presence/type only; local channel ID plus runtime identities provide safe correlation.
    identityFields: Object.fromEntries(
      ["event_id", "item_id", "response_id"].map(key => [key, field(raw, key, "string")]),
    ),
  };
}

export type WireRecord = ReturnType<typeof describeTranscriptWire> & {
  sequence: number;
  channelId: number;
  channelRuntimeId: string | null;
  atMs: number | null;
  runtimeId: string | null;
  visitId: number | null;
  childTurnId: number | null;
  nodeId: string | null;
  transcriptRevision: number | null;
  journalOffset: number | null;
  afterDispatchOffset?: number | null;
  awaitingSteering?: boolean | null;
};
export type WireCapture = {
  version: 1;
  channels: number;
  frames: number;
  dropped: number;
  observationErrors: number;
  records: WireRecord[];
};
export type WireWindow = LessonObservationWindow & { sproutTranscriptWire?: { read(): WireCapture; dispose(): void } };

/** Serialized as a harness init script; listener is registered before production onmessage. */
export function observeTranscriptWireInBrowser(describe: typeof describeTranscriptWire) {
  const host = window as WireWindow;
  const prototype = RTCPeerConnection.prototype;
  const original = prototype.createDataChannel;
  const capture: WireCapture = { version: 1, channels: 0, frames: 0, dropped: 0, observationErrors: 0, records: [] };
  const listeners: { channel: RTCDataChannel; listener: (event: MessageEvent) => void }[] = [];
  const wrapped: typeof original = function (this: RTCPeerConnection, ...args) {
    const channel = original.apply(this, args);
    if (args[0] !== "oai-events") return channel;
    const channelId = ++capture.channels;
    // Bound listener retention as well as records. A cap makes absence inconclusive.
    if (listeners.length >= 32) {
      capture.observationErrors++;
      return channel;
    }
    let channelRuntimeId: string | null = null;
    try {
      channelRuntimeId = host.sproutLessonObservation?.read()?.cursor.runtimeId ?? null;
    } catch {
      capture.observationErrors++;
    }
    const listener = (event: MessageEvent) => {
      capture.frames++;
      if (capture.records.length >= 2048) {
        capture.dropped++;
        return;
      }
      try {
        // Use the existing read-only bridge's clock, never AudioContext or wall time.
        const observation = host.sproutLessonObservation?.read();
        const state = observation?.snapshot.runtime;
        const record: WireRecord = {
          ...describe(event.data),
          sequence: capture.frames - 1,
          channelId,
          channelRuntimeId,
          atMs: observation?.nowMs ?? null,
          runtimeId: observation?.cursor.runtimeId ?? null,
          journalOffset: observation?.cursor.offset ?? null,
          awaitingSteering: observation?.snapshot.awaitingSteering ?? null,
          visitId: state?.visitId ?? null,
          childTurnId: state?.childTurnId ?? null,
          nodeId: state?.nodeId ?? null,
          transcriptRevision: state?.transcriptRevision ?? null,
        };
        capture.records.push(record);
        queueMicrotask(() => {
          try {
            const after = host.sproutLessonObservation?.read();
            record.afterDispatchOffset = after?.cursor.runtimeId === record.runtimeId ? after.cursor.offset : null;
          } catch {
            capture.observationErrors++;
          }
        });
      } catch {
        capture.observationErrors++;
      }
    };
    channel.addEventListener("message", listener);
    listeners.push({ channel, listener });
    return channel;
  };
  prototype.createDataChannel = wrapped;
  host.sproutTranscriptWire = {
    read: () => structuredClone(capture),
    dispose: () => {
      if (prototype.createDataChannel === wrapped) prototype.createDataChannel = original;
      listeners.forEach(({ channel, listener }) => channel.removeEventListener("message", listener));
      listeners.length = 0;
    },
  };
}

export async function installTranscriptWire(page: Page) {
  // Serialize the actual installed production source, including its private helpers.
  // This independent invocation observes acceptance; it does not deliver events to the runtime.
  const source = await readFile(path.join(process.cwd(), "lib/events.ts"), "utf8");
  const parserSource = ts
    .transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace(/^export /gm, "");
  await page.addInitScript({
    content: `(() => { ${parserSource}
(${observeTranscriptWireInBrowser.toString()})(data => (${describeTranscriptWire.toString()})(data, parseProviderEvent)); })();`,
  });
  return {
    read: () => page.evaluate(() => (window as WireWindow).sproutTranscriptWire?.read() ?? null),
    dispose: () => page.evaluate(() => (window as WireWindow).sproutTranscriptWire?.dispose()),
  };
}

/** Independent evidence layers, never infer learner delivery from tutor wording. */
export function transcriptDeliveryEvidence(
  capture: WireCapture | null,
  events: LessonDiagnostic[],
  runtimeId: string | null,
) {
  const records = capture?.records.filter(record => record.runtimeId === runtimeId) ?? [];
  const learner = records.filter(record => record.eventType === "session.input_transcript.delta");
  const runtime = events.filter(event => event.runtimeId === runtimeId);
  return {
    runtimeId,
    boundedCaptureComplete:
      capture !== null &&
      capture.dropped === 0 &&
      capture.observationErrors === 0 &&
      capture.channels > 0 &&
      capture.records.length > 0 &&
      capture.records.every(
        record =>
          record.atMs !== null &&
          record.runtimeId === runtimeId &&
          record.channelRuntimeId === runtimeId &&
          record.disposition !== "uninspected" &&
          record.disposition !== "unreadable",
      ),
    learnerWireEvents: learner.length,
    learnerTranscriptCandidates: records.filter(
      row => "transcriptDirection" in row && row.transcriptDirection === "learner",
    ).length,
    tutorTranscriptCandidates: records.filter(
      row => "transcriptDirection" in row && row.transcriptDirection === "tutor",
    ).length,
    tutorWireEvents: records.filter(record => record.eventType === "session.output_transcript.delta").length,
    fragments: correlateTranscriptFragments(records, runtime),
    parserDiscardedLearnerEvents: learner.filter(record => record.disposition === "parser-discard").length,
    unrecognizedTranscriptEvents: records.filter(record => record.disposition === "unrecognized-transcript").length,
    parserValidLearnerEvents: learner.filter(record => record.disposition === "parser-transcript").length,
    runtimeLearnerRejections: runtime
      .filter(
        event =>
          event.type === "transcript.ignored" && (event.detail as { speaker?: string } | null)?.speaker === "child",
      )
      .map(event => ({
        atMs: event.atMs,
        visitId: event.visitId,
        childTurnId: event.childTurnId,
        reason: (event.detail as { reason?: string })?.reason,
      })),
    learnerSnapshots: runtime
      .filter(event => event.type === "transcript.snapshot" && event.transcriptSpeaker === "child")
      .map(event => ({
        atMs: event.atMs,
        visitId: event.visitId,
        childTurnId: event.childTurnId,
        transcriptRevision: event.transcriptRevision,
      })),
  };
}

/** Journal intervals and synchronous dispatch windows are evidence, not semantic authority. */
export function correlateTranscriptFragments(records: WireRecord[], events: LessonDiagnostic[]) {
  return records
    .filter(row => row.disposition === "parser-transcript")
    .map(row => {
      const speaker = row.eventType === "session.input_transcript.delta" ? "child" : "tutor";
      const matching = events.flatMap((event, index) => {
        const detail = event.detail as { speaker?: string; startMs?: number; endMs?: number; reason?: string } | null;
        if (
          event.runtimeId !== row.runtimeId ||
          event.visitId !== row.visitId ||
          event.childTurnId !== row.childTurnId ||
          (event.transcriptSpeaker !== speaker && detail?.speaker !== speaker) ||
          !["transcript.snapshot", "transcript.ignored"].includes(event.type) ||
          index < (row.journalOffset ?? Infinity)
        )
          return [];
        const interval =
          detail?.startMs === ("timing" in row ? row.timing : undefined)?.start_ms.valueMs &&
          detail?.endMs === ("timing" in row ? row.timing : undefined)?.end_ms.valueMs;
        const synchronous = row.afterDispatchOffset != null && index < row.afterDispatchOffset;
        return interval || synchronous
          ? [
              {
                index,
                type: event.type,
                atMs: event.atMs,
                reason: detail?.reason ?? null,
                transcriptRevision: event.transcriptRevision,
                synchronous,
              },
            ]
          : [];
      });
      const competing = records.filter(
        other =>
          other !== row &&
          other.disposition === "parser-transcript" &&
          other.runtimeId === row.runtimeId &&
          other.visitId === row.visitId &&
          other.childTurnId === row.childTurnId &&
          other.eventType === row.eventType &&
          ("timing" in other ? other.timing : undefined)?.start_ms.valueMs ===
            ("timing" in row ? row.timing : undefined)?.start_ms.valueMs &&
          ("timing" in other ? other.timing : undefined)?.end_ms.valueMs ===
            ("timing" in row ? row.timing : undefined)?.end_ms.valueMs,
      );
      const unique = row.channelRuntimeId === row.runtimeId && matching.length === 1 && competing.length === 0;
      return {
        sequence: row.sequence,
        channelId: row.channelId,
        runtimeId: row.runtimeId,
        visitId: row.visitId,
        childTurnId: row.childTurnId,
        speaker,
        atMs: row.atMs,
        disposition: unique
          ? matching[0].type === "transcript.snapshot"
            ? "snapshot"
            : "runtime-rejected"
          : "unknown",
        reason: unique ? matching[0].reason : "no_unique_journal_evidence",
        awaitingSteeringAtArrival: row.awaitingSteering ?? null,
        queuedPendingSteering: "unknown",
        deduplicated: "unknown",
        journalEvidence: matching,
      };
    });
}
