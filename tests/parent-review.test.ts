import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { observationFixtures, type SyntheticObservationFixture } from "./fixtures/observation-contracts";
import { validateObserverProposal, type ObserverProposal } from "../lib/observation-contracts";
import { sourceTimelineBound } from "../lib/evidence-timing";
import { reviewedObserverClaim } from "../lib/reviewed-observation";
import type { TimelineEvent } from "../lib/session-recorder";

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
        ...(event.timeline ? { timeline: event.timeline as TimelineEvent } : {}),
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

// Exercise the production bound constructor, not a guessed provider/session offset.
function prepareTiming(
  source: SyntheticObservationFixture,
  provenance: "mapped_provider" | "source_input_bound" | "source_timeline_bound",
  tied = false,
  laterScene = false,
) {
  const scene = source.record.events.find(event => event.evidence?.type === "scene_displayed")!;
  const response = source.record.events.find(event => event.evidence?.type === "utterance")!;
  if (scene.evidence?.type !== "scene_displayed" || response.evidence?.type !== "utterance")
    throw new Error("fixture evidence");
  const speech = response.evidence;
  speech.providerTiming = { clock: "provider", sourceId: 1, startMs: 50600, endMs: 50800 };
  speech.firstObservedAtMs = speech.lastObservedAtMs = 2000;
  speech.responseScene = {
    provenance: "application_transcript_context",
    sceneId: scene.evidence.sceneId,
    displayedAtMs: scene.atMs,
    status: "stable",
  };
  const startMs = tied ? scene.atMs : 1700;
  const inputScene = { sceneId: scene.evidence.sceneId, displayedAtMs: scene.atMs };
  if (provenance === "mapped_provider") {
    speech.sessionTiming = { clock: "session", provenance, startMs, endMs: 2000 };
  } else if (provenance === "source_input_bound") {
    speech.sessionTiming = { clock: "session", provenance, sourceId: 1, startMs, endMs: 2000, inputScene };
  } else {
    // For a later scene the original input fence deliberately names another display.
    const initialScene = laterScene ? { sceneId: "initial-scene", displayedAtMs: 100 } : inputScene;
    if (laterScene)
      source.record.events.unshift({
        ...scene,
        _id: "initial-scene-event",
        atMs: 100,
        evidence: { ...scene.evidence, sceneId: initialScene.sceneId },
      });
    speech.sessionTiming = sourceTimelineBound(
      speech.providerTiming,
      startMs - 50600,
      laterScene ? 100 : scene.atMs,
      initialScene,
      2000,
    );
    if (!speech.sessionTiming) throw new Error("production bound");
  }
}

it.each([
  ["mapped_provider", false, false],
  ["source_input_bound", false, false],
  ["source_input_bound", true, false],
  ["source_timeline_bound", false, false],
  ["source_timeline_bound", true, false],
  ["source_timeline_bound", false, true],
] as const)("publishes then corrects %s timing (tied=%s, later scene=%s)", async (provenance, tied, laterScene) => {
  const f = await fixture(undefined, 1, source => prepareTiming(source, provenance, tied, laterScene));
  const correction = { ...f.original.observation, statedTotal: 2, outcome: "incorrect" as const };
  const id = await f.decide(correct(correction));
  expect(await f.decide(correct(correction))).toBe(id);
  await expect(f.decide(correct({ ...correction, statedTotal: 1 }))).rejects.toThrow("immutable");
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  expect(await f.gate()).toMatchObject({
    blocked: false,
    evidence: [{ observation: correction, sources: f.original.sources, interpretationProvenance: "parent_review" }],
  });
  expect(await f.t.run(ctx => ctx.db.get(f.rows[0]._id))).toEqual(f.rows[0]);
});

