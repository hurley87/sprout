import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createLiveObserver } from "../scripts/live/observer.mjs";
import { createReactiveChild } from "../scripts/live/reactive-child.mjs";
import { createScenarioAssertions } from "../scripts/live/assertions.mjs";
const syntheticCountingBehavior = {
  correctAnswer: ({ sceneId }: { sceneId: string | null }) => {
    if (sceneId !== "hello-duck" && sceneId !== "duck-friends")
      throw new Error(`scene "${sceneId}": counting behavior does not recognize it`);
    return { text: sceneId === "hello-duck" ? "One!" : "Two!" };
  },
  wrongAnswer: () => ({ text: "Five!" }),
};

function fixture(
  lessonBehavior: Parameters<typeof createReactiveChild>[0]["lessonBehavior"] = syntheticCountingBehavior,
) {
  const entries: Record<string, unknown>[] = [{ dir: "scene", scene: "hello-duck", at: 0 }];
  let now = 10000;
  const observer = createLiveObserver({
    evaluate: async (_fn: unknown, offset: number) => ({ entries: entries.slice(offset), now }),
  });
  const speech = {
    say: vi.fn(async (text: string) => {
      void text;
    }),
  };
  const record = vi.fn(async (entry: unknown) => {
    void entry;
  });
  const sleep = vi.fn(async (ms: number) => {
    void ms;
  });
  const child = createReactiveChild({ observer, speech, record, sleep, lessonBehavior });
  return {
    entries,
    setNow: (value: number) => {
      now = value;
    },
    observer,
    speech,
    record,
    sleep,
    child,
    assertions: createScenarioAssertions(observer),
  };
}

describe("reactive child", () => {
  it("keeps the core independent of counting and delegates to injected behavior", async () => {
    const source = readFileSync(new URL("../scripts/live/reactive-child.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/COUNTING_SCENES|counting-scenes|quantity|\bOne\b|\bFive\b/);
    const correctAnswer = vi.fn(() => ({ text: "custom response", expected: "custom", answer: "custom" }));
    const wrongAnswer = vi.fn(() => ({ text: "other response" }));
    const f = fixture({ correctAnswer, wrongAnswer });
    f.entries.push({ dir: "scene", scene: "custom-scene", at: 1 });
    await f.child.correctAnswer();
    await f.child.wrongAnswer();
    expect(correctAnswer).toHaveBeenCalledWith({ sceneId: "custom-scene" });
    expect(wrongAnswer).toHaveBeenCalledWith({ sceneId: "custom-scene" });
    expect(f.speech.say.mock.calls.map(([text]) => text)).toEqual(["custom response", "other response"]);
  });

  it("allows all generic actions without lesson behavior and rejects lesson-aware actions clearly", async () => {
    const f = fixture(undefined);
    // Explicitly construct without the fixture's default adapter.
    const child = createReactiveChild({ observer: f.observer, speech: f.speech, record: f.record, sleep: f.sleep });
    await child.say("hello");
    await child.dontKnow();
    await child.requestStop();
    await child.requestMore();
    await child.wait(10);
    await child.staySilent(20);
    expect(f.speech.say).toHaveBeenCalledTimes(4);
    expect(f.sleep.mock.calls).toEqual([[10], [20]]);
    await expect(child.correctAnswer()).rejects.toThrow("no lesson behavior supplied");
    await expect(child.wrongAnswer()).rejects.toThrow("no lesson behavior supplied");
  });

  it("carries action evidence and logs start/finish around the real speech abstraction", async () => {
    const f = fixture();
    f.speech.say.mockImplementation(async () => {
      f.entries.push({ dir: "scene", scene: "duck-friends", at: 2 });
    });
    const action = await f.child.say("One!");
    expect(action).toMatchObject({
      type: "say",
      text: "One!",
      scene: "hello-duck",
      checkpointBefore: 1,
      checkpointAfterPlayback: 2,
    });
    expect(action.finishedAt).toBeGreaterThanOrEqual(action.startedAt);
    expect(f.record.mock.calls.map(([e]) => (e as { action: string }).action)).toEqual([
      "child.action.started",
      "child.action.finished",
    ]);
    expect(f.entries).toHaveLength(2); // No transcript injection.
  });

  it("routes explicit behavior speech through say", async () => {
    const f = fixture();
    await f.child.dontKnow();
    await f.child.requestStop();
    await f.child.requestMore();
    expect(f.speech.say.mock.calls.map(([text]) => text)).toEqual([
      "I don't know.",
      "I am all done. I want to stop now.",
      "Can we do more?",
    ]);
  });

  it("silence and wait use intentional timers and never observer waiters", async () => {
    const f = fixture();
    const sync = vi.spyOn(f.observer, "waitForSproutTurnEnd");
    await f.child.staySilent(12000);
    await f.child.wait(100);
    expect(f.sleep.mock.calls).toEqual([[12000], [100]]);
    expect(sync).not.toHaveBeenCalled();
    expect(f.speech.say).not.toHaveBeenCalled();
    await expect(f.child.wait(-1)).rejects.toThrow("nonnegative");
  });

  it("chooses the next queued answer only after previous playback finishes", async () => {
    const f = fixture();
    f.speech.say.mockImplementationOnce(async () => {
      f.entries.push({ dir: "scene", scene: "duck-friends", at: 2 });
    });
    const [first, second] = await Promise.all([f.child.correctAnswer(), f.child.correctAnswer()]);
    expect([first.text, second.text]).toEqual(["One!", "Two!"]);
  });

  it("fails clearly for an unknown scene and records speech failures", async () => {
    const f = fixture();
    f.entries.push({ dir: "scene", scene: "unknown", at: 2 });
    await expect(f.child.correctAnswer()).rejects.toThrow('scene "unknown": counting behavior does not recognize it');
    f.speech.say.mockRejectedValueOnce(new Error("audio failed"));
    await expect(f.child.say("hello")).rejects.toThrow("audio failed");
    expect(f.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "child.action.failed", error: "Error: audio failed" }),
    );
  });
});

