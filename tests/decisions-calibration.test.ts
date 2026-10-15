import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  loadBenchmark,
  makePlan,
  valueHash,
  reviewGate,
  type RunReview,
} from "../lib/experiments/issue-42/benchmark-artifacts";
import { createFactoredClassifier } from "../lib/experiments/issue-42/factored-decisions";
import {
  calibrationContext,
  fitDecisionsPolicy,
  validateLockedPolicy,
  writeFrozenCandidate,
  type CalibrationData,
  type CalibrationReview,
  type LockedPolicy,
} from "../lib/experiments/issue-42/decisions-calibration";
import { runComparison } from "../lib/experiments/issue-42/provider-comparison";
import { body, policy } from "./helpers/factored-controls";
const b = loadBenchmark();
afterEach(() => vi.restoreAllMocks());
// Every observation and reviewer below is an in-memory mechanical fixture. They are
// never exported as real review/observation files and establish no empirical calibration.
async function fixture() {
  const c = b.cases.find(c => c.row.id === "oct14-engram-final")!;
  const r = await createFactoredClassifier({
    mappingPolicy: policy,
    transport: async req => ({ ok: true, body: body(req) }),
  }).classifyWithDiagnostics(c.input, new AbortController().signal);
  const data: CalibrationData = {
    version: 1,
    kind: "issue-42-calibration-observations",
    context: calibrationContext(b),
    observations: [
      {
        caseId: c.row.id,
        inputHash: c.hashes.inputSha256,
        exchangeGroup: c.row.exchangeGroup,
        split: "calibration",
        kind: "fresh_provider_measurement",
        returnedModel: "gpt-6-luna",
        dispatchPolicy: policy,
        raw: r.factored!,
      },
    ],
  };
  const labels = structuredClone({ objective: c.row.expected.objective, concepts: c.row.expected.concepts });
  const review: CalibrationReview = {
    version: 1,
    kind: "issue-42-independent-calibration-review",
    context: calibrationContext(b),
    reviewer: "synthetic test reviewer",
    reviewedAt: "2026-10-15T12:00:00Z",
    independentHumanLabels: true,
    groupingApproved: true,
    cases: [{ caseId: c.row.id, inputSha256: c.hashes.inputSha256, labels }],
  };
  return { data, review, c };
}
async function candidate() {
  const { data, review } = await fixture();
  const r = fitDecisionsPolicy(b, data, review, [policy]);
  if (r.status !== "candidate_available") throw new Error("fixture unavailable");
  return r.candidate;
}
async function lock(): Promise<LockedPolicy> {
  const core = {
    version: 1 as const,
    kind: "issue-42-locked-policy" as const,
    candidate: await candidate(),
    reviewer: "synthetic lock reviewer",
    reviewedAt: "2026-10-15T13:00:00Z",
    authorizationReference: "test-only",
    lockedBeforeHeldOut: true as const,
  };
  return { ...core, lockHash: valueHash(core) };
}
it("missing observations or review reports calibration unavailable with no inherited Jev settings", async () => {
  expect(fitDecisionsPolicy(b)).toMatchObject({ status: "calibration_unavailable" });
  const { data } = await fixture();
  expect(fitDecisionsPolicy(b, data)).toMatchObject({ status: "calibration_unavailable" });
});
it("freezes deterministic candidate identities, separate probability/confidence gates and explicit objective", async () => {
  const { data, review } = await fixture();
  const grid = [policy, { minProbability: 1, minConfidence: 1, minMargin: 1 }];
  const a = fitDecisionsPolicy(b, data, review, grid);
  expect(a).toEqual(fitDecisionsPolicy(b, data, review, grid));
  if (a.status !== "candidate_available") throw new Error("fixture unavailable");
  expect(a.candidate).toMatchObject({
    context: { model: "gpt-6-luna", variant: "factored-concepts-v1" },
    observationHash: valueHash(data),
    reviewHash: valueHash(review),
    candidateGridHash: valueHash(grid),
  });
  expect(a.candidate.inputHashes.every(r => r.split === "calibration")).toBe(true);
  expect(a.candidate.fitting.selection).toContain("false mastery");
  expect(a.candidate.policy).toEqual(policy);
});
it("prioritizes false mastery over coverage", async () => {
  const { data, review } = await fixture();
  for (const label of Object.values(review.cases[0].labels.concepts)) {
    label.demonstration = "no_demonstration";
    label.attribution = "not_applicable";
  }
  const strict = { minProbability: 1, minConfidence: 1, minMargin: 1 };
  const r = fitDecisionsPolicy(b, data, review, [policy, strict]);
  expect(r.status === "candidate_available" && r.candidate.policy).toEqual(strict);
  expect(r.status === "candidate_available" && r.candidate.evidence).toMatchObject({ falseMastery: 0, abstentions: 1 });
});
it.each([
  "synthetic",
  "held_out",
  "group",
  "corpus",
  "variant",
  "model",
  "input",
  "source",
  "review",
  "grouping",
  "extra-prompting",
])("rejects %s contamination instead of selecting thresholds", async bad => {
  const { data, review } = await fixture();
  const o = data.observations[0];
  if (bad === "synthetic") o.kind = "synthetic_mock";
  if (bad === "held_out") o.split = "held_out";
  if (bad === "group") o.exchangeGroup = b.cases.find(c => c.row.split === "held_out")!.row.exchangeGroup;
  if (bad === "corpus") data.context.corpusHash = "foreign";
  if (bad === "variant") data.context.variant = "direct-equivalent-v1" as never;
  if (bad === "model") o.returnedModel = "gpt-6-other";
  if (bad === "input") o.inputHash = "foreign";
  if (bad === "source") Object.values(o.raw.sources)[0].choice = "message_999999";
  if (bad === "review") review.independentHumanLabels = false as never;
  if (bad === "grouping") review.groupingApproved = false as never;
  if (bad === "extra-prompting") o.raw.prompting.prompting_foreign = Object.values(o.raw.prompting)[0];
  expect(() => fitDecisionsPolicy(b, data, review, [policy])).toThrow();
});
it("rejects held-out records and related-group leakage even if supplied as calibration", async () => {
  const { data, review, c } = await fixture();
  const contaminated = structuredClone(b);
  contaminated.cases.find(row => row.row.split === "held_out")!.row.exchangeGroup = c.row.exchangeGroup;
  data.context = review.context = calibrationContext(contaminated);
  expect(() => fitDecisionsPolicy(contaminated, data, review, [policy])).toThrow(/leakage/);
});
it("exclusive freeze refuses overwrite and locks bind policy/corpus/design/model", async () => {
  const a = await candidate();
  const dir = mkdtempSync(join(tmpdir(), "sprout-mechanical-policy-"));
  try {
    const path = join(dir, "candidate.json");
    writeFrozenCandidate(path, a);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(a);
    expect(() => writeFrozenCandidate(path, a)).toThrow();
    expect(() =>
      writeFrozenCandidate(join(dir, "bad.json"), { ...a, policy: { ...policy, minConfidence: 0 } }),
    ).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const l = await lock();
  expect(() => validateLockedPolicy(l, calibrationContext(b))).not.toThrow();
  for (const field of ["corpusHash", "designHash", "model", "variant", "groupingHash"] as const)
    expect(() => validateLockedPolicy(l, { ...calibrationContext(b), [field]: "foreign" })).toThrow();
  l.candidate.policy.minProbability = 0;
  expect(() => validateLockedPolicy(l, calibrationContext(b))).toThrow();
});
it("v2 plans bind variant/request/design/policy and invalidate v1 run reviews", async () => {
  const direct = makePlan(b, { caseIds: ["oct14-engram-final"] });
  const factored = makePlan(b, {
    variant: "factored-concepts-v1",
    caseIds: direct.selectedCaseIds,
    mappingPolicy: policy,
  });
  expect(direct.version).toBe(1);
  expect(factored.version).toBe(2);
  expect(factored.designHash).toMatch(/^[a-f0-9]{64}$/);
  expect(factored.cases[0].decisionsRequestHash).not.toBe(direct.cases[0].decisionsRequestHash);
  expect(factored.mappingPolicyHash).not.toBe(direct.mappingPolicyHash);
  expect(factored.providers.jev.model).toBe("jev-1.13.0");
  expect(factored.activeRuntime.model).toBe("jev-1.14.0");
  expect(
    reviewGate(b, factored, { version: 1, kind: "issue-42-authorized-run", planHash: factored.planHash }).ready,
  ).toBe(false);
  expect(() => makePlan(b, { variant: "direct-equivalent-v1", lockedPolicy: awaitNoop as never })).toThrow();
});
const awaitNoop = {};
it("held-out network review requires a separately locked policy; offline stays provider-free", async () => {
  const id = b.cases.find(c => c.row.split === "held_out")!.row.id;
  const p = makePlan(b, { variant: "factored-concepts-v1", caseIds: [id], mappingPolicy: policy });
  const r: RunReview = {
    version: 2,
    variant: "factored-concepts-v1",
    designHash: p.designHash,
    kind: "issue-42-authorized-run",
    planHash: p.planHash,
    reviewer: "test-only",
    reviewedAt: "2026-10-15T13:00:00Z",
    authorization: { reference: "test-only", providerExecution: true, maxRequests: p.maxRequests },
    lockedBeforeProviderOutputs: true,
    grouping: { hash: p.groupingHash, approved: true },
    cases: [],
  };
  expect(reviewGate(b, p, r).ready).toBe(false);
  const l = await lock();
  expect(() => makePlan(b, { variant: "factored-concepts-v1", caseIds: [id], lockedPolicy: l })).not.toThrow();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const offline = await runComparison(b, p, { mode: "offline" });
  expect(offline.summary.decisions.observedProviderClassifications).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("actual call budgets count conditional requests and failures, and repeated ordering is deterministic", async () => {
  const p = makePlan(b, {
    variant: "factored-concepts-v1",
    caseIds: ["oct14-engram-final"],
    mappingPolicy: policy,
    repetitions: 2,
    maxRequests: 2,
  });
  expect(p.schedule.map(s => s.arm)).toEqual(["jev", "decisions", "decisions", "jev"]);
  const requests = vi.fn(async (arm, req) => ({ ok: true, body: arm === "decisions" ? body(req) : null }));
  const r = await runComparison(b, p, { mode: "offline", transport: requests });
  expect(r.requestCount).toBe(2);
  expect(requests).toHaveBeenCalledTimes(2);
  expect(r.results.find(r => r.arm === "decisions")!.mapped.reason).toBe("budget_exhausted");
  const full = await runComparison(
    b,
    makePlan(b, { variant: "factored-concepts-v1", caseIds: ["oct14-engram-final"], mappingPolicy: policy }),
    { mode: "offline", transport: requests },
  );
  expect(full.requestCount).toBe(3);
  expect(full.results.find(r => r.arm === "decisions")!.measurement.requestCount).toBe(2);
  expect(full.results.find(r => r.arm === "decisions")!.factored).not.toBeNull();
  expect(full.pairedComparisons[0].rawChoicesEqual).toBeNull();
});

it("validates fully covered v2 reviews and rejects changed design/group/hash authorization", async () => {
  const p = makePlan(b, { variant: "factored-concepts-v1", caseIds: ["oct14-engram-final"], mappingPolicy: policy });
  const { review } = await fixture();
  const r: RunReview = {
    version: 2,
    variant: "factored-concepts-v1",
    designHash: p.designHash,
    kind: "issue-42-authorized-run",
    planHash: p.planHash,
    reviewer: "test-only",
    reviewedAt: "2026-10-15T13:00:00Z",
    authorization: { reference: "test-only", providerExecution: true, maxRequests: p.maxRequests },
    lockedBeforeProviderOutputs: true,
    grouping: { hash: p.groupingHash, approved: true },
    cases: review.cases,
  };
  expect(reviewGate(b, p, r).ready).toBe(true);
  for (const changed of [
    { ...r, designHash: "wrong" },
    { ...r, version: 1 },
    { ...r, grouping: { ...r.grouping, hash: "wrong" } },
    { ...r, planHash: "wrong" },
    { ...r, cases: [{ ...r.cases[0], choices: { "concept_engram-biological": "demonstrated_independent" } }] },
  ])
    expect(reviewGate(b, p, changed).ready).toBe(false);
  const transport = vi.fn();
  await expect(runComparison(b, { ...p, designHash: "wrong" }, { mode: "offline", transport })).rejects.toThrow(
    /checkout/,
  );
  expect(transport).not.toHaveBeenCalled();
});

it("gates held-out evaluation on a compatible lock and rejects direct held-out network review", async () => {
  const c = b.cases.find(c => c.row.split === "held_out")!;
  const l = await lock();
  const p = makePlan(b, { variant: "factored-concepts-v1", caseIds: [c.row.id], lockedPolicy: l });
  const labels = structuredClone({ objective: c.row.expected.objective, concepts: c.row.expected.concepts });
  const r: RunReview = {
    version: 2,
    variant: "factored-concepts-v1",
    designHash: p.designHash,
    kind: "issue-42-authorized-run",
    planHash: p.planHash,
    reviewer: "test-only",
    reviewedAt: "2026-10-15T13:00:00Z",
    authorization: { reference: "test-only", providerExecution: true, maxRequests: p.maxRequests },
    lockedBeforeProviderOutputs: true,
    grouping: { hash: p.groupingHash, approved: true },
    cases: [{ caseId: c.row.id, inputSha256: c.hashes.inputSha256, labels }],
  };
  expect(reviewGate(b, p, r).ready).toBe(true);
  const unlocked = makePlan(b, { variant: "factored-concepts-v1", caseIds: [c.row.id], mappingPolicy: policy });
  expect(reviewGate(b, unlocked, { ...r, planHash: unlocked.planHash }).ready).toBe(false);
  const direct = makePlan(b, { caseIds: [c.row.id] });
  const { variant: _variant, designHash: _design, ...rest } = r;
  expect(_variant).toBe("factored-concepts-v1");
  expect(_design).toBeDefined();
  expect(
    reviewGate(b, direct, {
      ...rest,
      version: 1,
      planHash: direct.planHash,
      authorization: { ...rest.authorization, maxRequests: direct.maxRequests },
    }).ready,
  ).toBe(false);
});
