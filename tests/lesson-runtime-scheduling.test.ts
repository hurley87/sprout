import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { LESSON_START_INSTRUCTION } from "../lib/lesson-runtime/live-context";
import { ANSWER_RECOVERY_INSTRUCTION } from "../lib/lesson-runtime/answer-recovery";
import fillerTrace from "./fixtures/butterfly-filler-confirmation.json";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", () => ({
  BrowserTransport: class {
    activeSourceId = 1;
    setMicrophoneDiagnosticSink() {}
    async start(receive: (event: ProviderEvent) => void) {
      transport.receive = receive;
      receive({ type: "session.started", sourceId: 1 });
    }
    openInput() {
      return true;
    }
    send = transport.send;
    close = transport.close;
  },
}));

let lesson: LessonRuntime;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
});
afterEach(() => {
  lesson?.stop();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function emit(event: ProviderEvent) {
  transport.receive?.(event);
}
function start(childAnswer = "One.") {
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {});
  lesson.confirmRendered(lesson.snapshot().display);
  const command = transport.send.mock.calls[0][0];
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: command.event_id,
    startMs: 0,
  });
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: childAnswer, startMs: 100, endMs: 200 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}
function tutor(delta: string, startMs = 300) {
  emit({ type: "transcript", speaker: "sprout", delta, startMs, endMs: startMs + 100 });
}

function interruptWithoutTranscript() {
  start();
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}

it.each(["provider_unreachable", "invalid_outputs"])(
  "does not request semantic recovery for %s diagnostics",
  async reason => {
    const mapping = fillerTrace.steps.find(step => "mapping" in step)!.mapping!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const input = JSON.parse(init.body as string);
        return Response.json({
          proposal: null,
          diagnostic: {
            ...mapping,
            outputs: null,
            labelCompletionEligible: false,
            reason,
            nodeId: input.nodeId,
            transcriptRevision: input.transcriptRevision,
          },
        });
      }),
    );
    start();
    await vi.advanceTimersByTimeAsync(9000);
    expect(transport.send).toHaveBeenCalledOnce();
    expect(lesson.report().events.some(event => event.type === "answer_recovery.requested")).toBe(false);
  },
);

it("asks once after canonical abstention with a current filler transcript and requires fresh success", async () => {
  const diagnostic = {
    ...fillerTrace.steps.find(step => "mapping" in step)!.mapping!,
    // Fourth live attempt: both labels suggest success, but neither probability
    // reaches 0.9. Clarification must not convert those scores into authority.
    labelCompletionEligible: true,
    outputs: {
      objectiveState: {
        choice: "completed",
        confidence: 0.82,
        probabilities: {
          completed: 0.87,
          incorrect: 0,
          unclear_or_incomplete: 0.1,
          unresolved_help: 0.03,
          no_attempt: 0,
        },
      },
      tutorState: {
        choice: "confirmed_completion",
        confidence: 0.73,
        probabilities: { confirmed_completion: 0.78, clarifying: 0, helping: 0.05, asking: 0.01, other: 0.16 },
      },
    },
  };
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string);
    return Promise.resolve(
      Response.json({
        proposal: null,
        diagnostic: { ...diagnostic, nodeId: input.nodeId, transcriptRevision: input.transcriptRevision },
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  interruptWithoutTranscript();
  emit({ type: "transcript", speaker: "child", delta: "Ah", startMs: 500, endMs: 600 });
  await vi.advanceTimersByTimeAsync(300);
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(4000);
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({ type: "answer_recovery.requested", detail: { waitMs: 4000, reason: "semantic_hold" } }),
  );
  expect(lesson.snapshot().runtime).toMatchObject({
    phase: "active",
    answerAccepted: false,
    acknowledgmentObserved: false,
  });
  fetch.mockImplementation((_url, init) => Promise.resolve(correctResponse(init)));
  tutor("Could you repeat your answer?", 700);
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "transcript", speaker: "child", delta: "One duck.", startMs: 900, endMs: 1000 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot().runtime?.phase).toBe("active");
  tutor("Yes, one duck!", 1100);
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(lesson.snapshot().runtime?.phase).toBe("rendering");
});

