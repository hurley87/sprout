import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
import * as artifacts from "../lib/experiments/issue-42/benchmark-artifacts";
import {
  aggregateResults,
  latencySummary,
  replayReducer,
  runComparison,
  syntheticTransport,
  type Transport,
} from "../lib/experiments/issue-42/provider-comparison";
import { executeConversationObserver } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import type { ConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";

let benchmark: artifacts.Benchmark;
beforeAll(() => {
  benchmark = artifacts.loadBenchmark();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const options = { caseIds: ["oct14-engram-final"], repetitions: 2, maxRequests: 4 };
const plan = () => artifacts.makePlan(benchmark, options);
// Synthetic gate fixtures are test data only, never authorization or a saved run review.
function review(p = plan()): artifacts.RunReview {
  return {
    version: 1,
    kind: "issue-42-authorized-run",
    planHash: p.planHash,
    reviewer: "test-only reviewer fixture",
    reviewedAt: "2026-10-15T12:00:00Z",
    authorization: {
      reference: "test-only authorization fixture",
      providerExecution: true,
      maxRequests: p.maxRequests,
    },
    lockedBeforeProviderOutputs: true,
    grouping: { hash: p.groupingHash, approved: true },
    cases: p.selectedCaseIds.map(caseId => {
      const c = benchmark.cases.find(c => c.row.id === caseId)!;
      return {
        caseId,
        inputSha256: c.hashes.inputSha256,
        labels: {
          objective: structuredClone(c.row.expected.objective),
          concepts: structuredClone(c.row.expected.concepts),
        },
      };
    }),
  };
}
function networkFixture(p: artifacts.Plan) {
  const r = review(p);
  const bytes = JSON.stringify(r);
  return {
    mode: "network" as const,
    execute: true,
    explicitBudget: p.maxRequests,
    review: r,
    reviewBytes: bytes,
    reviewHash: artifacts.sha256(bytes),
  };
}
function cleanBenchmark() {
  const clean = { ...benchmark, workingTreeDirty: false };
  vi.spyOn(artifacts, "loadBenchmark").mockReturnValue(clean);
  return clean;
}
function demonstrated(): Transport {
  return async (arm, req) => {
    const q =
      arm === "decisions"
        ? (
            req as NonNullable<
              ReturnType<typeof import("../lib/experiments/issue-42/decisions-classifier").decisionsRequest>
            >
          ).questions
        : Object.entries((req as artifacts.Benchmark["cases"][number]["jev"]).questions).map(([name, q]) => ({
            name,
            choices: Object.keys(q.criteria).map(value => ({ value })),
          }));
    const answers = q.map(q => {
      const choice =
        q.name === "objectiveState"
          ? "completed"
          : q.name === "tutorState"
            ? "confirmed_completion"
            : q.name.startsWith("source_")
              ? "message_1"
              : "demonstrated_independent";
      return {
        name: q.name,
        type: "choice",
        choice,
        confidence: 1,
        probabilities: q.choices.map(c => ({ value: c.value, probability: c.value === choice ? 1 : 0 })),
      };
    });
    return {
      ok: true,
      body: {
        model: arm === "decisions" ? "gpt-6-luna" : "jev-1.13.0",
        answers:
          arm === "decisions"
            ? answers
            : Object.fromEntries(
                answers.map(({ name, probabilities, ...a }) => [
                  name,
                  { ...a, probabilities: Object.fromEntries(probabilities.map(p => [p.value, p.probability])) },
                ]),
              ),
        usage: { input_tokens: 42, output_tokens: 0, total_tokens: 42 },
      },
    };
  };
}

describe("reproducible provider comparison (all transports synthetic)", () => {
  it("reproduces both arms for all 71 frozen snapshots with explicit wire differences", () => {
    const p = artifacts.makePlan(benchmark);
    expect(p.cases).toHaveLength(71);
    for (const c of benchmark.cases) {
      expect(JSON.parse(c.decisions.input)).toEqual(c.jev.state);
      expect(
        c.decisions.questions.map(q => [
          q.name,
          q.instructions,
          Object.fromEntries(q.choices.map(c => [c.value, c.description])),
        ]),
      ).toEqual(Object.entries(c.jev.questions).map(([name, q]) => [name, q.instructions, q.criteria]));
    }
    expect(p.sourceHashes[artifacts.ADAPTER_PATH]).toMatch(/^[a-f0-9]{64}$/);
    expect(p.mappingPolicy).toBeNull();
    expect(p.mappingPolicyHash).not.toBe(
      artifacts.makePlan(benchmark, { mappingPolicy: { minProbability: 0.7, minConfidence: 0.6, minMargin: 0.3 } })
        .mappingPolicyHash,
    );
  });
  it("has deterministic counterbalanced repetitions and no provider calls in plans", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(plan()).toEqual(plan());
    expect(plan().schedule.map(r => r.arm)).toEqual(["jev", "decisions", "decisions", "jev"]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { repetitions: 0 },
    { maxRequests: Infinity },
    { maxRequests: 0 },
    { timeoutMs: NaN },
    { caseIds: ["foreign"] },
    { caseIds: ["oct14-engram-final", "oct14-engram-final"] },
    { mappingPolicy: { minProbability: NaN, minConfidence: 0, minMargin: 0 } },
  ])("rejects unbounded or incompatible settings %j", settings => {
    expect(() => artifacts.makePlan(benchmark, settings)).toThrow();
  });
  it("rejects corrupt immutable bytes and baseline source drift", () => {
    const original = readFileSync("tests/fixtures/classifier-benchmark-v1/manifest.json", "utf8");
    expect(artifacts.sha256(original + "\n")).not.toBe(artifacts.MANIFEST_HASH);
    const fs = readFileSync;
    expect(artifacts.sha256(fs(artifacts.ADAPTER_PATH))).toBe(
      artifacts.sha256(execFileSync("git", ["show", `${artifacts.EXPECTED_PARENT}:${artifacts.ADAPTER_PATH}`])),
    );
    const changed = { ...plan(), corpusHash: "changed" };
    return expect(runComparison(benchmark, changed, { mode: "offline" })).rejects.toThrow("plan no longer matches");
  });
  it("fails the loader on modified manifest, corpus, adapter or production source bytes", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    for (const corrupted of [
      "tests/fixtures/classifier-benchmark-v1/manifest.json",
      "tests/fixtures/classifier-benchmark-v1/corpus.json",
      artifacts.ADAPTER_PATH,
      "lib/lesson-runtime/conversation-observer-contract.ts",
    ]) {
      vi.mocked(readFileSync).mockImplementation(((path: string, encoding?: BufferEncoding) =>
        path === corrupted
          ? Buffer.from("tampered")
          : encoding
            ? actual.readFileSync(path, encoding)
            : actual.readFileSync(path)) as typeof readFileSync);
      try {
        expect(() => artifacts.loadBenchmark()).toThrow();
      } finally {
        vi.mocked(readFileSync).mockImplementation(actual.readFileSync);
      }
    }
  });
  it("never promotes the existing six-case artifact or draft labels into run approval", () => {
    const path = "docs/issue-42-human-label-review-2026-10-15.json";
    // This user-owned file is intentionally untracked and need not exist on CI.
    let partial: unknown = {
      version: 1,
      corpusVersion: 1,
      providerRunsAllowed: false,
      remainingCaseCount: 65,
      cases: benchmark.cases
        .filter(c => c.row.id.startsWith("oct14-") && c.row.id.endsWith("-final"))
        .map(c => ({ caseId: c.row.id })),
    };
    if (existsSync(path)) {
      const bytes = readFileSync(path, "utf8");
      expect(artifacts.sha256(bytes)).toBe("d655a9ae604f61b4f709ebff3ea95f419afede84441199f9bb9b19f3b80bae2f");
      partial = JSON.parse(bytes);
    }
    expect(artifacts.reviewGate(benchmark, plan(), partial).ready).toBe(false);
    expect(artifacts.reviewGate(benchmark, plan(), undefined).ready).toBe(false);
    expect(benchmark.manifest.providerRunsAllowed).toBe(false);
  });
  it.each(["plan", "input", "labels", "groups", "authorization", "lock", "reviewer", "date", "missing", "duplicate"])(
    "blocks incomplete or incompatible review: %s",
    dimension => {
      const p = plan();
      const r = review(p);
      if (dimension === "plan") r.planHash = "wrong";
      if (dimension === "input") r.cases[0].inputSha256 = "wrong";
      if (dimension === "labels") r.cases[0].labels.concepts = {};
      if (dimension === "groups") r.grouping.approved = false as true;
      if (dimension === "authorization") r.authorization.maxRequests++;
      if (dimension === "lock") r.lockedBeforeProviderOutputs = false as true;
      if (dimension === "reviewer") r.reviewer = "";
      if (dimension === "date") r.reviewedAt = "unknown";
      if (dimension === "missing") r.cases = [];
      if (dimension === "duplicate") r.cases.push(r.cases[0]);
      expect(artifacts.reviewGate(benchmark, p, r).ready).toBe(false);
    },
  );
  it("can validate a separate exact run review while preserving frozen prohibition", () => {
    const p = plan();
    expect(artifacts.reviewGate(benchmark, p, review(p)).ready).toBe(true);
    expect(benchmark.manifest.providerRunsAllowed).toBe(false);
  });
  it("requires opt-in, explicit matching budget, review and exact review bytes before network", async () => {
    const b = cleanBenchmark();
    const p = artifacts.makePlan(b, options);
    const transport = vi.fn<Transport>(syntheticTransport());
    for (const override of [
      { execute: false },
      { explicitBudget: undefined },
      { explicitBudget: 999 },
      { review: undefined },
      { reviewHash: "0".repeat(64) },
      { reviewBytes: "{}" },
    ]) {
      await expect(runComparison(b, p, { ...networkFixture(p), ...override, transport })).rejects.toThrow();
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("runs deterministic offline mocks with no network, measurements or inferred reviewed dimensions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw Error("hidden fetch");
      }),
    );
    const p = plan();
    const now = () => 0;
    const a = await runComparison(benchmark, p, { mode: "offline", now });
    expect(a).toEqual(await runComparison(benchmark, p, { mode: "offline", now }));
    expect(a.requestCount).toBe(4);
    expect(a.summary.jev.observedProviderClassifications).toBe(0);
    expect(a.summary.jev.successfulProviderRequestLatencyMs.n).toBe(0);
    expect(a.results[0].semantic.concepts?.["concept_engram-biological"].demonstration).toBe("unscored");
    expect(a.results.every(r => r.kind === "synthetic_mock")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("exhausts a shared budget without retries or extra requests", async () => {
    const p = artifacts.makePlan(benchmark, { ...options, maxRequests: 1 });
    const transport = vi.fn<Transport>(syntheticTransport());
    const result = await runComparison(benchmark, p, { mode: "offline", transport });
    expect(transport).toHaveBeenCalledOnce();
    expect(result.requestCount).toBe(1);
    expect(result.results.slice(1).every(r => r.category === "budget_exhausted")).toBe(true);
  });
  it("locally abstains on sole-none source options without consuming a request", async () => {
    const row = benchmark.cases.find(c => c.decisions.questions.some(q => q.choices.length < 2))!;
    const p = artifacts.makePlan(benchmark, { caseIds: [row.row.id], maxRequests: 2 });
    const transport = vi.fn<Transport>(syntheticTransport());
    const result = await runComparison(benchmark, p, { mode: "offline", transport });
    const d = result.results.find(r => r.arm === "decisions")!;
    expect(d.category).toBe("locally_unsupported");
    expect(d.normalized).toBeNull();
    expect(d.measurement.requestCount).toBe(0);
    expect(result.requestCount).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("cancels before dispatch without consuming budget", async () => {
    const c = new AbortController();
    c.abort();
    const transport = vi.fn<Transport>(syntheticTransport());
    const r = await runComparison(benchmark, plan(), { mode: "offline", signal: c.signal, transport });
    expect(r.requestCount).toBe(0);
    expect(r.results.every(r => r.category === "cancelled")).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });
  it("cancels an in-flight transport ignoring abort and starts no later requests", async () => {
    const c = new AbortController();
    const transport = vi.fn<Transport>(async () => {
      c.abort();
      return new Promise(() => {});
    });
    const r = await runComparison(benchmark, plan(), { mode: "offline", signal: c.signal, transport });
    expect(r.requestCount).toBe(1);
    expect(r.results.every(r => r.category === "cancelled")).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("times out a hanging transport without retry and excludes it from valid observations", async () => {
    vi.useFakeTimers();
    const p = artifacts.makePlan(benchmark, { ...options, maxRequests: 1, timeoutMs: 20 });
    const transport = vi.fn<Transport>(() => new Promise(() => {}));
    const pending = runComparison(benchmark, p, { mode: "offline", transport });
    await vi.advanceTimersByTimeAsync(21);
    const r = await pending;
    expect(r.results[0].category).toBe("timeout");
    expect(r.results[0].normalized).toBeNull();
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each(["throw", "http", "refusal", "unreadable"])("categorizes %s safely and never retries", async kind => {
    const p = artifacts.makePlan(benchmark, { ...options, repetitions: 1 });
    const transport = vi.fn<Transport>(async (arm, request, signal) => {
      if (kind === "throw") throw Error("private provider body and credential");
      if (kind === "http") return { ok: false, body: "private" };
      if (kind === "unreadable") return { ok: true, body: { private: "do not retain" } };
      const response = await demonstrated()(arm, request, signal);
      if (arm === "decisions")
        (response.body as { answers: unknown[] }).answers = (
          request as { questions: { name: string }[] }
        ).questions.map(q => ({ name: q.name, type: "refusal" }));
      return response;
    });
    const r = await runComparison(benchmark, p, { mode: "offline", transport });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(r.results[1].category).toBe(kind === "refusal" ? "refusal" : "provider_error");
    expect(JSON.stringify(r)).not.toContain("private");
    expect(r.summary.decisions.observedProviderClassifications).toBe(0);
  });
  it("executes the unchanged production Jev adapter through the bounded transport and restores fetch", async () => {
    const b = cleanBenchmark();
    const p = artifacts.makePlan(b, { ...options, repetitions: 1 });
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-only");
    const original = vi.fn(() => {
      throw Error("unbudgeted network");
    });
    vi.stubGlobal("fetch", original);
    let time = 0;
    const transport = vi.fn<Transport>(demonstrated());
    const r = await runComparison(b, p, { ...networkFixture(p), transport, now: () => (time += 10) });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(original).not.toHaveBeenCalled();
    expect(fetch).toBe(original);
    expect(r.summary.jev.observedProviderClassifications).toBe(1);
    expect(r.results[1].mapped.reason).toBe("decisions_mapping_unconfigured");
    expect(r.pairedComparisons[0].rawChoicesEqual).toBe(true);
    expect(r.pairedComparisons[0].mappedProposalsEqual).toBeNull();
    expect(r.results[1].normalized).not.toBeNull();
    expect(r.results[1].measurement.usage?.inputTokens).toBe(42);
    expect(r.results[0].measurement.usage).toBeNull();
    expect(r.results[1].measurement.costUsd).toBeNull();
    expect(r.results[0].semantic.objectiveAggregate).toBe("unscored");
    expect(r.results[0].replay.proposalAccepted).toBe(true);
    expect(r.results[0].replay.evidence["engram:engram-biological"].source?.childMessageIndex).toBe(1);
    expect(r.results[0].replay.nodeId).toBe("engram");
    expect(r.results[0].replay.uiEvidence).toBeNull();
  });
  it("excludes fresh test-transport cancellation from successful observations", async () => {
    const b = cleanBenchmark();
    const p = artifacts.makePlan(b, options);
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-only");
    const c = new AbortController();
    const transport = vi.fn<Transport>(async () => {
      c.abort();
      return new Promise(() => {});
    });
    const r = await runComparison(b, p, { ...networkFixture(p), transport, signal: c.signal });
    expect(r.requestCount).toBe(1);
    expect(r.summary.jev.observedProviderClassifications).toBe(0);
    expect(r.summary.jev.allProviderAttemptLatencyMs.n).toBe(1);
    expect(r.summary.jev.successfulProviderRequestLatencyMs.n).toBe(0);
    expect(r.results.every(r => r.category === "cancelled")).toBe(true);
  });
  it("matches offline Jev normalization/mapping to the actual production adapter", async () => {
    const c = benchmark.cases.find(c => c.row.id === "oct14-engram-final")!;
    const response = await demonstrated()("jev", c.jev, new AbortController().signal);
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-only");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(response.body)),
    );
    const production = await executeConversationObserver(c.input, new AbortController().signal, c.jev);
    const r = await runComparison(benchmark, plan(), { mode: "offline", transport: demonstrated() });
    expect(r.results[0].normalized).toEqual(production.outputs);
    expect(r.results[0].mapped.proposal).toEqual(production.proposal);
  });
  it("keeps source provenance failure distinct from semantic and mapping disagreement", async () => {
    const transport: Transport = async (arm, req, signal) => {
      const response = await demonstrated()(arm, req, signal);
      if (arm === "decisions")
        for (const a of (
          response.body as {
            answers: { name: string; choice: string; probabilities: { value: string; probability: number }[] }[];
          }
        ).answers)
          if (a.name.startsWith("source_")) {
            a.choice = "none";
            a.probabilities = a.probabilities.map(p => ({ ...p, probability: p.value === "none" ? 1 : 0 }));
          }
      return response;
    };
    const p = artifacts.makePlan(benchmark, {
      ...options,
      mappingPolicy: { minConfidence: 0.8, minProbability: 0.8, minMargin: 0.5 },
    });
    const r = await runComparison(benchmark, p, { mode: "offline", transport, review: review(p) });
    expect(r.results[1].category).toBe("source_provenance_failure");
    expect(r.results[1].normalized).not.toBeNull();
    expect(r.results[1].semantic.concepts?.["concept_engram-biological"].learnerEvidence).toBe(
      "source_provenance_disagreement",
    );
    expect(r.results[1].replay.proposalAccepted).toBe(false);
  });
  it("rejects stale revision and unsupported source without fabricating transition/render/audio evidence", () => {
    const c = benchmark.cases.find(c => c.row.id === "oct14-engram-final")!;
    const proposal: ConversationStateProposal = {
      nodeId: c.input.nodeId,
      transcriptRevision: c.input.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "acknowledging",
      conceptObservations: [
        { criterionId: "engram-biological", observation: "demonstrated_independent", childMessageIndex: 1 },
      ],
    };
    const stale = replayReducer(c.input, proposal, true);
    expect(stale.rejection).toBe("stale_revision_rejected");
    expect(stale.evidence).toEqual({});
    const bad = replayReducer(c.input, {
      ...proposal,
      conceptObservations: [{ ...proposal.conceptObservations![0], childMessageIndex: 0 }],
    });
    expect(bad.evidence["engram:engram-biological"]?.source ?? null).toBeNull();
    expect(bad.uiEvidence).toBeNull();
    expect(bad.audioCompletion).toBeNull();
    expect(bad.nodeId).toBe(c.input.nodeId);
  });
  it("reports nearest-rank quantiles honestly for empty, single and small samples", () => {
    expect(latencySummary([])).toMatchObject({ n: 0, p50: null, p95: null, smallSample: true });
    expect(latencySummary([10])).toMatchObject({ n: 1, p50: 10, p95: 10, smallSample: true });
    expect(latencySummary([40, 10, 20, 30])).toMatchObject({ p50: 20, p95: 40 });
    expect(() => latencySummary([NaN])).toThrow();
    expect(aggregateResults([]).jev.observedProviderClassifications).toBe(0);
  });
});
