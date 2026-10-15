/** Node-only experiment tooling; never imported by application routes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { JEV_MODEL } from "../../jev";
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
import { FACTORED_VARIANT, FACTORED_MAPPING, factoredRequest, promptingRequest } from "./factored-decisions";
import { calibrationContext, validateLockedPolicy, type LockedPolicy } from "./decisions-calibration";
export { sha256, valueHash };
export const EXPECTED_PARENT = "1223826b3708627bbc5326ec249e05e3a827cf9c";
export const MANIFEST_HASH = "ceba27f934ad67b96c8ec0381f2e98156151660c5542c6cfdf3adc332e863c1c";
export const ADAPTER_PATH = "lib/experiments/issue-42/decisions-classifier.ts";
// Exact reviewed active-source exceptions; all frozen Git blobs are still checked.
// Other runtime files must continue matching v1 byte-for-byte.
export const ACTIVE_MODEL_COMPATIBILITY = {
  "lib/jev.ts": "733168e1333903a53eb891e9eb7800d20c3a397b30bf50a45ab19d9415b9f3a9",
  "lib/lesson-runtime/jev-conversation-state-classifier.ts":
    "c0ad13bb7f5202c625d9ae3ff2ebc55c39bce195de750db8adc8f8467f38ac9f",
};
// Exact recovery fix from 4b3c268; these orchestration modules are not executed
// by isolated reducer replay. Their frozen baseline Git blobs remain mandatory.
export const RECOVERY_SOURCE_COMPATIBILITY = {
  "lib/lesson-runtime/answer-recovery.ts": "4e3159932c3ad5beed9ed9786118910fac5d38ea1b8d725acbdb536729554a8c",
  "lib/lesson-runtime/lesson-runtime.ts": "b8e09c305de67b006d2fdb96934ba57e7717b4aa4a4fc49d42c38c99525385a4",
};
// Issue #71 changes the active lesson and terminal gate. Frozen v1 inputs stay historical.
export const SHORT_LESSON_COMPATIBILITY = {
  "lib/lesson-runtime/catching-unicorns-lesson.ts": "1923b45d800cad8d2c66336588289205d72a4acf17199559e88c573b099ab957",
  "lib/lesson-runtime/lesson-definition.ts": "f9d046c170ff620d249ab5380354da713c3d6cec1a70d6018b4cbb3b43999924",
  "lib/lesson-runtime/lesson-runtime-reducer.ts": "502bebd02e97bf8ff0185ca4c4dccb03756be6e91b90d7f68024aa092ea7fe3f",
  "lib/lesson-runtime/live-context.ts": "58890cb4f6a792e0d5d869830399aa316182c1171e534bc7b61fd321377710f5",
};
const toolPaths = [
  ADAPTER_PATH,
  "lib/experiments/issue-42/factored-decisions.ts",
  "lib/experiments/issue-42/decisions-calibration.ts",
  "tests/helpers/classifier-benchmark.ts",
  "lib/experiments/issue-42/benchmark-artifacts.ts",
  "lib/experiments/issue-42/provider-comparison.ts",
  "scripts/issue-42-provider-comparison.mjs",
  "scripts/issue-42-calibrate-decisions.mjs",
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
  assert.equal(JEV_MODEL, "jev-1.14.0", "unreviewed active model upgrade");
  assert.equal(manifest.jev.model, "jev-1.13.0", "historical Jev model must stay pinned");
  assert.equal(manifest.providerRunsAllowed, false, "frozen permission must remain false");
  for (const [path, hash] of Object.entries({ ...manifest.files, ...manifest.replaySources }))
    assert.equal(bytesHash(path), hash, `frozen file mismatch: ${path}`);
  for (const [path, hash] of Object.entries(manifest.baselineSources)) {
    const activeHash =
      ACTIVE_MODEL_COMPATIBILITY[path as keyof typeof ACTIVE_MODEL_COMPATIBILITY] ??
      RECOVERY_SOURCE_COMPATIBILITY[path as keyof typeof RECOVERY_SOURCE_COMPATIBILITY] ??
      SHORT_LESSON_COMPATIBILITY[path as keyof typeof SHORT_LESSON_COMPATIBILITY];
    assert.equal(bytesHash(path), activeHash ?? hash, `baseline incompatibility: ${path}`);
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
    activeRuntime: {
      model: JEV_MODEL,
      sourceHashes: { ...ACTIVE_MODEL_COMPATIBILITY },
      recoverySourceHashes: { ...RECOVERY_SOURCE_COMPATIBILITY },
      shortLessonSourceHashes: { ...SHORT_LESSON_COMPATIBILITY },
    },
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
export function factoredDesignHash(benchmark: Benchmark) {
  return valueHash({
    variant: FACTORED_VARIANT,
    requests: benchmark.cases.map(c => ({
      first: factoredRequest(c.input),
      promptingTemplate: promptingRequest(
        c.input,
        (c.input.lesson.nodes[c.input.nodeId].concepts ?? []).map(x => x.id),
      ),
    })),
  });
}
export type PlanOptions = {
  variant?: "direct-equivalent-v1" | typeof FACTORED_VARIANT;
  lockedPolicy?: LockedPolicy;
  caseIds?: string[];
  repetitions?: number;
  maxRequests?: number;
  timeoutMs?: number;
  mappingPolicy?: DecisionsMappingPolicy;
};
export function makePlan(benchmark: Benchmark, options: PlanOptions = {}) {
  const variant = options.variant ?? "direct-equivalent-v1";
  assert(["direct-equivalent-v1", FACTORED_VARIANT].includes(variant), "unknown design variant");
  assert(!options.lockedPolicy || (variant === FACTORED_VARIANT && !options.mappingPolicy), "policy/design conflict");
  if (options.lockedPolicy) validateLockedPolicy(options.lockedPolicy, calibrationContext(benchmark));
  if (options.lockedPolicy) {
    const rows = options.lockedPolicy.candidate.inputHashes;
    assert(new Set(rows.map(r => r.caseId)).size === rows.length, "duplicate fitting input");
    for (const row of rows) {
      const c = benchmark.cases.find(c => c.row.id === row.caseId);
      assert(
        c &&
          c.row.split === "calibration" &&
          c.hashes.inputSha256 === row.hash &&
          c.row.exchangeGroup === row.exchangeGroup,
        "policy fitting corpus mismatch",
      );
      assert(
        !benchmark.cases.some(other => other.row.split === "held_out" && other.row.exchangeGroup === row.exchangeGroup),
        "policy fitting group leakage",
      );
    }
  }
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
  const maxRequests =
    options.maxRequests ?? selectedCaseIds.length * repetitions * (variant === FACTORED_VARIANT ? 3 : 2);
  const timeoutMs = options.timeoutMs ?? 10_000;
  assert(Number.isSafeInteger(repetitions) && repetitions > 0 && repetitions <= 100, "invalid repetitions (1..100)");
  assert(
    Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 100_000,
    "invalid finite request budget (1..100000)",
  );
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000, "invalid timeout (1..300000ms)");
  const suppliedPolicy = options.lockedPolicy?.candidate.policy ?? options.mappingPolicy;
  const mappingPolicy = suppliedPolicy ? structuredClone(suppliedPolicy) : null;
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
    version: variant === FACTORED_VARIANT ? 2 : 1,
    ...(variant === FACTORED_VARIANT
      ? {
          variant,
          designHash: factoredDesignHash(benchmark),
          mappingVersion: FACTORED_MAPPING,
          lockedPolicy: options.lockedPolicy ? structuredClone(options.lockedPolicy) : null,
          conditionalRequests:
            "One demonstration request; at most one prompting request for confident demonstrated concepts with valid learner sources. No policy means raw first stage only.",
        }
      : {}),
    baselineCommit: benchmark.manifest.baselineSha,
    implementationBaseline: EXPECTED_PARENT,
    activeRuntime: benchmark.activeRuntime,
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
        decisionsRequestHash: valueHash(variant === FACTORED_VARIANT ? factoredRequest(c.input) : c.decisions),
        ...(variant === FACTORED_VARIANT
          ? {
              promptingTemplateHash: valueHash(
                promptingRequest(
                  c.input,
                  (c.input.lesson.nodes[c.input.nodeId].concepts ?? []).map(x => x.id),
                ),
              ),
            }
          : {}),
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
      decisions:
        variant === FACTORED_VARIANT
          ? {
              version: FACTORED_MAPPING,
              implementationHash: benchmark.sourceHashes["lib/experiments/issue-42/factored-decisions.ts"],
              policy: mappingPolicy,
            }
          : mappingPolicy,
    }),
    providers: {
      jev: { model: benchmark.manifest.jev.model, endpoint: benchmark.manifest.jev.endpoint },
      decisions: { model: "gpt-6-luna", endpoint: "https://api.openai.com/v1/decisions" },
    },
    modelPinning:
      "Exact returned identifiers checked; no immutable weight pin guaranteed behind either provider identifier.",
    differences:
      variant === FACTORED_VARIANT
        ? [
            "Same frozen speaker-labelled inputs and authored criteria; changed factored question design on Decisions only. Jev remains direct 1.13.",
            "Factored raw states are not equivalent direct Choices. Partial/incorrect/not_attempted remain distinct diagnostics; incorrect/not_attempted map to not_yet only at the proposal boundary.",
            "Policy gates conditional prompting dispatch and mapping; policy changes can change requests. No cross-policy equivalence or provider-only causal claim.",
          ]
        : [
            "Identical underlying evidence/questions; Jev object state and criteria maps become Decisions shared JSON text and named choice arrays.",
            "Jev production mapping vs explicit uncalibrated Decisions policy, or Decisions raw-only. No factored questions.",
          ],
  };
  return { ...core, planHash: valueHash(core) };
}
export type Plan = ReturnType<typeof makePlan>;
export type RunReview = {
  version: 1 | 2;
  variant?: typeof FACTORED_VARIANT;
  designHash?: string;
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
    assert(
      r && r.version === plan.version && r.kind === "issue-42-authorized-run",
      "separate authorized run review required",
    );
    if (plan.version === 2) {
      assert(r.variant === FACTORED_VARIANT && r.designHash === plan.designHash, "variant review mismatch");
    } else assert(!r.variant && !r.designHash, "direct review mismatch");
    if (plan.selectedCaseIds.some(id => benchmark.cases.find(c => c.row.id === id)!.row.split === "held_out"))
      assert(
        plan.version === 2 && plan.lockedPolicy,
        "held-out provider evaluation requires variant-compatible locked calibration policy; direct held-out fitting is not implemented",
      );
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
            plan.version === 2
              ? [
                  ...factoredRequest(c.input)!.questions,
                  ...promptingRequest(
                    c.input,
                    (c.input.lesson.nodes[c.input.nodeId].concepts ?? []).map(x => x.id),
                  ).questions,
                ].some(q => q.name === name && q.choices.some(v => v.value === choice))
              : Object.hasOwn(c.jev.questions, name) && Object.hasOwn(c.jev.questions[name].criteria, choice),
            "invalid reviewed Choice",
          );
    }
    return { ready: true, reason: null };
  } catch {
    // Do not echo arbitrary review file contents through assertion errors.
    return { ready: false, reason: "missing_or_incompatible_hash_bound_label_grouping_and_run_authorization" };
  }
}
