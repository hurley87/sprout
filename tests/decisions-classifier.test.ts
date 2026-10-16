import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createDecisionsClassifier,
  createDecisionsHttpTransport,
  decisionsRequest,
  DECISIONS_ENDPOINT,
  DECISIONS_MODEL,
  type DecisionsRequest,
  type DecisionsTransport,
} from "../lib/experiments/issue-42/decisions-classifier";
import {
  conversationObserverState,
  conversationStateQuestions,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { ConversationStateClassifierInput } from "../lib/lesson-runtime/conversation-state-classifier";

const input: ConversationStateClassifierInput = {
  lesson: CATCHING_UNICORNS_LESSON,
  nodeId: "engram",
  transcriptRevision: 7,
  transcript: "Tutor: What is an engram?\nChild: A memory held inside my brain.\nTutor: Yes, that explains it.",
};
// Synthetic gates exercise mapping, not empirically calibrated model thresholds.
const policy = { minProbability: 0.8, minConfidence: 0.6, minMargin: 0.5 };
const signal = () => new AbortController().signal;
function answer(q: DecisionsRequest["questions"][number], choice: string, p = 0.96) {
  return {
    type: "choice",
    name: q.name,
    choice,
    confidence: 0.87,
    probabilities: q.choices.map(c => ({
      value: c.value,
      probability: c.value === choice ? p : (1 - p) / (q.choices.length - 1),
    })),
  };
}
function body(request = decisionsRequest(input)!) {
  return {
    model: DECISIONS_MODEL,
    answers: request.questions.map(q =>
      answer(
        q,
        q.name === "objectiveState"
          ? "completed"
          : q.name === "tutorState"
            ? "confirmed_completion"
            : (q.name.startsWith("source_") || q.name.startsWith("sourceEnd_"))
              ? "message_1"
              : "demonstrated_independent",
      ),
    ),
    usage: { input_tokens: 120, output_tokens: 0, total_tokens: 120 },
  };
}
function adapter(value: unknown = body(), mappingPolicy: typeof policy | undefined = policy) {
  const transport = vi.fn<DecisionsTransport>(async () => ({ ok: true, body: value }));
  return { transport, ...createDecisionsClassifier({ transport, mappingPolicy }) };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("preserves exact authored state, instructions, criteria and source options for every node in both lessons", () => {
  for (const lesson of [COUNTING_LESSON, CATCHING_UNICORNS_LESSON])
    for (const nodeId of Object.keys(lesson.nodes)) {
      const snapshot = { ...input, lesson, nodeId };
      const request = decisionsRequest(snapshot)!;
      expect(JSON.parse(request.input)).toEqual(conversationObserverState(snapshot));
      expect(request.questions).toEqual(
        Object.entries(conversationStateQuestions(lesson, nodeId, snapshot.transcript)).map(([name, q]) => ({
          type: "choice",
          name,
          instructions: q.instructions,
          choices: Object.entries(q.criteria).map(([value, description]) => ({ value, description })),
        })),
      );
    }
});
it("normalizes array distributions without substituting confidence and proposes exact identity/source", async () => {
  const a = adapter();
  const result = await a.classifyWithDiagnostics(input, signal());
  expect(result).toMatchObject({
    status: "accepted",
    outputs: { objectiveState: { confidence: 0.87, probabilities: { completed: 0.96 } } },
    proposal: {
      nodeId: "engram",
      transcriptRevision: 7,
      childActivity: "unknown",
      conceptObservations: [
        { criterionId: "engram-biological", observation: "demonstrated_independent", childMessageIndex: 1 },
      ],
    },
  });
  expect(a.transport).toHaveBeenCalledOnce();
  expect(await a.classify(input, signal())).toEqual(result.proposal);
});
it("requires explicit experimental policy before emitting a proposal", async () => {
  const a = createDecisionsClassifier({ transport: adapter().transport });
  expect(await a.classifyWithDiagnostics(input, signal())).toMatchObject({
    reason: "decisions_mapping_unconfigured",
    proposal: null,
    outputs: { objectiveState: { choice: "completed" } },
  });
});
it("keeps prompting unresolved when only the combined demonstration is clear", async () => {
  const b = body();
  const a = b.answers[2];
  a.choice = "demonstrated_prompted";
  a.probabilities = a.probabilities.map(p => ({
    ...p,
    probability: p.value === "demonstrated_independent" ? 0.45 : p.value === "demonstrated_prompted" ? 0.5 : 0.025,
  }));
  expect(await adapter(b).classify(input, signal())).toMatchObject({
    conceptObservations: [{ observation: "demonstrated_unattributed", childMessageIndex: 1 }],
  });
});
it("does not invent concept demonstrations from objective completion or tutor affirmation", async () => {
  const b = body();
  b.answers[2] = answer(decisionsRequest(input)!.questions[2], "not_yet");
  b.answers[3] = answer(decisionsRequest(input)!.questions[3], "none");
  expect(await adapter(b).classify(input, signal())).toMatchObject({
    conceptObservations: [{ observation: "not_yet", childMessageIndex: null }],
  });
});
it.each(["none", "message_0", "message_2", "message_99"])(
  "fails closed on missing, tutor or out-of-snapshot source %s",
  async source => {
    const b = body();
    b.answers[3].choice = source;
    b.answers[3].probabilities = [
      { value: source, probability: 0.96 },
      { value: source === "none" ? "message_1" : "none", probability: 0.04 },
    ];
    const result = await adapter(b).classifyWithDiagnostics(input, signal());
    expect(result.status).toBe("abstained");
    expect(result.proposal).toBeNull();
    expect(result.reason).toBe(source === "none" ? "learner_source_unresolved" : "provider_invalid_probabilities");
  },
);
it("rejects an uncertain locator even if the concept is confident", async () => {
  const b = body();
  b.answers[3] = answer(decisionsRequest(input)!.questions[3], "message_1", 0.6);
  expect(await adapter(b).classifyWithDiagnostics(input, signal())).toMatchObject({
    reason: "learner_source_unresolved",
  });
});
it.each(["Tutor: You know this.\nChild: Yep.", "Tutor: You know this."])(
  "abstains without inventing an option for sole-none sources",
  async transcript => {
    const a = adapter();
    expect(await a.classifyWithDiagnostics({ ...input, transcript }, signal())).toMatchObject({
      reason: "learner_source_unavailable",
    });
    expect(a.transport).not.toHaveBeenCalled();
  },
);
it("uses merged learner fragment indexes from the exact snapshot", async () => {
  const snapshot = {
    ...input,
    transcript: "Tutor: Explain it.\nChild: A memory\nChild: inside my brain.\nTutor: Yes.",
  };
  expect(await adapter(body(decisionsRequest(snapshot)!)).classify(snapshot, signal())).toMatchObject({
    conceptObservations: [{ childMessageIndex: 1 }],
  });
});

describe("contract failures", () => {
  it.each([
    [
      "missing answers",
      (b: ReturnType<typeof body>) => {
        b.answers.pop();
      },
      "provider_missing_or_extra_answers",
    ],
    [
      "extra answer",
      (b: ReturnType<typeof body>) => {
        b.answers.push(b.answers[0]);
      },
      "provider_missing_or_extra_answers",
    ],
    [
      "duplicate name",
      (b: ReturnType<typeof body>) => {
        b.answers[1].name = b.answers[0].name;
      },
      "provider_answer_identity_mismatch",
    ],
    [
      "refusal",
      (b: ReturnType<typeof body>) => {
        b.answers[2].type = "refusal";
      },
      "provider_refused",
    ],
    [
      "unknown model",
      (b: ReturnType<typeof body>) => {
        b.model = "other";
      },
      "provider_model_mismatch",
    ],
    [
      "missing model",
      (b: ReturnType<typeof body>) => {
        Reflect.deleteProperty(b, "model");
      },
      "provider_model_unverifiable",
    ],
    [
      "typed boolean",
      (b: ReturnType<typeof body>) => {
        Reflect.set(b.answers[0], "choice", true);
      },
      "provider_invalid_choice",
    ],
    [
      "wrong answer type",
      (b: ReturnType<typeof body>) => {
        b.answers[0].type = "predicate";
      },
      "provider_invalid_choice",
    ],
    [
      "nonfinite confidence",
      (b: ReturnType<typeof body>) => {
        b.answers[0].confidence = NaN;
      },
      "provider_invalid_choice",
    ],
  ])("abstains for %s", async (_, mutate, reason) => {
    const b = body();
    mutate(b);
    expect(await adapter(b).classifyWithDiagnostics(input, signal())).toMatchObject({
      status: "abstained",
      reason,
      proposal: null,
    });
  });
  it.each([NaN, Infinity, -0.1, 1.1, "0.96", null])("rejects invalid probability %s", async value => {
    const b = body();
    Reflect.set(b.answers[0].probabilities[0], "probability", value);
    expect(await adapter(b).classifyWithDiagnostics(input, signal())).toMatchObject({
      reason: "provider_invalid_probabilities",
    });
  });
  it.each(["duplicate", "missing", "unknown", "bad total", "losing selection"])(
    "rejects %s probability distribution",
    async kind => {
      const b = body();
      const a = b.answers[0];
      if (kind === "duplicate") a.probabilities[1] = a.probabilities[0];
      if (kind === "missing") a.probabilities.pop();
      if (kind === "unknown") a.probabilities[0].value = "surprise";
      if (kind === "bad total") a.probabilities[0].probability = 0.94;
      if (kind === "losing selection") a.choice = a.probabilities[1].value;
      expect(await adapter(b).classifyWithDiagnostics(input, signal())).toMatchObject({
        reason: "provider_invalid_probabilities",
      });
    },
  );
  it("does not infer an immutable model version from an alias or retain usage/raw fields", async () => {
    const b = { ...body(), privateResponse: "must not escape", usage: { input_tokens: 120 } };
    const result = await adapter(b).classifyWithDiagnostics(input, signal());
    expect(result.status).toBe("accepted");
    expect(JSON.stringify(result)).not.toMatch(/privateResponse|must not escape|usage|model/);
    expect(
      await adapter({ ...b, model: "gpt-6-luna-2099-01-01" }).classifyWithDiagnostics(input, signal()),
    ).toMatchObject({ reason: "provider_model_mismatch" });
  });
});

it("captures lesson, transcript, revision and policy before caller or transport mutation", async () => {
  const mutable = { ...structuredClone(input) };
  const gates = { ...policy };
  let finish!: (v: { ok: boolean; body: unknown }) => void;
  const transport: DecisionsTransport = async request => {
    request.model = "wrong" as typeof DECISIONS_MODEL;
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  const a = createDecisionsClassifier({ transport, mappingPolicy: gates });
  const pending = a.classifyWithDiagnostics(mutable, signal());
  mutable.nodeId = "exogram";
  mutable.transcriptRevision = 999;
  mutable.transcript = "Tutor: Changed";
  Reflect.set(mutable.lesson!.nodes.engram, "concepts", []);
  gates.minProbability = 1;
  finish({ ok: true, body: body() });
  expect(await pending).toMatchObject({
    proposal: { nodeId: "engram", transcriptRevision: 7, conceptObservations: [{ childMessageIndex: 1 }] },
  });
});
it("skips transport for invalid input, unsupported question limits or pre-cancellation", async () => {
  const a = adapter();
  for (const invalid of [
    { ...input, lesson: undefined },
    { ...input, nodeId: "absent" },
    { ...input, transcriptRevision: -1 },
    { ...input, transcript: "Unlabelled" },
  ])
    expect(await a.classifyWithDiagnostics(invalid, signal())).toMatchObject({ reason: "invalid_input" });
  const many = {
    ...input,
    transcript: Array.from({ length: 255 }, (_, i) => `Child: Explanation ${i}\nTutor: Continue`).join("\n"),
  };
  expect(await a.classifyWithDiagnostics(many, signal())).toMatchObject({ reason: "decisions_request_limits" });
  const c = new AbortController();
  c.abort();
  expect(await a.classifyWithDiagnostics(input, c.signal)).toMatchObject({ reason: "cancelled" });
  expect(a.transport).not.toHaveBeenCalled();
});
it.each(["cancelled", "timeout"])("settles %s even if transport ignores abort and later returns", async reason => {
  vi.useFakeTimers();
  const c = new AbortController();
  let finish!: (v: { ok: boolean; body: unknown }) => void;
  let wireSignal!: AbortSignal;
  const transport: DecisionsTransport = async (_r, s) => {
    wireSignal = s;
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  const a = createDecisionsClassifier({ transport, mappingPolicy: policy, timeoutMs: 50 });
  const pending = a.classifyWithDiagnostics(input, c.signal);
  if (reason === "cancelled") c.abort();
  else await vi.advanceTimersByTimeAsync(50);
  expect(await pending).toMatchObject({ reason, proposal: null });
  expect(wireSignal.aborted).toBe(true);
  finish({ ok: true, body: body() });
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
it.each([false, true])("normalizes transport rejection without exposing error details (%s)", async reject => {
  const transport: DecisionsTransport = async () => {
    if (reject) throw new Error("private failure");
    return { ok: false, body: "private failure" };
  };
  expect(await createDecisionsClassifier({ transport }).classifyWithDiagnostics(input, signal())).toEqual({
    status: "abstained",
    outcome: "unresolved",
    outputs: null,
    labelCompletionEligible: false,
    proposal: null,
    reason: reject ? "provider_unreachable" : "provider_rejected",
  });
});
it("sends one documented HTTP request with explicit credentials and no retry", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body()));
  const transport = createDecisionsHttpTransport("synthetic-test-key", fetcher);
  const a = createDecisionsClassifier({ transport, mappingPolicy: policy });
  expect((await a.classifyWithDiagnostics(input, signal())).status).toBe("accepted");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual([
    DECISIONS_ENDPOINT,
    expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer synthetic-test-key", "Content-Type": "application/json" },
      body: JSON.stringify(decisionsRequest(input)),
      signal: expect.any(AbortSignal),
    }),
  ]);
});
it("cancels while parsing HTTP response body", async () => {
  const c = new AbortController();
  let parsing!: () => void;
  const started = new Promise<void>(resolve => {
    parsing = resolve;
  });
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      ({
        ok: true,
        json: () => {
          parsing();
          return new Promise(() => {});
        },
      }) as Response,
  );
  const a = createDecisionsClassifier({
    transport: createDecisionsHttpTransport("synthetic", fetcher),
    mappingPolicy: policy,
  });
  const pending = a.classifyWithDiagnostics(input, c.signal);
  await started;
  c.abort();
  expect(await pending).toMatchObject({ reason: "cancelled" });
});
it("fails closed on invalid JSON and never parses HTTP error bodies", async () => {
  const json = vi.fn(async () => {
    throw new Error("private body");
  });
  for (const ok of [true, false]) {
    json.mockClear();
    const fetcher = vi.fn<typeof fetch>(async () => ({ ok, json }) as unknown as Response);
    const a = createDecisionsClassifier({ transport: createDecisionsHttpTransport("synthetic", fetcher) });
    expect(await a.classify(input, signal())).toBeNull();
    expect(json).toHaveBeenCalledTimes(ok ? 1 : 0);
  }
});
it("validates experiment settings", () => {
  for (const timeoutMs of [0, -1, Infinity, NaN])
    expect(() => createDecisionsClassifier({ transport: adapter().transport, timeoutMs })).toThrow();
  expect(() =>
    createDecisionsClassifier({ transport: adapter().transport, mappingPolicy: { ...policy, minConfidence: NaN } }),
  ).toThrow();
});

