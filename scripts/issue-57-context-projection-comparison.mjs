/** Offline plan/report only; no credentials, env files, fetch, or paid execution mode. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourcePath = "docs/issue-57-simplified-observer-comparison.json";
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const args = process.argv.slice(2);
let write = false,
  resultsPath = null,
  expectationsPath = null;
while (args.length) {
  const arg = args.shift();
  if (arg === "--write" && !write) write = true;
  else if (arg === "--results" && !resultsPath && args[0] && !args[0].startsWith("--")) resultsPath = args.shift();
  else if (arg === "--expectations" && !expectationsPath && args[0] && !args[0].startsWith("--"))
    expectationsPath = args.shift();
  else
    throw new Error(
      "Usage: node scripts/issue-57-context-projection-comparison.mjs [--write] [--results normalized-results.json] [--expectations reviewed-enums.json]",
    );
}
const server = await createServer({
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const experiment = await server.ssrLoadModule("/lib/experiments/issue-57/context-projection.ts");
  const baseline = await server.ssrLoadModule("/lib/experiments/issue-57/simplified-observer.ts");
  const mapper = await server.ssrLoadModule("/lib/lesson-runtime/classification-decision.ts");
  const contract = { model: source.model, questions: experiment.CONTEXT_PROJECTION_QUESTIONS };
  const contractHash = hash(contract);
  const cases = source.cases.map(row => {
    const projections = Object.fromEntries(
      ["A", "B"].map(arm => {
        const request = experiment.contextProjectionRequest(row.input, arm);
        if (!request || request.model !== contract.model || hash(request.questions) !== hash(contract.questions))
          throw new Error(`Invalid frozen request ${row.id}`);
        return [arm, { state: request.state, inputHash: hash(request.state) }];
      }),
    );
    return {
      id: row.id,
      input: row.input,
      existingReviews: row.sources,
      historicalNineQuestionEvidence: {
        sourcePath,
        caseId: row.id,
        observations: row.historicalA.length,
        usableAsProjectionResult: false,
      },
      humanAdjudicatedExpectation: null,
      projections,
      A: [],
      B: [],
      comparison: experiment.compareProjectionDecisions(null, null, null),
    };
  });
  const requests = cases.flatMap((row, index) =>
    [1, 2].flatMap(repeat =>
      (index % 2 ? ["B", "A"] : ["A", "B"]).map(arm => ({
        id: `${row.id}:${arm}:${repeat}`,
        caseId: row.id,
        arm,
        repeat,
        inputHash: row.projections[arm].inputHash,
        contractHash,
      })),
    ),
  );
  const expectations = expectationsPath ? JSON.parse(readFileSync(expectationsPath, "utf8")) : [];
  if (!Array.isArray(expectations)) throw new Error("Expectations must be an array of explicitly reviewed enums");
  const reviewedIds = new Set();
  for (const review of expectations) {
    const row = cases.find(row => row.id === review.caseId);
    if (
      !row ||
      reviewedIds.has(review.caseId) ||
      review.humanReviewed !== true ||
      !Object.hasOwn(baseline.SIMPLIFIED_QUESTIONS.objectiveState.criteria, review.objectiveState) ||
      !Object.hasOwn(baseline.SIMPLIFIED_QUESTIONS.tutorState.criteria, review.tutorState)
    )
      throw new Error("Invalid or duplicate reviewed expectation");
    reviewedIds.add(review.caseId);
    row.humanAdjudicatedExpectation = { objectiveState: review.objectiveState, tutorState: review.tutorState };
  }
  const imported = resultsPath ? JSON.parse(readFileSync(resultsPath, "utf8")) : [];
  if (!Array.isArray(imported)) throw new Error("Results must be an array of normalized observations");
  const seen = new Set();
  for (const observation of imported) {
    const request = requests.find(r => r.id === observation.id);
    if (
      !request ||
      seen.has(observation.id) ||
      request.inputHash !== observation.inputHash ||
      request.contractHash !== observation.contractHash ||
      observation.model !== contract.model ||
      typeof observation.latencyMs !== "number" ||
      !Number.isFinite(observation.latencyMs) ||
      observation.latencyMs < 0
    )
      throw new Error("Duplicate, invalid, or mismatched result manifest metadata");
    seen.add(observation.id);
    const output = observation.normalizedOutput;
    const failed = observation.failureReason !== undefined;
    if (
      failed &&
      (![
        "provider_rejected",
        "provider_unreadable",
        "provider_unreachable",
        "provider_model_mismatch",
        "cancelled",
        "timeout",
      ].includes(observation.failureReason) ||
        output !== null)
    )
      throw new Error("Invalid provider failure observation");
    if (!failed && (!output || typeof output !== "object")) throw new Error("Missing normalized Choice outputs");
    const normalized = failed
      ? null
      : baseline.normalizeSimplifiedOutputs({
          answers: Object.fromEntries(Object.entries(output).map(([id, value]) => [id, { ...value, type: "choice" }])),
        });
    if (!failed && !normalized) throw new Error("Invalid normalized Choice outputs");
    const row = cases.find(row => row.id === request.caseId);
    const decision = failed
      ? {
          status: "abstained",
          outcome: "unresolved",
          reason: observation.failureReason,
          outputs: null,
          labelCompletionEligible: false,
          proposal: null,
        }
      : baseline.mapSimplifiedObservation(row.input, normalized);
    row[request.arm].push({
      id: request.id,
      repeat: request.repeat,
      model: observation.model,
      latencyMs: observation.latencyMs,
      normalizedOutput: normalized,
      mappedSemanticState: normalized
        ? {
            objectiveState: normalized.objectiveState.choice,
            tutorState: normalized.tutorState.choice,
          }
        : null,
      decision,
      semanticCompletionEvidence: decision.proposal !== null,
      runtimeOutcome: decision.proposal
        ? "conditional: requires exact source, fresh current-turn evidence, interruption gates, audio drain and render confirmation"
        : "hold",
    });
  }
  const decisionSignature = d =>
    JSON.stringify([d.status, d.outcome, d.reason, d.outputs?.objectiveState.choice, d.outputs?.tutorState.choice]);
  for (const row of cases) {
    if (row.A.length !== 2 || row.B.length !== 2) continue;
    if ([row.A, row.B].some(runs => decisionSignature(runs[0].decision) !== decisionSignature(runs[1].decision)))
      row.comparison = {
        classification: "still ambiguous",
        reason: "within-arm repeat instability",
        contamination: null,
      };
    else
      row.comparison = experiment.compareProjectionDecisions(
        row.A[0].decision,
        row.B[0].decision,
        row.humanAdjudicatedExpectation,
      );
  }
  const report = {
    status: imported.length ? "offline_import_of_supplied_outputs" : "prepared_not_run",
    source: {
      path: sourcePath,
      caseSetHash: hash(source.cases.map(row => ({ id: row.id, input: row.input }))),
      count: cases.length,
    },
    contract,
    contractHash,
    baselineContractHash: source.contractHashes.B,
    reviewedExpectationHash: hash(cases.map(row => ({ id: row.id, expected: row.humanAdjudicatedExpectation }))),
    locatorAdaptation: {
      appliesTo: "both arms identically",
      semanticCriteriaChanged: false,
      baseline:
        "Describe only tutorObservation.latestMessage using precedingChildAttempt and the full transcript as context.",
      comparison:
        "Describe only the latest relevant tutor response in the ordered transcript, using earlier child and tutor messages as context. Earlier messages are context only, never the latest tutor action.",
    },
    thresholds: mapper.CONVERSATION_CLASSIFICATION_THRESHOLDS,
    difference:
      "A contains full transcript plus tutorObservation/supportEvidence; B contains the same full transcript and authored current-node facts only. No extra turns are added.",
    caveats: [
      "Existing saved outputs use nine Nouls, not the frozen simplified questions. Neither projection has measured outputs in existing artifacts.",
      "Transcript completeness and speaker/visit attribution come from source snapshots; the experiment cannot reconstruct missing speech or independently prove attribution.",
      "Latest tutor action is unchanged as the semantic target; earlier wrong/help/acknowledgment evidence is context only.",
      "Null human-adjudicated expectations are deliberate. Existing reviews are retained but not silently promoted into approved labels.",
      "Do not attribute changed outputs causally to a specific earlier utterance without human review; contamination stays null until reviewed.",
      "Result imports validate shape and frozen request identity, not whether provider calls actually occurred; verify supplied-output provenance before claiming measured performance.",
    ],
    summary: {
      cases: cases.length,
      importedObservations: imported.length,
      improvements: cases.filter(row => row.comparison.classification === "improved").length,
      regressions: cases.filter(row => row.comparison.classification === "regressed").length,
      unchanged: cases.filter(row => row.comparison.classification === "unchanged").length,
      stillAmbiguous: cases.filter(row => row.comparison.classification === "still ambiguous").length,
      allPlannedAttemptsRecorded: imported.length === requests.length,
      performanceMeasured:
        imported.length === requests.length &&
        cases.every(row => [...row.A, ...row.B].every(run => run.normalizedOutput !== null)),
      contamination: "unmeasured",
      projectionUtility: "unmeasured",
    },
    evaluationPlan: {
      status: "requires_separate_paid_call_authorization",
      calls: requests.length,
      formula: `${cases.length} cases × 2 projections × 2 unchanged repetitions`,
      repeats: 2,
      retries: 0,
      fallbackCalls: 0,
      promptModificationsDuringRun: 0,
      liveLessons: 0,
      timeoutMs: 10000,
      maximumSerializedRequestBytes: 32768,
      overflowPolicy: "stop, never truncate or change questions",
      pricing: "verify provider pricing and explicit dollar cap before approval; no paid execution enabled",
      execution:
        "Request body is {model, questions} from contract plus state from cases[].projections[arm].state. Alternate arm order. Failed calls consume the cap; preserve failure category and latency. No replacement calls.",
      resultImportShape:
        "Array of {id, model, inputHash, contractHash, latencyMs, normalizedOutput:{objectiveState,tutorState}}; failures use normalizedOutput:null and failureReason. model is the requested pinned model for failure records. Only closed validated outputs retained. No retries.",
      expectationImportShape:
        "Array of {caseId, humanReviewed:true, objectiveState, tutorState}. Freeze before calls; unreviewed/disputed cases stay null. Never infer labels from transcript phrases.",
      requiredHumanReview:
        "Freeze reviewed enum expectations before calls; retain disputes. Review any regression for earlier wrong answer, help, tutor action, acknowledgment or unrelated-content contamination.",
      requests,
    },
    recommendation:
      "Run the bounded projection comparison after approval. No evidence yet supports changing production inputs or calling the projections useful/harmful/unnecessary.",
    cases,
  };
  for (const row of cases)
    for (const arm of ["A", "B"]) {
      if (
        Buffer.byteLength(JSON.stringify({ ...contract, state: row.projections[arm].state }), "utf8") >
        report.evaluationPlan.maximumSerializedRequestBytes
      )
        throw new Error("Frozen request exceeds the plan's input bound");
    }
  if (write) writeFileSync("docs/issue-57-context-projection-comparison.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report.summary, requiredPaidCalls: requests.length, contractHash }, null, 2));
} finally {
  await server.close();
}
