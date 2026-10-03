import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { TranscriptSteeringExperiment } from "../lib/transcript-state-steering/browser-experiment";

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

let experiment: TranscriptSteeringExperiment;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
});
afterEach(() => {
  experiment?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function emit(event: ProviderEvent) {
  transport.receive?.(event);
}
function start() {
  experiment = new TranscriptSteeringExperiment({} as HTMLAudioElement, () => {});
  experiment.confirmRendered(experiment.snapshot().display);
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
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
    transcriptRevision: 1,
    transcript: "Child: One.",
  });
});

it("routes real experiment output events through the tutor gate without using the reducer's drain", async () => {
  const fetch = vi.fn(async () => Response.json({ proposal: null }));
  vi.stubGlobal("fetch", fetch);
  start();
  tutor("Yes, one duck!");
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).not.toHaveBeenCalled();
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(250);
  expect(experiment.snapshot().runtime?.tutorOutputDrained).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(249);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledOnce();
  expect(experiment.snapshot().runtime?.nodeId).toBe("count-1-duck"); // An abstention still holds the scene.
  expect(experiment.report().events).toContainEqual(expect.objectContaining({ type: "classifier.abstained" }));
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
  expect(experiment.report().events).toContainEqual(
    expect.objectContaining({ type: "classifier.cancelled", transcriptRevision: 2 }),
  );
  expect(
    experiment
      .report()
      .events.filter(event => event.type === "classifier.started")
      .map(event => event.transcriptRevision),
  ).toEqual([2, 3]);
  requests[1].resolve(Response.json({ proposal: null }));
  await vi.advanceTimersByTimeAsync(0);
});
