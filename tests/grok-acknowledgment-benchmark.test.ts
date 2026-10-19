import { afterEach, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { formatExpectedCountingAnswer } from "../lib/experiments/grok-counting/expected-answer";
import dataset from "../lib/experiments/grok-counting/acknowledgment-cases.json";
import { ACK_THRESHOLD, ACK_DEADLINE_MS, type AckInput } from "../lib/experiments/grok-counting/acknowledgment";
import {
  runAcknowledgmentBenchmark,
  summarizeAcknowledgments,
  thresholdDecision,
  validateBenchmarkCases,
} from "../lib/experiments/grok-counting/acknowledgment-benchmark";
import { POST } from "../app/api/experiments/grok-counting/acknowledgment/route";
const cases = validateBenchmarkCases(dataset.cases);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each([
  ["count-1-duck", "one duck"],
  ["count-2-ducks", "two ducks"],
  ["count-3-butterflies", "three butterflies"],
])("formats authored %s", async (id, answer) => {
  expect(formatExpectedCountingAnswer(COUNTING_LESSON.nodes[id].presentation)).toBe(answer);
  vi.stubEnv("TYPESAFE_API_KEY", "");
  const response = await POST(
    new Request("http://127.0.0.1:3000/api/experiments/grok-counting/acknowledgment", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: id,
        learner: answer,
        tutor: `Yes, ${answer}.`,
        expectedAnswer: answer,
        requestId: "application-id",
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ reason: "unconfigured" });
});
it.each([
  { quantity: 2, object: "butterfly" },
  { quantity: 4, object: "duck" },
])("rejects unsupported scene formatting", scene => expect(() => formatExpectedCountingAnswer(scene)).toThrow());
it("locks independently authored labels, cases and demo rationale", () => {
  expect(cases).toHaveLength(33);
  expect(cases.filter(row => row.eligible)).toHaveLength(32);
  expect(new Set(cases.map(row => row.expectedLabel))).toEqual(new Set(["positive", "negative", "ambiguous"]));
  expect(cases.find(row => row.id === "oct18-demo")).toMatchObject({
    learner: "One duck.",
    tutor: "One duck. That's right!",
    expectedLabel: "positive",
    eligible: true,
  });
  expect(ACK_THRESHOLD).toBe(0.95);
  expect(() => validateBenchmarkCases([...cases, cases[0]])).toThrow();
  expect(() => validateBenchmarkCases([{ ...cases[0], expectedLabel: "model-guessed" }])).toThrow();
  expect(() => validateBenchmarkCases([{ ...cases[0], nodeId: "unknown" }])).toThrow();
  expect(() => validateBenchmarkCases([{ ...cases[0], eligible: false }])).toThrow();
});
it.each([
  [0.9, 0.9, "positive"],
  [0.95, 0.95, "positive"],
  [0.99, 0.99, "positive"],
  [0.1, 0.9, "negative"],
  [0.05, 0.95, "negative"],
  [0.01, 0.99, "negative"],
  [0.949, 0.95, "abstain"],
  [0.5, 0.95, "abstain"],
  [null, 0.95, "abstain"],
  [NaN, 0.95, "abstain"],
  [1.1, 0.95, "abstain"],
] as const)("interprets probability %s at %s", (p, t, result) => expect(thresholdDecision(p, t)).toBe(result));
it("rejects invalid thresholds and request bounds before evaluation", async () => {
  expect(() => thresholdDecision(0.99, 0.5)).toThrow();
  const evaluate = vi.fn();
  await expect(
    runAcknowledgmentBenchmark(cases, { execute: true, credentialsAvailable: true, maxRequests: 31 }, evaluate),
  ).rejects.toThrow();
  await expect(
    runAcknowledgmentBenchmark(cases, { execute: true, credentialsAvailable: true, maxRequests: 41 }, evaluate),
  ).rejects.toThrow();
  expect(evaluate).not.toHaveBeenCalled();
});
it.each([false, true])(
  "never calls provider without explicit execution and credentials (execute=%s)",
  async execute => {
    const evaluate = vi.fn();
    const report = await runAcknowledgmentBenchmark(
      cases,
      { execute, credentialsAvailable: !execute, maxRequests: 32 },
      evaluate,
    );
    expect(evaluate).not.toHaveBeenCalled();
    expect(report.providerAttempts).toBe(0);
    expect(report.thresholds[1].definitiveAccuracy).toBeNull();
    expect(report.rows.every(row => row.probability === null && row.latencyMs === null)).toBe(true);
  },
);
const evaluator = (probabilities: (number | null)[]) =>
  vi.fn(async (input: AckInput) => {
    const probability = probabilities.shift() ?? null;
    return {
      probability,
      decision: {
        requestId: input.requestId,
        outcome: probability !== null && probability >= 0.95 ? ("acknowledging" as const) : ("abstain" as const),
        reason: probability === null ? ("model_mismatch" as const) : ("confirmed" as const),
        modelValidated: probability !== null,
      },
    };
  });
it("collects once, excludes ineligible evidence, and recomputes thresholds on identical probabilities", async () => {
  const selected = [
    cases.find(row => row.expectedLabel === "positive")!,
    cases.find(row => row.expectedLabel === "negative" && row.eligible)!,
    cases.find(row => row.expectedLabel === "ambiguous")!,
    cases.find(row => !row.eligible)!,
  ];
  const evaluate = evaluator([0.96, 0.94, 0.5]);
  const report = await runAcknowledgmentBenchmark(
    selected,
    { execute: true, credentialsAvailable: true, maxRequests: 3 },
    evaluate,
  );
  expect(evaluate).toHaveBeenCalledTimes(3);
  expect(report.paidRetries).toBe(0);
  expect(report.rows.at(-1)).toMatchObject({ attempted: false, decision: "not-eligible", probability: null });
  expect(report.thresholds[0].falsePositives).toBe(1);
  expect(report.thresholds[1].falsePositives).toBe(0);
  expect(report.thresholds[1].falseNegatives).toBe(0);
  expect(report.thresholds[2].falseNegatives).toBe(1);
  expect(report.thresholds[1]).toMatchObject({ definitiveAccuracy: 0.5, abstentions: 2, ambiguousAbstained: 1 });
  expect(report.rows[0].probability).toBe(0.96);
});
it("includes provider failures and abstentions in honest denominators", async () => {
  const selected = [cases[0], cases.find(row => row.expectedLabel === "negative")!];
  const report = await runAcknowledgmentBenchmark(
    selected,
    { execute: true, credentialsAvailable: true, maxRequests: 2 },
    evaluator([null, 0.01]),
  );
  expect(report.thresholds[1]).toMatchObject({
    providerFailures: 1,
    falseNegatives: 1,
    definitiveAccuracy: 0.5,
    selectiveAccuracy: 1,
  });
  const rows = report.rows.map((row, index) => ({ ...row, latencyMs: index ? 300 : 100 }));
  expect(summarizeAcknowledgments(rows).latency).toEqual({ sampleSize: 2, medianMs: 200, p95Ms: 300 });
});
it("bounds an unresponsive provider with no retry and sanitizes errors", async () => {
  vi.useFakeTimers();
  const evaluate = vi.fn(() => new Promise<never>(() => {}));
  const pending = runAcknowledgmentBenchmark(
    [cases[0]],
    { execute: true, credentialsAvailable: true, maxRequests: 1 },
    evaluate,
  );
  await vi.advanceTimersByTimeAsync(ACK_DEADLINE_MS);
  const result = await pending;
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(result.rows[0]).toMatchObject({ probability: null, reason: "timeout", latencyMs: 5000 });
  const failed = await runAcknowledgmentBenchmark(
    [cases[0]],
    { execute: true, credentialsAvailable: true, maxRequests: 1 },
    async () => {
      throw new Error("private-secret");
    },
  );
  expect(JSON.stringify(failed)).not.toContain("private-secret");
  expect(failed.rows[0].reason).toBe("unreachable");
});
it("rejects malformed/identity-mismatched probability projections", async () => {
  const result = await runAcknowledgmentBenchmark(
    [cases[0]],
    { execute: true, credentialsAvailable: true, maxRequests: 1 },
    async () => ({
      probability: 1,
      decision: { requestId: "wrong", outcome: "acknowledging", reason: "confirmed", modelValidated: true },
    }),
  );
  expect(result.rows[0]).toMatchObject({ probability: null, decision: "abstain", modelValidated: false });
});
it("October 18 phrase is rejected by actual Grok-only grammar", async () => {
  const result = await runAcknowledgmentBenchmark(cases, {
    execute: false,
    credentialsAvailable: false,
    maxRequests: 32,
  });
  expect(result.october18Demo).toMatchObject({ grokOnlyAcknowledges: false, probability: null });
});
it("CLI plans with credentials present without making paid calls", () => {
  const output = execFileSync(process.execPath, ["scripts/grok-acknowledgment-benchmark.mjs"], {
    encoding: "utf8",
    env: { ...process.env, TYPESAFE_API_KEY: "provider-free-sentinel" },
  });
  expect(JSON.parse(output)).toMatchObject({ status: "not-executed", providerAttempts: 0 });
  const rejected = spawnSync(process.execPath, ["scripts/grok-acknowledgment-benchmark.mjs", "--live"], {
    encoding: "utf8",
  });
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain("--live --execute");
});

it("recomputes committed actual-provider evidence without network calls", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const live = JSON.parse(readFileSync("docs/evidence/issue-69-jev-acknowledgment-benchmark.json", "utf8"));
  expect(live.status).toBe("collected");
  expect(live.providerAttempts).toBe(32);
  expect(live.paidRetries).toBe(0);
  for (const threshold of [0.9, 0.95, 0.99]) {
    expect(summarizeAcknowledgments(live.rows, threshold)).toEqual(
      live.thresholds.find((row: { threshold: number }) => row.threshold === threshold),
    );
  }
  expect(live.sourceSHA256["lib/experiments/grok-counting/acknowledgment-cases.json"]).toBe(
    createHash("sha256").update(readFileSync("lib/experiments/grok-counting/acknowledgment-cases.json")).digest("hex"),
  );
  expect(
    live.rows.map((row: { id: string; expectedLabel: string; rationale: string }) => ({
      id: row.id,
      expectedLabel: row.expectedLabel,
      rationale: row.rationale,
    })),
  ).toEqual(cases.map(({ id, expectedLabel, rationale }) => ({ id, expectedLabel, rationale })));
  expect(live.october18Demo).toMatchObject({
    probability: 0.99,
    modelValidated: true,
    decision: "acknowledging",
    grokOnlyAcknowledges: false,
  });
});