it.each(["mapped_provider", "source_input_bound", "source_timeline_bound"] as const)(
  "keeps scene ambiguity fail-closed for %s parent corrections",
  async provenance => {
    for (const defect of [
      "competing_display",
      "start_transition",
      "end_transition",
      "mid_transition",
      "wrong_identity",
      "wrong_display_time",
      "missing_timing",
      "changed_context",
      "mixed_response",
      "missing_response_source",
      "wrong_evaluated_scene",
      "invalid_provider_interval",
      "invalid_arrival_interval",
    ] as const) {
      // Historical mapped-provider timing is independent of provider offsets.
      if (
        provenance === "mapped_provider" &&
        (defect === "invalid_provider_interval" || defect === "invalid_arrival_interval")
      )
        continue;
      const f = await fixture("ambiguous-speaker", 1, source => {
        prepareTiming(source, provenance, provenance !== "mapped_provider");
        const scene = source.record.events.find(event => event.evidence?.type === "scene_displayed")!;
        const response = source.record.events.find(event => event.evidence?.type === "utterance")!;
        if (response.evidence?.type !== "utterance") throw new Error("response");
        const speech = response.evidence;
        if (defect === "competing_display") source.record.events.push({ ...scene, _id: "competing-display" });
        if (defect === "start_transition" || defect === "end_transition" || defect === "mid_transition")
          source.record.events.push({
            ...scene,
            _id: "real-transition",
            atMs:
              defect === "start_transition"
                ? speech.sessionTiming!.startMs
                : defect === "end_transition"
                  ? speech.sessionTiming!.endMs
                  : 1800,
          });
        if (defect === "wrong_identity" || defect === "wrong_display_time") {
          if (speech.sessionTiming?.provenance !== "mapped_provider") {
            if (defect === "wrong_identity") speech.sessionTiming!.inputScene.sceneId = "wrong-scene";
            else speech.sessionTiming!.inputScene.displayedAtMs -= 1;
          } else {
            if (defect === "wrong_identity") speech.responseScene!.sceneId = "wrong-scene";
            else speech.responseScene!.displayedAtMs -= 1;
          }
        }
        if (defect === "missing_timing") delete speech.sessionTiming;
        if (defect === "changed_context") speech.responseScene!.status = "changed";
        if (defect === "invalid_provider_interval") speech.providerTiming!.endMs = speech.providerTiming!.startMs - 1;
        if (defect === "invalid_arrival_interval") speech.lastObservedAtMs = Number.NaN;
        if (defect === "mixed_response" || defect === "missing_response_source" || defect === "wrong_evaluated_scene") {
          speech.transcriptFragments = [{ key: "answer-fragment", textStart: 0, textEnd: speech.text.length }];
          source.record.events.push({
            _id: "latest-evaluation",
            atMs: 2100,
            timeline: {
              type: "evaluation_control",
              action: "evaluation_result",
              correlationKey: "latest",
              transcriptRevision: 2,
              sourceId: 1,
              responseIdentity: {
                provenance: "application_evaluation",
                fragmentKeys: ["answer-fragment", "correction-fragment"],
                sourceStatus:
                  defect === "mixed_response" ? "mixed" : defect === "missing_response_source" ? "missing" : "known",
                evaluatedScene: {
                  sceneId: defect === "wrong_evaluated_scene" ? "other-scene" : speech.responseScene!.sceneId,
                  displayedAtMs: scene.atMs,
                },
              },
            },
          });
        }
        source.proposal!.observation.uncertaintyReasons.push("conflicting_context");
        // Observer and parent correction must see the same complete canonical
        // history, including uncited displays and later response revisions.
        const concreteProposal = structuredClone(source.proposal!);
        concreteProposal.observation = {
          ...concreteProposal.observation,
          behavior: "quantity_identification",
          outcome: "correct",
          speakerAttribution: "child_or_nearby_speaker",
          statedTotal: 3,
          uncertaintyReasons: [],
        };
        speech.speaker = "child_or_nearby_speaker";
        expect(validateObserverProposal(concreteProposal, source.record).ok, defect).toBe(false);
        speech.speaker = "unknown";
      });
      const concrete = {
        ...f.original.observation,
        behavior: "quantity_identification" as const,
        outcome: "correct" as const,
        speakerAttribution: "child_or_nearby_speaker" as const,
        statedTotal: 3,
        uncertaintyReasons: [],
      };
      await expect(f.decide(correct(concrete))).rejects.toThrow(/canonical scene|scene attribution/);
      await expect(
        f.decide(correct({ ...f.original.observation, uncertaintyReasons: ["ambiguous_speaker"] })),
      ).rejects.toThrow(/scene timing uncertainty|scene attribution/);
      await expectNoReviewWrites(f);
      await f.decide(correct(f.original.observation));
      await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "substantial_repair" });
      expect(await f.gate()).toMatchObject({
        blocked: false,
        evidence: [
          {
            observation: {
              behavior: "uncertain_exchange",
              outcome: "uncertain",
              uncertaintyReasons: ["ambiguous_speaker", "conflicting_context"],
            },
          },
        ],
      });
    }
  },
);

