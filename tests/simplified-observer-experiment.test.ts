import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import report from "../docs/issue-57-simplified-observer-comparison.json";
import { JEV_MODEL } from "../lib/jev";
import {
  SIMPLIFIED_QUESTIONS,
  classifySimplifiedObserver,
  mapSimplifiedObservation,
  normalizeSimplifiedOutputs,
  simplifiedObserverState,
  type ObjectiveState,
  type ExperimentalTutorState,
  type SimplifiedOutputs,
} from "../lib/experiments/issue-57/simplified-observer";
import {
  CONVERSATION_QUESTIONS,
  classifyConversationStateWithDiagnostics,
} from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { isCountingNodeId } from "../lib/lesson-runtime/counting-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { conversationProviderBody } from "./fixtures/conversation-classification";

const input = {
  nodeId: "count-1-duck" as const,
  transcriptRevision: 2,
  transcript: "Child: One\nTutor: Yes, one duck.",
};
function outputs(
  objective: ObjectiveState = "completed",
  tutor: ExperimentalTutorState = "confirmed_completion",
  p = 0.96,
): SimplifiedOutputs {
  const distribution = <T extends string>(options: readonly T[], choice: T) => ({
    choice,
    confidence: 0.96,
    probabilities: Object.fromEntries(
      options.map(option => [option, option === choice ? p : (1 - p) / (options.length - 1)]),
    ) as Record<T, number>,
  });
  return {
    objectiveState: distribution(
      Object.keys(SIMPLIFIED_QUESTIONS.objectiveState.criteria) as ObjectiveState[],
      objective,
    ),
    tutorState: distribution(Object.keys(SIMPLIFIED_QUESTIONS.tutorState.criteria) as ExperimentalTutorState[], tutor),
  };
}
function body(values = outputs()) {
  return {
    model: JEV_MODEL,
    answers: {
      objectiveState: { type: "choice", ...values.objectiveState },
      tutorState: { type: "choice", ...values.tutorState },
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(Object.keys(SIMPLIFIED_QUESTIONS.objectiveState.criteria) as ObjectiveState[])(
  "only completed plus confirmed_completion emits evidence: %s",
  objective => {
    for (const tutor of Object.keys(SIMPLIFIED_QUESTIONS.tutorState.criteria) as ExperimentalTutorState[]) {
      const decision = mapSimplifiedObservation(input, outputs(objective, tutor));
      if (objective === "completed" && tutor === "confirmed_completion") {
        expect(decision.outcome).toBe("allow_semantic_completion_evidence");
        expect(decision.proposal).toEqual({
          nodeId: input.nodeId,
          transcriptRevision: 2,
          childActivity: "unknown",
          answerOutcome: "correct",
          supportState: "none",
          tutorState: "acknowledging",
        });
      } else {
        expect(decision.proposal).toBeNull();
        expect(decision.outcome).toBe(tutor === "confirmed_completion" ? "unresolved" : "hold_scene");
      }
    }
  },
);

it("retains probability gates and reports label eligibility separately", () => {
  expect(mapSimplifiedObservation(input, outputs("completed", "confirmed_completion", 0.899))).toMatchObject({
    status: "abstained",
    labelCompletionEligible: true,
    proposal: null,
  });
  expect(mapSimplifiedObservation(input, outputs("completed", "confirmed_completion", 0.9)).status).toBe("accepted");
});
it.each([
  (b: ReturnType<typeof body>) => {
    b.answers.objectiveState.probabilities.completed = Number.NaN;
  },
  (b: ReturnType<typeof body>) => {
    b.answers.objectiveState.probabilities.completed = 1.2;
  },
  (b: ReturnType<typeof body>) => {
    delete (b.answers.objectiveState.probabilities as Partial<Record<ObjectiveState, number>>).no_attempt;
  },
  (b: ReturnType<typeof body>) => {
    Object.assign(b.answers.objectiveState.probabilities, { nextNode: 0 });
  },
  (b: ReturnType<typeof body>) => {
    b.answers.objectiveState.probabilities.completed = 0.5;
  },
  (b: ReturnType<typeof body>) => {
    b.answers.objectiveState.confidence = Infinity;
  },
  (b: ReturnType<typeof body>) => {
    b.answers.objectiveState.choice = "incorrect";
  },
])("rejects malformed Choice outputs", mutate => {
  const raw = body();
  mutate(raw);
  expect(normalizeSimplifiedOutputs(raw)).toBeNull();
});

it.each(report.cases)(
  "uses exactly A's current projection for $id (mocked A, no semantic evaluation)",
  async example => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json(conversationProviderBody()),
    );
    vi.stubGlobal("fetch", fetch);
    if (!isCountingNodeId(example.input.nodeId)) throw new Error("Invalid review node");
    const snapshot = { ...example.input, nodeId: example.input.nodeId };
    await classifyConversationStateWithDiagnostics(snapshot, new AbortController().signal);
    const wire = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string);
    expect(wire.state).toEqual(simplifiedObserverState(snapshot));
    expect(wire.questions).toEqual(CONVERSATION_QUESTIONS);
  },
);

