/** Explicit offline/server CLI experiment. No application imports or automatic execution. */
import assert from "node:assert/strict";
import {
  abstain,
  mapConversationObservation,
  normalizeConversationOutputs,
  type ConversationStateDecision,
  type ConversationStateOutputs,
} from "../../lesson-runtime/conversation-observer-contract";
import { executeConversationObserver } from "../../lesson-runtime/jev-conversation-state-classifier";
import { createDecisionsClassifier, type DecisionsRequest } from "./decisions-classifier";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
} from "../../lesson-runtime/lesson-runtime-reducer";
import type {
  ConversationStateClassifierInput,
  ConversationStateProposal,
} from "../../lesson-runtime/conversation-state-classifier";
import { transcriptMessages } from "../../lesson-runtime/tutor-observation";
import {
  loadBenchmark,
  makePlan,
  reviewGate,
  sha256,
  valueHash,
  type Arm,
  type Benchmark,
  type Plan,
  type RunReview,
} from "./benchmark-artifacts";

import {
  createFactoredClassifier,
  factoredRequest,
  promptingRequest,
  type FactoredObservation,
  type FactoredDecision,
} from "./factored-decisions";

type JevRequest = Benchmark["cases"][number]["jev"];
export type Transport = (
  arm: Arm,
  request: JevRequest | DecisionsRequest,
  signal: AbortSignal,
) => Promise<{ ok: boolean; body: unknown }>;
type Usage = { inputTokens: number; outputTokens: number; totalTokens: number };
type CallMeasurement = {
  requestHash: string;
  questionNames: string[];
  latencyMs: number | null;
  usage: Usage | null;
  failure: string | null;
};
type Attempt = {
  calls?: CallMeasurement[];
  requestCount: number;
  latencyMs: number | null;
  usage: Usage | null;
  costUsd: null;
  failure: string | null;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function usageOf(arm: Arm, body: unknown): Usage | null {
  // Only Decisions usage fields have been verified. Never guess Jev's billing shape.
  if (arm !== "decisions" || !record(body) || !record(body.usage)) return null;
  const { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens } = body.usage;
  if (![inputTokens, outputTokens, totalTokens].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0))
    return null;
  return {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number,
  };
}

/** Fresh isolated current-node runtime setup, not a reconstruction of the live session. */
export function replayReducer(
  input: ConversationStateClassifierInput,
  proposal: ConversationStateProposal | null,
  staleRevision = false,
) {
  const lesson = input.lesson!;
  // Initial render at target is an explicit simulation assumption. All authored lesson contents stay frozen.
  const setupLesson = { ...lesson, initialNodeId: input.nodeId };
  const messages = transcriptMessages(input.transcript)!;
  const hasChildTranscript = messages.some(m => m.speaker === "Child" && m.text.trim());
  const transcriptSource = messages.at(-1)?.speaker === "Tutor" ? ("tutor" as const) : ("child" as const);
  const before = {
    ...createLessonRuntime("issue-42-snapshot-simulation", { lesson: setupLesson, atMs: 0 }),
    childTurnId: hasChildTranscript ? 1 : 0,
    hasChildTurn: hasChildTranscript,
    hasChildTranscript,
    transcriptRevision: input.transcriptRevision,
    transcriptSource,
  };
  const source = classificationSource(before);
  if (!source || !proposal)
    return {
      setup: before,
      source,
      proposalAccepted: false,
      rejection: proposal ? "source_ineligible" : "no_proposal",
      evidence: before.conceptEvidence,
      answerAccepted: false,
      effects: [],
      nodeId: before.nodeId,
      uiEvidence: null,
      audioCompletion: null,
    };
  const result = reduceLessonRuntime(
    before,
    {
      type: "proposal.received",
      source: staleRevision ? { ...source, transcriptRevision: source.transcriptRevision + 1 } : source,
      transcriptSnapshot: input.transcript,
      proposal,
      atMs: 1,
    },
    lesson,
  );
  return {
    setup: before,
    source,
    proposalAccepted: result.state.consumedRevision === input.transcriptRevision,
    rejection:
      result.state.consumedRevision === input.transcriptRevision
        ? null
        : staleRevision || proposal.transcriptRevision !== input.transcriptRevision
          ? "stale_revision_rejected"
          : "reducer_rejected",
    evidence: result.state.conceptEvidence,
    answerAccepted: result.state.answerAccepted,
    effects: result.effects,
    nodeId: result.state.nodeId,
    uiEvidence: null,
    audioCompletion: null,
  };
}

