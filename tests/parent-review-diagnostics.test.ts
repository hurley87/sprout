import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AttemptSummary, DiagnosticRowDetail } from "../app/evidence-diagnostics";
import { diagnosticPlaybackAnchor, diagnosticSource, diagnosticSpeechScenes } from "../lib/diagnostic-source";
import {
  diagnosticPage,
  validDiagnosticHistory,
  validDiagnosticPage,
  validDiagnosticRequest,
} from "../lib/parent-review-diagnostics";
import { recordingOffsetSeconds } from "../lib/session-recorder";
import { reviewDiagnosticFixture } from "./fixtures/review-diagnostics";

it("separates output absence, validation rejection and a valid unpublished row without decision controls", () => {
  const f = reviewDiagnosticFixture();
  const html = f.rows
    .map(row => renderToStaticMarkup(createElement(DiagnosticRowDetail, { row, record: f.record, seek: () => {} })))
    .join("");
  expect(html).toContain("Response absent from usable Observer output");
  expect(html).toContain("cause of absence is unknown");
  expect(html).toContain("rejected by validation");
  expect(html).toContain("passed proposal validation");
  expect(html).toContain("not necessarily published or parent-reviewed");
  expect(html).toContain("observation.statedTotal");
  expect(html).toContain("text offsets");
  expect(html).not.toContain("Accept unchanged");
  expect(html).not.toContain("Edit details");
  expect(html).not.toContain("Reject proposal");
});
it("does not substitute an event with the same event key/time for a missing historical ID", () => {
  const f = reviewDiagnosticFixture();
  const row = f.rows.find(row => row.kind === "response" && row.eventId === f.responseId)!;
  f.record.events[1].id = "replacement-id";
  expect(diagnosticSource(f.record, f.responseId)).toBeUndefined();
  const html = renderToStaticMarkup(createElement(DiagnosticRowDetail, { row, record: f.record, seek: () => {} }));
  expect(html).toContain("source material unavailable in the current record");
  expect(html).not.toContain("Three");
  expect(html).not.toContain("Play from");
});
it("labels trace truncation, unresolvable transcript fragments and absent recordings", () => {
  const f = reviewDiagnosticFixture();
  const row = f.rows.find(row => row.kind === "response")!;
  if (row.kind !== "response") throw new Error();
  row.traceTruncated = true;
  row.fragmentKeys = ["shortened-fragment"];
  delete f.record.recording;
  const html = renderToStaticMarkup(createElement(DiagnosticRowDetail, { row, record: f.record, seek: () => {} }));
  expect(html).toContain("Trace detail truncated");
  expect(html).toContain("truncated key may not resolve");
  expect(html).toContain("Full-session recording unavailable");
  expect(html).not.toContain("<button");
});
it("keeps failure, invalid batch, changed snapshot and not-captured summaries qualified", () => {
  const { attempt } = reviewDiagnosticFixture();
  const summary = attempt.summary!;
  for (const outputState of ["unavailable", "invalid_batch"] as const) {
    const html = renderToStaticMarkup(
      createElement(AttemptSummary, {
        attempt: {
          ...attempt,
          snapshotChanged: true,
          summary: { ...summary, outputState, absentResponseCount: null, failureStage: "transcription" },
        },
      }),
    );
    expect(html).toContain("coverage is unknown");
    expect(html).toContain("Canonical snapshot changed");
    expect(html).toContain("some evidence may be missing");
    expect(html).toContain("Failure stage: transcription");
  }
  const html = renderToStaticMarkup(
    createElement(AttemptSummary, {
      attempt: { ...attempt, state: "not_captured", summary: null, snapshotChanged: null, completedAt: null },
    }),
  );
  expect(html).toContain("diagnostics not captured");
  expect(html).toContain("Snapshot change status unavailable");
});
it.each(["mapped_provider", "source_input_bound", "source_timeline_bound", "receipt", "event"] as const)(
  "seeks %s with canonical recording offset and never raw provider offsets",
  provenance => {
    const f = reviewDiagnosticFixture();
    const event = f.record.events[1];
    const evidence = event.evidence!;
    if (evidence.type !== "utterance") throw new Error();
    if (provenance === "source_input_bound")
      evidence.sessionTiming = {
        clock: "session",
        provenance,
        sourceId: 1,
        startMs: 100,
        endMs: 14500,
        inputScene: { sceneId: "ducks-3", displayedAtMs: 100 },
      };
    if (provenance === "source_timeline_bound") {
      evidence.providerTiming = { clock: "provider", sourceId: 1, startMs: 12000, endMs: 13000 };
      evidence.sessionTiming = {
        clock: "session",
        provenance,
        sourceId: 1,
        startMs: 12000,
        endMs: 14500,
        sourceRequestedAtMs: 0,
        inputOpenedAtMs: 100,
        inputScene: { sceneId: "ducks-3", displayedAtMs: 100 },
      };
    }
    if (provenance === "receipt" || provenance === "event") delete evidence.sessionTiming;
    if (provenance === "event") delete evidence.firstObservedAtMs;
    const anchor = diagnosticPlaybackAnchor(event);
    expect(anchor.atMs).toBe(
      provenance === "source_input_bound"
        ? 100
        : provenance === "receipt"
          ? 14000
          : provenance === "event"
            ? 20000
            : 12000,
    );
    expect(anchor.label).toContain(
      provenance.startsWith("source_") ? "conservative" : provenance === "mapped_provider" ? "mapped" : "approximate",
    );
    expect(recordingOffsetSeconds(anchor.atMs, f.record.recording!)).toBe(Math.max(0, anchor.atMs - 2000) / 1000);
    expect(anchor.atMs).not.toBe(50600);
  },
);
it("does not establish speech scene from an evaluator alone, incomplete IDs or crossing timing", () => {
  const f = reviewDiagnosticFixture();
  const response = f.record.events[1];
  expect(diagnosticSpeechScenes(response, f.record)).toHaveLength(1);
  f.record.events.push({
    id: "later-scene",
    eventKey: "later",
    order: 6,
    atMs: 13000,
    evidence: f.record.events[0].evidence,
  });
  expect(diagnosticSpeechScenes(response, f.record)).toEqual([]);
  f.record.events.pop();
  const withoutIds = structuredClone(f.record);
  delete withoutIds.events[0].id;
  expect(diagnosticSpeechScenes(response, withoutIds)).toEqual([]);
  if (response.evidence?.type !== "utterance") throw new Error();
  delete response.evidence.sessionTiming;
  expect(diagnosticSpeechScenes(response, f.record)).toEqual([]);
});
it("validates reused diagnostic schemas and bounded pages, rejecting private fields and scope mismatch", () => {
  const f = reviewDiagnosticFixture();
  const input = { sessionId: f.record.id, snapshotId: f.attempt.snapshotId, cursor: null, numItems: 25 };
  expect(validDiagnosticRequest(input)).toBe(true);
  expect(validDiagnosticHistory(f.history)).toBe(true);
  expect(validDiagnosticHistory({ ...f.history, inputSnapshot: "private" })).toBe(false);
  expect(validDiagnosticHistory({ ...f.history, attempts: [{ ...f.attempt, token: "private" }] })).toBe(false);
  const value = { page: f.rows, isDone: true, continueCursor: "", leaseToken: "private" };
  const page = diagnosticPage(value, input);
  expect(page).not.toHaveProperty("leaseToken");
  expect(validDiagnosticPage(page, input)).toBe(true);
  expect(validDiagnosticPage({ ...page, snapshotId: "other-attempt" }, input)).toBe(false);
  for (const numItems of [0, 51, 1.5]) expect(validDiagnosticRequest({ ...input, numItems })).toBe(false);
  for (const row of [
    { ...f.rows[0], payload: "private" },
    { ...f.rows[0], responseEventIds: Array(9).fill("id") },
  ])
    expect(() => diagnosticPage({ ...value, page: [row] }, input)).toThrow();
  expect(() => diagnosticPage({ ...value, isDone: false, continueCursor: "" }, input)).toThrow();
});
