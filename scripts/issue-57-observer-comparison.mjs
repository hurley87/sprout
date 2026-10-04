/** Offline only: no credentials, env loading, network calls, or live lessons. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const read = name => JSON.parse(readFileSync(`docs/${name}`, "utf8"));
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
try {
  const candidate = await server.ssrLoadModule("/lib/experiments/issue-57/simplified-observer.ts");
  const baseline = await server.ssrLoadModule("/lib/lesson-runtime/jev-conversation-state-classifier.ts");
  const mapper = await server.ssrLoadModule("/lib/lesson-runtime/classification-decision.ts");
  const { JEV_MODEL } = await server.ssrLoadModule("/lib/jev.ts");
  const rows = new Map();
  function add(file, group, entry, historical = []) {
    const input = entry.input ?? {
      nodeId: entry.nodeId ?? entry.identity?.nodeId ?? entry.source?.nodeId,
      transcriptRevision: entry.identity?.transcriptRevision ?? entry.source?.transcriptRevision ?? 1,
      transcript: entry.transcript,
    };
    const key = hash([input.nodeId, input.transcript]);
    const row = rows.get(key) ?? {
      id: entry.id,
      input,
      inputHash: hash(candidate.simplifiedObserverState(input)),
      sources: [],
      historicalA: [],
    };
    if (!candidate.simplifiedObserverState(input)) throw new Error(`Invalid case ${entry.id}`);
    row.sources.push({
      file,
      group,
      id: entry.id,
      identity: entry.identity ?? entry.source ?? null,
      input,
      existingReview: entry.textReview ?? entry.review ?? null,
      draftExpected: entry.draftExpected ?? null,
      humanAdjudication:
        entry.humanAdjudication ??
        "Existing review is a recorded text interpretation, not independently adjudicated ground truth.",
    });
    for (const observed of historical) {
      if (!observed?.probabilities) continue;
      const decision = mapper.mapConversationClassification(input, observed.probabilities);
      row.historicalA.push({
        file,
        caseId: entry.id,
        provenance: observed.provenance,
        normalizedOutput: observed.probabilities,
        originalDecision: observed.decision ?? null,
        currentMapperReplay: decision,
        outcome:
          decision.status === "abstained"
            ? "unresolved"
            : decision.proposal.answerOutcome === "correct" &&
                decision.proposal.supportState === "none" &&
                decision.proposal.tutorState === "acknowledging"
              ? "allow_semantic_completion_evidence"
              : "hold_scene",
      });
    }
    rows.set(key, row);
  }
  const finalFile = "issue-57-final-node-review-set.json";
  const final = read(finalFile);
  for (const group of ["recorded", "synthetic"])
    for (const entry of final[group])
      add(
        finalFile,
        group,
        entry,
        entry.observedMapping
          ? [
              {
                ...entry.observedMapping,
                provenance: "historical recorded diagnostic; exact old contract not reconstructed",
              },
            ]
          : [],
      );
  const clarificationFile = "issue-57-clarification-review-set.json";
  const clarification = read(clarificationFile);
  for (const group of ["recorded", "synthetic"])
    for (const entry of clarification[group])
      add(
        clarificationFile,
        group,
        entry,
        entry.observedMapping
          ? [
              {
                ...entry.observedMapping,
                provenance: "historical recorded diagnostic; exact old contract not reconstructed",
              },
            ]
          : [],
      );
  const replayFile = "issue-57-jev-replay-results.json";
  for (const entry of read(replayFile).results)
    add(replayFile, entry.observedMapping ? "recorded_replay" : "synthetic_replay", entry, [
      { ...entry.observedMapping, provenance: "historical observed diagnostic" },
      { ...entry.diagnostic, provenance: "historical paid replay; earlier nine-question contract, not fresh arm A" },
    ]);
  const correctionFile = "issue-57-self-correction-review-set.json";
  // Synthetic score vectors here are mapper controls, never measured Jev outputs.
  for (const entry of read(correctionFile).cases.filter(entry => entry.kind === "recorded"))
    add(correctionFile, "recorded_secondary", entry, [
      { probabilities: entry.probabilities, provenance: "historical recorded diagnostic; primary export missing" },
    ]);
  const planFile = "issue-57-observer-evaluation-plan.json";
  const previousPlan = read(planFile);
  for (const entry of previousPlan.cases.filter(entry => entry.kind === "recorded_primary")) {
    const event = previousPlan.forensicEvents.find(
      event => event.type === "classifier.mapping" && entry.source?.mappingEventIndex === event.eventIndex,
    );
    add(
      planFile,
      "recorded_primary",
      entry,
      event ? [{ ...event.detail, provenance: "historical recorded primary diagnostic" }] : [],
    );
  }

  const contracts = {
    A: { model: JEV_MODEL, questions: baseline.CONVERSATION_QUESTIONS },
    B: { model: JEV_MODEL, questions: candidate.SIMPLIFIED_QUESTIONS },
  };
  const contractHashes = { A: hash(contracts.A), B: hash(contracts.B) };
  const cases = [...rows.values()].map(row => ({
    ...row,
    freshA: { status: "not_run", outcome: "unmeasured", normalizedOutput: null },
    simplifiedB: { status: "not_run", outcome: "unmeasured", normalizedOutput: null },
    comparison: "unmeasured: no outputs exist for this two-Choice contract",
  }));
  // Repetitions measure stability without expanding contract/options/prompt scope.
  const requests = cases.flatMap((row, index) =>
    [1, 2].flatMap(repeat =>
      (index % 2 ? ["B", "A"] : ["A", "B"]).map(arm => ({
        id: `${row.id}:${arm}:${repeat}`,
        caseId: row.id,
        arm,
        repeat,
        inputHash: row.inputHash,
        contractHash: contractHashes[arm],
      })),
    ),
  );
  const historicalCounts = {};
  for (const row of cases)
    for (const observation of row.historicalA) {
      const reason = observation.currentMapperReplay.reason ?? observation.outcome;
      historicalCounts[reason] = (historicalCounts[reason] ?? 0) + 1;
    }
  const report = {
    status: "prepared_not_run",
    model: JEV_MODEL,
    scope:
      "Two Choice questions versus nine Nouls; identical current-checkout evidence projection. Production unchanged.",
    caveats: [
      "Historical A vectors replay current mapping only, not current prompt performance. No B results exist. Synthetic score controls are excluded.",
      "Reviews/draft labels and speaker attribution are imperfect; mixed status questions, supplied repetitions and tentative reaffirmations need human review.",
      "allow_semantic_completion_evidence still requires all existing reducer identity, current-turn, interruption, audio drain and render gates. No observed live outcome is inferred.",
      "No change in false holds, regressions or threshold sensitivity can be measured without paired fresh provider outputs.",
    ],
    thresholds: mapper.CONVERSATION_CLASSIFICATION_THRESHOLDS,
    choiceValidation:
      "All finite [0,1] probabilities; exact options; sum within 1e-6 of 1; choice is an argmax; confidence validated but not used as a gate; pinned response model.",
    contracts,
    contractHashes,
    summary: {
      distinctNodeTranscripts: cases.length,
      historicalObservations: cases.reduce((n, row) => n + row.historicalA.length, 0),
      casesWithHistoricalA: cases.filter(row => row.historicalA.length).length,
      historicalMapperOutcomes: historicalCounts,
      freshA: 0,
      measuredB: 0,
      improvements: "unmeasured",
      regressions: "unmeasured",
    },
    evaluationPlan: {
      status: "requires_separate_paid_call_authorization",
      calls: requests.length,
      formula: `${cases.length} distinct node/transcripts × 2 arms × 2 unchanged repetitions`,
      repeats: 2,
      retries: 0,
      fallbackCalls: 0,
      optionOrderVariants: 0,
      stateHashPolicy:
        "SHA-256 of JSON.stringify(projected state); exact input revision belongs to this evaluation snapshot, source identities retained separately.",
      requestConstruction:
        "For each request use model/questions from contracts[arm] and state=simplifiedObserverState(case.input); A projection equality is tested offline.",
      execution:
        "No paid runner enabled. Before authorization verify per-request price, cap, timeout and token bounds, then freeze reviewed labels and these hashes. Any changes require a new plan.",
      measures: [
        "false completion on reviewed negatives",
        "holds/abstentions on reviewed resolved cases",
        "negative-control holds",
        "incompatible labels",
        "label eligibility versus probability gate",
        "repeat stability",
        "latency and cost",
      ],
      requests,
    },
    recommendation:
      "Run the bounded paired experiment after review and paid-call approval; current evidence does not support replacing or endorsing the existing contract.",
    cases,
  };
  if (process.argv.includes("--write"))
    writeFileSync("docs/issue-57-simplified-observer-comparison.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report.summary, requiredPaidCalls: requests.length, contractHashes }, null, 2));
} finally {
  await server.close();
}
