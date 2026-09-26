import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SessionInspector, SessionRecordView } from "../app/session-inspector";
import { recordingOffsetSeconds, type InspectableSessionRecord } from "../lib/session-recorder";

const record: InspectableSessionRecord = {
  id: "attempt-2",
  state: "ended",
  recordStatus: "pending",
  createdAt: 1000,
  endingReason: "parent_stop",
  events: [],
};
function render(value: InspectableSessionRecord) {
  return renderToStaticMarkup(createElement(SessionRecordView, { record: value }));
}
it.each([
  ["pending", "Record still pending", "Durable assembly has not finished"],
  ["complete", "Record complete", "assembled successfully"],
  ["incomplete", "Record incomplete", "Some evidence may be missing"],
] as const)("renders %s integrity distinctly without hiding evidence", (recordStatus, title, qualification) => {
  const html = render({
    ...record,
    recordStatus,
    events: [
      {
        eventKey: "partial",
        order: 0,
        atMs: 40,
        evidence: {
          type: "utterance",
          speaker: "child_or_nearby_speaker",
          text: "partial speech",
          state: "interrupted",
        },
      },
    ],
  });
  expect(html).toContain(title);
  expect(html).toContain(qualification);
  expect(html).toContain("partial speech");
  expect(html).toContain("interrupted");
  expect(html).toContain("child_or_nearby_speaker");
  expect(html).not.toContain("Play from here");
});
it("handles empty evidence, missing audio and timestamps", () => {
  const html = render(record);
  expect(html).toContain("No durable evidence events recorded");
  expect(html).toContain("Full-session audio unavailable");
  expect(html).toContain("Started: Unavailable");
  expect(html).not.toContain("<audio");
});
it("renders every persisted evidence type in canonical timestamp order", () => {
  const html = render({
    ...record,
    retryOf: "attempt-1",
    startedAt: 2000,
    endedAt: 3000,
    recording: { url: "https://audio.invalid/full", mimeType: "audio/webm", startOffsetMs: 0, durationMs: 20000 },
    events: [
      {
        eventKey: "scene",
        order: 0,
        atMs: 300,
        evidence: {
          type: "scene_displayed",
          sceneId: "duck-scene",
          targetQuantity: 2,
          items: [
            { emoji: "🦆", label: "duck" },
            { emoji: "🍎", label: "apple" },
          ],
          arrangement: "wrapping row",
        },
      },
      {
        eventKey: "speech",
        order: 1,
        atMs: 100,
        evidence: {
          type: "utterance",
          speaker: "sprout",
          text: "Count together",
          state: "finalized",
          startMs: 100,
          endMs: 150,
        },
      },
      {
        eventKey: "unknown",
        order: 2,
        atMs: 150,
        evidence: { type: "utterance", speaker: "unknown", text: "Two", state: "interrupted" },
      },
      {
        eventKey: "support",
        order: 3,
        atMs: 160,
        evidence: { type: "support", source: "parent", mode: "spoken", description: "Pointed out the group" },
      },
    ],
  });
  expect(html).toContain("Retry of attempt-1");
  expect(html).toContain("Scene actually displayed: duck-scene");
  expect(html).toContain("Target quantity: 2");
  expect(html.indexOf("duck</li>")).toBeLessThan(html.indexOf("apple</li>"));
  expect(html.indexOf("Count together")).toBeLessThan(html.indexOf("duck-scene"));
  expect(html).toContain("wrapping row");
  expect(html).toContain("Provider utterance: 100–150 ms");
  expect(html).toContain("unknown · interrupted");
  expect(html).toContain("Support · parent · spoken: Pointed out the group");
  expect(html.match(/<audio/g)).toHaveLength(1);
  expect(html.match(/Play from here/g)).toHaveLength(4);
});
it("handles a missing durable reference without fetch or retry", () => {
  const html = renderToStaticMarkup(
    createElement(SessionInspector, {
      reader: {
        getRecord: async () => {
          throw new Error("must not fetch");
        },
      },
      onRetry: () => {},
    }),
  );
  expect(html).toContain("Durable session record unavailable");
  expect(html).not.toContain("Retry this lesson");
  expect(html).not.toContain("Refresh record");
});
it.each([
  [12300, 0, 20000, 12.3],
  [12300, 2000, 20000, 10.3],
  [1000, 2000, 20000, 0],
  [30000, 2000, 20000, 20],
  [1000, 0, 0, 0],
])(
  "converts canonical %i ms with offset %i and duration %i to %f seconds",
  (atMs, startOffsetMs, durationMs, expected) => {
    expect(recordingOffsetSeconds(atMs, { startOffsetMs, durationMs })).toBeCloseTo(expected);
  },
);

it("shows generated conversation as analysis without implying learner delivery and retains seeking", () => {
  const html = render({
    ...record,
    recording: { url: "https://audio.invalid/full", mimeType: "audio/webm", startOffsetMs: 0, durationMs: 20000 },
    events: [
      {
        eventKey: "generated",
        order: 0,
        atMs: 120,
        timeline: {
          type: "sprout_generated_utterance",
          speaker: "sprout",
          text: "Try three",
          startMs: 100,
          endMs: 200,
          firstObservedAtMs: 120,
          lastObservedAtMs: 280,
          state: "interrupted",
        },
      },
      {
        eventKey: "gate",
        order: 1,
        atMs: 100,
        timeline: { type: "playback_gate_changed", state: "blocked", reason: "answer_evaluation" },
      },
    ],
  });
  expect(html).toContain("Generated by Sprout");
  expect(html).toContain("Delivery not established");
  expect(html).toContain("Conversation analysis");
  expect(html).not.toContain("Learner-experience evidence");
  expect(html).toContain("Observed: 120–280 ms");
  expect(html).toContain("Sprout playback blocked");
  expect(html.indexOf("Sprout playback blocked")).toBeLessThan(html.indexOf("Try three"));
  expect(html.match(/Play from here/g)).toHaveLength(2);
});