it("recovers confirmed speech without transcript by asking once, then needs a fresh answer and acknowledgment", async () => {
  const fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve(correctResponse(init)));
  vi.stubGlobal("fetch", fetch);
  interruptWithoutTranscript();
  // Late tutor fragments must not cancel the missing-child recovery or restore authority.
  await vi.advanceTimersByTimeAsync(500);
  tutor(" One duck.", 400);
  await vi.advanceTimersByTimeAsync(3499);
  expect(transport.send).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.send).toHaveBeenCalledTimes(2);
  const recovery = transport.send.mock.calls.at(-1)![0];
  expect(recovery).toMatchObject({
    type: "session.instructions.append",
    content: ANSWER_RECOVERY_INSTRUCTION,
  });
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: recovery.event_id,
    startMs: 500,
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(lesson.snapshot().runtime).toMatchObject({
    hasChildTranscript: false,
    answerAccepted: false,
    acknowledgmentObserved: false,
    phase: "active",
  });
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
  // A conversational prompt and its append acknowledgment never advance the lesson.
  tutor("Could you repeat your answer?", 600);
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "transcript", speaker: "child", delta: "One duck.", startMs: 800, endMs: 900 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot().runtime?.phase).toBe("active");
  tutor("Yes, one duck!", 1000);
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(lesson.snapshot().runtime?.phase).toBe("rendering");
  expect(lesson.snapshot().display.nodeId).toBe("count-2-ducks");
});

it.each(["late-transcript", "new-speech", "parent-stop", "disconnect"])(
  "cancels missing-transcript recovery on %s",
  async reason => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ proposal: null })),
    );
    interruptWithoutTranscript();
    await vi.advanceTimersByTimeAsync(3999);
    if (reason === "late-transcript")
      emit({ type: "transcript", speaker: "child", delta: "Uh", startMs: 500, endMs: 600 });
    if (reason === "new-speech") emit({ type: "microphone.activity_started" });
    if (reason === "parent-stop") lesson.stop();
    if (reason === "disconnect") emit({ type: "session.closed" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      transport.send.mock.calls.some(
        ([command]) =>
          command.type === "session.instructions.append" && command.content === ANSWER_RECOVERY_INSTRUCTION,
      ),
    ).toBe(false);
  },
);

it("holds and spends the missing-transcript request budget when transport send fails", async () => {
  vi.stubGlobal("fetch", vi.fn());
  interruptWithoutTranscript();
  transport.send.mockImplementationOnce(() => {
    throw new Error("offline");
  });
  await vi.advanceTimersByTimeAsync(4000);
  expect(lesson.report().events.some(event => event.type === "answer_recovery.send_failed")).toBe(true);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(8000);
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(lesson.snapshot().runtime?.phase).toBe("active");
});

it("sends an explicit parent start after initial render, once, without treating its acknowledgment as a tutor prompt", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {});
  expect(transport.send).not.toHaveBeenCalled();
  const identity = lesson.snapshot().display;
  lesson.confirmRendered(identity);
  expect(transport.send).toHaveBeenCalledOnce();
  const command = transport.send.mock.calls[0][0];
  expect(command.type).toBe("session.instructions.append");
  if (command.type !== "session.instructions.append") throw new Error("Expected steering append");
  expect(command.content).toContain(LESSON_START_INSTRUCTION);
  expect(command.content).toContain('"nodeId":"count-1-duck"');
  expect(command.content).not.toContain("count-2-ducks");
  const events = lesson.report().events;
  expect(events.findIndex(event => event.type === "render.confirmed")).toBeLessThan(
    events.findIndex(event => event.type === "gpt_live.steering_append"),
  );
  lesson.confirmRendered(identity);
  expect(transport.send).toHaveBeenCalledOnce();
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: command.event_id,
    startMs: 600,
    endMs: 1200,
  });
  expect(lesson.snapshot().awaitingSteering).toBe(false);
  expect(lesson.snapshot().transcript).toBe("");
  expect(lesson.snapshot().runtime).toMatchObject({ phase: "active", hasChildTurn: false, answerAccepted: false });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the child answer's 300 ms debounce independent of active tutor audio", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ proposal: null }));
  vi.stubGlobal("fetch", fetch);
  start();
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(299);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe("/api/classify");
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
    transcriptRevision: 1,
    transcript: "Child: One.",
  });
});

it("routes real lesson output events through the tutor gate without using the reducer's drain", async () => {
  const fetch = vi.fn(async () => Response.json({ proposal: null }));
  vi.stubGlobal("fetch", fetch);
  start();
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).not.toHaveBeenCalled();
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(250);
  expect(lesson.snapshot().runtime?.tutorOutputDrained).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(249);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledOnce();
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-1-duck"); // An abstention still holds the scene.
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "classifier.abstained" }));
});

