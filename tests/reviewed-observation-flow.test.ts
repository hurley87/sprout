import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { ConvexSessionRecorder } from "../lib/convex-session-recorder";
import { recordingOffsetSeconds } from "../lib/session-recorder";
import { reviewPlaybackAtMs, type ReviewSnapshot } from "../lib/parent-review";
import { reconcileReviewWrite, type ReviewWrite } from "../lib/parent-review-reconciliation";
import { observationFixtures } from "./fixtures/observation-contracts";

const rpc = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn(), action: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = rpc.mutation;
    query = rpc.query;
    action = rpc.action;
  },
}));
import { POST as observe } from "../app/api/observer/retry/route";
import { POST as review } from "../app/api/parent-review/route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.values(rpc).forEach(mock => mock.mockReset());
});

function request(path: string, body: unknown, origin = "http://127.0.0.1:3000") {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Only network transport, transcription and model output are mocked. The recorder,
 * routes, public capability actions, scheduler, validators and persisted review are real.
 * Invented bytes and proposals do not establish acoustic alignment or model accuracy. */
async function flow(name = "correct-total-without-spoken-count", partial = false, count = 1) {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  vi.useFakeTimers();
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  rpc.mutation.mockImplementation(async (fn, args) => {
    const result = await t.mutation(fn, args);
    return getFunctionName(fn) === getFunctionName(api.sessions.generateUploadUrl)
      ? "https://synthetic-upload.invalid/audio"
      : result;
  });
  rpc.query.mockImplementation((fn, args) => t.query(fn, args));
  rpc.action.mockImplementation((fn, args) => t.action(fn, args));
  const source = structuredClone(observationFixtures.find(f => f.name === name)!);
  let proposals: unknown[] = [];
  let failTranscription = false;
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "https://synthetic-upload.invalid/audio") {
      const storageId = await t.run(ctx => ctx.storage.store(init!.body as Blob));
      return Response.json({ storageId });
    }
    if (url === "/api/observer/retry") return observe(request(url, JSON.parse(String(init?.body))));
    if (url.includes("audio/transcriptions")) {
      const audio = (init!.body as FormData).get("file") as Blob;
      expect(await audio.text()).toBe("synthetic recording bytes");
      return failTranscription
        ? new Response(null, { status: 503 })
        : Response.json({ text: "Synthetic adult fixture" });
    }
    if (url.endsWith("/responses")) {
      const body = JSON.parse(String(init?.body));
      const snapshot = JSON.parse(JSON.parse(body.input).canonicalSnapshot);
      expect(snapshot.sessionId).toBe(sessionId);
      expect(snapshot.events.map((e: { _id: string }) => e._id)).toEqual(saved!.events.map(e => e._id));
      return Response.json({ status: "completed", output_text: JSON.stringify({ proposals }) });
    }
    expect(url).toBe(saved!.recordingUrl);
    const bytes = await t.run(async ctx => {
      const audio = await ctx.storage.get(saved!.session.recording!.storageId);
      return Array.from(new Uint8Array(await audio!.arrayBuffer()));
    });
    return new Response(new Uint8Array(bytes));
  });
  vi.stubGlobal("fetch", network);
  const recorder = new ConvexSessionRecorder();
  const sessionId = (await recorder.create()) as Id<"sessions">;
  await recorder.activate(1000);
  for (const [i, event] of source.record.events.entries())
    await recorder.append(`synthetic-${i}`, event.atMs, event.evidence!);
  await recorder.finalize(partial ? "connection_failure" : "wrap_up", partial);
  const pending = await recorder.getRecord(sessionId);
  expect(pending?.recordStatus).toBe(partial ? "incomplete" : "pending");
  await expect(t.action(api.observer_action.requestAnalysis, { sessionId, capability: "wrong" })).rejects.toThrow(
    "authorization failed",
  );
  await recorder.attachRecording({
    blob: new Blob(["synthetic recording bytes"], { type: "audio/webm" }),
    mimeType: "audio/webm",
    startOffsetMs: 100,
    durationMs: 5000,
  });
  const saved = await t.query(api.sessions.getRecord, { sessionId });
  expect(saved?.session.recordStatus).toBe(partial ? "incomplete" : "complete");
  expect(saved?.session.endingReason).toBe(partial ? "connection_failure" : "wrap_up");
  const ids = new Map(source.record.events.map((e, i) => [e._id, saved!.events[i]._id]));
  if (source.proposal) {
    source.proposal.sessionId = sessionId;
    source.proposal.sources = source.proposal.sources.map(s =>
      "eventId" in s ? { ...s, eventId: ids.get(s.eventId)! } : s,
    );
    source.proposal.observation.support.sourceEventIds = source.proposal.observation.support.sourceEventIds.map(id =>
      ids.get(id)!,
    );
    proposals = Array.from({ length: count }, (_, i) => ({ ...source.proposal!, proposalId: `synthetic-p${i}` }));
  }
  const flush = () => t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
  const read = async (): Promise<ReviewSnapshot> => {
    const response = await review(request("/api/parent-review", { operation: "get", sessionId }));
    expect(response.status).toBe(200);
    return response.json();
  };
  const write = (command: ReviewWrite) => review(request("/api/parent-review", command));
  const gate = () => t.query(internal.parent_review.forPlanning, { sessionIds: [sessionId] });
  const retry = () => observe(request("/api/observer/retry", { sessionId }));
  return {
    t,
    sessionId,
    recorder,
    saved,
    flush,
    read,
    write,
    gate,
    retry,
    network,
    rewriteExchangeAtMs: (exchangeAtMs: number) => {
      proposals = proposals.map(value => ({ ...(value as NonNullable<typeof source.proposal>), exchangeAtMs }));
    },
    setFailure: (value: boolean) => {
      failTranscription = value;
    },
    rewriteDescription: (description: string) => {
      proposals = proposals.map(value => {
        const proposal = structuredClone(value) as NonNullable<typeof source.proposal>;
        proposal.observation.description = description;
        return proposal;
      });
    },
  };
}

