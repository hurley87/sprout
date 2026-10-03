import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import {
  diagnoseObserverOutput,
  observationRecordFromSnapshot,
  type ObserverDiagnostics,
} from "../lib/observer-diagnostics";
import { analyzeSavedRecording, ObserverProviderError } from "../lib/observer-provider";
import { observationFixtures } from "./fixtures/observation-contracts";

const fixture = () => structuredClone(observationFixtures[0]);
const snapshot = (record: ReturnType<typeof fixture>["record"]) =>
  JSON.stringify({
    sessionId: record.session._id,
    state: record.session.state,
    recordStatus: record.session.recordStatus,
    events: record.events,
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("distinguishes fully covered, absent, rejected and unmappable responses using the whole output", () => {
  const { record, proposal } = fixture();
  const response = record.events[1];
  record.events.push({ ...response, _id: "omitted-response" });
  const rejected = { ...proposal!, observation: { ...proposal!.observation, statedTotal: 2 } };
  const unknown = { ...proposal!, proposalId: "unknown", sources: [{ role: "response", eventId: "invented" }] };
  const { diagnostics } = diagnoseObserverOutput(record, [proposal, rejected, null, unknown], "publication");
  expect(diagnostics).toMatchObject({
    outputState: "usable",
    returnedProposalCount: 4,
    rejectedProposalCount: 3,
    responseCount: 2,
    absentResponseCount: 1,
  });
  expect(diagnostics.rows).toContainEqual(
    expect.objectContaining({
      kind: "response",
      eventId: response._id,
      coverage: "returned",
      returnedCount: 2,
      rejectedCount: 1,
      proposalOrdinals: [0, 1],
    }),
  );
  expect(diagnostics.rows).toContainEqual(
    expect.objectContaining({
      kind: "response",
      eventId: "omitted-response",
      coverage: "absent",
      omissionCause: "unknown",
    }),
  );
  expect(diagnostics.rows).toContainEqual(
    expect.objectContaining({
      kind: "proposal",
      ordinal: 2,
      proposalId: null,
      responseEventIds: [],
      issues: [{ path: "$", message: "must be an object" }],
    }),
  );
  expect(diagnostics.rows).toContainEqual(
    expect.objectContaining({
      kind: "proposal",
      ordinal: 3,
      proposalId: "unknown",
      status: "rejected",
      responseEventIds: [],
    }),
  );
  const full = diagnoseObserverOutput(
    record,
    [
      proposal,
      {
        ...proposal,
        sources: [
          ...proposal!.sources.filter(s => s.role !== "response"),
          { role: "response", eventId: "omitted-response" },
        ],
      },
    ],
    "publication",
  );
  expect(full.diagnostics).toMatchObject({ absentResponseCount: 0, rejectedProposalCount: 0 });
  // Even a malformed claim with a wrong session still declared a reference to this exact snapshot event.
  expect(
    diagnoseObserverOutput(record, [{ ...proposal, sessionId: "wrong" }], "publication").diagnostics.rows,
  ).toContainEqual(
    expect.objectContaining({ kind: "response", eventId: response._id, coverage: "returned", rejectedCount: 1 }),
  );
});

it("separates empty usable output from unavailable/invalid output and preserves missing timing without inventing a cause", () => {
  const { record } = fixture();
  record.session.recordStatus = "incomplete";
  const response = record.events[1].evidence!;
  if (response.type !== "utterance") throw new Error("fixture");
  delete response.sessionTiming;
  const empty = diagnoseObserverOutput(record, [], "provider_validation").diagnostics;
  expect(empty).toMatchObject({ outputState: "usable", returnedProposalCount: 0, absentResponseCount: 1 });
  expect(empty.rows).toContainEqual(
    expect.objectContaining({ kind: "response", coverage: "absent", trustedTiming: false, omissionCause: "unknown" }),
  );
  for (const output of [undefined, { proposals: [] }, Array(1001).fill(null)]) {
    const report = diagnoseObserverOutput(record, output, "before_output").diagnostics;
    expect(report).toMatchObject({
      outputState: output === undefined ? "unavailable" : "invalid_batch",
      absentResponseCount: null,
    });
    expect(report.rows).toContainEqual(
      expect.objectContaining({ kind: "response", coverage: "unknown", omissionCause: null }),
    );
    if (output !== undefined) expect(report.batchIssue).toMatchObject({ path: "$" });
  }
});

it("bounds trace details while retaining full counts, canonical transcript fragments", () => {
  const { record, proposal } = fixture();
  const response = record.events[1].evidence!;
  if (response.type !== "utterance") throw new Error("fixture");
  response.transcriptFragments = [{ key: "source:1:fragment:2", textStart: 0, textEnd: 5 }];
  const output = Array.from({ length: 1000 }, (_, ordinal) => ({ ...proposal, proposalId: `p-${ordinal}` }));
  const report = diagnoseObserverOutput(record, output, "publication").diagnostics;
  expect(report.rows).toContainEqual(
    expect.objectContaining({
      kind: "response",
      returnedCount: 1000,
      proposalOrdinals: [0, 1, 2, 3, 4, 5, 6, 7],
      traceTruncated: true,
      fragmentKeys: ["source:1:fragment:2"],
    }),
  );
  const long = diagnoseObserverOutput(record, [{ proposalId: "🦋".repeat(200) }], "publication").diagnostics.rows[0];
  if (long.kind !== "proposal") throw new Error("fixture");
  expect(new TextEncoder().encode(long.proposalId!).length).toBeLessThanOrEqual(200);
  expect(long.traceTruncated).toBe(true);
});

it("captures all provider rejections before publication while preserving timestamp repair and fail-closed batches", async () => {
  const { record, proposal } = fixture();
  const reports: ObserverDiagnostics[] = [];
  await expect(
    analyzeSavedRecording({
      provider: {
        transcribe: async () => "Synthetic",
        propose: async () => [
          null,
          { ...proposal!, exchangeAtMs: 0 },
          { ...proposal!, observation: { ...proposal!.observation, statedTotal: 2 } },
        ],
      },
      audio: new Blob(["synthetic"]),
      mimeType: "audio/webm",
      canonicalSnapshot: snapshot(record),
      signal: new AbortController().signal,
      onDiagnostics: report => reports.push(report),
    }),
  ).rejects.toThrow(ObserverProviderError);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    rejectedProposalCount: 2,
    returnedProposalCount: 3,
    absentResponseCount: 0,
    boundary: "provider_validation",
  });
  expect(reports[0].rows).toContainEqual(
    expect.objectContaining({ kind: "proposal", ordinal: 1, status: "valid", timestampRepaired: true }),
  );
  expect(reports[0].rows).toContainEqual(
    expect.objectContaining({ kind: "response", rejectedCount: 1, returnedCount: 2 }),
  );
});