it("attributes an advancing proposal diagnostic to its source visit rather than the resulting visit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        proposal: {
          nodeId: "count-1-duck",
          transcriptRevision: 2,
          childActivity: "unknown",
          answerOutcome: "correct",
          supportState: "none",
          tutorState: "acknowledging",
        },
      }),
    ),
  );
  start();
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);

  expect(lesson.snapshot().runtime).toMatchObject({ nodeId: "count-2-ducks", visitId: 2, phase: "rendering" });
  const events = lesson.report().events;
  const proposalIndex = events.findIndex(event => event.type === "runtime.event.proposal.received");
  expect(proposalIndex).toBeGreaterThanOrEqual(0);
  expect(events[proposalIndex]).toMatchObject({
    runtimeId: lesson.report().runtimeId,
    nodeId: "count-1-duck",
    visitId: 1,
    childTurnId: 1,
    transcriptRevision: 2,
    transcriptSpeaker: "tutor",
    detail: {
      accepted: true,
      event: { source: { nodeId: "count-1-duck", visitId: 1 } },
    },
  });
  expect(events[proposalIndex + 1]).toMatchObject({
    type: "runtime.changed",
    nodeId: "count-2-ducks",
    visitId: 2,
    detail: {
      trigger: "proposal.received",
      before: { nodeId: "count-1-duck", visitId: 1 },
      after: { nodeId: "count-2-ducks", visitId: 2 },
    },
  });
  const pendingIdentity = lesson.snapshot().display;
  expect(transport.send).toHaveBeenCalledOnce(); // next-node instructions wait for render confirmation
  lesson.confirmRendered(pendingIdentity);
  expect(transport.send).toHaveBeenCalledTimes(2);
  const nextCommand = transport.send.mock.calls[1][0];
  expect(nextCommand.type).toBe("session.instructions.append");
  if (nextCommand.type !== "session.instructions.append") throw new Error("Expected next-node steering");
  expect(nextCommand.content).not.toContain(LESSON_START_INSTRUCTION);
  expect(nextCommand.content).toContain('"nodeId":"count-2-ducks"');
});

