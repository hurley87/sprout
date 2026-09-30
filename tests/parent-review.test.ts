import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { observationFixtures, type SyntheticObservationFixture } from "./fixtures/observation-contracts";
import type { ObserverProposal } from "../lib/observation-contracts";

async function fixture(
  name = "correct-total-without-spoken-count",
  count = 1,
  prepare?: (source: SyntheticObservationFixture) => void,
) {
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const source = structuredClone(observationFixtures.find(item => item.name === name)!);
  prepare?.(source);
  const sessionId = await t.run(async ctx => {
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "complete",
      createdAt: 1,
      nextEventOrder: source.record.events.length,
    });
    const ids = new Map<string, string>();
    for (const [order, event] of source.record.events.entries()) {
      const id = await ctx.db.insert("sessionEvents", {
        sessionId,
        order,
        eventKey: `${order}`,
        atMs: event.atMs,
        evidence: event.evidence,
      });
      ids.set(event._id, id);
    }
    if (source.proposal) {
      source.proposal.sessionId = sessionId;
      source.proposal.sources = source.proposal.sources.map(item =>
        "eventId" in item ? { ...item, eventId: ids.get(item.eventId)! } : item,
      );
      source.proposal.observation.support.sourceEventIds = source.proposal.observation.support.sourceEventIds.map(id =>
        ids.get(id)!,
      );
    }
    return sessionId;
  });
  const claim = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (claim.status !== "claimed") throw new Error("claim");
  const proposals = source.proposal
    ? Array.from({ length: count }, (_, i) => ({ ...source.proposal!, proposalId: `p${i}` }))
    : [];
  await t.mutation(internal.observer.publish, { analysisId: claim.analysisId, token: claim.token, proposals, now: 11 });
  const rows = await t.run(ctx =>
    ctx.db
      .query("observerProposals")
      .withIndex("by_analysis_ordinal", q => q.eq("analysisId", claim.analysisId))
      .take(1001),
  );
  const scope = { sessionId, analysisId: claim.analysisId };
  const decide = (decision: unknown, index = 0) =>
    t.mutation(internal.parent_review.decide, { ...scope, proposalRowId: rows[index]._id, decision });
  const gate = () => t.query(internal.parent_review.forPlanning, { sessionIds: [sessionId] });
  return { t, scope, rows, decide, gate, original: proposals[0] as ObserverProposal };
}

const accept = (id = "p0") => ({ kind: "parent_decision", proposalId: id, decision: "accepted" });
const reject = (id = "p0") => ({
  kind: "parent_decision",
  proposalId: id,
  decision: "rejected",
  rejectionReason: "This was the parent speaking.",
});

const correct = (correction: ObserverProposal["observation"]) => ({
  kind: "parent_decision",
  proposalId: "p0",
  decision: "corrected",
  correction,
  parentContext: { provenance: "parent_review", note: "Corrected the interpretation." },
});

async function expectNoReviewWrites(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await f.t.run(ctx => ctx.db.query("parentDecisions").take(10))).toEqual([]);
  expect(await f.t.run(ctx => ctx.db.query("reviewedEvidence").take(10))).toEqual([]);
  expect(await f.t.run(ctx => ctx.db.query("sessionReviews").take(10))).toEqual([]);
  await expect(
    f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" }),
  ).rejects.toThrow("incomplete");
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  expect(await f.t.run(ctx => ctx.db.get(f.rows[0]._id))).toEqual(f.rows[0]);
}

it("rejects a self-consistent wrong target atomically and keeps it out of planning", async () => {
  const f = await fixture();
  await expect(
    f.decide(
      correct({
        ...f.original.observation,
        targetQuantity: 4,
        statedTotal: 4,
        description: "The child correctly identified four objects.",
      }),
    ),
  ).rejects.toThrow("canonical cited scene quantity");
  await expectNoReviewWrites(f);
  // Parent interpretation can differ from transcript tokens, while retaining the actual target.
  const correction = { ...f.original.observation, statedTotal: 2, outcome: "incorrect" as const };
  await f.decide(correct(correction));
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  expect(await f.gate()).toMatchObject({
    blocked: false,
    evidence: [{ observation: correction, sources: f.original.sources, interpretationProvenance: "parent_review" }],
  });
});

