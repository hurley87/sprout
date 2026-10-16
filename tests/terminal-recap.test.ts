import { expect, it } from "vitest";
import type { TranscriptEvent } from "../lib/events";
import { normalizeRecapSpeech } from "../lib/lesson-runtime/evidence-recap";
import { terminalRecapComplete } from "../lib/lesson-runtime/terminal-recap";
import {
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeState,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import replay from "./fixtures/catching-unicorns-terminal-artifact-oct16.json";

const fragment = (delta: string, startMs = 100, endMs = 200): TranscriptEvent => ({
  type: "transcript",
  speaker: "sprout",
  delta,
  startMs,
  endMs,
});
const expected = "You independently explained sharing. Thanks for the discussion.";
it.each([
  ["exact", [fragment(expected)], true],
  ["opening restart", [fragment("You"), fragment(expected, 300, 400)], true],
  ["same-interval retransmission", [fragment("You"), fragment("You"), fragment(expected.slice(3), 200, 300)], true],
  ["missing opening", [fragment(expected.slice(4))], false],
  ["missing closing", [fragment(expected.slice(0, -12))], false],
  ["different", [fragment(expected.replace("sharing", "durability"))], false],
  ["reordered", [fragment("Thanks for the discussion. You independently explained sharing.")], false],
  ["internal repetition", [fragment(expected.replace("sharing", "sharing sharing"))], false],
  ["unbounded opening repetition", [fragment("You"), fragment("You", 200, 300), fragment(expected, 400, 500)], false],
  ["monolithic YouYou", [fragment(`You${expected}`)], false],
] as const)("verifies %s without filling in content", (_name, fragments, complete) => {
  expect(terminalRecapComplete(expected, fragments)).toBe(complete);
});

it.each([false, true])("replays October 16 with artifact correction=%s", corrected => {
  let state = structuredClone(replay.initialState) as LessonRuntimeState;
  const fragments: TranscriptEvent[] = [];
  let completed = 0;
  let completedAt: number | undefined;
  const send = (event: LessonRuntimeEvent) => {
    const result = reduceLessonRuntime(state, event, lesson);
    state = result.state;
    completed += result.effects.filter(effect => effect.type === "lesson.completed").length;
    if (state.pendingRender) {
      expect(state.outputActivity).toBe("quiet");
      expect(event.atMs).toBeGreaterThanOrEqual(234750.5 + 1500);
      completedAt = event.atMs;
      const committed = reduceLessonRuntime(
        state,
        {
          type: "render.confirmed",
          runtimeId: state.runtimeId,
          identity: state.pendingRender.identity,
          atMs: event.atMs,
        },
        lesson,
      );
      state = committed.state;
      completed += committed.effects.filter(effect => effect.type === "lesson.completed").length;
    }
  };
  let tick = Math.ceil(state.nowMs / 50) * 50;
  for (const entry of replay.events) {
    while (tick <= entry.atMs) {
      send({ type: "clock.tick", source: runtimeSource(state), atMs: tick });
      tick += 50;
    }
    if ("fragment" in entry) fragments.push(entry.fragment as TranscriptEvent);
    else {
      const event = entry.event as LessonRuntimeEvent;
      send(
        event.type === "terminal.transcript.checked" && corrected
          ? { ...event, complete: terminalRecapComplete(replay.expected, fragments) }
          : event,
      );
    }
  }
  const raw = fragments.map(fragment => fragment.delta).join("");
  expect(normalizeRecapSpeech(raw)).toBe(normalizeRecapSpeech(`You${replay.expected}`));
  expect(fragments.slice(0, 2).map(fragment => [fragment.delta, fragment.startMs, fragment.endMs])).toEqual([
    ["You", 229200, 229400],
    ["You", 230800, 231000],
  ]);
  expect(normalizeRecapSpeech(raw)).not.toBe(normalizeRecapSpeech(replay.expected));
  expect(terminalRecapComplete(replay.expected, fragments)).toBe(true);
  expect(completed).toBe(corrected ? 1 : 0);
  expect(state.lessonComplete).toBe(corrected);
  expect(completedAt).toBe(corrected ? 238750.89999997616 : undefined);
});