describe("scenario assertions", () => {
  it("catches an advance, including an advance away and back", async () => {
    const f = fixture();
    const after = await f.observer.checkpoint();
    await f.assertions.sceneStayed({ after, scene: "hello-duck" });
    f.entries.push({ dir: "scene", scene: "duck-friends", at: 1 });
    await expect(f.assertions.sceneStayed({ after, scene: "hello-duck" })).rejects.toThrow('observed "duck-friends"');
    f.entries.push({ dir: "scene", scene: "hello-duck", at: 2 });
    await expect(f.assertions.sceneStayed({ after, scene: "hello-duck" })).rejects.toThrow("Expected scene to remain");
  });

  it("catches zero and duplicate advances; accepts one within an explicit evidence window", async () => {
    const f = fixture();
    const after = await f.observer.checkpoint();
    const options = { after, from: "hello-duck", to: "duck-friends" };
    await expect(f.assertions.sceneAdvancedExactlyOnce(options)).rejects.toThrow("observed 0 advances");
    f.entries.push({ dir: "scene", scene: "duck-friends", at: 1 });
    await expect(f.assertions.sceneAdvancedExactlyOnce(options)).resolves.toMatchObject({ to: "duck-friends" });
    f.entries.push({ dir: "scene", scene: "butterfly-garden", at: 2 });
    await expect(f.assertions.sceneAdvancedExactlyOnce(options)).rejects.toThrow("observed 2 advances");
    await expect(f.assertions.sceneAdvancedExactlyOnce({ ...options, through: 2 })).resolves.toMatchObject({
      cursor: 2,
    });
    await expect(f.assertions.sceneAdvanced({ ...options, to: "pond" })).rejects.toThrow("Expected scene advance");
  });

  it("waits for a new tutor opportunity after a boundary and verifies session end", async () => {
    const f = fixture();
    const after = await f.observer.checkpoint();
    f.entries.push({ dir: "in", type: "session.output_transcript.delta", at: 1 });
    const oldEnd = await f.observer.waitForSproutTurnEnd({ after });
    f.entries.push({ dir: "in", type: "session.output_transcript.delta", at: 10001 });
    const response = f.assertions.sproutRespondedAfter(oldEnd);
    f.entries.push({ dir: "ui", live: false, at: 14000 });
    f.setNow(14000);
    const fake = {
      waitForSproutTurnStart: vi.fn(async () => ({ cursor: 10 })),
      waitForSproutTurnEnd: vi.fn(async () => ({ cursor: 11 })),
    };
    await response;
    await createScenarioAssertions(fake).sproutRespondedAfter({ cursor: 9 });
    expect(fake.waitForSproutTurnStart).toHaveBeenCalledWith({ after: 9 });
    expect(fake.waitForSproutTurnEnd).toHaveBeenCalledWith({ after: 10 });
    await expect(f.assertions.sessionEnded({ after })).resolves.toMatchObject({ kind: "session-end" });
  });
});