it("derives walkthrough timing only from current correlated real-event fields", async () => {
  const { summarizeGrokWalkthrough } = await import("../lib/experiments/grok-counting/walkthrough-evidence");
  const event = (value: object) => ({
    node: "count-1-duck",
    turn: 1,
    response: 2,
    item: 1,
    reason: "completed",
    ...value,
  });
  const timeline = [
    event({ sequence: 1, type: "learner.transcript", reason: "settled", atMs: 10 }),
    event({ sequence: 2, type: "audio.started", atMs: 12, response: 99 }),
    event({ sequence: 3, type: "proposal.validated", reason: "correct", atMs: 20 }),
    event({ sequence: 4, type: "audio.started", atMs: 30 }),
    event({
      sequence: 5,
      type: "classification.completed",
      reason: "confirmed",
      atMs: 40,
      classification: { modelValidated: true, latencyMs: 18 },
    }),
    event({ sequence: 6, type: "audio.drained", atMs: 60 }),
    event({ sequence: 7, type: "render.requested", atMs: 310 }),
    event({ sequence: 8, type: "render.confirmed", node: "count-2-ducks", atMs: 330 }),
  ] as import("../lib/experiments/grok-counting/proposals").DecisionEntry[];
  const scene = summarizeGrokWalkthrough(timeline)[0];
  expect(scene).toMatchObject({
    settledToValidatedToolMs: 10,
    firstScheduledAcknowledgmentAudioAtMs: 30,
    localAcknowledgmentAudioDrainedAtMs: 60,
    settledToNextRenderMs: 320,
    jev: { latencyMs: 18 },
  });
  const noAudio = summarizeGrokWalkthrough(timeline.filter(entry => !entry.type.startsWith("audio.")))[0];
  expect(noAudio.firstScheduledAcknowledgmentAudioAtMs).toBeNull();
  expect(noAudio.localAcknowledgmentAudioDrainedAtMs).toBeNull();
});

