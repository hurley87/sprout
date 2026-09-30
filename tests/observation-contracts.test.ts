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

  it.each([
    ["Three, one", 3, 3, "correct"],
    ["One, three", 3, 3, "correct"],
    ["One, two, three", 4, 3, "incorrect"],
  ])("rejects incomplete sequence %s for target %i", (text, target, total, outcome) => {
    const fixture = observationFixtures.find(item => item.name === "counting-aloud-with-total")!;
    const record = structuredClone(fixture.record);
    const scene = record.events.find(event => event.evidence?.type === "scene_displayed")!;
    if (scene.evidence?.type === "scene_displayed") scene.evidence.targetQuantity = target;
    const utterance = record.events.find(event => event.evidence?.type === "utterance")!;
    if (utterance.evidence?.type === "utterance") utterance.evidence.text = text;
    const proposal = structuredClone(fixture.proposal!) as ObserverProposal;
    proposal.observation.targetQuantity = target;
    proposal.observation.statedTotal = total;
    proposal.observation.outcome = outcome as ObserverProposal["observation"]["outcome"];

    expect(validateObserverProposal(proposal, record)).toMatchObject({ ok: false });
  });

  it.each([
    ["One", 1],
    ["One, two, three, four, five", 5],
  ])("accepts a complete sequence for boundary target %i", (text, target) => {
    const fixture = observationFixtures.find(item => item.name === "counting-aloud-with-total")!;
    const record = structuredClone(fixture.record);
    const scene = record.events.find(event => event.evidence?.type === "scene_displayed")!;
    if (scene.evidence?.type === "scene_displayed") scene.evidence.targetQuantity = target;
    const utterance = record.events.find(event => event.evidence?.type === "utterance")!;
    if (utterance.evidence?.type === "utterance") utterance.evidence.text = text;
    const proposal = structuredClone(fixture.proposal!) as ObserverProposal;
    proposal.observation.targetQuantity = target;
    proposal.observation.statedTotal = target;

    expect(validateObserverProposal(proposal, record).ok).toBe(true);
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
      sources: proposal.sources.map(source =>
        source.role === "recording_support" ? source : { ...source, eventId: "missing_event" },
      ),
    };
    expect(validateObserverProposal(wrongEvent, fixture.record).ok).toBe(false);
    const wrongTimestamp = { ...proposal, exchangeAtMs: proposal.exchangeAtMs + 1 };
    expect(validateObserverProposal(wrongTimestamp, fixture.record).ok).toBe(false);
  });

  it("rejects learner claims sourced from Sprout speech or contradicted by the displayed total", () => {
    const fixture = observationFixtures.find(item => item.name === "correct-total-without-spoken-count")!;
    const sproutRecord = structuredClone(fixture.record);
    const responseSource = fixture.proposal!.sources.find(source => source.role === "response");
    if (!responseSource || responseSource.role === "recording_support")
      throw new Error("Missing response fixture source");
    const answer = sproutRecord.events.find(event => event._id === responseSource.eventId)!;
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

  it.each([5000, 5000.25, 1200])(
    "accepts recording-backed support without a structured support row for duration %s ms",
    durationMs => {
      const fixture = observationFixtures.find(item => item.name === "hint-and-counting-together")!;
      expect(fixture.fixtureStatus).toBe("synthetic_example_not_delivered_evidence");
      const record = structuredClone(fixture.record);
      record.events = record.events.filter(event => event.evidence?.type !== "support");
      record.recording = { recordingId: "storage_synthetic_recording", startOffsetMs: 1000, durationMs };
      const proposal = structuredClone(fixture.proposal!) as ObserverProposal;
      proposal.observation.support = {
        status: "recorded",
        kinds: ["hint", "counting_together"],
        sourceEventIds: [],
        recordingSourceIds: ["recording-support-synthetic-1"],
      };
      proposal.sources = proposal.sources.filter(source => source.role !== "support");
      proposal.sources.push({
        sourceId: "recording-support-synthetic-1",
        role: "recording_support",
        provenance: "recording_review",
        sessionId: record.session._id,
        recordingId: "storage_synthetic_recording",
        recordingStartMs: 200,
        recordingEndMs: 1200,
        sessionStartMs: 1200,
        sessionEndMs: 2200,
      });

      expect(validateObserverProposal(proposal, record).ok).toBe(true);
    },
  );

  it("rejects absent or wrong-session recordings and invalid recording/session clock intervals", () => {
    const fixture = observationFixtures.find(item => item.name === "hint-and-counting-together")!;
    const record = structuredClone(fixture.record);
    record.events = record.events.filter(event => event.evidence?.type !== "support");
    record.recording = { recordingId: "storage_synthetic_recording", startOffsetMs: 1000, durationMs: 5000 };
    const proposal = structuredClone(fixture.proposal!) as ObserverProposal;
    proposal.observation.support = {
      status: "recorded",
      kinds: ["hint", "counting_together"],
      sourceEventIds: [],
      recordingSourceIds: ["recording-support-synthetic-1"],
    };
    proposal.sources = proposal.sources.filter(source => source.role !== "support");
    const source = {
      sourceId: "recording-support-synthetic-1",
      role: "recording_support" as const,
      provenance: "recording_review" as const,
      sessionId: record.session._id,
      recordingId: "storage_synthetic_recording",
      recordingStartMs: 200,
      recordingEndMs: 1200,
      sessionStartMs: 1200,
      sessionEndMs: 2200,
    };
    proposal.sources.push(source);

    const noRecording = structuredClone(record);
    delete noRecording.recording;
    expect(validateObserverProposal(proposal, noRecording).ok).toBe(false);
    expect(
      validateObserverProposal(
        {
          ...proposal,
          sources: proposal.sources.map(item =>
            item.role === "recording_support" ? { ...item, sessionId: "sessions_other" } : item,
          ),
        },
        record,
      ).ok,
    ).toBe(false);
    expect(
      validateObserverProposal(
        {
          ...proposal,
          sources: proposal.sources.map(item =>
            item.role === "recording_support" ? { ...item, recordingId: "storage_other" } : item,
          ),
        },
        record,
      ).ok,
    ).toBe(false);
    for (const invalid of [
      { ...source, recordingStartMs: -1 },
      { ...source, recordingStartMs: 1200, recordingEndMs: 1100 },
      { ...source, recordingEndMs: 5001, sessionEndMs: 6001 },
      { ...source, sessionStartMs: 1201 },
    ]) {
      expect(
        validateObserverProposal(
          { ...proposal, sources: [...proposal.sources.filter(item => item.role !== "recording_support"), invalid] },
          record,
        ).ok,
      ).toBe(false);
    }

    const incomplete = structuredClone(record);
    incomplete.session.recordStatus = "incomplete";
    expect(validateObserverProposal(proposal, incomplete).ok).toBe(false);

    // Keep the fractional boundary exact: an interval ending at 1200 ms cannot fit in 1199.75 ms.
    for (const durationMs of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 1199.75]) {
      const invalidDuration = structuredClone(record);
      invalidDuration.recording!.durationMs = durationMs;
      expect(validateObserverProposal(proposal, invalidDuration).ok).toBe(false);
    }
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