it("does not extend the input-fence tie exception to a later provider-timeline bound", async () => {
  const f = await fixture("ambiguous-speaker", 1, source => {
    prepareTiming(source, "source_timeline_bound", true, true);
    source.proposal!.observation.uncertaintyReasons.push("missing_scene_context");
  });
  await expect(
    f.decide(
      correct({
        ...f.original.observation,
        behavior: "quantity_identification",
        outcome: "correct",
        speakerAttribution: "child_or_nearby_speaker",
        statedTotal: 3,
        uncertaintyReasons: [],
      }),
    ),
  ).rejects.toThrow("uniquely displayed canonical scene");
  await expectNoReviewWrites(f);
});

it("allows explicit parent speech and assistance testimony while keeping production scene provenance", async () => {
  const f = await fixture("ambiguous-speaker", 1, source => {
    prepareTiming(source, "source_timeline_bound", true);
    const speech = source.record.events.find(event => event.evidence?.type === "utterance")!.evidence;
    if (speech?.type !== "utterance") throw new Error("speech");
    speech.recognition = "needs_confirmation";
    source.proposal!.observation.uncertaintyReasons.push("unclear_speech");
  });
  const correction = {
    ...f.original.observation,
    behavior: "quantity_identification" as const,
    outcome: "incorrect" as const,
    speakerAttribution: "child_or_nearby_speaker" as const,
    statedTotal: 2,
    uncertaintyReasons: [],
  };
  await f.decide({
    ...correct(correction),
    parentContext: {
      provenance: "parent_review",
      note: "I listened: the child said two, and I had helped.",
      assistance: ["parent_reported_assistance"],
    },
  });
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "substantial_repair" });
  expect(await f.gate()).toMatchObject({
    blocked: false,
    evidence: [
      {
        observation: correction,
        interpretationProvenance: "parent_review",
        parentContext: { assistance: ["parent_reported_assistance"] },
      },
    ],
  });
});

it("keeps later recognition uncertainty through fragment joins but allows explicit parent speech testimony", async () => {
  const f = await fixture("ambiguous-speaker", 1, source => {
    prepareTiming(source, "source_timeline_bound", true);
    const speech = source.record.events.find(event => event.evidence?.type === "utterance")!.evidence;
    if (speech?.type !== "utterance") throw new Error("speech");
    speech.recognition = "no_ambiguity_detected";
    speech.transcriptFragments = [{ key: "answer", textStart: 0, textEnd: speech.text.length }];
    source.record.events.push({
      _id: "revised-evaluation",
      atMs: 2100,
      timeline: {
        type: "evaluation_control",
        action: "evaluation_result",
        correlationKey: "revised",
        transcriptRevision: 2,
        sourceId: 1,
        responseIdentity: {
          provenance: "application_evaluation",
          sourceStatus: "known",
          fragmentKeys: ["answer", "correction"],
          evaluatedScene: {
            sceneId: speech.responseScene!.sceneId,
            displayedAtMs: speech.responseScene!.displayedAtMs,
          },
          recognitionContext: {
            provenance: "application_text_policy",
            recovery: "clarification",
            recognition: "needs_confirmation",
          },
        },
      },
    });
    source.proposal!.observation.uncertaintyReasons.push("unclear_speech");
    const concrete = structuredClone(source.proposal!);
    concrete.observation = {
      ...concrete.observation,
      behavior: "quantity_identification",
      outcome: "correct",
      speakerAttribution: "child_or_nearby_speaker",
      statedTotal: 3,
      uncertaintyReasons: [],
    };
    speech.speaker = "child_or_nearby_speaker";
    const validated = validateObserverProposal(concrete, source.record);
    expect(validated.ok).toBe(false);
    if (!validated.ok)
      expect(validated.issues.some(issue => issue.message.includes("unconfirmed recognition"))).toBe(true);
    speech.speaker = "unknown";
  });
  const correction = {
    ...f.original.observation,
    behavior: "quantity_identification" as const,
    outcome: "correct" as const,
    speakerAttribution: "child_or_nearby_speaker" as const,
    statedTotal: 3,
    uncertaintyReasons: [],
  };
  await f.decide(correct(correction));
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "substantial_repair" });
  expect(await f.gate()).toMatchObject({
    blocked: false,
    evidence: [{ observation: correction, interpretationProvenance: "parent_review" }],
  });
});

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
      if (response.evidence?.type === "utterance") {
        delete response.evidence.startMs;
        delete response.evidence.sessionTiming;
      }
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
    observation: reviewedObserverClaim(f.original.observation),
    interpretationProvenance: "observer",
  });
  expect(gate.evidence[0].reviewedAt).toBeGreaterThan(11);
  expect(await f.t.run(ctx => ctx.db.get(f.rows[0]._id))).toEqual(f.rows[0]);
  await expect(f.decide(reject())).rejects.toThrow("Conflicting repeated");
  await expect(f.decide({ ...accept(), reviewedAt: 0 })).rejects.toThrow("backend-owned");
});

