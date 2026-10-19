import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/experiments/grok-counting/acknowledgment/route";
import {
  ACK_DEADLINE_MS,
  ACK_MODEL,
  requestAcknowledgment,
  type AckDecision,
  type AckInput,
} from "../lib/experiments/grok-counting/acknowledgment";
import { CountingProposals, OUTCOME_TOOL } from "../lib/experiments/grok-counting/proposals";
const input: AckInput = {
  requestId: "application-1",
  nodeId: "count-1-duck",
  expectedAnswer: "1 duck",
  learner: "One duck.",
  tutor: "Yes, one duck.",
};
const decision = (requestId: string, positive = true): AckDecision => ({
  requestId,
  outcome: positive ? "acknowledging" : "abstain",
  reason: positive ? "confirmed" : "low-confidence",
  modelValidated: true,
});
function request(value: unknown = input, headers = {}) {
  return new Request("http://127.0.0.1:3000/api/experiments/grok-counting/acknowledgment", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(value),
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each([
  ["Yes, one duck.", 0.99],
  ["One duck. That's right!", 0.98],
  ["You counted one duck correctly.", 0.97],
  ["Exactly! There is one duck.", 0.96],
  ["Great job!", 0.01],
  ["How many ducks do you see?", 0.01],
  ["Maybe one duck?", 0.1],
  ["No, there are two ducks", 0.01],
  ["Let's talk about trees", 0.01],
  ["That's...", 0.5],
] as const)("maps mocked semantic decision for %s", async (tutor, probability) => {
  vi.stubEnv("TYPESAFE_API_KEY", "server-only-secret");
  const fetch = vi.fn(async () =>
    Response.json({
      model: ACK_MODEL,
      answers: { acknowledgesValidatedAnswer: { noul: probability } },
      raw: "private",
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request({ ...input, tutor }));
  expect(await response.json()).toEqual({
    requestId: input.requestId,
    outcome: probability >= 0.95 ? "acknowledging" : "abstain",
    reason: probability >= 0.95 ? "confirmed" : probability <= 0.05 ? "not-confirmed" : "low-confidence",
    modelValidated: true,
  });
  const sent = JSON.parse((fetch.mock.calls as unknown as [string, RequestInit][])[0][1].body as string);
  expect(sent.model).toBe(ACK_MODEL);
  expect(Object.keys(sent.questions)).toEqual(["acknowledgesValidatedAnswer"]);
  expect(JSON.stringify(sent)).not.toContain("application-1");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it.each([
  {},
  { model: "other", answers: { acknowledgesValidatedAnswer: { noul: 1 } } },
  { answers: { acknowledgesValidatedAnswer: { noul: 1 } } },
  { model: ACK_MODEL },
  { model: ACK_MODEL, answers: { acknowledgesValidatedAnswer: { noul: "1" } } },
])("abstains on missing identity or malformed provider output", async body => {
  vi.stubEnv("TYPESAFE_API_KEY", "secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
  const response = await POST(request());
  expect(await response.json()).toMatchObject({ outcome: "abstain", modelValidated: false });
});
it.each([
  null,
  [],
  {},
  { ...input, extra: true },
  { ...input, learner: "" },
  { ...input, tutor: "x".repeat(2001) },
  { ...input, expectedAnswer: "2 ducks" },
  { ...input, requestId: "bad id" },
  { ...input, nodeId: "unknown" },
  { ...input, tutor: 1 },
])("rejects invalid request before provider access", async value => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request(value))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("enforces local origin, content type and byte limit", async () => {
  expect((await POST(request(input, { origin: "https://evil.example" }))).status).toBe(403);
  expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
  expect((await POST(request({ ...input, tutor: "x".repeat(12000) }))).status).toBe(413);
});
it.each(["unconfigured", "rejected", "unreachable"])("abstains safely on %s", async reason => {
  vi.stubEnv("TYPESAFE_API_KEY", reason === "unconfigured" ? "" : "secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (reason === "rejected") return Response.json({ private: "secret" }, { status: 401 });
      throw new Error("secret");
    }),
  );
  const response = await POST(request());
  const body = await response.json();
  expect(body).toMatchObject({ outcome: "abstain", reason });
  expect(JSON.stringify(body)).not.toContain("secret");
});
function fixture(nodeId = "count-1-duck", learner = "One duck.") {
  vi.useFakeTimers();
  const requests: { input: AckInput; signal: AbortSignal; resolve: (decision: AckDecision) => void }[] = [];
  const classifier = vi.fn(
    (input: AckInput, signal: AbortSignal) =>
      new Promise<AckDecision>(resolve => requests.push({ input, signal, resolve })),
  );
  const adapter = new CountingProposals(crypto.randomUUID(), "grok-jev", classifier);
  adapter.state = { ...adapter.state, nodeId };
  const token = JSON.parse(adapter.issueContext()!).context_token;
  adapter.acknowledgeContext();
  adapter.speechStarted("learner");
  adapter.speechStopped("learner");
  adapter.transcript({ id: "learner", speaker: "Learner", text: learner, final: true });
  adapter.responseCreated("r1");
  const call = () =>
    adapter.call({
      response_id: "r1",
      call_id: "c1",
      name: OUTCOME_TOOL.name,
      arguments: JSON.stringify({
        context_token: token,
        supporting_text: learner,
        answer_outcome: "correct",
        support_state: "none",
      }),
    });
  const tutor = (text = "One duck. That's right!") => {
    adapter.spoken("r1");
    adapter.transcript({ id: "tutor", speaker: "Tutor", text, final: true }, "r1");
    adapter.tick();
  };
  const finish = async (index = 0, positive = true) => {
    requests[index].resolve(decision(requests[index].input.requestId, positive));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { adapter, call, tutor, requests, classifier, finish };
}
it.each(["before", "after"])("requires audio drain when Jev completes %s it", async order => {
  const f = fixture();
  f.call();
  f.tutor();
  expect(f.requests).toHaveLength(1); // starts before response.done, while playback can run
  f.adapter.output(true, "tutor");
  f.adapter.responseDone("r1", "completed");
  if (order === "before") {
    await f.finish();
    expect(f.adapter.state.phase).toBe("active");
  }
  f.adapter.output(false);
  f.adapter.tick();
  if (order === "after") {
    await vi.advanceTimersByTimeAsync(1000);
    f.adapter.tick();
    expect(f.adapter.state.phase).toBe("active");
    await f.finish();
  }
  await vi.advanceTimersByTimeAsync(300);
  f.adapter.tick();
  expect(f.adapter.state.phase).toBe("rendering");
  expect(f.adapter.confirmRender({ ...f.adapter.state.pendingRender!.identity, token: "wrong" })).toBe(false);
  expect(f.adapter.confirmRender(f.adapter.state.pendingRender!.identity)).toBe(true);
  expect(f.adapter.state.nodeId).toBe("count-2-ducks");
});
it("positive classification cannot supply missing acknowledgment audio", async () => {
  const f = fixture();
  f.call();
  f.tutor();
  f.adapter.responseDone("r1", "completed");
  await f.finish();
  await vi.advanceTimersByTimeAsync(1000);
  f.adapter.tick();
  expect(f.adapter.state.phase).toBe("active");
  expect(f.adapter.recoveryReason).toBe("missing-acknowledgment-audio");
  expect(f.adapter.state.acknowledgmentObserved).toBe(false);
});
it("does not classify a tutor answer before a validated learner tool report", () => {
  const f = fixture();
  f.tutor();
  expect(f.requests).toHaveLength(0);
});
it("deduplicates finals and replaces changed tutor text", async () => {
  const f = fixture();
  f.call();
  f.tutor();
  f.tutor();
  expect(f.requests).toHaveLength(1);
  f.tutor("Exactly! There is one duck.");
  expect(f.requests).toHaveLength(2);
  expect(f.requests[0].signal.aborted).toBe(true);
  await f.finish(0);
  expect(f.adapter.state.acknowledgmentObserved).toBe(false);
  await f.finish(1);
  expect(f.adapter.decisionTimeline.filter(e => e.type === "classification.completed")).toHaveLength(1);
});
it.each(["interrupt", "correction", "cancel", "supersede", "scene", "stop"])(
  "invalidates classification on %s",
  async action => {
    const f = fixture();
    f.call();
    f.tutor();
    if (action === "interrupt") f.adapter.speechStarted("new");
    if (action === "correction")
      f.adapter.transcript({ id: "learner", speaker: "Learner", text: "Two ducks.", final: true });
    if (action === "cancel") f.adapter.responseDone("r1", "cancelled");
    if (action === "supersede") f.adapter.responseCreated("r2");
    if (action === "scene")
      f.adapter.state = { ...f.adapter.state, nodeId: "count-2-ducks", visitId: f.adapter.state.visitId + 1 };
    if (action === "stop") f.adapter.stop();
    await f.finish();
    expect(f.adapter.state.acknowledgmentObserved).toBe(false);
    expect(f.adapter.state.pendingRender).toBeNull();
    expect(f.adapter.decisionTimeline.some(e => e.type === "classification.stale")).toBe(true);
  },
);
it.each(["abstention", "timeout"])(
  "holds recovery while pending, then preserves one continuation on %s",
  async reason => {
    const f = fixture();
    f.call();
    f.tutor("Great job!");
    f.adapter.responseDone("r1", "completed");
    expect(f.adapter.recoveryReason).toBeUndefined();
    if (reason === "timeout") await vi.advanceTimersByTimeAsync(ACK_DEADLINE_MS);
    else await f.finish(0, false);
    expect(f.adapter.recoveryReason).toBe("missing-acknowledgment");
    expect(f.adapter.learnerAnswerAccepted).toBe(true);
    expect(f.adapter.takeRecovery()).toBe("missing-acknowledgment");
    f.adapter.responseCreated("recovery");
    f.adapter.spoken("recovery");
    f.adapter.transcript({ id: "t2", speaker: "Tutor", text: "Great job!", final: true }, "recovery");
    f.adapter.responseDone("recovery", "completed");
    f.adapter.tick();
    await f.finish(1, false);
    expect(f.adapter.takeRecovery()).toBeUndefined();
    expect(f.adapter.recoveryExhausted).toBe(true);
    expect(JSON.stringify(f.adapter.decisionTimeline)).not.toMatch(/Great job|One duck|context_token/);
  },
);
it.each([
  ["count-2-ducks", "Two ducks.", "Yes, two ducks."],
  ["count-3-butterflies", "Three butterflies.", "Exactly! Three butterflies."],
])("uses authored context for %s", async (node, learner, tutor) => {
  const f = fixture(node, learner);
  f.call();
  f.tutor(tutor);
  expect(f.requests).toHaveLength(1);
  await f.finish();
  expect(f.requests[0].input.nodeId).toBe(node);
  expect(f.requests[0].input.learner).toBe(learner);
});
it("browser contract rejects forged or malformed success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ...decision("wrong"), modelValidated: false })),
  );
  await expect(requestAcknowledgment(input, new AbortController().signal)).rejects.toThrow();
});

it("bounds server provider execution by its deadline", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "secret");
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("secret")));
          controller.abort();
        }),
    ),
  );
  const response = await POST(request());
  expect(await response.json()).toMatchObject({ outcome: "abstain", reason: "timeout" });
  expect(timeout).toHaveBeenCalledWith(ACK_DEADLINE_MS);
  timeout.mockRestore();
});

it("cancels pending classification when its source report is rejected", async () => {
  const f = fixture();
  f.call();
  f.tutor();
  f.adapter.call({ response_id: "r1", call_id: "c2", name: "unknown", arguments: "{}" });
  expect(f.requests[0].signal.aborted).toBe(true);
  await f.finish();
  expect(f.adapter.state.acknowledgmentObserved).toBe(false);
});
it("copies classifier metadata in exported timeline snapshots", async () => {
  const f = fixture();
  f.call();
  f.tutor();
  await f.finish();
  const completed = f.adapter.decisionTimeline.find(entry => entry.type === "classification.completed")!;
  completed.classification!.modelValidated = false;
  expect(
    f.adapter.decisionTimeline.find(entry => entry.type === "classification.completed")!.classification!.modelValidated,
  ).toBe(true);
});
