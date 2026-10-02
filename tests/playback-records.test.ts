import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { LocalPlaybackTimeline, ChoreographyTimeline } from "../lib/choreography";

const playback: LocalPlaybackTimeline = {
  type: "local_playback",
  provenance: "application_finite_audio",
  role: "acknowledgment",
  sourceId: 2,
  identity: {
    sessionAttemptId: "attempt",
    originSourceId: 1,
    owningSourceId: 2,
    evaluatedSceneIndex: 0,
    transcriptRevision: 1,
    answerVersion: "100:One",
    correlationKey: "0|1|100:One|1",
    choreographyEpoch: 1,
    playbackAttemptId: "attempt:playback:2",
    responseIdentity: {
      provenance: "application_evaluation",
      fragmentKeys: ["transcript_1"],
      sourceStatus: "known",
      evaluatedScene: { sceneId: "hello-duck", displayedAtMs: 100 },
    },
  },
  assetId: "ack-v1-hello-duck",
  assetSha256: "a".repeat(64),
  text: "That's right, there's one duck.",
  display: { sceneId: "hello-duck", displayedAtMs: 100, token: "attempt:display:0" },
  state: "completed",
  clock: "browser.performance.now",
  observedAt: 3000,
  sessionClockOrigin: 1000,
  sessionAtMs: 2000,
  mediaTime: 2,
  duration: 2,
  renderFence: 3,
  outputTimestamp: { contextTime: 3.1, performanceTime: 2999 },
};
const phase: ChoreographyTimeline = {
  type: "choreography_phase",
  provenance: "application_controller",
  sessionAttemptId: "attempt",
  choreographyEpoch: 1,
  correlationKey: playback.identity.correlationKey,
  phase: "next_question_pending",
  display: { sceneId: "duck-friends", displayedAtMs: 2100, token: "attempt:display:1" },
  questionToken: "attempt:question:1",
  questionStatus: "pending",
  transitionFragmentKeys: ["transcript_2"],
};
async function fixture() {
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.activate, { sessionId });
  return {
    t,
    sessionId,
    append: (timeline: LocalPlaybackTimeline | ChoreographyTimeline, key = "event", atMs = 2000) =>
      t.mutation(api.sessions.appendEvent, { sessionId, eventKey: key, atMs, timeline }),
  };
}
it("round trips finite playback, explicit session mapping and pending question alongside historical records", async () => {
  const f = await fixture();
  await f.append(playback);
  await f.append(phase, "phase", 2100);
  await f.t.mutation(api.sessions.appendEvent, {
    sessionId: f.sessionId,
    eventKey: "legacy",
    atMs: 0,
    timeline: { type: "playback_gate_changed", state: "blocked", reason: "answer_evaluation" },
  });
  const saved = await f.t.query(api.sessions.getRecord, { sessionId: f.sessionId });
  expect(saved!.events.filter(e => e.timeline?.type === "local_playback").map(e => e.timeline)).toEqual([playback]);
  expect(saved!.events.find(e => e.timeline?.type === "choreography_phase")?.timeline).toEqual(phase);
  expect(saved!.events.find(e => e.eventKey === "legacy")).toBeDefined();
});
it.each([
  "fence_missing",
  "fence_zero",
  "fence_nan",
  "duration_zero",
  "duration_over_bound",
  "duration_infinite",
  "media_mismatch",
  "context_before_fence",
  "context_missing",
  "performance_missing",
  "performance_zero",
  "performance_infinite",
  "scene_fraction",
  "scene_last",
  "scene_missing",
  "display_wrong_attempt",
  "clock_mapping",
])("rejects malformed completed playback: %s", async mode => {
  const f = await fixture();
  const event = structuredClone(playback);
  if (mode === "fence_missing") delete event.renderFence;
  if (mode === "fence_zero") event.renderFence = 0;
  if (mode === "fence_nan") event.renderFence = NaN;
  if (mode === "duration_zero") event.duration = event.mediaTime = 0;
  if (mode === "duration_over_bound") event.duration = event.mediaTime = 11;
  if (mode === "duration_infinite") event.duration = event.mediaTime = Infinity;
  if (mode === "media_mismatch") event.mediaTime = 1;
  if (mode === "context_before_fence") event.outputTimestamp!.contextTime = 2;
  if (mode === "context_missing") delete event.outputTimestamp!.contextTime;
  if (mode === "performance_missing") delete event.outputTimestamp!.performanceTime;
  if (mode === "performance_zero") event.outputTimestamp!.performanceTime = 0;
  if (mode === "performance_infinite") event.outputTimestamp!.performanceTime = Infinity;
  if (mode === "scene_fraction") event.identity.evaluatedSceneIndex = 0.1;
  if (mode === "scene_last") event.identity.evaluatedSceneIndex = 5;
  if (mode === "scene_missing") delete event.identity.responseIdentity.evaluatedScene;
  if (mode === "display_wrong_attempt") event.display.token = "other:display:0";
  if (mode === "clock_mapping") event.sessionAtMs = 1500;
  await expect(f.append(event)).rejects.toThrow();
  expect((await f.t.query(api.sessions.getRecord, { sessionId: f.sessionId }))!.events).toEqual([]);
});
it.each([
  "empty_question",
  "wrong_question_epoch",
  "empty_display",
  "wrong_display_attempt",
  "unknown_scene",
  "fraction_epoch",
  "blank_fragment",
])("rejects malformed choreography identity: %s", async mode => {
  const f = await fixture();
  const event = structuredClone(phase);
  if (mode === "empty_question") event.questionToken = " ";
  if (mode === "wrong_question_epoch") event.questionToken = "attempt:question:2";
  if (mode === "empty_display") event.display.token = " ";
  if (mode === "wrong_display_attempt") event.display.token = "other:display:1";
  if (mode === "unknown_scene") event.display.sceneId = "unshown";
  if (mode === "fraction_epoch") event.choreographyEpoch = 0.5;
  if (mode === "blank_fragment") event.transitionFragmentKeys = [""];
  await expect(f.append(event, "phase", 2100)).rejects.toThrow();
});
it("retains interrupted delivery with absent optional clocks and no completed claim", async () => {
  const f = await fixture();
  const event = structuredClone(playback);
  event.state = "interrupted";
  for (const key of [
    "mediaTime",
    "duration",
    "renderFence",
    "outputTimestamp",
    "sessionClockOrigin",
    "sessionAtMs",
  ] as const)
    delete event[key];
  await f.append(event);
  expect((await f.t.query(api.sessions.getRecord, { sessionId: f.sessionId }))!.events[0].timeline).toEqual(event);
});