it("keeps legacy accepted narrative out of planner output without rewriting saved history", async () => {
  const f = await fixture();
  await f.t.mutation(internal.parent_review.acceptAll, f.scope);
  const legacy = "The child mastered counting and independently touch-counted every object.";
  const storedId = await f.t.run(async ctx => {
    const row = (await ctx.db.query("reviewedEvidence").take(10))[0];
    await ctx.db.patch(row._id, { observation: { ...row.observation, description: legacy } });
    return row._id;
  });
  expect(await f.gate()).toMatchObject({
    blocked: false,
    evidence: [
      {
        observation: reviewedObserverClaim(f.original.observation),
      },
    ],
  });
  expect((await f.t.run(ctx => ctx.db.get(storedId)))?.observation.description).toBe(legacy);
  expect(await f.t.run(ctx => ctx.db.get(f.rows[0]._id))).toEqual(f.rows[0]);
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

it("reads legacy proposals conservatively and blocks planning/approval without rewriting historical rows", async () => {
  const f = await fixture();
  await f.decide(accept());
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "verified" });
  // Simulate an already-reviewed historical snapshot produced before clock labels.
  await removeLegacyTiming(f);
  const history = () =>
    f.t.run(async ctx => ({
      events: await ctx.db
        .query("sessionEvents")
        .withIndex("by_session_order", q => q.eq("sessionId", f.scope.sessionId))
        .take(100),
      proposals: await ctx.db
        .query("observerProposals")
        .withIndex("by_analysis_ordinal", q => q.eq("analysisId", f.scope.analysisId))
        .take(100),
      decisions: await ctx.db
        .query("parentDecisions")
        .withIndex("by_analysis", q => q.eq("analysisId", f.scope.analysisId))
        .take(100),
      reviewed: await ctx.db
        .query("reviewedEvidence")
        .withIndex("by_analysis", q => q.eq("analysisId", f.scope.analysisId))
        .take(100),
    }));
  const before = await history();
  const view = JSON.parse(await f.t.query(internal.parent_review.inspect, { sessionId: f.scope.sessionId }));
  expect(view).toMatchObject({ status: "ready", qualification: expect.stringContaining("unverified speech timing") });
  expect(view.proposals).toHaveLength(1);
  expect(view.proposals[0].resolution).toBe("reject_only");
  expect(await f.gate()).toEqual({ blocked: true, reason: "Speech timing is unverified", evidence: [] });
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("speech timing is unverified");
  expect(await history()).toEqual(before);
});

it("validates parent correction scene against mapped time despite divergent provider offsets", async () => {
  const f = await fixture("correct-total-without-spoken-count", 1, source => {
    const response = source.record.events.find(event => event.evidence?.type === "utterance")!;
    if (response.evidence?.type !== "utterance") throw new Error("fixture");
    response.evidence.startMs = 50600;
    response.evidence.endMs = 50800;
    source.record.events.push({
      _id: "later-scene",
      atMs: 43640,
      evidence: {
        type: "scene_displayed",
        sceneId: "later",
        targetQuantity: 4,
        items: [{ emoji: "🦆", label: "duck" }],
        arrangement: "row",
      },
    });
  });
  await f.decide(correct({ ...f.original.observation, statedTotal: 2, outcome: "incorrect" }));
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  expect(await f.gate()).toMatchObject({
    blocked: false,
    evidence: [expect.objectContaining({ interpretationProvenance: "parent_review" })],
  });
});

