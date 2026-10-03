import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { classificationDiagnostic, mapConversationClassification } from "../lib/lesson-runtime/classification-decision";
import { conversationProbabilities } from "./fixtures/conversation-classification";

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
  vi.useRealTimers();
});
function emit(event: ProviderEvent) {
  transport.receive?.(event);
}
function start() {
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
  emit({ type: "transcript", speaker: "child", delta: "One.", startMs: 100, endMs: 200 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}
function tutor(delta: string, startMs = 300) {
  emit({ type: "transcript", speaker: "sprout", delta, startMs, endMs: startMs + 100 });
}

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
  const diagnostic = classificationDiagnostic(
    mapConversationClassification(
      {
        nodeId: "count-1-duck",
        transcriptRevision: 1,
        transcript: "Child: One.",
      },
      conversationProbabilities(),
    ),
  );
  const fetch = vi.fn(async () =>
    Response.json({
      proposal: null,
      diagnostic: {
        ...diagnostic,
        nodeId: "count-3-butterflies",
        transcriptRevision: 999,
        rawBody: "raw provider marker",
        probabilities: { ...diagnostic.probabilities, rawBody: "raw provider marker" },
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
  expect(JSON.stringify(mapping)).not.toMatch(/raw provider marker|rawBody|count-3-butterflies|999/);
  expect(lesson.snapshot().runtime?.answerAccepted).toBe(false);
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-1-duck");
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "classifier.abstained" }));
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
    const diagnostic = classificationDiagnostic(
      mapConversationClassification(
        {
          nodeId: "count-1-duck",
          transcriptRevision: 1,
          transcript: "Child: One.",
        },
        conversationProbabilities({ answerCorrect: 0.8 }),
      ),
    );
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
                        probabilities: { ...diagnostic.probabilities, answerCorrect: "raw provider marker" },
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
