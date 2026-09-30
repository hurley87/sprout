import { describe, expect, it } from "vitest";
import { validateObserverProposal, validateParentDecision, type ObserverProposal } from "../lib/observation-contracts";
import { observationFixtures } from "./fixtures/observation-contracts";

describe("evidence-linked observation contracts", () => {
  it.each(observationFixtures.filter(fixture => fixture.proposal))(
    "validates the synthetic $name example against canonical event IDs",
    fixture => {
      expect(fixture.fixtureStatus).toBe("synthetic_example_not_delivered_evidence");
      expect(validateObserverProposal(fixture.proposal, fixture.record).ok).toBe(
        !["wrong-scene-context", "missing-scene-context-concrete-claim-rejected"].includes(fixture.name),
      );
    },
  );

  it("keeps a correct total without a spoken count as quantity identification", () => {
    const fixture = observationFixtures.find(item => item.name === "correct-total-without-spoken-count")!;
    expect(fixture.proposal?.observation).toMatchObject({
      behavior: "quantity_identification",
      outcome: "correct",
      countSequenceObserved: false,
      statedTotal: 3,
    });
  });

  it("never infers incorrect performance from silence or missing scene context", () => {
    const silence = observationFixtures.find(item => item.name === "silence-produces-no-observation")!;
    expect(silence.proposal).toBeUndefined();
    const unsupportedMissingScene = observationFixtures.find(
      item => item.name === "missing-scene-context-concrete-claim-rejected",
    )!;
    expect(validateObserverProposal(unsupportedMissingScene.proposal, unsupportedMissingScene.record)).toMatchObject({
      ok: false,
    });
    const uncertainMissingScene = observationFixtures.find(item => item.name === "missing-scene-context-uncertain")!;
    expect(validateObserverProposal(uncertainMissingScene.proposal, uncertainMissingScene.record).ok).toBe(true);
    expect(uncertainMissingScene.proposal?.observation).toMatchObject({
      behavior: "uncertain_exchange",
      outcome: "uncertain",
      uncertaintyReasons: ["missing_scene_context"],
    });
  });

  it("rejects event IDs from another session, generated timeline rows, and incorrect exchange timestamps", () => {
    const fixture = observationFixtures.find(item => item.name === "correct-total-without-spoken-count")!;
    const proposal = fixture.proposal!;
    const wrongSession = { ...proposal, sessionId: "sessions_elsewhere" };
    expect(validateObserverProposal(wrongSession, fixture.record).ok).toBe(false);
    const wrongEvent = {
      ...proposal,
      sources: proposal.sources.map(source => ({ ...source, eventId: "missing_event" })),
    };
    expect(validateObserverProposal(wrongEvent, fixture.record).ok).toBe(false);
    const wrongTimestamp = { ...proposal, exchangeAtMs: proposal.exchangeAtMs + 1 };
    expect(validateObserverProposal(wrongTimestamp, fixture.record).ok).toBe(false);
  });

  it("rejects learner claims sourced from Sprout speech or contradicted by the displayed total", () => {
    const fixture = observationFixtures.find(item => item.name === "correct-total-without-spoken-count")!;
    const sproutRecord = structuredClone(fixture.record);
    const answer = sproutRecord.events.find(event => event._id === fixture.proposal!.sources[1].eventId)!;
    if (answer.evidence?.type === "utterance") answer.evidence.speaker = "sprout";
    expect(validateObserverProposal(fixture.proposal, sproutRecord).ok).toBe(false);
    const mislabeled = structuredClone(fixture.proposal!) as ObserverProposal;
    mislabeled.observation.outcome = "incorrect";
    expect(validateObserverProposal(mislabeled, fixture.record).ok).toBe(false);
  });

  it("binds concrete claims to the scene displayed throughout the speech interval", () => {
    const fixture = observationFixtures.find(item => item.name === "correct-total-without-spoken-count")!;
    const futureScene = structuredClone(fixture.record);
    const citedScene = futureScene.events.find(event => event.evidence?.type === "scene_displayed")!;
    citedScene.atMs = 5000;
    expect(validateObserverProposal(fixture.proposal, futureScene).ok).toBe(false);

    const replacedScene = structuredClone(fixture.record);
    replacedScene.events.push({
      _id: "sessionEvents_replacement_scene",
      atMs: 1500,
      evidence: {
        type: "scene_displayed",
        sceneId: "ducks-4",
        targetQuantity: 4,
        items: [{ emoji: "🦆", label: "duck" }],
        arrangement: "row",
      },
    });
    expect(validateObserverProposal(fixture.proposal, replacedScene).ok).toBe(false);

    const duringSpeech = structuredClone(fixture.record);
    duringSpeech.events.push({
      _id: "sessionEvents_mid_speech_scene",
      atMs: 1800,
      evidence: {
        type: "scene_displayed",
        sceneId: "ducks-4",
        targetQuantity: 4,
        items: [{ emoji: "🦆", label: "duck" }],
        arrangement: "row",
      },
    });
    expect(validateObserverProposal(fixture.proposal, duringSpeech).ok).toBe(false);
    expect(validateObserverProposal(fixture.proposal, fixture.record).ok).toBe(true);

    const tiedScenes = structuredClone(fixture.record);
    const tiedScene = structuredClone(tiedScenes.events.find(event => event.evidence?.type === "scene_displayed")!);
    tiedScene._id = "sessionEvents_tied_scene";
    tiedScenes.events.push(tiedScene);
    expect(validateObserverProposal(fixture.proposal, tiedScenes).ok).toBe(false);
  });

  it("requires uncertainty when speech timing is missing or scene timing is ambiguous", () => {
    const fixture = observationFixtures.find(item => item.name === "correct-total-without-spoken-count")!;
    const missingTiming = structuredClone(fixture.record);
    const response = missingTiming.events.find(event => event.evidence?.type === "utterance")!;
    if (response.evidence?.type === "utterance") {
      delete response.evidence.startMs;
      delete response.evidence.endMs;
    }
    expect(validateObserverProposal(fixture.proposal, missingTiming).ok).toBe(false);

    const uncertain = structuredClone(fixture.proposal!) as ObserverProposal;
    uncertain.observation = {
      behavior: "uncertain_exchange",
      outcome: "uncertain",
      speakerAttribution: "child_or_nearby_speaker",
      countSequenceObserved: false,
      description: "The scene context changed during speech.",
      support: { status: "not_established", kinds: [], sourceEventIds: [] },
      uncertaintyReasons: ["conflicting_context"],
    };
    uncertain.observation.uncertaintyReasons = ["missing_scene_context"];
    expect(validateObserverProposal(uncertain, missingTiming).ok).toBe(true);
    uncertain.observation.uncertaintyReasons = ["conflicting_context"];
    const changingScene = structuredClone(fixture.record);
    changingScene.events.push({
      _id: "sessionEvents_mid_speech_scene",
      atMs: 1800,
      evidence: {
        type: "scene_displayed",
        sceneId: "ducks-4",
        targetQuantity: 4,
        items: [{ emoji: "🦆", label: "duck" }],
        arrangement: "row",
      },
    });
    expect(validateObserverProposal(uncertain, changingScene).ok).toBe(true);
    uncertain.observation.uncertaintyReasons = ["ambiguous_speaker"];
    expect(validateObserverProposal(uncertain, changingScene).ok).toBe(false);
  });

  it("rejects a count claim without a count sequence and support without provenance", () => {
    const fixture = observationFixtures.find(item => item.name === "counting-aloud-with-total")!;
    const noCount = structuredClone(fixture.proposal!) as ObserverProposal;
    noCount.observation.countSequenceObserved = false;
    expect(validateObserverProposal(noCount, fixture.record).ok).toBe(false);
    const unsupportedHelp = observationFixtures.find(
      item => item.name === "correct-total-without-spoken-count",
    )!.proposal!;
    const falseSupport = structuredClone(unsupportedHelp) as ObserverProposal;
    falseSupport.observation.support = { status: "recorded", kinds: ["hint"], sourceEventIds: [] };
    expect(validateObserverProposal(falseSupport, observationFixtures[0].record).ok).toBe(false);
  });

  it("keeps parent correction and added assistance in a separately sourced decision", () => {
    const base = {
      kind: "parent_decision",
      proposalId: "proposal-original",
      decision: "corrected",
      reviewedAt: 9000,
      correction: observationFixtures[0].proposal!.observation,
    };
    expect(
      validateParentDecision({
        ...base,
        parentContext: {
          provenance: "parent_review",
          note: "I pointed to each duck as the child counted.",
          assistance: ["parent_reported_assistance"],
          pointingOrTouchCounting: true,
        },
      }).ok,
    ).toBe(true);
    expect(
      validateParentDecision({
        ...base,
        parentContext: { provenance: "observer", note: "Pointing was seen.", pointingOrTouchCounting: true },
      }).ok,
    ).toBe(false);
    expect(validateParentDecision({ ...base, kind: "observer_proposal" }).ok).toBe(false);
  });

  it("requires a concrete rejection reason and no correction on acceptance", () => {
    expect(
      validateParentDecision({ kind: "parent_decision", proposalId: "p1", decision: "rejected", reviewedAt: 1 }).ok,
    ).toBe(false);
    expect(
      validateParentDecision({
        kind: "parent_decision",
        proposalId: "p1",
        decision: "accepted",
        reviewedAt: 1,
        correction: observationFixtures[0].proposal!.observation,
      }).ok,
    ).toBe(false);
  });
});