async function removeLegacyTiming(f: Awaited<ReturnType<typeof fixture>>, onlyEventId?: string) {
  await f.t.run(async ctx => {
    const events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_order", q => q.eq("sessionId", f.scope.sessionId))
      .take(100);
    for (const event of events) {
      if (event.evidence?.type === "utterance" && (!onlyEventId || event._id === onlyEventId)) {
        const evidence = { ...event.evidence };
        delete evidence.sessionTiming;
        await ctx.db.patch(event._id, { evidence });
      }
    }
    const analysis = await ctx.db.get(f.scope.analysisId);
    const snapshot = JSON.parse(analysis!.inputSnapshot!);
    for (const event of snapshot.events)
      if (event.evidence?.type === "utterance" && (!onlyEventId || event._id === onlyEventId))
        delete event.evidence.sessionTiming;
    await ctx.db.patch(f.scope.analysisId, { inputSnapshot: JSON.stringify(snapshot) });
  });
}

it("lets a parent reject legacy timing failures and complete review without evidence or historical rewrites", async () => {
  const f = await fixture();
  await removeLegacyTiming(f);
  const before = await f.t.query(internal.parent_review.get, f.scope);
  await expect(
    f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" }),
  ).rejects.toThrow("incomplete");
  expect(await f.gate()).toMatchObject({ blocked: true, reason: "Parent review is incomplete", evidence: [] });
  await expect(f.decide(accept())).rejects.toThrow("speech timing is unverified");
  await expect(f.decide(correct(f.original.observation))).rejects.toThrow("speech timing is unverified");
  const decisionId = await f.decide(reject());
  expect(await f.decide(reject())).toBe(decisionId);
  await expect(f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "verified" })).rejects.toThrow(
    "unchanged acceptances",
  );
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  expect(await f.gate()).toEqual({ blocked: false, reason: null, evidence: [] });
  expect((await f.t.query(internal.parent_review.get, f.scope)).proposals).toEqual(before.proposals);
  expect(await f.t.run(ctx => ctx.db.query("reviewedEvidence").take(10))).toEqual([]);
  await expect(f.decide(accept())).rejects.toThrow("speech timing is unverified");
});

it("keeps completed rejected legacy proposals out of planning without changing their decisions", async () => {
  const f = await fixture();
  await f.decide(reject());
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  await removeLegacyTiming(f);
  const before = await f.t.query(internal.parent_review.get, f.scope);
  expect(await f.gate()).toEqual({ blocked: false, reason: null, evidence: [] });
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  expect(await f.t.query(internal.parent_review.get, f.scope)).toEqual(before);
});

it("plans from valid accepted evidence alongside rejected timing-invalid evidence", async () => {
  const valid = await fixture();
  // Use the same database for two prerequisite sessions.
  await valid.decide(accept());
  await valid.t.mutation(internal.parent_review.complete, { ...valid.scope, repairLevel: "verified" });
  const second = await valid.t.run(async ctx => {
    const source = structuredClone(observationFixtures[0]);
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "complete",
      createdAt: 1,
      nextEventOrder: source.record.events.length,
    });
    const ids = new Map<string, string>();
    for (const [order, event] of source.record.events.entries()) {
      if (event.evidence?.type === "utterance") delete event.evidence.sessionTiming;
      ids.set(
        event._id,
        await ctx.db.insert("sessionEvents", {
          sessionId,
          order,
          eventKey: `${order}`,
          atMs: event.atMs,
          evidence: event.evidence,
        }),
      );
    }
    const events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_order", q => q.eq("sessionId", sessionId))
      .take(100);
    const inputSnapshot = JSON.stringify({
      sessionId,
      state: "ended",
      recordStatus: "complete",
      recording: null,
      events: events.map(event => ({
        _id: event._id,
        order: event.order,
        atMs: event.atMs,
        evidence: event.evidence ?? null,
        timeline: event.timeline ?? null,
      })),
    });
    const analysisId = await ctx.db.insert("observerAnalyses", {
      sessionId,
      status: "ready",
      attempt: 1,
      inputSnapshot,
    });
    const proposal = source.proposal!;
    proposal.sessionId = sessionId;
    proposal.proposalId = "legacy";
    proposal.sources = proposal.sources.map(item =>
      "eventId" in item ? { ...item, eventId: ids.get(item.eventId)! } : item,
    );
    const proposalRowId = await ctx.db.insert("observerProposals", { sessionId, analysisId, ordinal: 0, proposal });
    return { sessionId, analysisId, proposalRowId };
  });
  await valid.t.mutation(internal.parent_review.decide, { ...second, decision: reject("legacy") });
  await valid.t.mutation(internal.parent_review.complete, {
    sessionId: second.sessionId,
    analysisId: second.analysisId,
    repairLevel: "light_correction",
  });
  const result = await valid.t.query(internal.parent_review.forPlanning, {
    sessionIds: [valid.scope.sessionId, second.sessionId],
  });
  expect(result).toMatchObject({ blocked: false, reason: null, evidence: [{ proposalRowId: valid.rows[0]._id }] });
  expect(result.evidence).toHaveLength(1);
});