it("publishes and reviews the canonical event time when the model supplies speech start", async () => {
  const f = await flow();
  f.rewriteExchangeAtMs(1700);
  await f.flush();
  const saved = await f.read();
  expect(saved.status).toBe("ready");
  expect(saved.proposals[0].proposal.exchangeAtMs).toBe(1800);
  expect(reviewPlaybackAtMs(saved.proposals[0].proposal, saved.sources)).toBe(1700);
  expect(
    (await f.write({ operation: "acceptAll", sessionId: f.sessionId, analysisId: saved.analysisId! })).status,
  ).toBe(200);
  expect((await f.gate()).evidence[0].exchangeAtMs).toBe(1800);
});

it.each([false, true])(
  "carries saved audio through Observer, mixed review and planning (partial: %s)",
  async partial => {
    const f = await flow(undefined, partial, 3);
    expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
    await f.flush();
    const before = await f.read();
    expect(before.status, JSON.stringify(await f.t.query(api.observer.get, { sessionId: f.sessionId }))).toBe("ready");
    expect(Boolean(before.qualification)).toBe(partial);
    const scope = { sessionId: f.sessionId, analysisId: before.analysisId! };
    const command = (i: number, decision: "accepted" | "rejected"): ReviewWrite => ({
      operation: "decide",
      ...scope,
      proposalRowId: before.proposals[i].id,
      decision: {
        kind: "parent_decision",
        proposalId: `synthetic-p${i}`,
        decision,
        ...(decision === "rejected" ? { rejectionReason: "Synthetic parent attribution mismatch" } : {}),
      },
    });
    const accepted = command(0, "accepted");
    expect((await f.write(accepted)).status).toBe(200);
    // A lost response is resolved using the real persisted state, ignoring only server time.
    expect(reconcileReviewWrite(accepted, await f.read()).outcome).toBe("saved");
    const competing = command(0, "rejected");
    expect((await f.write(competing)).status).toBe(409);
    expect(reconcileReviewWrite(competing, await f.read()).outcome).toBe("conflict");
    const correction: ReviewWrite = {
      operation: "decide",
      ...scope,
      proposalRowId: before.proposals[1].id,
      decision: {
        kind: "parent_decision",
        proposalId: "synthetic-p1",
        decision: "corrected",
        correction: {
          ...before.proposals[1].proposal.observation,
          description: "Identified the total with parent help.",
        },
        parentContext: {
          provenance: "parent_review",
          note: "Synthetic parent reports help and pointing.",
          assistance: ["parent_reported_assistance"],
          pointingOrTouchCounting: true,
        },
      },
    };
    expect(reconcileReviewWrite(correction, await f.read())).toMatchObject({ outcome: "unresolved", retryable: true });
    expect((await f.write(correction)).status).toBe(200);
    expect((await f.write(command(2, "rejected"))).status).toBe(200);
    expect((await f.write({ operation: "acceptAll", ...scope })).status).toBe(409);
    expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
    const complete: ReviewWrite = {
      operation: "complete",
      ...scope,
      repairLevel: "light_correction",
      note: "Synthetic mixed review",
    };
    expect((await f.write(complete)).status).toBe(200);
    expect((await f.write(complete)).status).toBe(200);
    expect(reconcileReviewWrite(complete, await f.read()).outcome).toBe("saved");
    const after = await f.read();
    expect(after.proposals).toEqual(before.proposals);
    expect(after.review).toMatchObject({ repairLevel: "light_correction", note: "Synthetic mixed review" });
    const gate = await f.gate();
    expect(gate.blocked).toBe(false);
    expect(gate.evidence).toHaveLength(2);
    expect(gate.evidence[1]).toMatchObject({ parentContext: correction.decision.parentContext });
    const recovered = await new ConvexSessionRecorder().getRecord(f.sessionId);
    const atMs = reviewPlaybackAtMs(after.proposals[0].proposal, after.sources);
    expect(atMs).toBe(1700);
    expect(recordingOffsetSeconds(atMs, recovered!.recording!)).toBe(1.6);
    expect(recovered?.events.map(e => e.atMs)).toEqual(f.saved!.events.map(e => e.atMs));
    const calls = f.network.mock.calls.length;
    expect(await (await f.retry()).json()).toEqual({ status: "ready" });
    await f.flush();
    expect(f.network).toHaveBeenCalledTimes(calls);
    expect((await f.read()).proposals).toEqual(before.proposals);
    expect((await f.t.query(api.sessions.getRecord, { sessionId: f.sessionId }))?.events).toEqual(f.saved!.events);
  },
);