async function saved(recordStatus: "complete" | "incomplete" = "complete") {
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const f = fixture();
  const { sessionId, proposal, responseId, omittedId } = await t.run(async ctx => {
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus,
      createdAt: 1,
      endedAt: 2,
      nextEventOrder: 3,
    });
    const ids = new Map<string, Id<"sessionEvents">>();
    for (const [order, event] of f.record.events.entries()) {
      if (event.evidence?.type === "utterance")
        event.evidence.transcriptFragments = [{ key: "fragment-1", textStart: 0, textEnd: 5 }];
      ids.set(
        event._id,
        await ctx.db.insert("sessionEvents", {
          sessionId,
          order,
          eventKey: `fixture-${order}`,
          atMs: event.atMs,
          evidence: event.evidence,
        }),
      );
    }
    const omittedId = await ctx.db.insert("sessionEvents", {
      sessionId,
      order: 2,
      eventKey: "omitted",
      atMs: 1800,
      evidence: { type: "utterance", speaker: "unknown", text: "[unclear]", state: "interrupted" },
    });
    const proposal = {
      ...f.proposal!,
      sessionId,
      sources: f.proposal!.sources.map(source =>
        "eventId" in source ? { ...source, eventId: ids.get(source.eventId)! } : source,
      ),
    };
    return { sessionId, proposal, responseId: ids.get(f.record.events[1]._id)!, omittedId };
  });
  const claim = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (claim.status !== "claimed") throw new Error("claim expected");
  const view = async () => JSON.parse(await t.query(internal.parent_review.inspect, { sessionId }));
  const rows = async (snapshotId?: Id<"observerDiagnosticAttempts">) => {
    const history = (await view()).diagnostics;
    const id = snapshotId ?? history.attempts.at(-1).snapshotId;
    return t.query(internal.observer.readDiagnostics, {
      sessionId,
      snapshotId: id,
      paginationOpts: { numItems: 100, cursor: null },
    });
  };
  return { t, sessionId, proposal, responseId, omittedId, claim, view, rows };
}