/** No full bodies, exception messages or credentials escape this boundary. */
export function syntheticTransport(): Transport {
  return async (arm, request) => {
    const questions =
      arm === "decisions"
        ? (request as DecisionsRequest).questions
        : Object.entries((request as JevRequest).questions).map(([name, q]) => ({
            name,
            choices: Object.keys(q.criteria).map(value => ({ value })),
          }));
    const answers = questions.map(q => {
      const choice =
        q.name === "objectiveState"
          ? "no_attempt"
          : q.name === "tutorState"
            ? "asking"
            : q.name.startsWith("source_")
              ? "none"
              : q.name.startsWith("demonstration_")
                ? "not_attempted"
                : q.name.startsWith("prompting_")
                  ? "unresolved"
                  : "not_yet";
      const probabilities = q.choices.map(c => ({ value: c.value, probability: c.value === choice ? 1 : 0 }));
      return { name: q.name, type: "choice", choice, confidence: 1, probabilities };
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
      },
    };
  };
}

function compareChoices(outputs: ConversationStateOutputs | null, reviewed?: RunReview["cases"][number]) {
  if (!outputs) return { choices: null, concepts: null, objectiveAggregate: "unscored", questionResponse: "unscored" };
  const answers = {
    objectiveState: outputs.objectiveState,
    tutorState: outputs.tutorState,
    ...outputs.concepts,
    ...outputs.sources,
  };
  const choices = Object.fromEntries(
    Object.entries(answers).map(([name, answer]) => [
      name,
      reviewed?.choices?.[name] === undefined
        ? "unscored"
        : answer.choice === reviewed.choices[name]
          ? "agree"
          : "semantic_disagreement",
    ]),
  );
  const concepts = Object.fromEntries(
    Object.entries(outputs.concepts ?? {}).map(([key, answer]) => {
      const expected = reviewed?.labels.concepts[key.slice(8)];
      if (!expected)
        return [
          key,
          { demonstration: "unscored", attempt: "unscored", attribution: "unscored", learnerEvidence: "unscored" },
        ];
      const demonstrated = answer.choice.startsWith("demonstrated_");
      // 'not_yet' does not distinguish a complete wrong attempt from no attempt.
      const source = outputs.sources?.[`source_${key.slice(8)}`]?.choice;
      const index = source?.match(/^message_(\d+)$/u)?.[1];
      return [
        key,
        {
          demonstration:
            demonstrated === (expected.demonstration === "demonstrated") ? "agree" : "semantic_disagreement",
          attempt:
            answer.choice === "partial"
              ? expected.attempt === "partial"
                ? "agree"
                : "semantic_disagreement"
              : demonstrated
                ? expected.attempt === "complete"
                  ? "agree"
                  : "semantic_disagreement"
                : "unscored",
          attribution:
            !demonstrated || expected.attribution === "unresolved" || expected.attribution === "not_applicable"
              ? "unscored"
              : answer.choice === `demonstrated_${expected.attribution}`
                ? "agree"
                : "semantic_disagreement",
          learnerEvidence:
            expected.learnerEvidence.validity === "unresolved"
              ? "unscored"
              : source === "none"
                ? expected.learnerEvidence.validity === "none"
                  ? "agree"
                  : "source_provenance_disagreement"
                : index !== undefined && expected.learnerEvidence.messageIndexes.includes(Number(index))
                  ? "agree"
                  : "source_provenance_disagreement",
        },
      ];
    }),
  );
  return { choices, concepts, objectiveAggregate: "unscored", questionResponse: "unscored" };
}
function compareFactored(raw: FactoredObservation | null, reviewed?: RunReview["cases"][number]) {
  if (!raw) return null;
  return Object.fromEntries(
    Object.entries(raw.demonstration).map(([key, a]) => {
      const id = key.slice("demonstration_".length);
      const label = reviewed?.labels.concepts[id];
      const source = raw.sources[`source_${id}`]?.choice;
      const index = source?.match(/^message_(\d+)$/u)?.[1];
      const prompting = raw.prompting[`prompting_${id}`]?.choice;
      return [
        id,
        {
          demonstration:
            !label || a.choice === "uncertain"
              ? "unscored"
              : (a.choice === "demonstrated") === (label.demonstration === "demonstrated")
                ? "agree"
                : "semantic_disagreement",
          attempt:
            !label || a.choice === "uncertain"
              ? "unscored"
              : (a.choice === "partial" ? "partial" : a.choice === "not_attempted" ? "not_attempted" : "complete") ===
                  label.attempt
                ? "agree"
                : "semantic_disagreement",
          attribution:
            !label ||
            a.choice !== "demonstrated" ||
            !prompting ||
            prompting === "unresolved" ||
            !["independent", "prompted"].includes(label.attribution)
              ? "unscored"
              : prompting === label.attribution
                ? "agree"
                : "semantic_disagreement",
          learnerEvidence:
            !label || label.learnerEvidence.validity === "unresolved"
              ? "unscored"
              : source === "none"
                ? label.learnerEvidence.validity === "none"
                  ? "agree"
                  : "source_provenance_disagreement"
                : index !== undefined && label.learnerEvidence.messageIndexes.includes(Number(index))
                  ? "agree"
                  : "source_provenance_disagreement",
          choice:
            reviewed?.choices?.[key] === undefined
              ? "unscored"
              : reviewed.choices[key] === a.choice
                ? "agree"
                : "semantic_disagreement",
        },
      ];
    }),
  );
}
function category(d: ConversationStateDecision) {
  if (d.proposal) return "mapped_proposal";
  if (d.reason === "learner_source_unavailable" || d.reason === "decisions_request_limits")
    return "locally_unsupported";
  if (d.reason === "learner_source_unresolved") return "source_provenance_failure";
  if (d.reason === "cancelled") return "cancelled";
  if (d.reason === "timeout") return "timeout";
  if (d.reason === "budget_exhausted") return "budget_exhausted";
  if (d.reason === "provider_refused") return "refusal";
  return d.outputs || (d as Partial<FactoredDecision>).factored ? "confidence_or_mapping_rejection" : "provider_error";
}