it("aborts an in-flight older revision and waits for the new tutor boundary before capturing its snapshot", async () => {
  const requests: {
    signal: AbortSignal;
    body: { transcript: string; transcriptRevision: number };
    resolve: (value: Response) => void;
  }[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>(resolve => {
        requests.push({ signal: init.signal!, body: JSON.parse(init.body as string), resolve });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  start();
  tutor("Yes, one");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(requests).toHaveLength(1);
  expect(requests[0].body.transcriptRevision).toBe(2);
  tutor(" duck!", 400);
  expect(requests[0].signal.aborted).toBe(true);
  requests[0].resolve(Response.json({ proposal: null }));
  await vi.advanceTimersByTimeAsync(599);
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toHaveLength(2);
  expect(requests[1].body).toMatchObject({ transcriptRevision: 3, transcript: "Child: One.\nTutor: Yes, one duck!" });
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({ type: "classifier.cancelled", transcriptRevision: 2 }),
  );
  expect(
    lesson
      .report()
      .events.filter(event => event.type === "classifier.started")
      .map(event => event.transcriptRevision),
  ).toEqual([2, 3]);
  requests[1].resolve(Response.json({ proposal: null }));
  await vi.advanceTimersByTimeAsync(0);
});

it("logs only normalized mapping diagnostics with the captured source and cannot advance from diagnostics alone", async () => {
  const diagnostic = choiceDiagnostic();
  const fetch = vi.fn(async () =>
    Response.json({
      proposal: null,
      diagnostic: {
        ...diagnostic,
        rawBody: "raw provider marker",
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  start();
  await vi.advanceTimersByTimeAsync(300);
  const mapping = lesson.report().events.find(event => event.type === "classifier.mapping");
  expect(mapping).toMatchObject({
    runtimeId: lesson.report().runtimeId,
    visitId: 1,
    childTurnId: 1,
    nodeId: "count-1-duck",
    transcriptRevision: 1,
    transcriptSpeaker: "child",
    detail: diagnostic,
  });
  // Inspect normalized classifier data; generated runtime UUIDs may contain the marker digits.
  expect(JSON.stringify(mapping?.detail)).not.toMatch(/raw provider marker|rawBody|count-3-butterflies|999/);
  expect(lesson.snapshot().runtime?.answerAccepted).toBe(false);
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-1-duck");
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "classifier.held" }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetch).toHaveBeenCalledOnce();
  expect(transport.send).toHaveBeenCalledOnce(); // Only initial steering, never diagnostics-driven steering.
});

it.each(["abstained", "missing", "invalid"] as const)(
  "leaves proposal handling unchanged with %s diagnostics",
  async kind => {
    const proposal = {
      nodeId: "count-1-duck",
      transcriptRevision: 1,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "unknown",
    };
    const diagnostic = {
      ...choiceDiagnostic(),
      decision: "abstained",
      outcome: "unresolved",
      reason: "tutorState_no_winner",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          proposal,
          ...(kind === "missing"
            ? {}
            : {
                diagnostic:
                  kind === "invalid"
                    ? {
                        ...diagnostic,
                        outputs: "raw provider marker",
                      }
                    : diagnostic,
              }),
        }),
      ),
    );
    start();
    await vi.advanceTimersByTimeAsync(300);
    expect(lesson.snapshot().runtime?.answerAccepted).toBe(true);
    expect(lesson.report().events).toContainEqual(
      expect.objectContaining({ type: "classifier.result", detail: expect.objectContaining({ proposal }) }),
    );
    if (kind === "abstained")
      expect(lesson.report().events).toContainEqual(
        expect.objectContaining({ type: "classifier.mapping", detail: diagnostic }),
      );
    else
      expect(lesson.report().events).toContainEqual(
        expect.objectContaining({ type: "classifier.mapping_unavailable" }),
      );
    expect(JSON.stringify(lesson.report())).not.toContain("raw provider marker");
  },
);

it.each([
  { category: "http", status: 404, code: null, result: () => new Response("private HTML", { status: 404 }) },
  {
    category: "http",
    status: 503,
    code: "unconfigured",
    result: () => Response.json({ code: "unconfigured", error: "private marker" }, { status: 503 }),
  },
  {
    category: "http",
    status: 502,
    code: null,
    result: () => Response.json({ code: "private marker" }, { status: 502 }),
  },
  { category: "invalid_json", status: 200, code: null, result: () => new Response("private marker") },
  {
    category: "invalid_schema",
    status: 200,
    code: null,
    result: () => Response.json({ proposal: { secret: "private marker" } }),
  },
  {
    category: "network",
    status: null,
    code: null,
    result: () => {
      throw new Error("private marker");
    },
  },
])(
  "exports safe $category diagnostics with HTTP $status and holds the failed revision",
  async ({ category, status, code, result }) => {
    const fetch = vi.fn(async () => result());
    vi.stubGlobal("fetch", fetch);
    start();
    await vi.advanceTimersByTimeAsync(300);
    expect(lesson.report().events).toContainEqual(
      expect.objectContaining({
        type: "classifier.error",
        transcriptRevision: 1,
        detail: expect.objectContaining({ category, httpStatus: status, endpointCode: code }),
      }),
    );
    expect(JSON.stringify(lesson.report())).not.toContain("private marker");
    expect(JSON.stringify(lesson.report())).not.toContain("private HTML");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(lesson.snapshot().runtime).toMatchObject({ nodeId: "count-1-duck", answerAccepted: false });
  },
);

it("distinguishes a request timeout from network failure without exporting the exception", async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("private marker")));
        }),
    ),
  );
  start();
  await vi.advanceTimersByTimeAsync(300);
  timeout.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({
      type: "classifier.error",
      detail: expect.objectContaining({ category: "timeout", httpStatus: null }),
    }),
  );
  expect(JSON.stringify(lesson.report())).not.toContain("private marker");
});

it("recovers on a newer acknowledged revision after an endpoint failure, then renders before steering", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("HTML route unavailable", { status: 404 }))
    .mockResolvedValueOnce(Response.json({ proposal: null }))
    .mockResolvedValueOnce(
      Response.json({
        proposal: {
          nodeId: "count-1-duck",
          transcriptRevision: 4,
          childActivity: "unknown",
          answerOutcome: "correct",
          supportState: "none",
          tutorState: "acknowledging",
        },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  start("Two.");
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot().runtime?.answerAccepted).toBe(false);
  tutor("Try again. Count slowly.");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-1-duck");
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "Uh, one", startMs: 500, endMs: 600 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  tutor("Yes, one duck!", 700);
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-1-duck");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(lesson.snapshot().runtime).toMatchObject({ nodeId: "count-2-ducks", phase: "rendering" });
  expect(transport.send).toHaveBeenCalledOnce();
  lesson.confirmRendered(lesson.snapshot().display);
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(transport.send.mock.calls[1][0]).toMatchObject({ type: "session.instructions.append" });
});

function correctResponse(init?: RequestInit) {
  const body = JSON.parse(init?.body as string);
  return Response.json({
    proposal: {
      nodeId: body.nodeId,
      transcriptRevision: body.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "acknowledging",
    },
  });
}