it("permits target omission only for uncertainty and binds supplied uncertain targets to the cited scene", async () => {
  const f = await fixture("ambiguous-speaker");
  await expect(f.decide(correct({ ...f.original.observation, targetQuantity: 4 }))).rejects.toThrow(
    "canonical cited scene quantity",
  );
  await expectNoReviewWrites(f);
  const { targetQuantity, ...correction } = f.original.observation;
  void targetQuantity;
  await f.decide(correct(correction));
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  expect(await f.gate()).toMatchObject({ blocked: false, evidence: [{ observation: correction }] });
  const concrete = await fixture();
  const { targetQuantity: omitted, ...withoutTarget } = concrete.original.observation;
  void omitted;
  await expect(concrete.decide(correct(withoutTarget))).rejects.toThrow("invalid or missing observation fields");
  await expectNoReviewWrites(concrete);
});

it("cannot resolve missing or ambiguous scene timing into concrete performance or erase its uncertainty", async () => {
  const preparations: Array<(source: SyntheticObservationFixture) => void> = [
    // A missing scene, including an attempted target supplied solely by the parent.
    source => {
      source.record.events = source.record.events.filter(event => event.evidence?.type !== "scene_displayed");
      source.proposal!.sources = source.proposal!.sources.filter(source => source.role !== "scene");
      delete source.proposal!.observation.targetQuantity;
    },
    source => {
      const response = source.record.events.find(event => event.evidence?.type === "utterance")!;
      if (response.evidence?.type === "utterance") delete response.evidence.startMs;
    },
    source => {
      source.record.events[0].atMs = 1700;
    }, // Scene at speech start is ambiguous.
    source => {
      source.record.events.push({ ...source.record.events[0], _id: "tie-scene" });
    },
    source => {
      source.record.events.push({ ...source.record.events[0], _id: "transition-scene", atMs: 1800 });
    },
    source => {
      source.proposal!.sources = source.proposal!.sources.filter(source => source.role !== "scene");
    },
  ];
  for (const prepare of preparations) {
    const f = await fixture("ambiguous-speaker", 1, source => {
      prepare(source);
      source.proposal!.observation.uncertaintyReasons.push("missing_scene_context");
    });
    await expect(
      f.decide(
        correct({
          ...f.original.observation,
          behavior: "quantity_identification",
          outcome: "correct",
          speakerAttribution: "child_or_nearby_speaker",
          targetQuantity: 3,
          statedTotal: 3,
          uncertaintyReasons: [],
        }),
      ),
    ).rejects.toThrow(/canonical cited scene quantity|uniquely displayed canonical scene/);
    const { targetQuantity, ...uncertain } = f.original.observation;
    void targetQuantity;
    await expect(f.decide(correct({ ...uncertain, uncertaintyReasons: ["ambiguous_speaker"] }))).rejects.toThrow(
      "scene timing uncertainty",
    );
    await expectNoReviewWrites(f);
    await f.decide(correct(uncertain));
    await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "substantial_repair" });
    expect(await f.gate()).toMatchObject({ blocked: false, evidence: [{ observation: uncertain }] });
  }
});

it("accepts unchanged with backend time, canonical row provenance, idempotency and immutable originals", async () => {
  const f = await fixture();
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  const id = await f.decide(accept());
  expect(await f.decide(accept())).toBe(id);
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  const review = await f.t.mutation(internal.parent_review.complete, {
    ...f.scope,
    repairLevel: "verified",
    note: "Checked audio.",
  });
  expect(
    await f.t.mutation(internal.parent_review.complete, {
      ...f.scope,
      repairLevel: "verified",
      note: "Checked audio.",
    }),
  ).toBe(review);
  const gate = await f.gate();
  expect(gate.blocked).toBe(false);
  expect(gate.evidence).toHaveLength(1);
  expect(gate.evidence[0]).toMatchObject({
    proposalRowId: f.rows[0]._id,
    decisionId: id,
    sessionId: f.scope.sessionId,
    analysisId: f.scope.analysisId,
    exchangeAtMs: f.original.exchangeAtMs,
    sources: f.original.sources,
    observation: f.original.observation,
    interpretationProvenance: "observer",
  });
  expect(gate.evidence[0].reviewedAt).toBeGreaterThan(11);
  expect(await f.t.run(ctx => ctx.db.get(f.rows[0]._id))).toEqual(f.rows[0]);
  await expect(f.decide(reject())).rejects.toThrow("Conflicting repeated");
  await expect(f.decide({ ...accept(), reviewedAt: 0 })).rejects.toThrow("backend-owned");
});