// Only network Jev needs the original adapter's global fetch boundary. CLI runs serially in its own process.
let jevBridgeBusy = false;
async function baselineJev(
  input: ConversationStateClassifierInput,
  request: JevRequest,
  signal: AbortSignal,
  transport: Transport,
) {
  assert(!jevBridgeBusy, "concurrent Jev bridge prohibited");
  jevBridgeBusy = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, JSON.stringify(request), "baseline Jev request differs from plan");
    const response = await transport("jev", structuredClone(request), signal);
    return Response.json(response.body, { status: response.ok ? 200 : 400 });
  };
  try {
    return await executeConversationObserver(input, signal, request);
  } finally {
    globalThis.fetch = original;
    jevBridgeBusy = false;
  }
}

export type RunOptions = {
  mode: "offline" | "network";
  execute?: boolean;
  explicitBudget?: number;
  review?: unknown;
  reviewHash?: string | null;
  reviewBytes?: string;
  transport?: Transport;
  signal?: AbortSignal;
  now?: () => number;
};
export async function runComparison(benchmark: Benchmark, plan: Plan, options: RunOptions) {
  plan = structuredClone(plan);
  // Re-read source/files/Git immediately before execution, including offline execution.
  const fresh = loadBenchmark();
  assert.deepEqual(
    makePlan(fresh, {
      caseIds: plan.selectedCaseIds,
      repetitions: plan.repetitions,
      maxRequests: plan.maxRequests,
      timeoutMs: plan.timeoutMs,
      variant: plan.version === 2 ? plan.variant : undefined,
      lockedPolicy: plan.lockedPolicy ?? undefined,
      mappingPolicy: plan.lockedPolicy ? undefined : (plan.mappingPolicy ?? undefined),
    }),
    plan,
    "plan no longer matches checkout",
  );
  benchmark = fresh;
  const gate = reviewGate(benchmark, plan, options.review);
  if (options.mode === "network") {
    assert(
      options.execute === true && options.explicitBudget === plan.maxRequests,
      "network requires explicit opt-in and matching finite budget",
    );
    assert(gate.ready, "network requires compatible human review and run authorization");
    assert(
      options.reviewBytes && sha256(options.reviewBytes) === options.reviewHash,
      "exact review file hash required",
    );
    assert.deepEqual(JSON.parse(options.reviewBytes), options.review, "review bytes differ");
    assert(!plan.workingTreeDirty, "network requires committed source");
    assert(options.transport, "network transport required");
  } else assert(options.mode === "offline", "invalid execution mode");
  // Freeze caller-owned run controls before any await.
  const review = gate.ready ? (structuredClone(options.review) as RunReview) : undefined;
  const reviewHash = options.reviewHash ?? null;
  const mode = options.mode;
  const transport = options.transport ?? syntheticTransport();
  const now = options.now ?? (() => performance.now());
  const signal = options.signal ?? new AbortController().signal;
  let requestCount = 0;
  const results = [];
  for (const slot of plan.schedule) {
    const c = benchmark.cases.find(c => c.row.id === slot.caseId)!;
    const attempt: Attempt = { requestCount: 0, latencyMs: null, usage: null, costUsd: null, failure: null };
    const calls: CallMeasurement[] = [];
    if (plan.version === 2) attempt.calls = calls;
    const bounded: Transport = async (arm, request, adapterSignal) => {
      if (signal.aborted || adapterSignal.aborted) {
        attempt.failure = "cancelled";
        throw new Error("cancelled");
      }
      if (requestCount >= plan.maxRequests) {
        attempt.failure = "budget_exhausted";
        throw new Error("budget exhausted");
      }
      assert(
        attempt.requestCount < (slot.arm === "decisions" && plan.version === 2 ? 2 : 1),
        "no hidden retries allowed",
      );
      assert.equal(arm, slot.arm);
      if (arm === "decisions" && plan.version === 2) {
        const req = request as DecisionsRequest;
        const ids = req.questions.map(q => q.name.slice("prompting_".length));
        const expected = attempt.requestCount === 0 ? factoredRequest(c.input) : promptingRequest(c.input, ids);
        assert.equal(valueHash(request), valueHash(expected), "factored transport input differs");
      } else
        assert.equal(
          valueHash(request),
          arm === "jev" ? valueHash(c.jev) : valueHash(c.decisions),
          "transport input differs",
        );
      requestCount++;
      attempt.requestCount++;
      const call: CallMeasurement = {
        requestHash: valueHash(request),
        questionNames:
          arm === "decisions"
            ? (request as DecisionsRequest).questions.map(q => q.name)
            : Object.keys((request as JevRequest).questions),
        latencyMs: null,
        usage: null,
        failure: null,
      };
      calls.push(call);
      const start = now();
      const controller = new AbortController();
      const cancel = () => {
        attempt.failure = "cancelled";
        controller.abort();
      };
      signal.addEventListener("abort", cancel, { once: true });
      adapterSignal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => {
        attempt.failure = "timeout";
        controller.abort();
      }, plan.timeoutMs);
      let stopped!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        stopped = () => reject(new Error("request stopped"));
        controller.signal.addEventListener("abort", stopped, { once: true });
      });
      try {
        const response = await Promise.race([transport(arm, structuredClone(request), controller.signal), aborted]);
        if (controller.signal.aborted) throw new Error("request stopped");
        const usage = response.ok ? usageOf(arm, response.body) : null;
        call.usage = usage;
        attempt.usage =
          attempt.requestCount === 1
            ? usage
            : attempt.usage && usage
              ? {
                  inputTokens: attempt.usage.inputTokens + usage.inputTokens,
                  outputTokens: attempt.usage.outputTokens + usage.outputTokens,
                  totalTokens: attempt.usage.totalTokens + usage.totalTokens,
                }
              : null;
        return response;
      } catch {
        attempt.failure ??= "provider_unreachable";
        throw new Error("safe transport failure");
      } finally {
        const elapsed = now() - start;
        call.failure = attempt.failure;
        call.latencyMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
        attempt.latencyMs = Number.isFinite(elapsed) && elapsed >= 0 ? (attempt.latencyMs ?? 0) + elapsed : null;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        adapterSignal.removeEventListener("abort", cancel);
        controller.signal.removeEventListener("abort", stopped);
      }
    };
    let decision: ConversationStateDecision | FactoredDecision;
    if (signal.aborted) decision = abstain("cancelled");
    else if (slot.arm === "decisions") {
      decision = await (plan.version === 2 ? createFactoredClassifier : createDecisionsClassifier)({
        transport: (request, s) => bounded("decisions", request, s),
        mappingPolicy: plan.mappingPolicy ?? undefined,
        timeoutMs: plan.version === 2 ? plan.timeoutMs : Math.min(plan.timeoutMs + 1000, 2_147_483_647),
      }).classifyWithDiagnostics(c.input, signal);
    } else if (mode === "network") decision = await baselineJev(c.input, c.jev, signal, bounded);
    else {
      try {
        const response = await bounded("jev", c.jev, signal);
        const outputs =
          response.ok && record(response.body) && response.body.model === c.jev.model
            ? normalizeConversationOutputs(response.body, c.input.lesson, c.input.nodeId, c.input.transcript)
            : null;
        decision = outputs
          ? mapConversationObservation(c.input, outputs)
          : abstain(response.ok ? "provider_unreadable" : "provider_rejected");
      } catch {
        decision = abstain(attempt.failure ?? "provider_unreachable");
      }
    }
    if (attempt.failure) decision = abstain(attempt.failure);
    const factored = (decision as Partial<FactoredDecision>).factored ?? null;
    const replay = replayReducer(c.input, decision.proposal);
    results.push({
      ...slot,
      kind: mode === "offline" ? "synthetic_mock" : "fresh_provider_measurement",
      category: category(decision),
      normalized: decision.outputs,
      ...(plan.version === 2 ? { factored } : {}),
      returnedModel: decision.outputs || factored ? plan.providers[slot.arm].model : null,
      mapped: {
        status: decision.status,
        reason: decision.reason ?? null,
        outcome: decision.outcome,
        proposal: decision.proposal,
      },
      replay,
      semantic: compareChoices(
        decision.outputs,
        review?.cases.find(r => r.caseId === slot.caseId),
      ),
      ...(plan.version === 2
        ? {
            factoredSemantic: compareFactored(
              factored,
              review?.cases.find(r => r.caseId === slot.caseId),
            ),
          }
        : {}),
      measurement: {
        ...attempt,
        latencyKind:
          mode === "offline"
            ? "mock_request_only"
            : plan.version === 2
              ? "sum_of_provider_calls_including_body_parse"
              : "provider_request_including_body_parse",
        costAvailability: "unavailable_no_verified_pricing",
        liveEndToEndMs: null,
      },
      historical: { present: c.row.historicalObservation !== null, includedInFreshMeasurements: false },
    });
  }
  return {
    version: plan.version,
    plan,
    reviewHash,
    reviewGate: gate,
    mode,
    requestCount,
    ...(plan.version === 2
      ? {
          calibration: plan.lockedPolicy
            ? {
                status: "locked_candidate",
                candidateHash: plan.lockedPolicy.candidate.candidateHash,
                limitations: plan.lockedPolicy.candidate.fitting.limitations,
              }
            : {
                status: "calibration_unavailable",
                reason:
                  "No eligible observation/review fit and separately locked policy supplied; explicit thresholds are experimental hypotheses.",
              },
        }
      : {}),
    results,
    summary: aggregateResults(results),
    pairedComparisons: pairedComparisons(results),
    simulationLimitations:
      "Isolated current-node snapshot, empty carried evidence, target assumed initially rendered, synthetic turn/source identity and local time. No live rendering/audio/drain events, whole-session carry, scene transition or live end-to-end evidence established.",
  };
}
export type RunResult = Awaited<ReturnType<typeof runComparison>>;