it("cannot bypass unrelated proposal corruption or stale snapshots through legacy rejection", async () => {
  const f = await fixture();
  await removeLegacyTiming(f);
  await f.t.run(ctx => ctx.db.patch(f.rows[0]._id, { proposal: { ...f.original, exchangeAtMs: 99999 } }));
  await expect(f.decide(reject())).rejects.toThrow("Invalid stored proposal provenance");
  expect(await f.t.run(ctx => ctx.db.query("parentDecisions").take(10))).toEqual([]);
  const stale = await fixture();
  await stale.t.run(async ctx => {
    const event = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_order", q => q.eq("sessionId", stale.scope.sessionId))
      .first();
    await ctx.db.patch(event!._id, { atMs: 99999 });
  });
  await expect(stale.decide(reject())).rejects.toThrow("Stale analysis");
});

it("blocks corrupt stored rejection linkage and missing or altered reviewed evidence", async () => {
  const rejected = await fixture();
  await rejected.decide(reject());
  await rejected.t.mutation(internal.parent_review.complete, { ...rejected.scope, repairLevel: "light_correction" });
  await removeLegacyTiming(rejected);
  await rejected.t.run(async ctx => {
    const row = await ctx.db.query("parentDecisions").first();
    await ctx.db.patch(row!._id, { decision: { ...row!.decision, proposalId: "wrong" } });
  });
  await expect(rejected.gate()).rejects.toThrow("Invalid stored decision provenance");
  const accepted = await fixture();
  await accepted.decide(accept());
  await accepted.t.mutation(internal.parent_review.complete, { ...accepted.scope, repairLevel: "verified" });
  await accepted.t.run(async ctx => {
    const row = await ctx.db.query("reviewedEvidence").first();
    await ctx.db.patch(row!._id, { exchangeAtMs: 99999 });
  });
  await expect(accepted.gate()).rejects.toThrow("Invalid reviewed evidence provenance");
  await accepted.t.run(async ctx => {
    const row = await ctx.db.query("reviewedEvidence").first();
    await ctx.db.delete(row!._id);
  });
  await expect(accepted.gate()).rejects.toThrow("Invalid reviewed evidence completeness");
});

it("resolves mixed valid and rejected legacy proposals within one analysis", async () => {
  const f = await fixture(undefined, 2, source => {
    const response = source.record.events.find(event => event.evidence?.type === "utterance")!;
    source.record.events.push({ ...structuredClone(response), _id: "second-response", atMs: response.atMs + 300 });
  });
  await f.t.run(async ctx => {
    const events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_order", q => q.eq("sessionId", f.scope.sessionId))
      .take(100);
    const response = events.at(-1)!;
    const proposal = structuredClone(f.rows[1].proposal);
    proposal.exchangeAtMs = response.atMs;
    proposal.sources = proposal.sources.map((source: ObserverProposal["sources"][number]) =>
      source.role === "response" ? { ...source, eventId: response._id } : source,
    );
    await ctx.db.patch(f.rows[1]._id, { proposal });
  });
  const response = f.original.sources.find(source => source.role === "response")!;
  if (!("eventId" in response)) throw new Error("fixture");
  await removeLegacyTiming(f, response.eventId);
  await f.decide(accept("p1"), 1);
  await expect(f.t.mutation(internal.parent_review.acceptAll, f.scope)).rejects.toThrow("speech timing is unverified");
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  await f.decide(reject());
  await f.t.mutation(internal.parent_review.complete, { ...f.scope, repairLevel: "light_correction" });
  expect(await f.gate()).toMatchObject({ blocked: false, evidence: [{ proposalRowId: f.rows[1]._id }] });
  expect((await f.gate()).evidence).toHaveLength(1);
});