it("revalidates an unchanged tutor snapshot under a fresh turn after discard, rejecting a delayed older result", async () => {
  const requests: { signal: AbortSignal; resolve: (value: Response) => void; response: Response }[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>(resolve => {
        requests.push({ signal: init.signal!, resolve, response: correctResponse(init) });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  start();
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(requests).toHaveLength(1);
  const before = lesson.snapshot().runtime!;
  emit({ type: "microphone.activity_started" });
  expect(requests[0].signal.aborted).toBe(true);
  expect(lesson.snapshot().runtime).toMatchObject({ childSpeaking: true, answerAccepted: false });
  requests[0].resolve(requests[0].response);
  await vi.advanceTimersByTimeAsync(1000);
  expect(lesson.snapshot().runtime?.phase).toBe("active");
  emit({ type: "microphone.activity_discarded" });
  expect(lesson.snapshot().runtime).toMatchObject({
    childTurnId: before.childTurnId + 1,
    transcriptRevision: before.transcriptRevision,
    hasChildTranscript: true,
    answerAccepted: false,
    acknowledgmentObserved: false,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(2); // Stable text/quiet may already qualify, but old semantic authority never does.
  requests[1].resolve(requests[1].response);
  await vi.advanceTimersByTimeAsync(249);
  expect(lesson.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(1);
  expect(lesson.snapshot().runtime).toMatchObject({ nodeId: "count-2-ducks", phase: "rendering" });
  expect(transport.send).toHaveBeenCalledTimes(1);
  lesson.confirmRendered(lesson.snapshot().display);
  expect(transport.send).toHaveBeenCalledTimes(2);
});

it("recovers the answer when acknowledgment and fresh output arrive during a discarded candidate", async () => {
  const fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve(correctResponse(init)));
  vi.stubGlobal("fetch", fetch);
  start();
  emit({ type: "microphone.activity_started" });
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(200);
  expect(fetch).not.toHaveBeenCalled();
  emit({ type: "microphone.activity_discarded" });
  expect(lesson.snapshot().runtime).toMatchObject({ hasChildTranscript: true, tutorOutputObserved: true });
  await vi.advanceTimersByTimeAsync(600);
  expect(fetch).toHaveBeenCalledOnce();
  expect(lesson.snapshot().runtime?.phase).toBe("rendering");
});

it.each(["confirmed", "new_child_transcript"] as const)(
  "%s activity revokes suspended answer/audio and still needs a new acknowledgment and output",
  async interruption => {
    const fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve(correctResponse(init)));
    vi.stubGlobal("fetch", fetch);
    start();
    tutor("Yes, one duck!");
    emit({ type: "output.activity", state: "active" });
    emit({ type: "output.activity", state: "quiet" });
    emit({ type: "microphone.activity_started" });
    if (interruption === "confirmed") {
      emit({ type: "microphone.speech_started" });
      emit({ type: "microphone.speech_stopped", quietMs: 900 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetch).not.toHaveBeenCalled();
      expect(lesson.snapshot().runtime?.hasChildTranscript).toBe(false);
    }
    emit({ type: "transcript", speaker: "child", delta: " Actually, one.", startMs: 500, endMs: 600 });
    if (interruption === "new_child_transcript") emit({ type: "microphone.activity_discarded" });
    await vi.advanceTimersByTimeAsync(300);
    expect(lesson.snapshot().runtime).toMatchObject({
      phase: "active",
      transcriptSource: "child",
      acknowledgmentObserved: false,
      tutorOutputObserved: false,
    });
    tutor("Yes, one duck!", 700);
    emit({ type: "output.activity", state: "active" });
    emit({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    expect(lesson.snapshot().runtime?.phase).toBe("rendering");
  },
);

it("candidate onset during rendering cancels the handoff and cannot release steering after discard", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => Promise.resolve(correctResponse(init))),
  );
  start();
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  const display = lesson.snapshot().display;
  expect(lesson.snapshot().runtime?.phase).toBe("rendering");
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.activity_discarded" });
  lesson.confirmRendered(display);
  expect(lesson.snapshot()).toMatchObject({ status: "ended", runtime: { phase: "stopped", nodeId: "count-1-duck" } });
  expect(transport.send.mock.calls.filter(([command]) => command.type === "session.instructions.append")).toHaveLength(
    1,
  );
});

it("replays the second-scene timing: discarded candidates recover eligibility but confirmed activity still holds", async () => {
  const fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve(correctResponse(init)));
  vi.stubGlobal("fetch", fetch);
  start();
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  lesson.confirmRendered(lesson.snapshot().display);
  const command = transport.send.mock.calls.at(-1)![0];
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: command.event_id,
    startMs: 1000,
  });
  const advanceTo = async (atMs: number) => vi.advanceTimersByTimeAsync(atMs - performance.now());
  await advanceTo(26311.8);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  await advanceTo(27478.5);
  emit({ type: "microphone.speech_stopped", quietMs: 900.2 });
  await advanceTo(27501.7);
  emit({ type: "transcript", speaker: "child", delta: "Two", startMs: 26000, endMs: 26200 });
  await advanceTo(27619.8);
  emit({ type: "microphone.activity_started" });
  await advanceTo(27676.2);
  tutor("Yes,", 26200);
  await advanceTo(27804.8);
  emit({ type: "microphone.activity_discarded" });
  expect(lesson.snapshot().runtime?.hasChildTranscript).toBe(true);
  await advanceTo(28063.5);
  tutor(" two", 26600);
  await advanceTo(28084.6);
  emit({ type: "output.activity", state: "active" });
  await advanceTo(28474.6);
  tutor(" ducks!", 27000);
  for (const [atMs, state] of [
    [28565.4, "quiet"],
    [28715.3, "active"],
    [29214.4, "quiet"],
    [29264.3, "active"],
    [29465.4, "quiet"],
  ] as const) {
    await advanceTo(atMs);
    emit({ type: "output.activity", state });
  }
  await advanceTo(29569.5);
  emit({ type: "microphone.activity_started" });
  await advanceTo(29803.4);
  emit({ type: "microphone.activity_discarded" });
  expect(lesson.snapshot().runtime).toMatchObject({ hasChildTranscript: true, tutorOutputObserved: true });
  await advanceTo(29814.6);
  emit({ type: "microphone.activity_started" });
  await advanceTo(29895.1);
  emit({ type: "microphone.speech_started" });
  await advanceTo(30594.1);
  emit({ type: "transcript", speaker: "child", delta: "[tongue", startMs: 29200, endMs: 29400 });
  await advanceTo(30755.9);
  emit({ type: "transcript", speaker: "child", delta: " click", startMs: 29400, endMs: 29600 });
  await advanceTo(32237.1);
  emit({ type: "microphone.speech_stopped", quietMs: 900.1 });
  await advanceTo(32785.8);
  expect(lesson.snapshot().runtime).toMatchObject({
    nodeId: "count-2-ducks",
    phase: "active",
    answerAccepted: true,
    acknowledgmentObserved: false,
    tutorOutputObserved: false,
  });
  expect(fetch).toHaveBeenCalledTimes(2); // First scene, then the final child-authored snapshot.
});

it("binds a first child transcript delivered after its candidate was discarded, without granting prior completion", async () => {
  const fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve(correctResponse(init)));
  vi.stubGlobal("fetch", fetch);
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {});
  lesson.confirmRendered(lesson.snapshot().display);
  const command = transport.send.mock.calls[0][0];
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: command.event_id,
    startMs: 0,
  });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.activity_discarded" });
  expect(lesson.snapshot().runtime).toMatchObject({ hasChildTurn: true, hasChildTranscript: false });
  emit({ type: "transcript", speaker: "child", delta: "One.", startMs: 100, endMs: 200 });
  await vi.advanceTimersByTimeAsync(300);
  expect(fetch).toHaveBeenCalledOnce();
  expect(lesson.snapshot().runtime).toMatchObject({
    phase: "active",
    hasChildTranscript: true,
    acknowledgmentObserved: false,
    tutorOutputObserved: false,
  });
});

