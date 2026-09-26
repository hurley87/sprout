import { describe, it, expect, vi } from "vitest";
import { REACTIVE_SCENARIOS, spokenNonAnswer, silentOpportunity } from "../scripts/live/reactive-scenarios.mjs";
import { createScenarioAssertions } from "../scripts/live/assertions.mjs";
import { executeScenario, selectScenarios, runSelected } from "../scripts/live/reactive-runner.mjs";

function context() {
  const calls: string[] = [];
  const action = { checkpointBefore: 2, scene: "one", text: "One!" };
  const observer = {
    waitForSproutTurnEnd: vi.fn(async () => {
      calls.push("end");
      return { cursor: 10, at: 100 };
    }),
    waitForSproutTurnStart: vi.fn(async () => {
      calls.push("start");
      return { cursor: 1, at: 0 };
    }),
    waitForChildTranscript: vi.fn(async () => ({ kind: "child-transcript", cursor: 4, text: "I don't know." })),
    waitForEvaluation: vi.fn(async () => ({ cursor: 5 })),
    waitForSceneAdvance: vi.fn(async () => ({ cursor: 6 })),
    snapshot: vi.fn(async (): Promise<{ events: { kind: string; cursor: number; at?: number; text?: string }[] }> => ({
      events: [
        { kind: "playback-start", cursor: 3, at: 50 },
        { kind: "child-transcript", cursor: 4, text: "Wait!" },
      ],
    })),
  };
  const child = {
    correctAnswer: vi.fn(async () => {
      calls.push("correct");
      return action;
    }),
    wrongAnswer: vi.fn(async () => {
      calls.push("wrong");
      return action;
    }),
    say: vi.fn(async () => {
      calls.push("say");
      return action;
    }),
  };
  const assertions = {
    evaluated: vi.fn(async () => {}),
    sceneStayed: vi.fn(async () => {}),
    sceneAdvancedExactlyOnce: vi.fn(async () => {}),
    sproutRespondedAfter: vi.fn(async () => ({ cursor: 10 })),
  };
  return { observer, child, assertions, calls };
}

