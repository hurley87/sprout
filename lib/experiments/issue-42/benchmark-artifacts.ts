/** Node-only experiment tooling; never imported by application routes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { LessonDefinition } from "../../lesson-runtime/lesson-definition";
import {
  conversationObserverState,
  conversationStateQuestions,
} from "../../lesson-runtime/conversation-observer-contract";
import { decisionsRequest, type DecisionsMappingPolicy } from "./decisions-classifier";
import {
  benchmarkDirectory as dir,
  sha256,
  valueHash,
  validateBenchmarkCorpus,
  type BenchmarkCase,
} from "../../../tests/helpers/classifier-benchmark";
export { sha256, valueHash };
export const EXPECTED_PARENT = "1223826b3708627bbc5326ec249e05e3a827cf9c";
export const MANIFEST_HASH = "ceba27f934ad67b96c8ec0381f2e98156151660c5542c6cfdf3adc332e863c1c";
export const ADAPTER_PATH = "lib/experiments/issue-42/decisions-classifier.ts";
const toolPaths = [
  ADAPTER_PATH,
  "tests/helpers/classifier-benchmark.ts",
  "lib/experiments/issue-42/benchmark-artifacts.ts",
  "lib/experiments/issue-42/provider-comparison.ts",
  "scripts/issue-42-provider-comparison.mjs",
];
export const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const bytesHash = (path: string) => sha256(readFileSync(path));

export function loadBenchmark() {
  assert.equal(bytesHash(dir + "manifest.json"), MANIFEST_HASH, "immutable manifest mismatch");
  assert.equal(readFileSync(dir + "manifest.sha256", "utf8").trim(), MANIFEST_HASH);
  const manifest = JSON.parse(readFileSync(dir + "manifest.json", "utf8")) as {
    baselineSha: string;
    providerRunsAllowed: false;
    files: Record<string, string>;
    baselineSources: Record<string, string>;
    replaySources: Record<string, string>;
    historicalCounting: { gitRef: string; path: string; sha256: string };
    cases: { id: string; inputSha256: string; questionsSha256: string; projectionSha256: string }[];
    jev: { model: "jev-1.13.0"; endpoint: string };
  };
  assert.equal(manifest.providerRunsAllowed, false, "frozen permission must remain false");
  for (const [path, hash] of Object.entries({ ...manifest.files, ...manifest.replaySources }))
    assert.equal(bytesHash(path), hash, `frozen file mismatch: ${path}`);
  for (const [path, hash] of Object.entries(manifest.baselineSources)) {
    assert.equal(bytesHash(path), hash, `baseline incompatibility: ${path}`);
    assert.equal(
      sha256(execFileSync("git", ["show", `${manifest.baselineSha}:${path}`])),
      hash,
      "baseline object mismatch",
    );
  }
  const old = manifest.historicalCounting;
  assert.equal(sha256(execFileSync("git", ["show", `${old.gitRef}:${old.path}`])), old.sha256);
  assert.equal(
    git("merge-base", EXPECTED_PARENT, "HEAD"),
    EXPECTED_PARENT,
    "expected implementation baseline is not an ancestor",
  );
  // Commit 2's adapter is also a compatibility boundary, independent of the v1 manifest.
  assert.equal(
    bytesHash(ADAPTER_PATH),
    sha256(execFileSync("git", ["show", `${EXPECTED_PARENT}:${ADAPTER_PATH}`])),
    "Decisions adapter drift",
  );
  const lessons = JSON.parse(readFileSync(dir + "lessons.json", "utf8")) as LessonDefinition[];
  const corpus: unknown = JSON.parse(readFileSync(dir + "corpus.json", "utf8"));
  validateBenchmarkCorpus(corpus, lessons);
  assert.equal(corpus.cases.length, manifest.cases.length);
  const cases = corpus.cases.map((row, index) => {
    const input = {
      lesson: lessons.find(l => l.id === row.input.lessonId)!,
      nodeId: row.input.nodeId,
      transcriptRevision: row.input.transcriptRevision,
      transcript: row.input.transcript,
    };
    const questions = conversationStateQuestions(input.lesson, input.nodeId, input.transcript);
    const state = conversationObserverState(input);
    const hashes = {
      id: row.id,
      inputSha256: valueHash(row.input),
      questionsSha256: valueHash(questions),
      projectionSha256: valueHash(state),
    };
    assert.deepEqual(hashes, manifest.cases[index], "frozen input/contract mismatch");
    const decisions = decisionsRequest(input)!;
    assert.deepEqual(JSON.parse(decisions.input), state, "arm evidence differs");
    assert.deepEqual(
      decisions.questions,
      Object.entries(questions).map(([name, q]) => ({
        type: q.type,
        name,
        instructions: q.instructions,
        choices: Object.entries(q.criteria).map(([value, description]) => ({ value, description })),
      })),
      "arm questions differ",
    );
    return { row, input, hashes, jev: { model: manifest.jev.model, state, questions }, decisions };
  });
  return {
    manifest,
    lessons,
    cases,
    corpusHash: bytesHash(dir + "corpus.json"),
    lessonsHash: bytesHash(dir + "lessons.json"),
    sourceHashes: Object.fromEntries(toolPaths.map(path => [path, bytesHash(path)])),
    executingCommit: git("rev-parse", "HEAD"),
    executingParent: git("rev-parse", "HEAD^"),
    workingTreeDirty:
      git("status", "--porcelain", "--untracked-files=no") !== "" ||
      toolPaths.some(path => {
        try {
          return (
            bytesHash(path) !==
            sha256(execFileSync("git", ["show", `HEAD:${path}`], { stdio: ["ignore", "pipe", "pipe"] }))
          );
        } catch {
          return true;
        }
      }),
  };
}
export type Benchmark = ReturnType<typeof loadBenchmark>;
export type Arm = "jev" | "decisions";
export type PlanOptions = {
  caseIds?: string[];
  repetitions?: number;
  maxRequests?: number;
  timeoutMs?: number;
  mappingPolicy?: DecisionsMappingPolicy;
};
export function makePlan(benchmark: Benchmark, options: PlanOptions = {}) {
  const selectedCaseIds = options.caseIds ?? benchmark.cases.map(c => c.row.id);
  assert(
    selectedCaseIds.length > 0 && new Set(selectedCaseIds).size === selectedCaseIds.length,
    "empty/duplicate selection",
  );
  assert(
    selectedCaseIds.every(id => benchmark.cases.some(c => c.row.id === id)),
    "unknown case",
  );
  const repetitions = options.repetitions ?? 1;
  const maxRequests = options.maxRequests ?? selectedCaseIds.length * repetitions * 2;
  const timeoutMs = options.timeoutMs ?? 10_000;
  assert(Number.isSafeInteger(repetitions) && repetitions > 0 && repetitions <= 100, "invalid repetitions (1..100)");
  assert(
    Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 100_000,
    "invalid finite request budget (1..100000)",
  );
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000, "invalid timeout (1..300000ms)");
  const mappingPolicy = options.mappingPolicy ? structuredClone(options.mappingPolicy) : null;
  if (mappingPolicy)
    assert(
      Object.keys(mappingPolicy).sort().join() === "minConfidence,minMargin,minProbability" &&
        Object.values(mappingPolicy).every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1),
      "invalid experimental policy",
    );
  const schedule = selectedCaseIds
    .flatMap((caseId, index) =>
      Array.from({ length: repetitions }, (_, repetition) =>
        ((index + repetition) % 2 ? ["decisions", "jev"] : ["jev", "decisions"]).map(arm => ({
          id: `${caseId}:${repetition + 1}:${arm}`,
          caseId,
          repetition: repetition + 1,
          arm: arm as Arm,
        })),
      ),
    )
    .flat();
  const core = {
    version: 1,
    baselineCommit: benchmark.manifest.baselineSha,
    implementationBaseline: EXPECTED_PARENT,
    executingCommit: benchmark.executingCommit,
    executingParent: benchmark.executingParent,
    workingTreeDirty: benchmark.workingTreeDirty,
    manifestHash: MANIFEST_HASH,
    corpusHash: benchmark.corpusHash,
    lessonsHash: benchmark.lessonsHash,
    sourceHashes: benchmark.sourceHashes,
    groupingHash: valueHash(
      benchmark.cases.map(c => ({ caseId: c.row.id, exchangeGroup: c.row.exchangeGroup, split: c.row.split })),
    ),
    selectedCaseIds,
    repetitions,
    maxRequests,
    timeoutMs,
    schedule,
    cases: selectedCaseIds.map(id => {
      const c = benchmark.cases.find(c => c.row.id === id)!;
      return {
        ...c.hashes,
        jevRequestHash: valueHash(c.jev),
        decisionsRequestHash: valueHash(c.decisions),
        decisionsUnsupported: c.decisions.questions.some(q => q.choices.length < 2)
          ? "learner_source_unavailable"
          : c.decisions.questions.length > 200 || c.decisions.questions.some(q => q.choices.length > 255)
            ? "decisions_request_limits"
            : null,
      };
    }),
    mappingPolicy,
    mappingPolicyHash: valueHash({
      jev: benchmark.manifest.baselineSources["lib/lesson-runtime/conversation-observer-contract.ts"],
      decisions: mappingPolicy,
    }),
    providers: {
      jev: { model: benchmark.manifest.jev.model, endpoint: benchmark.manifest.jev.endpoint },
      decisions: { model: "gpt-6-luna", endpoint: "https://api.openai.com/v1/decisions" },
    },
    modelPinning:
      "Exact returned identifiers checked; no immutable weight pin guaranteed behind either provider identifier.",
    differences: [
      "Identical underlying evidence/questions; Jev object state and criteria maps become Decisions shared JSON text and named choice arrays.",
      "Jev production mapping vs explicit uncalibrated Decisions policy, or Decisions raw-only. No factored questions.",
    ],
  };
  return { ...core, planHash: valueHash(core) };
}
export type Plan = ReturnType<typeof makePlan>;
export type RunReview = {
  version: 1;
  kind: "issue-42-authorized-run";
  planHash: string;
  reviewer: string;
  reviewedAt: string;
  authorization: { reference: string; providerExecution: true; maxRequests: number };
  lockedBeforeProviderOutputs: true;
  grouping: { hash: string; approved: true };
  cases: {
    caseId: string;
    inputSha256: string;
    labels: Omit<BenchmarkCase["expected"], "reviewStatus">;
    choices?: Record<string, string>;
  }[];
};
/** A separate human artifact may authorize this exact run; never mutates v1 permission. */
export function reviewGate(
  benchmark: Benchmark,
  plan: Plan,
  review: unknown,
): { ready: boolean; reason: string | null } {
  try {
    const r = review as RunReview;
    assert(r && r.version === 1 && r.kind === "issue-42-authorized-run", "separate authorized run review required");
    assert.equal(r.planHash, plan.planHash, "review plan hash mismatch");
    assert(
      typeof r.reviewer === "string" &&
        r.reviewer.trim().length > 0 &&
        typeof r.reviewedAt === "string" &&
        Number.isFinite(Date.parse(r.reviewedAt)),
      "reviewer/date required",
    );
    assert(
      r.lockedBeforeProviderOutputs === true &&
        r.authorization?.providerExecution === true &&
        typeof r.authorization.reference === "string" &&
        r.authorization.reference.trim() &&
        r.authorization.maxRequests === plan.maxRequests,
      "explicit bounded authorization required",
    );
    assert(r.grouping?.approved === true && r.grouping.hash === plan.groupingHash, "grouping/split review required");
    assert(
      Array.isArray(r.cases) &&
        r.cases.length === plan.selectedCaseIds.length &&
        new Set(r.cases.map(c => c.caseId)).size === r.cases.length,
      "every selected label must be reviewed exactly once",
    );
    for (const id of plan.selectedCaseIds) {
      const c = benchmark.cases.find(c => c.row.id === id)!;
      const reviewed = r.cases.find(row => row.caseId === id);
      assert(reviewed && reviewed.inputSha256 === c.hashes.inputSha256, "review input mismatch");
      assert.deepEqual(
        Object.keys(reviewed.labels).sort(),
        ["concepts", "objective"],
        "review labels must be explicit semantic dimensions only",
      );
      // The closed corpus validator validates every semantic dimension, authored criterion and source index.
      validateBenchmarkCorpus(
        { version: 1, cases: [{ ...c.row, expected: { ...reviewed.labels, reviewStatus: "draft_agent" } }] },
        benchmark.lessons,
      );
      if (reviewed.choices)
        for (const [name, choice] of Object.entries(reviewed.choices))
          assert(
            Object.hasOwn(c.jev.questions, name) && Object.hasOwn(c.jev.questions[name].criteria, choice),
            "invalid reviewed Choice",
          );
    }
    return { ready: true, reason: null };
  } catch {
    // Do not echo arbitrary review file contents through assertion errors.
    return { ready: false, reason: "missing_or_incompatible_hash_bound_label_grouping_and_run_authorization" };
  }
}