it("replays the latest correction's eligibility loss without treating untranscribed confirmed turns as discarded noise", async () => {
  // Reduced replay of ef40acf8: preserve runtime timing around the correction
  // and acknowledgment, without claiming the mocked detector proves what was spoken.
  const fetch = vi.fn(async () => Response.json({ proposal: null }));
  vi.stubGlobal("fetch", fetch);
  start("Two");
  await vi.advanceTimersByTimeAsync(300);
  expect(fetch).toHaveBeenCalledOnce();
  tutor("Let's count them slowly.");
  emit({ type: "output.activity", state: "active" });
  const advanceTo = async (atMs: number) => vi.advanceTimersByTimeAsync(atMs - performance.now());
  await advanceTo(16884.2);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "output.activity", state: "quiet" });
  await advanceTo(18147.7);
  emit({ type: "transcript", speaker: "child", delta: "One", startMs: 16800, endMs: 17000 });
  const correctionSource = lesson.snapshot().runtime!;
  await advanceTo(18600.9);
  emit({ type: "microphone.speech_stopped", quietMs: 900.1 });
  await advanceTo(18667.5);
  emit({ type: "microphone.activity_started" });
  await advanceTo(18892.4);
  emit({ type: "microphone.activity_discarded" });
  expect(lesson.snapshot().runtime?.hasChildTranscript).toBe(true);
  await advanceTo(19125.8);
  emit({ type: "microphone.activity_started" });
  await advanceTo(19246.2);
  tutor("Yes,", 17800);
  await advanceTo(19252.5);
  emit({ type: "microphone.speech_started" });
  await advanceTo(19652.1);
  emit({ type: "output.activity", state: "active" });
  await advanceTo(20900.9);
  emit({ type: "microphone.speech_stopped", quietMs: 900.1 });
  const firstBlockedTurn = lesson.snapshot().runtime!.childTurnId;
  await advanceTo(21070.3);
  emit({ type: "microphone.activity_started" });
  await advanceTo(21149.9);
  emit({ type: "microphone.speech_started" });
  await advanceTo(21256.7);
  tutor(" one duck. You counted carefully.", 19800);
  await advanceTo(22602.1);
  emit({ type: "output.activity", state: "quiet" });
  await advanceTo(22708.5);
  emit({ type: "microphone.speech_stopped", quietMs: 907.7 });
  const secondBlockedTurn = lesson.snapshot().runtime!.childTurnId;
  emit({ type: "microphone.speech_stopped", quietMs: 900 }); // Duplicate stop cannot duplicate the diagnostic.
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.activity_discarded" });
  await advanceTo(31346.3);

  expect(fetch).toHaveBeenCalledOnce(); // Only the earlier wrong answer reached the mock classifier.
  expect(lesson.snapshot().runtime).toMatchObject({
    nodeId: "count-1-duck",
    phase: "active",
    childSpeaking: false,
    hasChildTranscript: false,
    answerAccepted: false,
    acknowledgmentObserved: false,
    tutorOutputObserved: false,
  });
  const blocked = lesson.report().events.filter(event => event.type === "classifier.blocked");
  expect(blocked.map(event => event.childTurnId)).toEqual([firstBlockedTurn, secondBlockedTurn]);
  for (const event of blocked) {
    expect(event).toMatchObject({
      runtimeId: lesson.report().runtimeId,
      nodeId: "count-1-duck",
      visitId: 1,
      transcriptSpeaker: "tutor",
      detail: {
        reason: "missing_current_turn_child_transcript",
        trigger: "microphone.speech_stopped",
        latestChildTranscript: {
          source: { runtimeId: correctionSource.runtimeId, visitId: 1, childTurnId: correctionSource.childTurnId },
          startMs: 16800,
          endMs: 17000,
        },
      },
    });
    expect(event.childTurnId).toBeGreaterThan(correctionSource.childTurnId);
  }
  expect(transport.send).toHaveBeenCalledTimes(1);
});

