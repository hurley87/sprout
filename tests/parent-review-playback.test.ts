import { expect, it } from "vitest";
import { reviewPlaybackAtMs, type ReviewSnapshot } from "../lib/parent-review";
import { recordingOffsetSeconds } from "../lib/session-recorder";
import { observationFixtures } from "./fixtures/observation-contracts";

function fixture() {
  const f = structuredClone(observationFixtures[0]);
  const proposal = f.proposal!;
  proposal.exchangeAtMs = 20000;
  const sources: ReviewSnapshot["sources"] = f.record.events.map(event => ({
    id: event._id,
    eventKey: event._id,
    atMs: event.evidence?.type === "utterance" ? 20000 : event.atMs,
    evidence: event.evidence!,
  }));
  const response = sources.find(source => source.evidence.type === "utterance")!;
  if (response.evidence.type !== "utterance") throw new Error("Expected synthetic utterance");
  response.evidence.startMs = 12000;
  response.evidence.endMs = 14000;
  return { proposal, sources, response, speech: response.evidence };
}

it("plays the cited canonical speech before delayed flush, preserving proposals and provenance", () => {
  const { proposal, sources } = fixture();
  const before = structuredClone({ proposal, sources });
  const atMs = reviewPlaybackAtMs(proposal, sources);
  expect(atMs).toBe(12000);
  expect(recordingOffsetSeconds(atMs, { startOffsetMs: 2000, durationMs: 30000 })).toBe(10);
  expect({ proposal, sources }).toEqual(before);
});

it.each([
  [undefined, 14000],
  [12000, undefined],
  [-1, 14000],
  [NaN, 14000],
  [Infinity, 14000],
  [12000, NaN],
  [12000, Infinity],
  [12000, 11000],
])("falls back to the exchange event for invalid speech bounds %s–%s", (startMs, endMs) => {
  const { proposal, sources, speech } = fixture();
  speech.startMs = startMs;
  speech.endMs = endMs;
  expect(reviewPlaybackAtMs(proposal, sources)).toBe(20000);
});

it("requires a cited response and never chooses unrelated or generated speech", () => {
  const { proposal, sources, response, speech } = fixture();
  const unrelated = { ...structuredClone(response), id: "unrelated" };
  if (unrelated.evidence.type === "utterance") unrelated.evidence.startMs = 1000;
  expect(reviewPlaybackAtMs(proposal, [unrelated, ...sources])).toBe(12000);
  expect(reviewPlaybackAtMs(proposal, [unrelated])).toBe(20000);
  speech.speaker = "sprout";
  expect(reviewPlaybackAtMs(proposal, [unrelated, ...sources])).toBe(20000);
  // A generated timeline row has no canonical evidence, even with the cited ID.
  const generated = { id: response.id, timeline: { type: "sprout_generated_utterance", startMs: 1000 } };
  expect(reviewPlaybackAtMs(proposal, [generated] as unknown as ReviewSnapshot["sources"])).toBe(20000);
  proposal.sources = proposal.sources.filter(source => source.role !== "response");
  expect(reviewPlaybackAtMs(proposal, [unrelated, ...sources])).toBe(20000);
});

it("retains zero speech start and the existing recording clamps", () => {
  const { proposal, sources, speech } = fixture();
  speech.startMs = 0;
  const recording = { startOffsetMs: 2000, durationMs: 30000 };
  expect(recordingOffsetSeconds(reviewPlaybackAtMs(proposal, sources), recording)).toBe(0);
  speech.startMs = 40000;
  speech.endMs = 42000;
  expect(recordingOffsetSeconds(reviewPlaybackAtMs(proposal, sources), recording)).toBe(30);
});