it("stores help and pointing as parent testimony without inventing Observer evidence", async () => {
  const f = await fixture();
  const correction = structuredClone(f.original.observation);
  correction.description = "The child gave the total with my help and touch-counting.";
  const decision = {
    kind: "parent_decision",
    proposalId: "p0",
    decision: "corrected",
    correction,
    parentContext: {
      provenance: "parent_review",
      note: "I pointed to each object and gave a hint.",
      assistance: ["parent_reported_assistance", "hint"],
      pointingOrTouchCounting: true,
    },
  };
  await f.decide(decision);
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("unchanged summary");
  await expect(f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "verified" })).rejects.toThrow(
    "unchanged",
  );
  await f.t.mutation(internal.parent_review.complete, {
    ...f.scope,
    repairLevel: "light_correction",
    note: "Added help.",
  });
  expect((await f.gate()).evidence[0]).toMatchObject({
    observation: correction,
    parentContext: decision.parentContext,
    interpretationProvenance: "parent_review",
  });
  expect(await f.t.run(ctx => ctx.db.get(f.rows[0]._id))).toEqual(f.rows[0]);
});

it("requires explicit parent attribution when resolving uncertainty or removing recorded support", async () => {
  for (const name of ["ambiguous-speaker", "hint-and-counting-together"]) {
    const f = await fixture(name);
    const correction = structuredClone(f.original.observation);
    if (name === "ambiguous-speaker") {
      Object.assign(correction, {
        behavior: "quantity_identification",
        outcome: "correct",
        speakerAttribution: "child_or_nearby_speaker",
        statedTotal: 3,
        uncertaintyReasons: [],
      });
      await expect(f.decide(correct({ ...correction, targetQuantity: 4, statedTotal: 4 }))).rejects.toThrow(
        "canonical cited scene quantity",
      );
      await expectNoReviewWrites(f);
    } else correction.support = { status: "not_established", kinds: [], sourceEventIds: [] };
    const decision = { kind: "parent_decision", proposalId: "p0", decision: "corrected", correction };
    await expect(f.decide(decision)).rejects.toThrow("parent_review explanation");
    await f.decide({
      ...decision,
      parentContext: {
        provenance: "parent_review",
        note: "I listened again: the interpretation of this exchange needs correction.",
      },
    });
    await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "substantial_repair" });
    expect(await f.gate()).toMatchObject({
      blocked: false,
      evidence: [{ observation: correction, sources: f.original.sources, interpretationProvenance: "parent_review" }],
    });
  }
});

it("rejections remain inspectable but excluded; pending proposals block all evidence", async () => {
  const f = await fixture(undefined, 2);
  await f.decide(reject());
  await expect(
    f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "substantial_repair" }),
  ).rejects.toThrow("incomplete");
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  await f.decide(accept("p1"), 1);
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "substantial_repair" });
  expect((await f.gate()).evidence).toHaveLength(1);
  expect((await f.gate()).evidence[0].proposalRowId).toBe(f.rows[1]._id);
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("unchanged summary");
});

it("accept-all completes atomically and retries do not duplicate previously accepted rows", async () => {
  const f = await fixture(undefined, 3);
  await f.decide(accept());
  const id = await f.t.mutation(internal.parent_review.acceptAll, f.scope);
  expect(await f.t.mutation(internal.parent_review.acceptAll, f.scope)).toBe(id);
  expect((await f.gate()).evidence).toHaveLength(3);
  expect(await f.t.run(ctx => ctx.db.query("parentDecisions").take(10))).toHaveLength(3);
});