function rawChoices(outputs: ConversationStateOutputs) {
  return Object.fromEntries(
    Object.entries({
      objectiveState: outputs.objectiveState,
      tutorState: outputs.tutorState,
      ...outputs.concepts,
      ...outputs.sources,
    }).map(([key, answer]) => [key, answer.choice]),
  );
}
export function pairedComparisons(
  results: {
    caseId: string;
    repetition: number;
    arm: Arm;
    category: string;
    normalized: ConversationStateOutputs | null;
    mapped: { proposal: ConversationStateProposal | null };
    replay: ReturnType<typeof replayReducer>;
  }[],
) {
  return results
    .filter(row => row.arm === "jev")
    .map(jev => {
      const decisions = results.find(
        row => row.arm === "decisions" && row.caseId === jev.caseId && row.repetition === jev.repetition,
      )!;
      return {
        caseId: jev.caseId,
        repetition: jev.repetition,
        categories: { jev: jev.category, decisions: decisions.category },
        rawChoicesEqual:
          jev.normalized && decisions.normalized
            ? valueHash(rawChoices(jev.normalized)) === valueHash(rawChoices(decisions.normalized))
            : null,
        mappedProposalsEqual:
          jev.mapped.proposal && decisions.mapped.proposal
            ? valueHash(jev.mapped.proposal) === valueHash(decisions.mapped.proposal)
            : null,
        reducerAcceptance: { jev: jev.replay.proposalAccepted, decisions: decisions.replay.proposalAccepted },
        resultingEvidenceEqual:
          jev.replay.proposalAccepted && decisions.replay.proposalAccepted
            ? valueHash(jev.replay.evidence) === valueHash(decisions.replay.evidence)
            : null,
        uiEvidence: null,
      };
    });
}