it("retains the actual blocked voice attempt without inventing Jev or render evidence", async () => {
  const { readFileSync } = await import("node:fs");
  const { summarizeGrokWalkthrough } = await import("../lib/experiments/grok-counting/walkthrough-evidence");
  const live = JSON.parse(readFileSync("docs/evidence/issue-69-grok-jev-live-walkthrough.json", "utf8"));
  expect(live).toMatchObject({
    mode: "grok-jev",
    status: "blocked",
    blockedStage: "count-1-duck",
    providerSessions: 1,
    learnerAttempts: 1,
    paidRetries: 0,
    jevHttpRequests: 0,
  });
  expect(live.scenes).toEqual(summarizeGrokWalkthrough(live.sessionExport.decisionTimeline));
  expect(live.sessionExport.decisionTimeline).toContainEqual(
    expect.objectContaining({ type: "proposal.rejected", reason: "unsupported incorrect answer" }),
  );
  expect(
    live.sessionExport.decisionTimeline.some((entry: { type: string }) =>
      ["classification.requested", "render.requested"].includes(entry.type),
    ),
  ).toBe(false);
  expect(live.wireEvents).toContainEqual(
    expect.objectContaining({ type: "conversation.item.input_audio_transcription.completed", text: "I see one dog." }),
  );
  expect(live.wireEvents).toContainEqual(
    expect.objectContaining({ type: "response.function_call_arguments.done", outcome: "incorrect" }),
  );
  expect(JSON.stringify(live)).not.toMatch(
    /context_token|supporting_text|Authorization|Bearer|client-secret|TYPESAFE_API_KEY|XAI_API_KEY/,
  );
});