it("leaves evidence acceptance and stale identity rejection to the reducer", async () => {
  const lesson = CATCHING_UNICORNS_LESSON;
  let state = createLessonRuntime("decisions-contract", { lesson });
  state = reduceLessonRuntime(
    state,
    { type: "child.turn.started", source: runtimeSource(state), atMs: 1 },
    lesson,
  ).state;
  state = reduceLessonRuntime(
    state,
    { type: "transcript.updated", source: runtimeSource(state), revision: 1, speaker: "child", atMs: 2 },
    lesson,
  ).state;
  state = reduceLessonRuntime(state, { type: "child.turn.ended", source: runtimeSource(state), atMs: 3 }, lesson).state;
  const snapshot = { ...input, transcriptRevision: state.transcriptRevision };
  const proposal = (await adapter().classify(snapshot, signal()))!;
  const source = classificationSource(state)!;
  const stale = reduceLessonRuntime(
    state,
    {
      type: "proposal.received",
      source,
      transcriptSnapshot: snapshot.transcript,
      proposal: { ...proposal, transcriptRevision: proposal.transcriptRevision + 1 },
      atMs: 4,
    },
    lesson,
  ).state;
  expect(stale.conceptEvidence["engram:engram-biological"]?.source ?? null).toBeNull();
  const accepted = reduceLessonRuntime(
    state,
    { type: "proposal.received", source, transcriptSnapshot: snapshot.transcript, proposal, atMs: 4 },
    lesson,
  ).state;
  expect(accepted.conceptEvidence["engram:engram-biological"].source).toMatchObject({ childMessageIndex: 1 });
  expect(accepted.nodeId).toBe("engram");
});
it.each(["demonstrated_prompted", "partial"])("preserves a supported %s observation", async choice => {
  const b = body();
  b.answers[2] = answer(decisionsRequest(input)!.questions[2], choice);
  expect(await adapter(b).classify(input, signal())).toMatchObject({
    conceptObservations: [{ observation: choice, childMessageIndex: 1 }],
  });
});
it("supports objective/tutor-only counting proposals without manufacturing concepts", async () => {
  const snapshot = {
    lesson: COUNTING_LESSON,
    nodeId: "count-2-ducks",
    transcriptRevision: 4,
    transcript: "Child: Two\nTutor: Yes, two ducks.",
  };
  expect(await adapter(body(decisionsRequest(snapshot)!)).classify(snapshot, signal())).toEqual({
    nodeId: "count-2-ducks",
    transcriptRevision: 4,
    childActivity: "unknown",
    answerOutcome: "correct",
    supportState: "none",
    tutorState: "acknowledging",
  });
});
it.each(["confidence", "probability", "tie"])("holds uncertain %s without applying Jev gates", async kind => {
  const b = body();
  if (kind === "confidence") b.answers[0].confidence = 0.5;
  if (kind === "probability") b.answers[0] = answer(decisionsRequest(input)!.questions[0], "completed", 0.7);
  if (kind === "tie")
    b.answers[0].probabilities = b.answers[0].probabilities.map(p => ({
      ...p,
      probability: ["completed", "incorrect"].includes(p.value) ? 0.5 : 0,
    }));
  expect(await adapter(b).classifyWithDiagnostics(input, signal())).toMatchObject({
    reason: "decisions_uncertain_state",
    proposal: null,
  });
});