/** Nearest-rank: sorted[ceil(p*n)-1]. Empty => null; n<20 explicitly small, no tail inference. */
export function latencySummary(values: number[]) {
  assert(
    values.every(v => Number.isFinite(v) && v >= 0),
    "invalid latency sample",
  );
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => (sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null);
  return {
    n: sorted.length,
    p50: q(0.5),
    p95: q(0.95),
    smallSample: sorted.length < 20,
    convention: "nearest-rank; <20 samples do not establish tail latency",
  };
}
export function aggregateResults(
  results: {
    arm: Arm;
    caseId: string;
    kind: string;
    category: string;
    normalized: ConversationStateOutputs | null;
    factored?: FactoredObservation | null;
    measurement: Attempt;
  }[],
) {
  return Object.fromEntries(
    (["jev", "decisions"] as const).map(arm => {
      const rows = results.filter(r => r.arm === arm);
      const observed = rows.filter(
        r => r.kind === "fresh_provider_measurement" && (r.normalized !== null || !!r.factored),
      );
      const stability = [...new Set(rows.map(r => r.caseId))].map(caseId => {
        const samples = observed.filter(r => r.caseId === caseId);
        const labels = samples.map(r =>
          r.factored
            ? valueHash(r.factored)
            : valueHash({
                objective: r.normalized!.objectiveState.choice,
                tutor: r.normalized!.tutorState.choice,
                concepts: Object.fromEntries(
                  Object.entries(r.normalized!.concepts ?? {}).map(([k, a]) => [k, a.choice]),
                ),
                sources: Object.fromEntries(Object.entries(r.normalized!.sources ?? {}).map(([k, a]) => [k, a.choice])),
              }),
        );
        return {
          caseId,
          validObservations: samples.length,
          stable: samples.length < 2 ? null : new Set(labels).size === 1,
        };
      });
      return [
        arm,
        {
          requestsStarted: rows.reduce((n, r) => n + r.measurement.requestCount, 0),
          observedProviderClassifications: observed.length,
          categories: Object.fromEntries(
            [...new Set(rows.map(r => r.category))].map(k => [k, rows.filter(r => r.category === k).length]),
          ),
          successfulProviderRequestLatencyMs: latencySummary(
            observed.flatMap(r =>
              r.measurement.calls
                ? r.measurement.calls.flatMap(c => (c.latencyMs === null ? [] : [c.latencyMs]))
                : r.measurement.latencyMs === null
                  ? []
                  : [r.measurement.latencyMs],
            ),
          ),
          allProviderAttemptLatencyMs: latencySummary(
            rows
              .filter(r => r.kind === "fresh_provider_measurement" && r.measurement.requestCount > 0)
              .flatMap(r =>
                r.measurement.calls
                  ? r.measurement.calls.flatMap(c => (c.latencyMs === null ? [] : [c.latencyMs]))
                  : r.measurement.latencyMs === null
                    ? []
                    : [r.measurement.latencyMs],
              ),
          ),
          usageAvailableRequests: rows
            .filter(r => r.kind === "fresh_provider_measurement")
            .reduce(
              (n, r) =>
                n +
                (r.measurement.calls
                  ? r.measurement.calls.filter(c => c.usage !== null).length
                  : r.measurement.usage !== null
                    ? 1
                    : 0),
              0,
            ),
          costUsd: null,
          liveEndToEndMs: null,
          stability,
        },
      ];
    }),
  );
}