it("validates the actual Choice wire format and captures identity before awaiting", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const mutable = { ...input };
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    mutable.transcriptRevision = 999;
    return Response.json({ ...body(), nodeId: "count-3-butterflies", nextNode: "complete" });
  });
  vi.stubGlobal("fetch", fetch);
  const decision = await classifySimplifiedObserver(mutable, new AbortController().signal);
  expect(decision.proposal?.transcriptRevision).toBe(2);
  expect(decision.proposal?.nodeId).toBe(input.nodeId);
  const wire = JSON.parse(fetch.mock.calls[0][1].body as string);
  expect(wire).toEqual({ model: JEV_MODEL, state: simplifiedObserverState(input), questions: SIMPLIFIED_QUESTIONS });
  expect(fetch).toHaveBeenCalledOnce();
});
it("does not call an unconfigured or already cancelled provider", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await classifySimplifiedObserver(input, new AbortController().signal)).reason).toBe("provider_unconfigured");
  const controller = new AbortController();
  controller.abort();
  expect((await classifySimplifiedObserver(input, controller.signal)).reason).toBe("cancelled");
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  ["model mismatch", () => Response.json({ ...body(), model: "jev-latest" }), "provider_model_mismatch"],
  ["rejection", () => new Response("private body", { status: 429 }), "provider_rejected"],
  ["unreadable", () => new Response("private body"), "provider_model_mismatch"],
  ["missing choice", () => Response.json({ model: JEV_MODEL, answers: {} }), "provider_unreadable"],
] as const)("holds on %s without retrying or exposing bodies", async (_label, response, reason) => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const fetch = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetch);
  expect(await classifySimplifiedObserver(input, new AbortController().signal)).toMatchObject({
    reason,
    outputs: null,
    proposal: null,
  });
  expect(fetch).toHaveBeenCalledOnce();
});
it("rejects a valid response cancelled while in flight", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      controller.abort();
      return Response.json(body());
    }),
  );
  expect((await classifySimplifiedObserver(input, controller.signal)).reason).toBe("cancelled");
});

function runtime() {
  let state = createLessonRuntime("experiment");
  const send = (event: LessonRuntimeEvent) => {
    const result = reduceLessonRuntime(state, event);
    state = result.state;
    return result;
  };
  send({ type: "child.turn.started", source: runtimeSource(state), atMs: 1 });
  send({ type: "transcript.updated", source: runtimeSource(state), speaker: "child", revision: 1, atMs: 2 });
  send({ type: "child.turn.ended", source: runtimeSource(state), atMs: 3 });
  send({ type: "transcript.updated", source: runtimeSource(state), speaker: "tutor", revision: 2, atMs: 4 });
  return {
    send,
    get state() {
      return state;
    },
  };
}
const proposal = () => mapSimplifiedObservation(input, outputs()).proposal!;