describe("baseline reactive suite", () => {
  it("selects one, subset, all, repeat and rejects invalid input", () => {
    expect(selectScenarios([], REACTIVE_SCENARIOS)).toHaveLength(10);
    expect(selectScenarios(["happy-path"], REACTIVE_SCENARIOS).map(r => r.name)).toEqual(["happy-path"]);
    expect(selectScenarios(["silence", "interruption", "--repeat", "2"], REACTIVE_SCENARIOS).map(r => r.label)).toEqual(
      ["silence-1", "silence-2", "interruption-1", "interruption-2"],
    );
    expect(() => selectScenarios(["missing"], REACTIVE_SCENARIOS)).toThrow("Available:");
    expect(() => selectScenarios(["--repeat"], REACTIVE_SCENARIOS)).toThrow("positive integer");
    expect(() => selectScenarios(["toString"], REACTIVE_SCENARIOS)).toThrow("Unknown");
  });
  it("waits for the tutor before answers and bounds the wrong-answer window after its response", async () => {
    const ctx = context();
    await REACTIVE_SCENARIOS["incorrect-then-correct"].run(ctx);
    expect(ctx.calls).toEqual(["end", "wrong", "correct"]);
    expect(ctx.assertions.sceneStayed).toHaveBeenCalledWith({
      after: expect.objectContaining({ checkpointBefore: 2 }),
      through: 10,
    });
    expect(ctx.assertions.sproutRespondedAfter).toHaveBeenCalledWith({ cursor: 5 });
    expect(ctx.assertions.sceneAdvancedExactlyOnce).toHaveBeenCalledWith(expect.objectContaining({ through: 10 }));
  });
  it("waits for start for interruption and rejects audio arriving after that same turn", async () => {
    const ctx = context();
    await REACTIVE_SCENARIOS.interruption.run(ctx);
    expect(ctx.calls.slice(0, 2)).toEqual(["start", "say"]);
    const late = context();
    late.observer.snapshot.mockResolvedValue({ events: [{ kind: "playback-start", cursor: 3, at: 101 }] });
    await expect(REACTIVE_SCENARIOS.interruption.run(late)).rejects.toThrow("did not barge");
  });
  it("replays support from before silence rather than skipping it at the timer end", async () => {
    const ctx = context();
    ctx.observer.snapshot.mockResolvedValue({ events: [] });
    const silence = { checkpointBefore: 2, checkpointAfterPlayback: 7, scene: "one" };
    const child = { ...ctx.child, staySilent: vi.fn(async () => silence) };
    await REACTIVE_SCENARIOS["long-pause"].run({ ...ctx, child });
    expect(child.staySilent).toHaveBeenCalledWith(12000);
    expect(ctx.assertions.sproutRespondedAfter.mock.calls[0]).toEqual([{ cursor: 2 }]);
    expect(ctx.assertions.sceneStayed).toHaveBeenCalledWith({ after: silence, through: 10 });
  });
  it("consumes support at cursor 5 even though silence finishes at cursor 7", async () => {
    const ctx = context();
    ctx.observer.snapshot.mockResolvedValue({ events: [] });
    const respond = vi.fn(async ({ cursor }: { cursor: number }) => {
      if (cursor >= 5) throw new Error("Support was skipped");
      return { cursor: 6 };
    });
    const assertions = { ...ctx.assertions, sproutRespondedAfter: respond };
    const action = { checkpointBefore: 2, checkpointAfterPlayback: 7, scene: "one" };
    await silentOpportunity({ ...ctx, assertions }, action);
    expect(respond).toHaveBeenCalledWith({ cursor: 2 });
    expect(assertions.sceneStayed).toHaveBeenCalledWith({ after: action, through: 6 });
  });
  it.each(["child-transcript", "evaluation", "session-end"])(
    "rejects %s during a bounded silent opportunity",
    async kind => {
      const ctx = context();
      ctx.observer.snapshot.mockResolvedValue({ events: [{ kind, cursor: 4 }] });
      await expect(silentOpportunity(ctx, { checkpointBefore: 2, scene: "one" })).rejects.toThrow();
      expect(ctx.assertions.sceneStayed).toHaveBeenCalledWith({ after: expect.anything(), through: 10 });
    },
  );
  it("rejects scene advancement during silence using the retained assertion window", async () => {
    const ctx = context();
    const snapshot = async () => ({
      cursor: 6,
      scene: "two",
      events: [
        { kind: "scene", cursor: 1, from: null, to: "one" },
        { kind: "scene", cursor: 4, from: "one", to: "two" },
      ],
    });
    const assertions = {
      ...ctx.assertions,
      sceneStayed: createScenarioAssertions({ snapshot }).sceneStayed,
      sproutRespondedAfter: async () => ({ cursor: 6 }),
    };
    await expect(silentOpportunity({ ...ctx, assertions }, { checkpointBefore: 2, scene: "one" })).rejects.toThrow(
      "Expected scene to remain",
    );
  });
  it("waits for real transcript and bypasses Jev for spoken non-answers", async () => {
    const ctx = context();
    const action = { checkpointBefore: 2, scene: "one", text: "I don't know." };
    ctx.observer.snapshot.mockResolvedValue({
      events: [{ kind: "child-transcript", cursor: 4, text: action.text }],
    });
    await spokenNonAnswer(ctx, action);
    expect(ctx.observer.waitForChildTranscript).toHaveBeenCalledWith({ after: 2 });
    expect(ctx.observer.waitForEvaluation).not.toHaveBeenCalled();
    expect(ctx.assertions.evaluated).not.toHaveBeenCalled();
    expect(ctx.assertions.sproutRespondedAfter).toHaveBeenCalledWith({
      kind: "child-transcript",
      cursor: 4,
      text: action.text,
    });
    expect(ctx.assertions.sceneStayed).toHaveBeenCalledWith({ after: action, through: 10 });
    ctx.observer.snapshot.mockResolvedValue({ events: [] });
    await expect(spokenNonAnswer(ctx, action)).rejects.toThrow("not transcribed");
  });
  it.each(["evaluation", "session-end"])("rejects %s in a spoken non-answer window", async kind => {
    const ctx = context();
    ctx.observer.snapshot.mockResolvedValue({
      events: [
        { kind: "child-transcript", cursor: 4, text: "Can we do more?" },
        { kind, cursor: 5 },
      ],
    });
    await expect(spokenNonAnswer(ctx, { checkpointBefore: 2, scene: "one" })).rejects.toThrow();
  });
  it.each(["incorrect-dont-know-correct", "off-topic", "request-more"])(
    "%s evaluates only its numeric answers before recovering",
    async name => {
      const ctx = context();
      const action = { checkpointBefore: 2, scene: "one", text: "I don't know." };
      const child = { ...ctx.child, dontKnow: vi.fn(async () => action), requestMore: vi.fn(async () => action) };
      await REACTIVE_SCENARIOS[name as keyof typeof REACTIVE_SCENARIOS].run({ ...ctx, child });
      expect(ctx.observer.waitForEvaluation).toHaveBeenCalledTimes(name === "incorrect-dont-know-correct" ? 2 : 1);
      expect(ctx.assertions.evaluated).toHaveBeenCalledTimes(name === "incorrect-dont-know-correct" ? 2 : 1);
    },
  );
  it("preserves synchronous Playwright locator methods in scenario context", async () => {
    const waitFor = vi.fn(async () => {});
    const page = { getByRole: () => ({ waitFor }) };
    await executeScenario(
      "ui",
      {
        timeoutMs: 100,
        run: async (ctx: { page: typeof page }) => {
          await ctx.page.getByRole().waitFor();
        },
      },
      { page },
    );
    expect(waitFor).toHaveBeenCalledOnce();
  });
  it("preserves scenario name and cause on failure", async () => {
    const cause = new Error("evaluation missing");
    await expect(
      executeScenario(
        "wrong",
        {
          timeoutMs: 100,
          run: async () => {
            throw cause;
          },
        },
        {},
      ),
    ).rejects.toMatchObject({ cause, message: expect.stringContaining("Scenario wrong failed") });
  });
  it("bounds a stalled scenario and prevents later speech after timeout", async () => {
    vi.useFakeTimers();
    try {
      let resume: () => void = () => {
        throw new Error("Scenario did not start");
      };
      const speak = vi.fn();
      const abort = vi.fn(async () => {});
      const pending = executeScenario(
        "stalled",
        {
          timeoutMs: 20,
          run: async (ctx: { child: { say: () => Promise<void> } }) => {
            await new Promise<void>(resolve => {
              resume = resolve;
            });
            await ctx.child.say();
          },
        },
        { child: { say: speak } },
        abort,
      );
      const rejection = expect(pending).rejects.toThrow("Overall scenario timeout");
      await vi.advanceTimersByTimeAsync(20);
      await rejection;
      resume();
      await Promise.resolve();
      expect(abort).toHaveBeenCalledOnce();
      expect(speak).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("executes sequentially, retains failures and continues the requested subset", async () => {
    const order: string[] = [];
    const results = await runSelected([{ name: "a" }, { name: "b" }], async ({ name }: { name: string }) => {
      order.push(`start ${name}`);
      await Promise.resolve();
      order.push(`end ${name}`);
      if (name === "a") throw new Error("broken");
    });
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
    expect(results.map(r => r.status)).toEqual(["failed", "passed"]);
  });
});

it("explicit stop waits for the post-session control and permits transport finalization", async () => {
  const action = { checkpointBefore: 2 };
  const end = { cursor: 5 };
  const getByRole = vi.fn(() => ({ waitFor: vi.fn(async () => {}) }));
  await REACTIVE_SCENARIOS["explicit-stop"].run({
    child: { requestStop: async () => action },
    observer: {
      waitForSproutTurnEnd: async () => {},
      waitForSessionEnd: async () => end,
      snapshot: async () => ({
        events: [
          { kind: "scene", cursor: 4, from: "hello-duck", to: null },
          { kind: "session-end", cursor: 5 },
          { kind: "session-end", cursor: 6 },
        ],
      }),
    },
    assertions: { sessionEnded: async () => {} },
    page: { getByRole },
  });
  expect(getByRole).toHaveBeenCalledWith("button", { name: "Start a new lesson" });
});