it("round-trips successful coverage through authorized review reads without bypassing review or promoting diagnostics to evidence", async () => {
  const f = await saved("incomplete");
  await f.t.mutation(internal.observer.publish, {
    analysisId: f.claim.analysisId,
    token: f.claim.token,
    proposals: [f.proposal],
    now: 11,
  });
  const view = await f.view();
  expect(view.diagnostics).toMatchObject({
    availability: "recorded",
    missingAttempts: [],
    attempts: [
      {
        attempt: 1,
        recordStatus: "incomplete",
        hasRecording: false,
        snapshotChanged: false,
        summary: { outputState: "usable", absentResponseCount: 1 },
      },
    ],
  });
  expect(view.proposals).toHaveLength(1);
  expect(view.decisions).toHaveLength(0);
  const snapshotId = view.diagnostics.attempts[0].snapshotId;
  expect((await f.rows()).page).toContainEqual(
    expect.objectContaining({
      kind: "response",
      eventId: f.responseId,
      fragmentKeys: ["fragment-1"],
    }),
  );
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  await expect(
    f.t.action(api.parent_review_action.readDiagnostics, {
      capability: "wrong",
      sessionId: f.sessionId,
      snapshotId,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  ).rejects.toThrow("authorization failed");
  const first = JSON.parse(
    await f.t.action(api.parent_review_action.readDiagnostics, {
      capability: "synthetic-capability",
      sessionId: f.sessionId,
      snapshotId,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  );
  expect(first.page).toHaveLength(1);
  expect(first.isDone).toBe(false);
  const next = await f.t.query(internal.observer.readDiagnostics, {
    sessionId: f.sessionId,
    snapshotId,
    paginationOpts: { numItems: 100, cursor: first.continueCursor },
  });
  expect(next.page).toHaveLength(2);
  expect(next.isDone).toBe(true);
  const otherSession = await f.t.run(ctx =>
    ctx.db.insert("sessions", { state: "ended", recordStatus: "complete", createdAt: 1, nextEventOrder: 0 }),
  );
  await expect(
    f.t.query(internal.observer.readDiagnostics, {
      sessionId: otherSession,
      snapshotId,
      paginationOpts: { numItems: 100, cursor: null },
    }),
  ).rejects.toThrow("scope mismatch");
  await expect(
    f.t.query(internal.observer.readDiagnostics, {
      sessionId: f.sessionId,
      snapshotId,
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow("page size");
  expect(JSON.stringify(view.diagnostics)).not.toContain("inputSnapshot");
  expect(JSON.stringify(view.diagnostics)).not.toContain(f.claim.token);
  expect(await f.t.query(internal.parent_review.forPlanning, { sessionIds: [f.sessionId] })).toMatchObject({
    blocked: true,
    evidence: [],
  });
  expect(
    await f.t.run(ctx =>
      ctx.db
        .query("reviewedEvidence")
        .withIndex("by_analysis", q => q.eq("analysisId", f.claim.analysisId))
        .take(1),
    ),
  ).toEqual([]);
  await f.t.mutation(internal.parent_review.acceptAll, { sessionId: f.sessionId, analysisId: f.claim.analysisId });
  const plan = await f.t.query(internal.parent_review.forPlanning, { sessionIds: [f.sessionId] });
  expect(plan).toMatchObject({ blocked: false });
  expect(plan.evidence).toHaveLength(1);
  expect(plan.evidence[0].observation).toMatchObject({ behavior: "quantity_identification" });
  expect(plan.evidence[0]).not.toHaveProperty("diagnostic");
  await f.t.mutation(internal.observer.publish, {
    analysisId: f.claim.analysisId,
    token: "stale",
    proposals: [],
    now: 12,
  });
  expect((await f.view()).diagnostics).toEqual(view.diagnostics);
});

it("retains independent publication rejection diagnostics after rollback with no partial proposals or reviewed evidence", async () => {
  const f = await saved();
  const batch = [
    f.proposal,
    { ...f.proposal, proposalId: "invalid", observation: { ...f.proposal.observation, statedTotal: 2 } },
    null,
  ];
  await expect(
    f.t.mutation(internal.observer.publish, {
      analysisId: f.claim.analysisId,
      token: f.claim.token,
      proposals: batch,
      now: 11,
    }),
  ).rejects.toThrow("Invalid proposal");
  expect((await f.view()).proposals).toEqual([]);
  await f.t.mutation(internal.observer.fail, {
    analysisId: f.claim.analysisId,
    token: f.claim.token,
    message: "Raw internal failure should stay private",
    proposals: batch,
    now: 12,
  });
  const view = await f.view();
  expect(view).toMatchObject({
    status: "failed",
    proposals: [],
    decisions: [],
    review: null,
    diagnostics: {
      attempts: [{ summary: { boundary: "publication", rejectedProposalCount: 2, absentResponseCount: 1 } }],
    },
  });
  expect(JSON.stringify(view)).not.toContain("Raw internal failure");
  expect((await f.rows()).page).toContainEqual(
    expect.objectContaining({
      kind: "response",
      eventId: f.responseId,
      coverage: "returned",
      returnedCount: 2,
      rejectedCount: 1,
    }),
  );
  expect(await f.t.query(internal.parent_review.forPlanning, { sessionIds: [f.sessionId] })).toMatchObject({
    blocked: true,
    evidence: [],
  });
});

it("preserves retry snapshots and prevents expired or superseded workers from attaching diagnostics", async () => {
  const f = await saved();
  const firstRows = diagnoseObserverOutput(
    observationRecordFromSnapshot(f.claim.inputSnapshot),
    [],
    "provider_validation",
  ).diagnostics;
  await f.t.mutation(internal.observer.fail, {
    analysisId: f.claim.analysisId,
    token: f.claim.token,
    message: "first",
    diagnostics: firstRows,
    now: 11,
  });
  const firstView = await f.view();
  const firstSnapshotId = firstView.diagnostics.attempts[0].snapshotId as Id<"observerDiagnosticAttempts">;
  await f.t.run(ctx => ctx.db.patch(f.sessionId, { recordStatus: "incomplete" }));
  const second = await f.t.mutation(internal.observer.claim, { sessionId: f.sessionId, now: 12 });
  if (second.status !== "claimed") throw new Error("claim expected");
  expect(second.inputSnapshot).not.toBe(f.claim.inputSnapshot);
  expect(
    await f.t.mutation(internal.observer.fail, {
      analysisId: f.claim.analysisId,
      token: f.claim.token,
      message: "stale",
      diagnostics: firstRows,
      now: 13,
    }),
  ).toBe(false);
  const expiredAt = 12 + 5 * 60 * 1000;
  expect(
    await f.t.mutation(internal.observer.fail, {
      analysisId: second.analysisId,
      token: second.token,
      message: "expired",
      diagnostics: firstRows,
      now: expiredAt,
    }),
  ).toBe(false);
  await expect(
    f.t.mutation(internal.observer.publish, {
      analysisId: second.analysisId,
      token: second.token,
      proposals: [],
      now: expiredAt,
    }),
  ).rejects.toThrow("stale or expired");
  const third = await f.t.mutation(internal.observer.claim, { sessionId: f.sessionId, now: expiredAt + 1 });
  if (third.status !== "claimed") throw new Error("claim expected");
  await f.t.mutation(internal.observer.publish, {
    analysisId: third.analysisId,
    token: third.token,
    proposals: [],
    now: expiredAt + 2,
  });
  const history = (await f.view()).diagnostics.attempts;
  expect(history[0]).toEqual(firstView.diagnostics.attempts[0]);
  expect(history[1]).toMatchObject({ attempt: 2, state: "not_captured", summary: null });
  expect(history[2]).toMatchObject({
    attempt: 3,
    recordStatus: "incomplete",
    state: "captured",
    summary: { outputState: "usable" },
  });
  expect((await f.rows(firstSnapshotId)).page).toHaveLength(2);
  const original = await f.t.run(ctx => ctx.db.get(firstSnapshotId));
  expect(original?.inputSnapshot).toBe(f.claim.inputSnapshot);
});

it("records coverage against the claimed snapshot when current canonical material changes and publication fails", async () => {
  const f = await saved();
  const newId = await f.t.run(async ctx => {
    await ctx.db.patch(f.sessionId, { recordStatus: "incomplete" });
    return ctx.db.insert("sessionEvents", {
      sessionId: f.sessionId,
      order: 4,
      eventKey: "late",
      atMs: 3000,
      evidence: { type: "utterance", speaker: "unknown", text: "late", state: "interrupted" },
    });
  });
  expect(
    await f.t.mutation(internal.observer.publish, {
      analysisId: f.claim.analysisId,
      token: f.claim.token,
      proposals: [f.proposal],
      now: 11,
    }),
  ).toBeNull();
  expect(await f.view()).toMatchObject({
    status: "failed",
    diagnostics: {
      attempts: [
        { recordStatus: "complete", snapshotChanged: true, summary: { responseCount: 2, absentResponseCount: 1 } },
      ],
    },
  });
  expect((await f.rows()).page.some(row => row.kind === "response" && row.eventId === newId)).toBe(false);
});

it("keeps legacy analyses explicitly unavailable without writing or repairing their records", async () => {
  const f = await saved();
  // Simulate a pre-diagnostics ready analysis, with its own immutable valid input/proposals.
  const legacySession = await f.t.run(async ctx => {
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "complete",
      createdAt: 1,
      nextEventOrder: 0,
    });
    const inputSnapshot = JSON.stringify({
      sessionId,
      state: "ended",
      recordStatus: "complete",
      recording: null,
      events: [],
    });
    await ctx.db.insert("observerAnalyses", { sessionId, status: "ready", attempt: 1, inputSnapshot });
    return sessionId;
  });
  const before = await f.t.run(ctx =>
    ctx.db
      .query("observerAnalyses")
      .withIndex("by_session", q => q.eq("sessionId", legacySession))
      .unique(),
  );
  const view = JSON.parse(await f.t.query(internal.parent_review.inspect, { sessionId: legacySession }));
  expect(view).toMatchObject({
    status: "ready",
    diagnostics: { availability: "legacy_unavailable", attempts: [], missingAttempts: [1] },
  });
  expect(await f.t.mutation(internal.observer.claim, { sessionId: legacySession, now: 12 })).toMatchObject({
    status: "ready",
  });
  expect(await f.t.run(ctx => ctx.db.get(before!._id))).toEqual(before);
});

it.each(["invalid", "empty", "offline", "proposal_offline", "malformed_envelope", "invalid_batch"])(
  "persists %s provider output through the saved-record action pipeline before publication",
  async mode => {
    const f = await saved();
    await f.t.mutation(internal.observer.fail, {
      analysisId: f.claim.analysisId,
      token: f.claim.token,
      message: "fixture setup",
      now: 11,
    });
    await f.t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["synthetic audio"]));
      await ctx.db.patch(f.sessionId, {
        recording: { storageId, mimeType: "audio/webm", startOffsetMs: 0, durationMs: 5000 },
      });
    });
    vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("audio/transcriptions"))
        return mode === "offline"
          ? new Response(null, { status: 503 })
          : Response.json({ text: "Synthetic transcript" });
      if (url.endsWith("/responses")) {
        if (mode === "proposal_offline") return new Response(null, { status: 503 });
        if (mode === "malformed_envelope") return Response.json({ status: "completed", output_text: "{" });
        if (mode === "invalid_batch")
          return Response.json({
            status: "completed",
            output_text: JSON.stringify({ proposals: Array(1001).fill(null) }),
          });
        return Response.json({
          status: "completed",
          output_text: JSON.stringify({
            proposals:
              mode === "empty"
                ? []
                : [
                    null,
                    f.proposal,
                    { ...f.proposal, proposalId: "bad", sources: [{ eventId: "invented", role: "response" }] },
                  ],
          }),
        });
      }
      return new Response(new Blob(["synthetic audio"]));
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await f.t.action(internal.observer_action.analyze, { sessionId: f.sessionId })).toBe(
      mode === "empty" ? "complete" : "failed",
    );
    const view = await f.view();
    expect(view.proposals).toEqual([]);
    const unavailable = ["offline", "proposal_offline", "malformed_envelope"].includes(mode);
    expect(view.diagnostics.attempts[1]).toMatchObject({
      attempt: 2,
      hasRecording: true,
      summary: {
        outputState: unavailable ? "unavailable" : mode === "invalid_batch" ? "invalid_batch" : "usable",
        boundary: unavailable ? "before_output" : mode === "empty" ? "publication" : "provider_validation",
        absentResponseCount: unavailable || mode === "invalid_batch" ? null : 1 + (mode === "empty" ? 1 : 0),
        failureStage:
          mode === "empty"
            ? null
            : mode === "offline"
              ? "transcription"
              : unavailable
                ? "proposal"
                : "provider_validation",
      },
    });
    if (mode === "invalid") {
      expect(view.diagnostics.attempts[1].summary.rejectedProposalCount).toBe(2);
      expect((await f.rows()).page).toContainEqual(
        expect.objectContaining({ kind: "response", eventId: f.responseId, coverage: "returned" }),
      );
    }
    expect(await f.t.query(internal.parent_review.forPlanning, { sessionIds: [f.sessionId] })).toMatchObject({
      blocked: true,
      evidence: [],
    });
  },
);

