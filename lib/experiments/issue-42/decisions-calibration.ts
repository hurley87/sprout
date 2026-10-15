/** Provider-free, explicit calibration. No automatic fit, credentials or transport. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { valueHash } from "../../../tests/helpers/classifier-benchmark";
import type { Benchmark, RunReview } from "./benchmark-artifacts";
import { MANIFEST_HASH, factoredDesignHash } from "./benchmark-artifacts";
import {
  FACTORED_VARIANT,
  FACTORED_MAPPING,
  validPolicy,
  normalizeFactored,
  factoredRequest,
  promptingRequest,
  eligibleConcepts,
  mapFactored,
  type FactoredObservation,
} from "./factored-decisions";
import type { DecisionsMappingPolicy } from "./decisions-classifier";

export type CalibrationContext = {
  adapterHash: string;
  modelHash: string;
  corpusHash: string;
  manifestHash: string;
  groupingHash: string;
  designHash: string;
  model: "gpt-6-luna";
  variant: typeof FACTORED_VARIANT;
};
export function calibrationContext(b: Benchmark): CalibrationContext {
  return {
    adapterHash: b.sourceHashes["lib/experiments/issue-42/factored-decisions.ts"],
    modelHash: valueHash({ provider: "openai", model: "gpt-6-luna" }),
    corpusHash: b.corpusHash,
    manifestHash: MANIFEST_HASH,
    designHash: factoredDesignHash(b),
    groupingHash: valueHash(
      b.cases.map(c => ({ caseId: c.row.id, exchangeGroup: c.row.exchangeGroup, split: c.row.split })),
    ),
    model: "gpt-6-luna",
    variant: FACTORED_VARIANT,
  };
}
export type CalibrationObservation = {
  caseId: string;
  inputHash: string;
  exchangeGroup: string;
  split: "calibration" | "held_out";
  kind: "fresh_provider_measurement" | "synthetic_mock";
  returnedModel: string;
  dispatchPolicy: DecisionsMappingPolicy;
  raw: FactoredObservation;
};
export type CalibrationData = {
  version: 1;
  kind: "issue-42-calibration-observations";
  context: CalibrationContext;
  observations: CalibrationObservation[];
};
export type CalibrationReview = {
  version: 1;
  kind: "issue-42-independent-calibration-review";
  context: CalibrationContext;
  reviewer: string;
  reviewedAt: string;
  independentHumanLabels: true;
  groupingApproved: true;
  cases: RunReview["cases"];
};
const hashPattern = /^[a-f0-9]{64}$/u;
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function identity(v: unknown) {
  return valueHash(v);
}
function same(a: unknown, b: unknown) {
  assert.deepEqual(a, b, "identity mismatch");
}
function reviewer(r: { reviewer: string; reviewedAt: string }) {
  assert(
    nonempty(r.reviewer) && nonempty(r.reviewedAt) && Number.isFinite(Date.parse(r.reviewedAt)),
    "human reviewer/date required",
  );
}
// Reuse the strict wire validator on reconstructed normalized fields, without reading raw provider bodies.
function validateObservation(b: Benchmark, o: CalibrationObservation) {
  const c = b.cases.find(c => c.row.id === o.caseId);
  assert(
    c && c.hashes.inputSha256 === o.inputHash && c.row.exchangeGroup === o.exchangeGroup && c.row.split === o.split,
    "observation input/group/split mismatch",
  );
  assert(
    o.returnedModel === "gpt-6-luna" && o.kind === "fresh_provider_measurement",
    "fresh exact-model observations required; mocks cannot calibrate",
  );
  assert(validPolicy(o.dispatchPolicy), "dispatch policy missing");
  const wire = (
    request: NonNullable<ReturnType<typeof factoredRequest>>,
    answers: Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }>,
  ) => {
    same(Object.keys(answers).sort(), request.questions.map(q => q.name).sort());
    return normalizeFactored(
      {
        model: o.returnedModel,
        answers: request.questions.map(q => ({
          type: "choice",
          name: q.name,
          ...answers[q.name],
          probabilities: Object.entries(answers[q.name].probabilities).map(([value, probability]) => ({
            value,
            probability,
          })),
        })),
      },
      request,
    );
  };
  const firstRequest = factoredRequest(c.input)!;
  same(Object.keys(o.raw).sort(), ["demonstration", "objectiveState", "prompting", "sources", "tutorState"]);
  same(
    Object.keys(o.raw.demonstration).sort(),
    firstRequest.questions
      .filter(q => q.name.startsWith("demonstration_"))
      .map(q => q.name)
      .sort(),
  );
  same(
    Object.keys(o.raw.sources).sort(),
    firstRequest.questions
      .filter(q => q.name.startsWith("source_"))
      .map(q => q.name)
      .sort(),
  );
  const first = wire(firstRequest, {
    objectiveState: o.raw.objectiveState,
    tutorState: o.raw.tutorState,
    ...o.raw.demonstration,
    ...o.raw.sources,
  });
  assert(!("reason" in first), "invalid normalized observation");
  const ids = eligibleConcepts(c.input, o.raw, o.dispatchPolicy);
  if (ids.length)
    assert(!("reason" in wire(promptingRequest(c.input, ids), o.raw.prompting)), "invalid conditional observations");
  else same(o.raw.prompting, {});
  return c;
}
export const FITTING_PROCEDURE = {
  version: "finite-grid-v1",
  selection:
    "Lexicographic: minimize false mastery, then missed demonstrations, then abstentions; ties prefer higher probability, confidence, margin in that order.",
  scope:
    "Reviewed calibration concept observations only. No Jev fitting. Probability, confidence and margin are distinct gates. No claim of probability calibration.",
  limitations:
    "Selective conditional prompting is limited to the recorded dispatch gates. Missing attribution under a candidate causes abstention. No held-out evidence or population accuracy, generalization, immutable provider weights, or live-session behavior established. Human provenance declarations require external verification.",
} as const;
export type Candidate = {
  version: 1;
  kind: "issue-42-frozen-candidate-policy";
  context: CalibrationContext;
  mappingVersion: typeof FACTORED_MAPPING;
  policy: DecisionsMappingPolicy;
  inputHashes: { caseId: string; hash: string; exchangeGroup: string; split: "calibration" }[];
  observationHash: string;
  reviewHash: string;
  candidateGridHash: string;
  fitting: typeof FITTING_PROCEDURE;
  evidence: { falseMastery: number; missedDemonstrations: number; abstentions: number; total: number };
  candidateHash: string;
};
/** Absence is reported, never replaced with draft labels or inherited Jev gates. */
export function fitDecisionsPolicy(
  b: Benchmark,
  data?: CalibrationData,
  review?: CalibrationReview,
  candidates?: DecisionsMappingPolicy[],
): { status: "calibration_unavailable"; reason: string } | { status: "candidate_available"; candidate: Candidate } {
  if (!data?.observations.length || !review?.cases.length)
    return {
      status: "calibration_unavailable",
      reason: "eligible normalized observations and independently human-reviewed calibration labels required",
    };
  assert(data.version === 1 && data.kind === "issue-42-calibration-observations");
  assert(review.version === 1 && review.kind === "issue-42-independent-calibration-review");
  const context = calibrationContext(b);
  same(data.context, context);
  same(review.context, context);
  reviewer(review);
  assert(
    review.independentHumanLabels === true && review.groupingApproved === true,
    "independent label and grouping review required",
  );
  assert(
    candidates?.length && candidates.length <= 10000 && candidates.every(validPolicy),
    "explicit bounded candidate grid required",
  );
  const selected = new Set(data.observations.map(o => o.caseId));
  assert(
    review.cases.length === selected.size && new Set(review.cases.map(r => r.caseId)).size === selected.size,
    "exact reviewed coverage required",
  );
  // Validate independently supplied semantic labels using the immutable corpus's closed validator.
  for (const r of review.cases) {
    const c = b.cases.find(c => c.row.id === r.caseId);
    assert(
      c && selected.has(r.caseId) && c.row.split === "calibration",
      "held-out or foreign review forbidden in fitting",
    );
    assert(c.hashes.inputSha256 === r.inputSha256);
    same(Object.keys(r.labels).sort(), ["concepts", "objective"]);
    validateLabels(
      { version: 1, cases: [{ ...c.row, expected: { ...r.labels, reviewStatus: "draft_agent" } }] },
      b.lessons,
    );
  }
  const heldOutGroups = new Set(b.cases.filter(c => c.row.split === "held_out").map(c => c.row.exchangeGroup));
  for (const o of data.observations) {
    assert(
      o.split === "calibration" && !heldOutGroups.has(o.exchangeGroup),
      "held-out/group leakage forbidden in fitting",
    );
    validateObservation(b, o);
  }
  const evaluated = candidates
    .map(policy => {
      let falseMastery = 0,
        missedDemonstrations = 0,
        abstentions = 0,
        total = 0;
      for (const o of data.observations) {
        const c = b.cases.find(c => c.row.id === o.caseId)!;
        const labels = review.cases.find(r => r.caseId === o.caseId)!.labels.concepts;
        const mapped = mapFactored(c.input, o.raw, policy);
        for (const [id, label] of Object.entries(labels)) {
          // Unresolved evidence cannot establish false mastery or missed demonstration; keep it unscored.
          if (label.learnerEvidence.validity === "unresolved") continue;
          total++;
          const proposal = mapped.proposal?.conceptObservations?.find(p => p.criterionId === id);
          const predicted = proposal?.observation.startsWith("demonstrated_") ?? false;
          const expected = label.demonstration === "demonstrated";
          if (
            predicted &&
            (!expected ||
              label.learnerEvidence.validity !== "valid" ||
              !label.learnerEvidence.messageIndexes.includes(proposal!.childMessageIndex!))
          )
            falseMastery++;
          if (expected && !predicted) missedDemonstrations++;
          if (!proposal) abstentions++;
        }
      }
      return { policy, evidence: { falseMastery, missedDemonstrations, abstentions, total } };
    })
    .sort(
      (a, b) =>
        a.evidence.falseMastery - b.evidence.falseMastery ||
        a.evidence.missedDemonstrations - b.evidence.missedDemonstrations ||
        a.evidence.abstentions - b.evidence.abstentions ||
        b.policy.minProbability - a.policy.minProbability ||
        b.policy.minConfidence - a.policy.minConfidence ||
        b.policy.minMargin - a.policy.minMargin,
    );
  const best = evaluated[0];
  if (!best.evidence.total) return { status: "calibration_unavailable", reason: "no scored calibration concepts" };
  const core = {
    version: 1 as const,
    kind: "issue-42-frozen-candidate-policy" as const,
    context,
    mappingVersion: FACTORED_MAPPING as typeof FACTORED_MAPPING,
    policy: { ...best.policy },
    inputHashes: [...selected].sort().map(caseId => {
      const c = b.cases.find(c => c.row.id === caseId)!;
      return { caseId, hash: c.hashes.inputSha256, exchangeGroup: c.row.exchangeGroup, split: "calibration" as const };
    }),
    observationHash: identity(data),
    reviewHash: identity(review),
    candidateGridHash: identity(candidates),
    fitting: FITTING_PROCEDURE,
    evidence: best.evidence,
  };
  return { status: "candidate_available", candidate: { ...core, candidateHash: identity(core) } };
}
import { validateBenchmarkCorpus as validateLabels } from "../../../tests/helpers/classifier-benchmark";
export type LockedPolicy = {
  version: 1;
  kind: "issue-42-locked-policy";
  candidate: Candidate;
  reviewer: string;
  reviewedAt: string;
  authorizationReference: string;
  lockedBeforeHeldOut: true;
  lockHash: string;
};
export function validateLockedPolicy(lock: LockedPolicy, context: CalibrationContext) {
  assert(lock.version === 1 && lock.kind === "issue-42-locked-policy" && lock.lockedBeforeHeldOut === true);
  reviewer(lock);
  assert(nonempty(lock.authorizationReference), "explicit policy lock provenance required");
  const { candidateHash, ...candidate } = lock.candidate;
  assert(candidate.version === 1 && candidate.kind === "issue-42-frozen-candidate-policy");
  assert(candidate.mappingVersion === FACTORED_MAPPING && validPolicy(candidate.policy));
  same(candidate.context, context);
  assert.equal(identity(candidate), candidateHash, "candidate modified after freeze");
  assert(
    candidate.inputHashes.length &&
      candidate.inputHashes.every(
        r => r.split === "calibration" && hashPattern.test(r.hash) && nonempty(r.exchangeGroup),
      ),
  );
  assert(
    [candidate.observationHash, candidate.reviewHash, candidate.candidateGridHash].every(h => hashPattern.test(h)),
  );
  same(candidate.fitting, FITTING_PROCEDURE);
  const { lockHash, ...core } = lock;
  assert.equal(identity(core), lockHash, "policy lock modified");
}
/** Exclusive create; never silently rewrite a frozen candidate or lock. Explicit caller action only. */
export function writeFrozenCandidate(path: string, candidate: Candidate) {
  const { candidateHash, ...core } = candidate;
  assert.equal(identity(core), candidateHash, "invalid candidate freeze");
  writeFileSync(path, JSON.stringify(candidate, null, 2) + "\n", { flag: "wx" });
}
