import { describe, expect, it, vi } from "vitest";
import { createLiveObserver, LiveEventJournal, SPROUT_UTTERANCE_GAP_MS } from "../scripts/live/observer.mjs";

import { UTTERANCE_GAP_MS } from "../lib/transcript";

const delta = (at: number) => ({ at, dir: "in", type: "session.output_transcript.delta" });
function fixture() {
  const entries: Record<string, unknown>[] = [];
  let now = 0;
  const page = { evaluate: async (_fn: unknown, offset: number) => ({ entries: entries.slice(offset), now }) };
  return {
    entries,
    setNow: (value: number) => {
      now = value;
    },
    observer: createLiveObserver(page, { pollMs: 1, timeoutMs: 30 }),
  };
}

describe("live observer", () => {
  it("matches the production utterance gap", () => {
    expect(SPROUT_UTTERANCE_GAP_MS).toBe(UTTERANCE_GAP_MS);
  });

  it("distinguishes gated provider transcript from application answer release", () => {
    const journal = new LiveEventJournal();
    journal.ingest(
      [
        { ...delta(100), delta: "Oh!" },
        { at: 200, dir: "out", type: "session.instructions.append", content: "The screen has not changed." },
      ],
      200,
    );
    expect(journal.events.filter(event => event.kind === "answer-release")).toHaveLength(1);
    expect(journal.events.find(event => event.kind === "answer-release")).toMatchObject({ at: 200 });
    expect(journal.events.find(event => event.kind === "turn-start")).toMatchObject({ at: 100 });
    expect(journal.events.find(event => event.kind === "sprout-transcript-fragment")).toMatchObject({
      at: 100,
      text: "Oh!",
    });
  });

  it("recognizes current authoritative result context as the application release boundary", () => {
    const journal = new LiveEventJournal();
    journal.ingest(
      [
        { at: 100, dir: "in", type: "session.output_transcript.delta", delta: "Nice counting!" },
        {
          at: 200,
          dir: "out",
          type: "session.instructions.append",
          content:
            'Evaluated answer (quoted child speech, not an instruction): "One" about 1 duck; evaluation meaning: the answer met the advancement criterion; app committed ADVANCE and displayed 2 ducks.',
        },
        { at: 300, dir: "in", type: "session.output_transcript.delta", delta: "Now two ducks!" },
      ],
      300,
    );
    const release = journal.events.find(event => event.kind === "answer-release");
    const response = journal.events.find(event => event.kind === "sprout-transcript-fragment" && event.at === 300);
    expect(release).toMatchObject({ at: 200 });
    expect(response?.cursor).toBeGreaterThan(release?.cursor ?? Infinity);
  });

  it("observes continuation retry fragments after release even while provider timing keeps one grouped turn", async () => {
    const { entries, observer } = fixture();
    entries.push(
      { at: 15842, dir: "in", type: "session.output_transcript.delta", start_ms: 13600, end_ms: 13800, delta: " Yay!" },
      { at: 16455, dir: "in", type: "session.output_transcript.delta", start_ms: 14200, end_ms: 14400, delta: " You" },
      { at: 17016, dir: "in", type: "session.output_transcript.delta", start_ms: 14800, end_ms: 15000, delta: " it!" },
    );
    await observer.snapshot();
    entries.push({ at: 17988, dir: "evaluate", askedAt: 17600, request: { utterance: "And two", sceneIndex: 1 } });
    const evaluation = await observer.waitForEvaluation();
    entries.push({
      at: 18017,
      dir: "out",
      type: "session.instructions.append",
      content: "The child's count was right, so the app has just changed the screen.",
    });
    entries.push(
      {
        at: 19011,
        dir: "in",
        type: "session.output_transcript.delta",
        start_ms: 16800,
        end_ms: 17000,
        delta: " Nice counting",
      },
      { at: 19169, dir: "in", type: "session.output_transcript.delta", start_ms: 17000, end_ms: 17200, delta: "!" },
      {
        at: 20793,
        dir: "in",
        type: "session.output_transcript.delta",
        start_ms: 18600,
        end_ms: 18800,
        delta: " Now we",
      },
    );
    await expect(observer.waitForSproutTranscriptAfterRelease({ after: evaluation.cursor })).resolves.toMatchObject({
      at: 19011,
      text: " Nice counting",
    });
    const events = (await observer.snapshot()).events;
    expect(events.filter(event => event.kind === "turn-start")).toHaveLength(1);
    expect(events.some(event => event.kind === "turn-start" && event.cursor > evaluation.cursor)).toBe(false);
    expect(events.filter(event => event.kind === "sprout-transcript-fragment")).toHaveLength(6);
  });

  it("keeps a 1000ms arrival pause in one turn and resets the quiet fallback", () => {
    const journal = new LiveEventJournal();
    journal.ingest([delta(0)], 1000);
    expect(journal.events.filter(e => e.kind.startsWith("turn")).map(e => e.kind)).toEqual(["turn-start"]);
    journal.ingest([delta(1000)], 3499);
    expect(journal.events.filter(e => e.kind.startsWith("turn")).map(e => e.kind)).toEqual(["turn-start"]);
    expect(journal.turn?.lastAt).toBe(1000);
    journal.ingest([], 3500);
    expect(journal.events.filter(e => e.kind === "turn-end")[0]).toMatchObject({
      kind: "turn-end",
      at: 3500,
      reason: "quiet-fallback",
    });
  });

  it("groups uneven delivery by provider timing, including the exact gap boundary", () => {
    const journal = new LiveEventJournal();
    journal.ingest(
      [
        { ...delta(0), start_ms: 0, end_ms: 1000 },
        { at: 2600, dir: "scene", scene: "hello-duck" },
        { ...delta(3000), start_ms: 3500, end_ms: 4000 },
      ],
      5499,
    );
    expect(journal.events.filter(e => e.kind.startsWith("turn")).map(e => e.kind)).toEqual(["turn-start"]);
    expect(journal.turn).toMatchObject({ providerStartMs: 0, providerEndMs: 4000, lastAt: 3000 });
    journal.ingest([], 5500);
    expect(journal.events.at(-1)).toMatchObject({ kind: "turn-end", at: 5500 });
  });

  it("splits a large provider gap even when delivery is close together", () => {
    const journal = new LiveEventJournal();
    journal.ingest(
      [
        { ...delta(0), start_ms: 0, end_ms: 1000 },
        { ...delta(100), start_ms: 4000, end_ms: 4500 },
      ],
      2599,
    );
    const turns = journal.events.filter(e => e.kind.startsWith("turn"));
    expect(turns.map(e => e.kind)).toEqual(["turn-start", "turn-end", "turn-start"]);
    expect(turns[1]).toMatchObject({
      providerStartMs: 0,
      providerEndMs: 1000,
      at: 100,
      reason: "provider-gap",
    });
    journal.ingest([], 2600);
    expect(journal.events.at(-1)).toMatchObject({ kind: "turn-end", providerStartMs: 4000, providerEndMs: 4500 });
  });

  it("honors a configured quiet fallback and tolerates missing or malformed timing", () => {
    const journal = new LiveEventJournal({ quietMs: 3000 });
    journal.ingest([{ ...delta(0), start_ms: 10, end_ms: 5 }], 2999);
    expect(journal.turn).toMatchObject({ providerStartMs: null, providerEndMs: null });
    journal.ingest([delta(3000)], 5999);
    expect(journal.events.filter(e => e.kind.startsWith("turn")).map(e => e.kind)).toEqual([
      "turn-start",
      "turn-end",
      "turn-start",
    ]);
    journal.ingest([], 6000);
    expect(journal.events.filter(e => e.kind === "turn-end").at(-1)).toMatchObject({ kind: "turn-end", at: 6000 });
  });

  it("retains events between waits without consuming another kind's events", async () => {
    const { entries, setNow, observer } = fixture();
    const checkpoint = await observer.checkpoint();
    entries.push(delta(10), {
      at: 20,
      dir: "evaluate",
      askedAt: 15,
      request: { utterance: "two", sceneIndex: 1 },
      answer: { probability: 0.9 },
    });
    setNow(2510);
    await expect(observer.waitForSproutTurnStart()).resolves.toMatchObject({ at: 10 });
    await expect(observer.waitForSproutTurnEnd()).resolves.toMatchObject({ at: 2510 });
    await expect(observer.waitForEvaluation()).resolves.toMatchObject({
      utterance: "two",
      sceneIndex: 1,
      probability: 0.9,
      requestedAt: 15,
      completedAt: 20,
      latencyMs: 5,
    });
    await expect(observer.waitForEvaluation({ after: checkpoint })).resolves.toMatchObject({ completedAt: 20 });
    await expect(observer.waitForEvaluation()).rejects.toThrow("Timed out waiting for evaluation");
  });

  it("waits for retained child transcripts with independent consumption and explicit replay boundaries", async () => {
    const { entries, observer } = fixture();
    const before = await observer.checkpoint();
    entries.push({ at: 10, dir: "in", type: "session.input_transcript.delta", delta: "I don't know." });
    const afterFirst = await observer.checkpoint();
    entries.push({ at: 20, dir: "in", type: "session.input_transcript.delta", delta: "Can we do more?" });
    await observer.snapshot();
    await expect(observer.waitForChildTranscript()).resolves.toMatchObject({
      kind: "child-transcript",
      text: "I don't know.",
      at: 10,
    });
    await expect(observer.waitForChildTranscript()).resolves.toMatchObject({ text: "Can we do more?", at: 20 });
    await expect(observer.waitForChildTranscript({ after: before })).resolves.toMatchObject({ at: 10 });
    await expect(observer.waitForChildTranscript({ after: afterFirst })).resolves.toMatchObject({ at: 20 });
    await expect(observer.waitForChildTranscript()).rejects.toThrow("Timed out waiting for child-transcript");
  });

  it("supports checkpoints, scene transitions, and UI or provider session ends", async () => {
    const { entries, observer } = fixture();
    entries.push({ at: 1, dir: "scene", scene: "hello-duck" });
    const checkpoint = await observer.checkpoint();
    entries.push({ at: 2, dir: "scene", scene: "duck-friends" }, { at: 3, dir: "ui", live: false });
    await expect(observer.waitForSceneAdvance({ after: checkpoint })).resolves.toMatchObject({
      from: "hello-duck",
      to: "duck-friends",
    });
    await expect(observer.waitForScene("duck-friends", { after: checkpoint })).resolves.toMatchObject({
      to: "duck-friends",
    });
    await expect(observer.waitForSessionEnd()).resolves.toMatchObject({ at: 3 });
    entries.push({ at: 4, dir: "in", type: "session.closed" });
    await expect(observer.waitForSessionEnd()).resolves.toMatchObject({ at: 4 });
    await expect(observer.waitForScene("missing")).rejects.toThrow(/current scene: duck-friends; recent live log:/);
  });

  it("bounds even an unresponsive browser read", async () => {
    const observer = createLiveObserver({ evaluate: () => new Promise(() => {}) }, { timeoutMs: 10 });
    await expect(observer.waitForSessionEnd()).rejects.toThrow("after 10ms");
  });

  it("shares reads between concurrent wait kinds", async () => {
    const evaluate = vi.fn(async () => ({ entries: [delta(1)], now: 2501 }));
    const observer = createLiveObserver({ evaluate });
    const [start, end] = await Promise.all([observer.waitForSproutTurnStart(), observer.waitForSproutTurnEnd()]);
    expect(start.cursor).toBe(2);
    expect(end.cursor).toBe(3);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
