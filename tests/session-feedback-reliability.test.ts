import { expect, it } from "vitest";
import { validateObserverProposal, type ObserverProposal } from "../lib/observation-contracts";
import { reviewPlaybackAtMs } from "../lib/parent-review";
import { observationFixtures } from "./fixtures/observation-contracts";
import { UtteranceAccumulator } from "../lib/transcript";

function contractFixture() {
  return structuredClone(observationFixtures.find(f => f.name === "correct-total-without-spoken-count")!);
}
function uncertain(proposal: ObserverProposal): ObserverProposal {
  return {
    ...proposal,
    observation: {
      behavior: "uncertain_exchange",
      outcome: "uncertain",
      speakerAttribution: "child_or_nearby_speaker",
      countSequenceObserved: false,
      description: "Timing and recognition remain uncertain.",
      support: { status: "not_established", kinds: [], sourceEventIds: [] },
      uncertaintyReasons: ["missing_scene_context", "unclear_speech"],
    },
  };
}

it("does not use the butterfly provider clock to attribute a response to strawberries", () => {
  const { record, proposal } = contractFixture();
  const scene = record.events.find(e => e.evidence?.type === "scene_displayed")!;
  scene.atMs = 16590;
  const response = record.events.find(e => e.evidence?.type === "utterance")!;
  if (response.evidence?.type !== "utterance" || scene.evidence?.type !== "scene_displayed") throw new Error("fixture");
  Object.assign(response.evidence, {
    startMs: 50600,
    endMs: 50800,
    firstObservedAtMs: 43075,
    lastObservedAtMs: 43075,
    providerTiming: { clock: "provider", startMs: 50600, endMs: 50800, sourceId: 1 },
    responseScene: {
      provenance: "application_transcript_context",
      sceneId: scene.evidence.sceneId,
      displayedAtMs: 16590,
      status: "stable",
    },
  });
  delete response.evidence.sessionTiming;
  response.atMs = 45575;
  proposal!.exchangeAtMs = response.atMs;
  record.events.push({ _id: "strawberries", atMs: 43640, evidence: { ...scene.evidence, sceneId: "picnic" } });
  const before = structuredClone(record);
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
  expect(validateObserverProposal(uncertain(proposal!), record).ok).toBe(true);
  const sources = record.events.map(e => ({ id: e._id, eventKey: e._id, atMs: e.atMs, evidence: e.evidence! }));
  expect(reviewPlaybackAtMs(proposal!, sources)).toBe(43075);
  expect(record).toEqual(before);
  // A separately established mapping may validate the original butterfly scene.
  response.evidence.sessionTiming = { clock: "session", provenance: "mapped_provider", startMs: 42500, endMs: 42900 };
  expect(validateObserverProposal(proposal, record).ok).toBe(true);
  proposal!.sources = proposal!.sources.map(s => (s.role === "scene" ? { eventId: "strawberries", role: "scene" } : s));
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
});

it("requires uncertainty for legacy timing and unconfirmed recognition, without rewriting source data", () => {
  const { record, proposal } = contractFixture();
  const response = record.events.find(e => e.evidence?.type === "utterance")!;
  if (response.evidence?.type !== "utterance") throw new Error("fixture");
  delete response.evidence.sessionTiming;
  const before = structuredClone(record);
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
  expect(validateObserverProposal(uncertain(proposal!), record).ok).toBe(true);
  expect(record).toEqual(before);
  response.evidence.sessionTiming = { clock: "session", provenance: "mapped_provider", startMs: 1600, endMs: 2000 };
  response.evidence.recognition = "needs_confirmation";
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
  expect(validateObserverProposal(uncertain(proposal!), record).ok).toBe(true);
});

it("orders support on mapped session time rather than large provider offsets or arrival time", () => {
  const f = structuredClone(observationFixtures.find(f => f.name === "hint-and-counting-together")!);
  const response = f.record.events.find(e => e.evidence?.type === "utterance")!;
  const support = f.record.events.find(e => e.evidence?.type === "support")!;
  if (response.evidence?.type !== "utterance") throw new Error("fixture");
  response.evidence.startMs = 50600;
  support.atMs = response.evidence.sessionTiming!.startMs + 1;
  expect(validateObserverProposal(f.proposal, f.record).ok).toBe(false);
  support.atMs = response.evidence.sessionTiming!.startMs - 1;
  expect(validateObserverProposal(f.proposal, f.record).ok).toBe(true);
  delete response.evidence.sessionTiming;
  expect(validateObserverProposal(f.proposal, f.record).ok).toBe(false);
});

it("does not turn generated help or delivered neutral clarification into recorded instructional support", () => {
  const { record, proposal } = contractFixture();
  record.events.push(
    {
      _id: "generated-help",
      atMs: 1100,
      timeline: { type: "sprout_generated_utterance", text: "Count with me." },
    },
    {
      _id: "delivered-clarification",
      atMs: 1200,
      evidence: { type: "utterance", speaker: "sprout", text: "Could you say your number again?", state: "finalized" },
    },
  );
  expect(validateObserverProposal(proposal, record).ok).toBe(true);
  for (const id of ["generated-help", "delivered-clarification"]) {
    const withHelp = structuredClone(proposal!);
    withHelp.sources.push({ role: "support", eventId: id });
    withHelp.observation.support = { status: "recorded", kinds: ["hint"], sourceEventIds: [id] };
    expect(validateObserverProposal(withHelp, record).ok).toBe(false);
  }
  const mistaken = structuredClone(proposal!);
  mistaken.observation.statedTotal = 2;
  mistaken.observation.outcome = "incorrect";
  expect(validateObserverProposal(mistaken, record).ok).toBe(false);
});

it("records changed arrival context across fragments and separates provider sources", () => {
  const accumulator = new UtteranceAccumulator();
  const context = (sceneId: string, sourceId = 1) => ({
    providerTiming: { clock: "provider" as const, startMs: 100, endMs: 200, sourceId },
    responseScene: {
      provenance: "application_transcript_context" as const,
      sceneId,
      displayedAtMs: 0,
      status: "stable" as const,
    },
  });
  accumulator.append("One, ", 100, 200, true, 10, context("ducks"));
  accumulator.append("two", 200, 300, true, 20, context("butterflies"));
  const prior = accumulator.append("Three", 0, 100, true, 30, context("butterflies", 2));
  expect(prior?.context?.responseScene).toMatchObject({ sceneId: "ducks", status: "changed" });
  expect(prior?.context?.providerTiming).toMatchObject({ sourceId: 1, startMs: 100, endMs: 300 });
  expect(accumulator.take()).toMatchObject({ text: "Three", context: { providerTiming: { sourceId: 2 } } });
});