describe("candidate evidence through the unchanged reducer (synthetic labels only)", () => {
  it("requires relevant audio drain and render confirmation before authored steering", () => {
    const r = runtime();
    r.send({ type: "proposal.received", source: classificationSource(r.state)!, proposal: proposal(), atMs: 5 });
    r.send({ type: "clock.tick", source: runtimeSource(r.state), atMs: 300 });
    expect(r.state.phase).toBe("active");
    r.send({ type: "output.activity", source: runtimeSource(r.state), state: "active", atMs: 301 });
    r.send({ type: "output.activity", source: runtimeSource(r.state), state: "quiet", atMs: 302 });
    expect(r.send({ type: "clock.tick", source: runtimeSource(r.state), atMs: 600 }).effects).toMatchObject([
      { type: "render.requested", identity: { nodeId: "count-2-ducks" } },
    ]);
    expect(r.state.phase).toBe("rendering");
    expect(
      r.send({
        type: "render.confirmed",
        runtimeId: "experiment",
        identity: r.state.pendingRender!.identity,
        atMs: 601,
      }).effects,
    ).toMatchObject([{ type: "steering.ready", context: { nodeId: "count-2-ducks" } }]);
  });
  it.each([
    { runtimeId: "old" },
    { visitId: 9 },
    { childTurnId: 9 },
    { nodeId: "count-2-ducks" as const },
    { transcriptRevision: 1 },
  ])("rejects stale or mismatched source %j", overrides => {
    const r = runtime();
    const previous = r.state;
    r.send({
      type: "proposal.received",
      source: { ...classificationSource(r.state)!, ...overrides },
      proposal: proposal(),
      atMs: 5,
    });
    expect(r.state).toBe(previous);
  });
  it.each(["child.turn.started", "child.candidate.started"] as const)("holds after interruption %s", type => {
    const r = runtime();
    const old = classificationSource(r.state)!;
    r.send({ type, source: runtimeSource(r.state), atMs: 5 });
    r.send({ type: "proposal.received", source: old, proposal: proposal(), atMs: 6 });
    r.send({ type: "output.activity", source: runtimeSource(r.state), state: "quiet", atMs: 7 });
    r.send({ type: "clock.tick", source: runtimeSource(r.state), atMs: 600 });
    expect(r.state.phase).toBe("active");
    expect(r.state.pendingRender).toBeNull();
  });
  it("does not reuse settled evidence for a confirmed child turn without fresh text", () => {
    const r = runtime();
    const old = classificationSource(r.state)!;
    r.send({ type: "child.candidate.started", source: runtimeSource(r.state), atMs: 5 });
    r.send({ type: "child.turn.confirmed", source: runtimeSource(r.state), atMs: 6 });
    r.send({ type: "child.turn.ended", source: runtimeSource(r.state), atMs: 7 });
    expect(classificationSource(r.state)).toBeNull();
    r.send({ type: "proposal.received", source: old, proposal: proposal(), atMs: 8 });
    expect(r.state.answerAccepted).toBe(false);
  });
});
it("freezes the exact two-arm request plan and leaves measured B results absent", () => {
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  expect(report.contractHashes.A).toBe(hash({ model: JEV_MODEL, questions: CONVERSATION_QUESTIONS }));
  expect(report.contractHashes.B).toBe(hash({ model: JEV_MODEL, questions: SIMPLIFIED_QUESTIONS }));
  expect(report.evaluationPlan.calls).toBe(report.cases.length * 4);
  expect(new Set(report.evaluationPlan.requests.map(r => r.id)).size).toBe(report.evaluationPlan.calls);
  for (const row of report.cases) {
    expect(row.simplifiedB.normalizedOutput).toBeNull();
    if (!isCountingNodeId(row.input.nodeId)) throw new Error("Invalid node");
    expect(row.inputHash).toBe(hash(simplifiedObserverState({ ...row.input, nodeId: row.input.nodeId })));
  }
});