it("READY empty batches require acknowledgment; failed, pending and running never succeed empty", async () => {
  const f = await fixture("silence-produces-no-observation");
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("explicit acknowledgment");
  for (const status of ["pending", "running", "failed"] as const) {
    await f.t.run(ctx => ctx.db.patch(f.scope.analysisId, { status }));
    expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
    await expect(
      f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "verified", acknowledgeEmpty: true }),
    ).rejects.toThrow("ready analysis");
  }
  await f.t.run(ctx => ctx.db.patch(f.scope.analysisId, { status: "ready" }));
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "verified", acknowledgeEmpty: true });
  expect(await f.gate()).toEqual({ blocked: false, reason: null, evidence: [] });
});

it("rejects stale/cross-session identities, invented support IDs, malformed claims and oversized notes", async () => {
  const f = await fixture();
  const other = await f.t.run(ctx =>
    ctx.db.insert("sessions", { state: "ended", recordStatus: "complete", createdAt: 1, nextEventOrder: 0 }),
  );
  await expect(
    f.t.mutation(internal.parent_review.decide, {
      ...f.scope,
      sessionId: other,
      proposalRowId: f.rows[0]._id,
      decision: accept(),
    }),
  ).rejects.toThrow("session/analysis");
  await expect(f.decide(accept("invented"))).rejects.toThrow("stored proposal");
  const context = { provenance: "parent_review", note: "I helped." };
  await expect(
    f.decide({
      ...accept(),
      decision: "corrected",
      correction: {
        ...f.original.observation,
        support: { status: "recorded", kinds: ["hint"], sourceEventIds: ["invented"] },
      },
      parentContext: context,
    }),
  ).rejects.toThrow("invent support");
  await expect(
    f.decide({
      ...accept(),
      decision: "corrected",
      correction: { ...f.original.observation, outcome: "incorrect" },
      parentContext: context,
    }),
  ).rejects.toThrow("outcome");
  await expect(f.t.mutation(internal.parent_review.acceptAll, { ...f.scope, note: "x".repeat(1001) })).rejects.toThrow(
    "1000 characters",
  );
  await f.t.run(ctx => ctx.db.patch(f.scope.sessionId, { recordStatus: "incomplete" }));
  await expect(f.decide(accept())).rejects.toThrow("Stale analysis");
  await expect(f.gate()).rejects.toThrow("Stale analysis");
});

it("invalid batches and row overflow roll back accept-all without decisions/evidence", async () => {
  const f = await fixture(undefined, 2);
  await f.t.run(ctx => ctx.db.patch(f.rows[1]._id, { proposal: { ...f.original, sessionId: "wrong-session" } }));
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("stored proposal provenance");
  expect(await f.t.run(ctx => ctx.db.query("parentDecisions").take(10))).toEqual([]);
  expect(await f.t.run(ctx => ctx.db.query("reviewedEvidence").take(10))).toEqual([]);
  await f.t.run(async ctx => {
    await ctx.db.patch(f.rows[1]._id, { proposal: f.original });
    for (let ordinal = 2; ordinal <= 1000; ordinal++)
      await ctx.db.insert("observerProposals", { ...f.scope, ordinal, proposal: f.original });
  });
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("1000-row");
  expect(await f.t.run(ctx => ctx.db.query("sessionReviews").take(10))).toEqual([]);
});

it("multi-session planning blocks earlier accepted evidence when a retry remains incomplete", async () => {
  const f = await fixture();
  await f.t.mutation(internal.parent_review.acceptAll, f.scope);
  const retry = await f.t.run(ctx =>
    ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "pending",
      createdAt: 2,
      nextEventOrder: 0,
      retryOf: f.scope.sessionId,
    }),
  );
  expect(await f.t.query(internal.parent_review.forPlanning, { sessionIds: [f.scope.sessionId, retry] })).toMatchObject(
    { blocked: true, evidence: [] },
  );
});

