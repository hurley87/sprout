import { describe, expect, it, vi } from "vitest";
import { countingBehavior } from "../scripts/live/lesson-behaviors/counting.mjs";
import { readFileSync } from "node:fs";
import { SCENES } from "../lib/lesson";
import { createLiveObserver } from "../scripts/live/observer.mjs";
import { createReactiveChild } from "../scripts/live/reactive-child.mjs";
import { createScenarioAssertions } from "../scripts/live/assertions.mjs";

function fixture(lessonBehavior: Parameters<typeof createReactiveChild>[0]["lessonBehavior"] = countingBehavior) {
  const entries: Record<string, unknown>[] = [{ dir: "scene", scene: SCENES[0].id, at: 0 }];
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

  it("derives correct and wrong answers from every production scene and observes scene changes", async () => {
    const f = fixture();
    for (const [index, scene] of SCENES.entries()) {
      f.entries.push({ dir: "scene", scene: scene.id, at: index + 1 });
      const correct = await f.child.correctAnswer();
      expect(correct).toMatchObject({
        scene: scene.id,
        sceneIndex: index,
        expected: scene.quantity,
        answer: scene.quantity,
      });
      expect(f.speech.say).toHaveBeenLastCalledWith(correct.text);
      const wrong = await f.child.wrongAnswer();
      expect(wrong.answer).not.toBe(scene.quantity);
      expect(wrong.answer).toBeGreaterThanOrEqual(1);
      expect(wrong.answer).toBeLessThanOrEqual(5);
      expect(f.speech.say).toHaveBeenLastCalledWith(wrong.text);
    }
    expect(f.speech.say).toHaveBeenCalledTimes(SCENES.length * 2);
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

  it("checks evaluation utterance, scene index and result, with actionable mismatch evidence", async () => {
    const f = fixture();
    const action = await f.child.correctAnswer();
    f.entries.push({
      dir: "evaluate",
      at: 5,
      askedAt: 2,
      request: { utterance: "One!", sceneIndex: 0 },
      answer: { probability: 0.99 },
    });
    await expect(f.assertions.evaluated({ after: action, result: { probability: 0.99 } })).resolves.toMatchObject({
      utterance: "One!",
      sceneIndex: 0,
    });
    for (const mismatch of [{ utterance: "Two!" }, { sceneIndex: 1 }, { result: { probability: 0.1 } }]) {
      await expect(f.assertions.evaluated({ after: action, ...mismatch })).rejects.toThrow(
        /Expected evaluation.*evidence:/,
      );
    }
  });

  it.each(["one", "One.", "  ONE!  "])("normalizes intended One! against %s", async utterance => {
    const f = fixture();
    const action = await f.child.correctAnswer();
    f.entries.push({
      dir: "evaluate",
      at: 5,
      askedAt: 2,
      request: { utterance, sceneIndex: 0 },
      answer: { probability: 0.99 },
    });
    await expect(f.assertions.evaluated({ after: action })).resolves.toMatchObject({ utterance });
    await expect(f.assertions.evaluated({ after: action, exactUtterance: true })).rejects.toThrow(
      "Expected evaluation",
    );
    await expect(f.assertions.evaluated({ after: action, utterance, exactUtterance: true })).resolves.toMatchObject({
      utterance,
    });
  });

  it.each([
    ["One!", 1],
    ["one", 1],
    ["1", 1],
    ["  ONE!  ", 1],
    ["TWO.", 2],
    ["2", 2],
    ["three", 3],
    ["3", 3],
    ["four", 4],
    ["4", 4],
    ["five", 5],
    ["5", 5],
  ])("matches counting token %s as %i only when opted in", async (utterance, numericAnswer) => {
    const f = fixture();
    const action = await f.child.correctAnswer();
    f.entries.push({
      dir: "evaluate",
      at: 5,
      askedAt: 2,
      request: { utterance, sceneIndex: 0 },
      answer: { probability: 0.99 },
    });
    await expect(f.assertions.evaluated({ after: action, numericAnswer })).resolves.toMatchObject({ utterance });
    await expect(f.assertions.evaluated({ after: action, numericAnswer: numericAnswer === 1 ? 2 : 1 })).rejects.toThrow(
      "Expected evaluation",
    );
    if (utterance !== "One!")
      await expect(f.assertions.evaluated({ after: action, numericAnswer, exactUtterance: true })).rejects.toThrow(
        "Expected evaluation",
      );
    if (utterance === "1")
      await expect(f.assertions.evaluated({ after: action })).rejects.toThrow("Expected evaluation");
  });

  it.each(["someone", "one two", "I don't know", "10", "one maybe", "done", "six", "6"])(
    "rejects non-counting token %s for numeric assertions",
    async utterance => {
      const f = fixture();
      const action = await f.child.correctAnswer();
      f.entries.push({
        dir: "evaluate",
        at: 5,
        askedAt: 2,
        request: { utterance, sceneIndex: 0 },
        answer: { probability: 0.99 },
      });
      await expect(f.assertions.evaluated({ after: action, numericAnswer: 1 })).rejects.toThrow("Expected evaluation");
    },
  );

  it.each([0, 6, 1.5, "1"])("rejects unsupported numericAnswer %s", async numericAnswer => {
    const f = fixture();
    await expect(f.assertions.evaluated({ after: 0, numericAnswer })).rejects.toThrow("supported counting value");
  });

  it("collapses repeated whitespace without accepting different words", async () => {
    const f = fixture();
    const action = await f.child.say("I don't know.");
    f.entries.push({
      dir: "evaluate",
      at: 5,
      askedAt: 2,
      request: { utterance: " I   don't\nknow! ", sceneIndex: 0 },
      answer: {},
    });
    await expect(f.assertions.evaluated({ after: action })).resolves.toMatchObject({ kind: "evaluation" });
    await expect(f.assertions.evaluated({ after: action, utterance: "I do know" })).rejects.toThrow(
      "Expected evaluation",
    );
  });

  it("waits for a new tutor opportunity after evaluation and verifies session end", async () => {
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