it("holds an untranscribed turn through stale child delivery, then requires fresh acknowledgment and audio after matching delivery", async () => {
  const fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve(correctResponse(init)));
  vi.stubGlobal("fetch", fetch);
  start();
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).not.toHaveBeenCalled();
  const blocked = lesson.report().events.filter(event => event.type === "classifier.blocked");
  expect(blocked).toHaveLength(1);
  const blockedTurn = blocked[0].childTurnId;
  emit({ type: "transcript", speaker: "child", delta: "One", startMs: 100, endMs: 200 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).not.toHaveBeenCalled();
  expect(lesson.snapshot().runtime?.hasChildTranscript).toBe(false);
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({
      type: "transcript.ignored",
      detail: expect.objectContaining({ reason: "no_matching_child_turn" }),
    }),
  );
  emit({ type: "transcript", speaker: "child", delta: "Actually, one.", startMs: 500, endMs: 600 });
  await vi.advanceTimersByTimeAsync(300);
  expect(fetch).toHaveBeenCalledOnce();
  expect(lesson.snapshot().runtime).toMatchObject({
    childTurnId: blockedTurn,
    hasChildTranscript: true,
    answerAccepted: true,
    acknowledgmentObserved: false,
    tutorOutputObserved: false,
    phase: "active",
  });
  tutor("Yes, one duck!", 700);
  await vi.advanceTimersByTimeAsync(600);
  expect(lesson.snapshot().runtime).toMatchObject({ acknowledgmentObserved: true, phase: "active" });
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(249);
  expect(lesson.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(1);
  expect(lesson.snapshot().runtime?.phase).toBe("rendering");
  expect(transport.send).toHaveBeenCalledTimes(1);
  lesson.confirmRendered(lesson.snapshot().display);
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(lesson.report().events.filter(event => event.type === "classifier.blocked")).toHaveLength(1);
});

