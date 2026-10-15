/** Experimental server entry point. Never imported by production provider selection. */
import "server-only";
import type {
  ConversationStateClassifier,
  ConversationStateClassifierInput,
  ProposedConceptObservation,
} from "../../lesson-runtime/conversation-state-classifier";
import {
  abstain,
  conversationObserverState,
  conversationStateQuestions,
  type ChoiceOutput,
  type ConversationStateDecision,
  type ConversationStateOutputs,
} from "../../lesson-runtime/conversation-observer-contract";
import { substantiveLearnerText, transcriptMessages } from "../../lesson-runtime/tutor-observation";

export const DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";
export const DECISIONS_MODEL = "gpt-6-luna";
export type DecisionsChoiceQuestion = {
  type: "choice";
  name: string;
  instructions: string;
  choices: { value: string; description: string }[];
};
export type DecisionsRequest = {
  model: typeof DECISIONS_MODEL;
  input: string;
  questions: DecisionsChoiceQuestion[];
};
export type DecisionsTransport = (
  request: DecisionsRequest,
  signal: AbortSignal,
) => Promise<{ ok: boolean; body: unknown }>;

/** Caller-supplied experimental gates, NOT validated calibration or production defaults. */
export type DecisionsMappingPolicy = {
  minProbability: number;
  minConfidence: number;
  minMargin: number;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** Same authored state and questions, adapted only to the documented Decisions wire format. */
export function decisionsRequest(input: ConversationStateClassifierInput): DecisionsRequest | null {
  const state = conversationObserverState(input);
  if (!state || !input.lesson) return null;
  return {
    model: DECISIONS_MODEL,
    input: JSON.stringify(state),
    questions: Object.entries(conversationStateQuestions(input.lesson, input.nodeId, input.transcript)).map(
      ([name, q]) => ({
        type: "choice",
        name,
        instructions: q.instructions,
        choices: Object.entries(q.criteria).map(([value, description]) => ({ value, description })),
      }),
    ),
  };
}

/** Explicit credentials only: no environment reads, auto-configuration, retry, or fallback. */
export function createDecisionsHttpTransport(apiKey: string, fetcher: typeof fetch = fetch): DecisionsTransport {
  return async (request, signal) => {
    if (!apiKey.trim()) return { ok: false, body: null };
    const response = await fetcher(DECISIONS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    // Never parse or expose an error body.
    return { ok: response.ok, body: response.ok ? await response.json().catch(() => null) : null };
  };
}

/** Strict local contract checks; no Jev rounding tolerance or score conversion. */
function normalize(
  body: unknown,
  request: DecisionsRequest,
): { outputs: ConversationStateOutputs } | { reason: string } {
  if (!record(body) || typeof body.model !== "string" || !body.model) return { reason: "provider_model_unverifiable" };
  if (body.model !== request.model) return { reason: "provider_model_mismatch" };
  if (!Array.isArray(body.answers)) return { reason: "provider_unreadable" };
  if (body.answers.length !== request.questions.length) return { reason: "provider_missing_or_extra_answers" };
  const answers: Record<string, ChoiceOutput<string>> = Object.create(null);
  for (const [index, q] of request.questions.entries()) {
    const answer: unknown = body.answers[index];
    if (!record(answer) || answer.name !== q.name) return { reason: "provider_answer_identity_mismatch" };
    if (answer.type === "refusal") return { reason: "provider_refused" };
    if (
      answer.type !== "choice" ||
      typeof answer.choice !== "string" ||
      !probability(answer.confidence) ||
      !Array.isArray(answer.probabilities)
    )
      return { reason: "provider_invalid_choice" };
    const options = q.choices.map(c => c.value);
    if (!options.includes(answer.choice) || answer.probabilities.length !== options.length)
      return { reason: "provider_invalid_probabilities" };
    const values: Record<string, number> = Object.create(null);
    for (const entry of answer.probabilities) {
      if (
        !record(entry) ||
        typeof entry.value !== "string" ||
        !options.includes(entry.value) ||
        entry.value in values ||
        !probability(entry.probability)
      )
        return { reason: "provider_invalid_probabilities" };
      values[entry.value] = entry.probability;
    }
    if (
      Math.abs(Object.values(values).reduce((a, b) => a + b, 0) - 1) > 1e-6 ||
      Object.values(values).some(p => p > values[answer.choice as string])
    )
      return { reason: "provider_invalid_probabilities" };
    answers[q.name] = { choice: answer.choice, confidence: answer.confidence, probabilities: values };
  }
  const concepts = Object.fromEntries(Object.entries(answers).filter(([key]) => key.startsWith("concept_")));
  const sources = Object.fromEntries(Object.entries(answers).filter(([key]) => key.startsWith("source_")));
  return {
    outputs: {
      objectiveState: answers.objectiveState as ConversationStateOutputs["objectiveState"],
      tutorState: answers.tutorState as ConversationStateOutputs["tutorState"],
      ...(Object.keys(concepts).length ? { concepts: concepts as ConversationStateOutputs["concepts"], sources } : {}),
    },
  };
}

function map(
  input: ConversationStateClassifierInput,
  outputs: ConversationStateOutputs,
  policy?: DecisionsMappingPolicy,
): ConversationStateDecision {
  const labelCompletionEligible =
    outputs.objectiveState.choice === "completed" && outputs.tutorState.choice === "confirmed_completion";
  if (!policy) return abstain("decisions_mapping_unconfigured", outputs, labelCompletionEligible);
  const confident = (
    a: ChoiceOutput<string>,
    selected = a.probabilities[a.choice],
    alternatives = Object.entries(a.probabilities)
      .filter(([k]) => k !== a.choice)
      .map(([, p]) => p),
  ) =>
    a.confidence >= policy.minConfidence &&
    selected >= policy.minProbability &&
    alternatives.every(p => selected > p && selected - p >= policy.minMargin);
  const observations: ProposedConceptObservation[] = [];
  const messages = transcriptMessages(input.transcript)!;
  for (const [key, answer] of Object.entries(outputs.concepts ?? {})) {
    let observation: ProposedConceptObservation["observation"] | null = confident(answer) ? answer.choice : null;
    if (
      !observation &&
      confident(answer, answer.probabilities.demonstrated_independent + answer.probabilities.demonstrated_prompted, [
        answer.probabilities.not_yet,
        answer.probabilities.partial,
      ])
    )
      observation = "demonstrated_unattributed";
    if (!observation) continue;
    const criterionId = key.slice("concept_".length);
    const source = outputs.sources?.[`source_${criterionId}`];
    const index =
      source && confident(source) && /^message_(?:0|[1-9]\d*)$/u.test(source.choice)
        ? Number(source.choice.slice(8))
        : null;
    if (
      observation !== "not_yet" &&
      (index === null || messages[index]?.speaker !== "Child" || !substantiveLearnerText(messages[index].text))
    )
      return abstain("learner_source_unresolved", outputs, labelCompletionEligible);
    observations.push({ criterionId, observation, childMessageIndex: observation === "not_yet" ? null : index });
  }
  const objective = outputs.objectiveState;
  const tutor = outputs.tutorState;
  if (!confident(objective) || !confident(tutor))
    return abstain("decisions_uncertain_state", outputs, labelCompletionEligible);
  if (outputs.concepts && !observations.length)
    return abstain("decisions_uncertain_concepts", outputs, labelCompletionEligible);
  // Completion stays advisory. Never derive a concept from objective/tutor affirmation.
  const completion = input.lesson?.conversationFirst
    ? tutor.choice === "confirmed_completion"
    : labelCompletionEligible;
  if (!outputs.concepts && tutor.choice === "confirmed_completion" && objective.choice !== "completed")
    return abstain("confirmation_without_completion", outputs);
  return {
    status: "accepted",
    outcome: completion ? "allow_semantic_completion_evidence" : "hold_scene",
    outputs,
    labelCompletionEligible,
    proposal: {
      nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision,
      childActivity: "unknown",
      answerOutcome:
        objective.choice === "completed"
          ? "correct"
          : objective.choice === "incorrect"
            ? "incorrect"
            : objective.choice === "no_attempt"
              ? "none"
              : "unclear",
      supportState: objective.choice === "unresolved_help" ? "needs_help" : "none",
      tutorState:
        tutor.choice === "confirmed_completion"
          ? "acknowledging"
          : tutor.choice === "asking"
            ? "asking"
            : tutor.choice === "clarifying"
              ? "clarifying"
              : tutor.choice === "helping"
                ? "helping"
                : "unknown",
      ...(outputs.concepts ? { conceptObservations: observations } : {}),
    },
  };
}

/** No provider runs occur until the later authorized harness explicitly calls this factory's methods. */
export function createDecisionsClassifier(options: {
  transport: DecisionsTransport;
  mappingPolicy?: DecisionsMappingPolicy;
  timeoutMs?: number;
}): ConversationStateClassifier & {
  classifyWithDiagnostics(
    input: ConversationStateClassifierInput,
    signal: AbortSignal,
  ): Promise<ConversationStateDecision>;
} {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const policy = options.mappingPolicy && { ...options.mappingPolicy };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
    throw new Error("Invalid Decisions timeout");
  if (policy && ![policy.minProbability, policy.minConfidence, policy.minMargin].every(probability))
    throw new Error("Invalid Decisions mapping policy");
  const transport = options.transport;
  async function classifyWithDiagnostics(
    input: ConversationStateClassifierInput,
    signal: AbortSignal,
  ): Promise<ConversationStateDecision> {
    if (signal.aborted) return abstain("cancelled");
    // Freeze the complete lesson, identity, source projection and transcript before awaiting transport.
    const snapshot = structuredClone(input);
    const request = decisionsRequest(snapshot);
    if (!request) return abstain("invalid_input");
    // Decisions requires 2..255 options and 1..200 questions. A sole 'none' locator
    // cannot be sent faithfully; abstain instead of inventing a second option.
    if (request.questions.some(q => q.choices.length < 2)) return abstain("learner_source_unavailable");
    if (request.questions.length > 200 || request.questions.some(q => q.choices.length > 255))
      return abstain("decisions_request_limits");
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let onAbort!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Decisions request stopped"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      // Separate request copy prevents injected transports mutating normalization identity.
      const response = await Promise.race([transport(structuredClone(request), controller.signal), stopped]);
      if (controller.signal.aborted) return abstain(signal.aborted ? "cancelled" : "timeout");
      if (!response.ok) return abstain("provider_rejected");
      const normalized = normalize(response.body, request);
      return "reason" in normalized ? abstain(normalized.reason) : map(snapshot, normalized.outputs, policy);
    } catch {
      return abstain(signal.aborted ? "cancelled" : timedOut ? "timeout" : "provider_unreachable");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", onAbort);
    }
  }
  return {
    classifyWithDiagnostics,
    async classify(input, signal) {
      return (await classifyWithDiagnostics(input, signal)).proposal;
    },
  };
}