it("keeps pre-diagnostics running workers compatible and records missing earlier retry provenance", async () => {
  const f = await saved();
  await f.t.run(async ctx => {
    const attempt = await ctx.db
      .query("observerDiagnosticAttempts")
      .withIndex("by_analysisId_and_attempt", q => q.eq("analysisId", f.claim.analysisId).eq("attempt", 1))
      .unique();
    await ctx.db.delete(attempt!._id);
  });
  expect(
    await f.t.mutation(internal.observer.fail, {
      analysisId: f.claim.analysisId,
      token: f.claim.token,
      message: "legacy worker failed",
      now: 11,
    }),
  ).toBe(true);
  expect((await f.view()).diagnostics).toMatchObject({ availability: "legacy_unavailable", missingAttempts: [1] });
  const retry = await f.t.mutation(internal.observer.claim, { sessionId: f.sessionId, now: 12 });
  if (retry.status !== "claimed") throw new Error("claim expected");
  await f.t.mutation(internal.observer.publish, {
    analysisId: retry.analysisId,
    token: retry.token,
    proposals: [],
    now: 13,
  });
  expect((await f.view()).diagnostics).toMatchObject({
    availability: "recorded",
    missingAttempts: [1],
    attempts: [{ attempt: 2, state: "captured" }],
  });
});

