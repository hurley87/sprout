/** Server/harness-only evaluation. Normal tests never opt into live execution. */
import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";
import { ACK_DEADLINE_MS, ACK_MODEL, ACK_THRESHOLD, grokOnlyAcknowledges, type AckInput } from "./acknowledgment";
import { formatExpectedCountingAnswer } from "./expected-answer";
import { evaluateAcknowledgment } from "./jev-acknowledgment";
export type ExpectedLabel = "positive" | "negative" | "ambiguous";
export type BenchmarkCase = {
  id: string;
  nodeId: string;
  learner: string;
  tutor: string;
  expectedLabel: ExpectedLabel;
  rationale: string;
  eligible: boolean;
};
export type BenchmarkRow = BenchmarkCase & {
  expectedAnswer: string;
  probability: number | null;
  decision: "acknowledging" | "abstain" | "not-eligible";
  reason: string;
  modelValidated: boolean;
  latencyMs: number | null;
  attempted: boolean;
  grokOnlyAcknowledges: boolean | null;
};
export function validateBenchmarkCases(value: unknown): BenchmarkCase[] {
  if (!Array.isArray(value) || !value.length || value.length > 40) throw new Error("Expected 1–40 cases");
  const ids = new Set<string>();
  for (const row of value) {
    if (
      !row ||
      typeof row !== "object" ||
      Object.keys(row).sort().join(",") !== "eligible,expectedLabel,id,learner,nodeId,rationale,tutor" ||
      !["id", "nodeId", "learner", "tutor", "rationale"].every(
        key => typeof row[key] === "string" && row[key].length <= 2000,
      ) ||
      !/^[a-z0-9-]{1,80}$/.test(row.id) ||
      ids.has(row.id) ||
      !["positive", "negative", "ambiguous"].includes(row.expectedLabel) ||
      typeof row.eligible !== "boolean" ||
      !row.tutor.trim() ||
      !row.rationale.trim() ||
      (row.eligible && !row.learner.trim()) ||
      (!row.eligible && (row.learner !== "" || row.expectedLabel !== "negative"))
    )
      throw new Error("Invalid benchmark case");
    const node = COUNTING_LESSON.nodes[row.nodeId]?.presentation;
    if (!node) throw new Error("Unknown authored node");
    formatExpectedCountingAnswer(node);
    ids.add(row.id);
  }
  return value.map(row => ({ ...row }));
}
export function thresholdDecision(probability: number | null, threshold: number): "positive" | "negative" | "abstain" {
  if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold >= 1) throw new Error("Invalid threshold");
  if (probability === null || !Number.isFinite(probability) || probability < 0 || probability > 1) return "abstain";
  if (probability >= threshold) return "positive";
  if (1 - probability >= threshold) return "negative";
  return "abstain";
}
export function summarizeAcknowledgments(rows: readonly BenchmarkRow[], threshold = ACK_THRESHOLD) {
  const evaluated = rows.filter(row => row.eligible && row.attempted);
  const definitive = evaluated.filter(row => row.expectedLabel !== "ambiguous");
  const semantic = (row: BenchmarkRow) => thresholdDecision(row.modelValidated ? row.probability : null, threshold);
  const correct = definitive.filter(row => semantic(row) === row.expectedLabel).length;
  const answered = definitive.filter(row => semantic(row) !== "abstain").length;
  const latencies = evaluated.flatMap(row => (row.latencyMs === null ? [] : [row.latencyMs])).sort((a, b) => a - b);
  const n = latencies.length;
  return {
    threshold,
    eligibleCases: rows.filter(row => row.eligible).length,
    attempted: evaluated.length,
    validProbabilities: evaluated.filter(row => row.modelValidated && row.probability !== null).length,
    providerFailures: evaluated.filter(row => !row.modelValidated || row.probability === null).length,
    definitiveExamples: definitive.length,
    definitiveCorrect: correct,
    definitiveAccuracy: definitive.length ? correct / definitive.length : null,
    selectiveAccuracy: answered ? correct / answered : null,
    falsePositives: evaluated.filter(row => row.expectedLabel === "negative" && semantic(row) === "positive").length,
    // Operationally every withheld correct confirmation is a missed positive, including abstentions/failures.
    falseNegatives: evaluated.filter(row => row.expectedLabel === "positive" && semantic(row) !== "positive").length,
    explicitFalseNegatives: evaluated.filter(row => row.expectedLabel === "positive" && semantic(row) === "negative")
      .length,
    ambiguousAccepted: evaluated.filter(row => row.expectedLabel === "ambiguous" && semantic(row) === "positive")
      .length,
    ambiguousAbstained: evaluated.filter(row => row.expectedLabel === "ambiguous" && semantic(row) === "abstain")
      .length,
    abstentions: evaluated.filter(row => semantic(row) === "abstain").length,
    abstentionRate: evaluated.length
      ? evaluated.filter(row => semantic(row) === "abstain").length / evaluated.length
      : null,
    gateWithheld: evaluated.filter(row => semantic(row) !== "positive").length,
    latency: {
      sampleSize: n,
      medianMs: n ? (latencies[Math.floor((n - 1) / 2)] + latencies[Math.floor(n / 2)]) / 2 : null,
      p95Ms: n ? latencies[Math.ceil(0.95 * n) - 1] : null,
    },
  };
}
export async function runAcknowledgmentBenchmark(
  cases: readonly BenchmarkCase[],
  options: {
    execute: boolean;
    maxRequests: number;
    credentialsAvailable: boolean;
  },
  evaluate = evaluateAcknowledgment,
) {
  validateBenchmarkCases(cases);
  const eligible = cases.filter(row => row.eligible).length;
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < eligible || options.maxRequests > 40)
    throw new Error("Request cap must cover the fixed dataset and cannot exceed 40");
  const rows: BenchmarkRow[] = [];
  for (const item of cases) {
    const scene = COUNTING_LESSON.nodes[item.nodeId].presentation;
    const base: BenchmarkRow = {
      ...item,
      expectedAnswer: formatExpectedCountingAnswer(scene),
      probability: null,
      decision: item.eligible ? "abstain" : "not-eligible",
      reason: !item.eligible ? "no-validated-learner" : !options.execute ? "not-executed" : "unconfigured",
      modelValidated: false,
      latencyMs: null,
      attempted: false,
      grokOnlyAcknowledges: item.eligible ? grokOnlyAcknowledges(item.tutor, scene) : null,
    };
    if (!options.execute || !options.credentialsAvailable || !item.eligible) {
      rows.push(base);
      continue;
    }
    const controller = new AbortController();
    const started = performance.now();
    const input: AckInput = {
      requestId: crypto.randomUUID(),
      nodeId: item.nodeId,
      expectedAnswer: base.expectedAnswer,
      learner: item.learner,
      tutor: item.tutor,
    };
    let timer: ReturnType<typeof setTimeout>;
    let timedOut = false;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("timeout"));
      }, ACK_DEADLINE_MS);
    });
    try {
      const result = await Promise.race([evaluate(input, controller.signal), deadline]);
      const p = result.probability;
      const valid =
        result.decision.requestId === input.requestId &&
        result.decision.modelValidated &&
        typeof p === "number" &&
        Number.isFinite(p) &&
        p >= 0 &&
        p <= 1;
      rows.push({
        ...base,
        attempted: true,
        probability: valid ? p : null,
        decision: valid && p >= ACK_THRESHOLD ? "acknowledging" : "abstain",
        reason: result.decision.reason,
        modelValidated: result.decision.modelValidated && result.decision.requestId === input.requestId,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch {
      rows.push({
        ...base,
        attempted: true,
        reason: timedOut ? "timeout" : "unreachable",
        latencyMs: Math.round(performance.now() - started),
      });
    } finally {
      clearTimeout(timer!);
    }
  }
  return {
    version: 1,
    model: ACK_MODEL,
    productionThreshold: ACK_THRESHOLD,
    deadlineMs: ACK_DEADLINE_MS,
    status: !options.execute ? "not-executed" : !options.credentialsAvailable ? "credentials-unavailable" : "collected",
    plannedProviderRequests: eligible,
    providerAttempts: rows.filter(row => row.attempted).length,
    paidRetries: 0,
    metricDefinitions: {
      definitiveAccuracy:
        "Correct positive/negative semantic decisions divided by all attempted definitive examples; abstentions and failures count as unresolved, not correct.",
      falseNegatives:
        "Expected positives not accepted, including abstention and failure; explicitFalseNegatives counts negative semantic decisions only.",
      abstentions:
        "Neither positive (p >= threshold) nor confident negative (p <= 1-threshold), or provider failure. Production also withholds confident negatives.",
      p95: "Nearest rank across all attempted requests, including failures/timeouts; n is small and not a population tail estimate.",
    },
    thresholds: [0.9, 0.95, 0.99].map(threshold => summarizeAcknowledgments(rows, threshold)),
    rows,
    october18Demo: rows.find(row => row.id === "oct18-demo") ?? null,
    limitations:
      "Single authored synthetic text sample per case; labels are developer judgments, not independent human adjudication. No billing evidence or accuracy confidence interval. Alternatives reuse exactly the same probabilities. Ineligible case tests the application precondition and makes no provider call.",
  };
}