it("all review RPC registrations remain internal", async () => {
  const reviewModule = await import("../convex/parent_review");
  for (const fn of [
    reviewModule.decide,
    reviewModule.complete,
    reviewModule.acceptAll,
    reviewModule.get,
    reviewModule.forPlanning,
  ]) {
    expect(fn).toHaveProperty("isInternal", true);
    expect(fn).not.toHaveProperty("isPublic");
  }
});

it("parent assistance cannot masquerade as recorded support and malformed context cannot approve", async () => {
  const f = await fixture("hint-and-counting-together");
  const correction = structuredClone(f.original.observation);
  correction.support.kinds.push("parent_reported_assistance");
  const input = {
    kind: "parent_decision",
    proposalId: "p0",
    decision: "corrected",
    correction,
    parentContext: { provenance: "parent_review", note: "I helped too.", assistance: ["parent_reported_assistance"] },
  };
  await expect(f.decide(input)).rejects.toThrow("Added assistance belongs");
  await expect(
    f.decide({
      ...input,
      correction: f.original.observation,
      parentContext: { ...input.parentContext, provenance: "observer" },
    }),
  ).rejects.toThrow("parent_review provenance");
  await expect(f.decide({ ...accept(), parentContext: input.parentContext })).rejects.toThrow("corrected decision");
  await expect(f.decide({ ...reject(), rejectionReason: " " })).rejects.toThrow("needs a reason");
  expect(await f.t.run(ctx => ctx.db.query("parentDecisions").take(10))).toEqual([]);
});

it("a correction cannot be overwritten by accept-all even when other proposals are pending", async () => {
  const f = await fixture(undefined, 2);
  const eventsBefore = await f.t.run(ctx =>
    ctx.db
      .query("sessionEvents")
      .withIndex("by_session_order", q => q.eq("sessionId", f.scope.sessionId))
      .take(1001),
  );
  await f.decide({
    kind: "parent_decision",
    proposalId: "p0",
    decision: "corrected",
    correction: f.original.observation,
    parentContext: { provenance: "parent_review", note: "I also pointed.", pointingOrTouchCounting: true },
  });
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("unchanged summary");
  expect(await f.t.run(ctx => ctx.db.query("parentDecisions").take(10))).toHaveLength(1);
  expect(await f.t.run(ctx => ctx.db.query("reviewedEvidence").take(10))).toHaveLength(1);
  expect(await f.t.run(ctx => ctx.db.query("sessionReviews").take(10))).toEqual([]);
  expect(
    await f.t.run(ctx =>
      ctx.db
        .query("sessionEvents")
        .withIndex("by_session_order", q => q.eq("sessionId", f.scope.sessionId))
        .take(1001),
    ),
  ).toEqual(eventsBefore);
  expect(await f.t.query(internal.parent_review.get, f.scope)).toMatchObject({ state: "incomplete", review: null });
});

it("a fully rejected batch completes with no evidence and records substantial repair", async () => {
  const f = await fixture();
  await f.decide(reject());
  await f.t.mutation(internal.parent_review.complete, {
    ...f.scope,
    repairLevel: "substantial_repair",
    note: "Unsupported attribution.",
  });
  expect(await f.gate()).toEqual({ blocked: false, reason: null, evidence: [] });
  expect(await f.t.query(internal.parent_review.get, f.scope)).toMatchObject({
    state: "complete",
    review: { repairLevel: "substantial_repair", note: "Unsupported attribution." },
  });
  await expect(
    f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" }),
  ).rejects.toThrow("Conflicting review completion");
});

it("rolls back earlier inserts if a later accept-all decision fails validation", async () => {
  const f = await fixture(undefined, 2);
  await f.t.run(ctx => ctx.db.patch(f.rows[1]._id, { proposal: { ...f.original, proposalId: "x".repeat(201) } }));
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("Invalid unchanged decision");
  expect(await f.t.run(ctx => ctx.db.query("parentDecisions").take(10))).toEqual([]);
  expect(await f.t.run(ctx => ctx.db.query("reviewedEvidence").take(10))).toEqual([]);
  expect(await f.t.run(ctx => ctx.db.query("sessionReviews").take(10))).toEqual([]);
});