it("reports null child provenance when a confirmed first turn ends without any child transcript", async () => {
  const fetch = vi.fn(async () => Response.json({ proposal: null }));
  vi.stubGlobal("fetch", fetch);
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {});
  lesson.confirmRendered(lesson.snapshot().display);
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: transport.send.mock.calls[0][0].event_id,
    startMs: 0,
  });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({
      type: "classifier.blocked",
      childTurnId: 1,
      detail: expect.objectContaining({ latestChildTranscript: null }),
    }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).not.toHaveBeenCalled();
});

it("exports the canonical classifier version and held-scene diagnostics", async () => {
  const diagnostic = choiceDiagnostic();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ proposal: null, diagnostic }));
  vi.stubGlobal("fetch", fetch);
  start();
  await vi.advanceTimersByTimeAsync(300);
  expect(Object.keys(JSON.parse(fetch.mock.calls[0][1]?.body as string))).toEqual([
    "nodeId",
    "transcriptRevision",
    "transcript",
  ]);
  expect(lesson.report().classifierVersion).toBe("conversation-state-v2");
  for (const event of lesson.report().events.filter(e => e.type.startsWith("classifier.")))
    expect(event.classifierVersion).toBe("conversation-state-v2");
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "classifier.held" }));
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-1-duck");
});

function choiceDiagnostic() {
  return {
    classifierVersion: "conversation-state-v2",
    decision: "accepted",
    outcome: "hold_scene",
    labelCompletionEligible: false,
    outputs: {
      objectiveState: {
        choice: "completed",
        confidence: 1,
        probabilities: { completed: 1, incorrect: 0, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 0 },
      },
      tutorState: {
        choice: "other",
        confidence: 1,
        probabilities: { confirmed_completion: 0, clarifying: 0, helping: 0, asking: 0, other: 1 },
      },
    },
    thresholds: { HIGH: 0.9, LOW: 0.1, COMPETITOR_CEILING: 0.2, MIN_MARGIN: 0.7 },
    nodeId: "count-1-duck",
    transcriptRevision: 1,
    elapsedMs: 200,
  };
}

it("correlates real parser-to-runtime snapshots, rejection and pending-steering gaps without inventing disposition", async () => {
  const { describeTranscriptWire, transcriptDeliveryEvidence } = await import("./helpers/transcript-wire");
  const { parseProviderEvent } = await import("../lib/events");
  const records: import("./helpers/transcript-wire").WireRecord[] = [];
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {});
  lesson.confirmRendered(lesson.snapshot().display);
  const deliver = (delta: unknown, start_ms: unknown, end_ms: unknown) => {
    const raw = { type: "session.input_transcript.delta", delta, start_ms, end_ms };
    const observation = lesson.observe();
    const state = observation.snapshot.runtime!;
    const row: import("./helpers/transcript-wire").WireRecord = {
      ...describeTranscriptWire(JSON.stringify(raw)),
      sequence: records.length,
      channelId: 1,
      channelRuntimeId: state.runtimeId,
      runtimeId: state.runtimeId,
      visitId: state.visitId,
      childTurnId: state.childTurnId,
      nodeId: state.nodeId,
      transcriptRevision: state.transcriptRevision,
      journalOffset: observation.cursor.offset,
      atMs: observation.nowMs,
      awaitingSteering: observation.snapshot.awaitingSteering,
    };
    records.push(row);
    const parsed = parseProviderEvent(raw);
    if (parsed) emit(parsed);
    row.afterDispatchOffset = lesson.observe().cursor.offset;
  };
  emit({ type: "microphone.activity_started" });
  deliver("One", 100, 200); // Real runtime queues while awaiting steering; bridge cannot prove queue membership.
  const capture = { version: 1 as const, channels: 1, frames: 1, dropped: 0, observationErrors: 0, records };
  const evidence = () => transcriptDeliveryEvidence(capture, lesson.report().events, lesson.report().runtimeId);
  expect(evidence().fragments[0]).toMatchObject({
    disposition: "unknown",
    awaitingSteeringAtArrival: true,
    queuedPendingSteering: "unknown",
  });
  const command = transport.send.mock.calls[0][0];
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: command.event_id,
    startMs: 0,
  });
  expect(evidence().fragments[0]).toMatchObject({ disposition: "snapshot" });
  deliver("invalid", 300, 250);
  expect(evidence().fragments[1]).toMatchObject({ disposition: "runtime-rejected", reason: "invalid_interval" });
  deliver("", 400, 450);
  expect(evidence().fragments[2]).toMatchObject({ disposition: "unknown", deduplicated: "unknown" });
  deliver(null, 500, 550);
  expect(evidence().parserDiscardedLearnerEvents).toBe(1);
  expect(evidence().learnerSnapshots).toHaveLength(1);
});