it("failed provider and duplicate triggers remain blocked until explicit retry and empty acknowledgment", async () => {
  const f = await flow("silence-produces-no-observation");
  f.setFailure(true);
  // Duplicate pending triggers target the same attempt, even if it fails quickly.
  await f.retry();
  await f.flush();
  expect(await f.read()).toMatchObject({ status: "failed", proposals: [], review: null });
  expect(await f.t.query(api.observer.get, { sessionId: f.sessionId })).toMatchObject({ attempt: 1 });
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  f.setFailure(false);
  await f.retry();
  await f.flush();
  const ready = await f.read();
  expect(ready).toMatchObject({ status: "ready", proposals: [], review: null });
  expect(await f.t.query(api.observer.get, { sessionId: f.sessionId })).toMatchObject({ attempt: 2 });
  const completion: ReviewWrite = {
    operation: "complete",
    sessionId: f.sessionId,
    analysisId: ready.analysisId!,
    repairLevel: "verified",
    note: "Synthetic silence",
    acknowledgeEmpty: true,
  };
  expect((await f.write({ ...completion, acknowledgeEmpty: false })).status).toBe(409);
  expect((await f.write(completion)).status).toBe(200);
  expect(reconcileReviewWrite(completion, await f.read()).outcome).toBe("saved");
  expect(await f.gate()).toEqual({ blocked: false, reason: null, evidence: [] });
});

it("exposes the free-text interpretation limitation while retaining the parent gate", async () => {
  const f = await flow();
  const unsupported = "The child mastered counting and independently touch-counted every object.";
  f.rewriteDescription(unsupported);
  await f.flush();
  // Shape/reference validation cannot prove narrative truth. This is a documented
  // limitation, not a test claiming these forbidden interpretations are acceptable.
  expect((await f.read()).proposals[0].proposal.observation.description).toBe(unsupported);
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
});

it.each([
  "counting-aloud-with-total",
  "hint-and-counting-together",
  "ambiguous-speaker",
  "unclear-speech",
  "interrupted-exchange",
  "missing-scene-context-uncertain",
  "wrong-scene-context",
])("validates %s across provider publication and unchanged review", async name => {
  const f = await flow(name, name === "interrupted-exchange");
  await f.flush();
  const saved = await f.read();
  if (name === "wrong-scene-context") {
    expect(saved).toMatchObject({ status: "failed", proposals: [], review: null });
    expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  } else {
    expect(saved.status).toBe("ready");
    expect(
      (await f.write({ operation: "acceptAll", sessionId: f.sessionId, analysisId: saved.analysisId! })).status,
    ).toBe(200);
    const gate = await f.gate();
    expect(gate.blocked).toBe(false);
    expect(gate.evidence).toHaveLength(1);
    expect((await f.read()).proposals).toEqual(saved.proposals);
  }
});