it("settles failure and retains original diagnostics even if current canonical material exceeds its read limit", async () => {
  const f = await saved();
  await f.t.run(async ctx => {
    for (let order = 3; order < 1001; order++)
      await ctx.db.insert("sessionEvents", { sessionId: f.sessionId, order, eventKey: `late-${order}`, atMs: order });
  });
  await expect(
    f.t.mutation(internal.observer.publish, {
      analysisId: f.claim.analysisId,
      token: f.claim.token,
      proposals: [f.proposal],
      now: 11,
    }),
  ).rejects.toThrow("more than 1000 events");
  expect(
    await f.t.mutation(internal.observer.fail, {
      analysisId: f.claim.analysisId,
      token: f.claim.token,
      message: "canonical read failed",
      proposals: [f.proposal],
      now: 12,
    }),
  ).toBe(true);
  expect(await f.view()).toMatchObject({
    status: "failed",
    diagnostics: { attempts: [{ snapshotChanged: true, summary: { responseCount: 2, absentResponseCount: 1 } }] },
  });
});

it("does not erase a canonical response reference when source-role or support-role validation rejects it", () => {
  const { record, proposal } = fixture();
  const responseId = record.events[1]._id;
  const wrongRole = { ...proposal, sources: [{ eventId: responseId, role: "scene" }] };
  const wrongSupport = {
    ...proposal,
    sources: [],
    observation: {
      ...proposal!.observation,
      support: { status: "recorded", kinds: ["hint"], sourceEventIds: [responseId] },
    },
  };
  for (const output of [[wrongRole], [wrongSupport]]) {
    const { diagnostics } = diagnoseObserverOutput(record, output, "publication");
    expect(diagnostics).toMatchObject({ rejectedProposalCount: 1, absentResponseCount: 0 });
    expect(diagnostics.rows).toContainEqual(
      expect.objectContaining({ kind: "response", eventId: responseId, coverage: "returned", rejectedCount: 1 }),
    );
  }
});
