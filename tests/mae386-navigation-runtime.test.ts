import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { providerEvents, useRuntimeFakeTimers as installRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
let runtime: LessonRuntime;
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});
function start(nodeId = "q10-1") {
  installRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, { ...MAE386_LESSON, initialNodeId: nodeId });
  const events = providerEvents(event => transport.receive!(event));
  runtime.confirmRendered(runtime.snapshot().display);
  const steering = transport.send.mock.calls.at(-1)![0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(steering.event_id, 0);
  return events;
}
it.each([
  ["q10-1", "Next.", "q10-2", []],
  ["q10-2", "Skip this one.", "q10-3", []],
  ["q10-3", "Next question.", "q5-a", []],
  ["q10-1", "Next question.", "q5-a", ["q10-2", "q10-3"]],
  ["q5-a", "Skip this question.", "q12", ["q5-c", "q5-f"]],
] as const)("scheduler maps %s / %s through authored render/steering", async (node, command, target, siblings) => {
  const events = start(node);
  transport.receive!({ type: "output.activity", state: "active" });
  events.childTurn(command, 100);
  await vi.advanceTimersByTimeAsync(1500);
  expect(runtime.snapshot().runtime?.nodeId).toBe(node);
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: target, phase: "rendering", navigationHistory: [] });
  const display = runtime.snapshot().display;
  runtime.confirmRendered({ ...display, token: "wrong" });
  expect(runtime.snapshot().runtime?.phase).toBe("rendering");
  runtime.confirmRendered(display);
  runtime.confirmRendered(display);
  expect(runtime.snapshot().runtime?.navigationHistory).toMatchObject([
    { source: { nodeId: node, transcriptRevision: 1 }, skippedNodeIds: [...siblings] },
  ]);
  expect(transport.send.mock.calls.filter(([c]) => c.type === "session.instructions.append")).toHaveLength(2);
});
it.each(["I don't know.", '"Next question."', 'He said "next question".', "Can you explain the next question?"])(
  "scheduler does not navigate on %s",
  async text => {
    const events = start();
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn(text, 100);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
    expect(runtime.snapshot().runtime?.navigationHistory).toEqual([]);
  },
);
it("I don't know may be followed by an explicit skip without classifier approval", async () => {
  const events = start();
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("I don't know.", 100);
  await vi.advanceTimersByTimeAsync(1000);
  events.childTurn("Skip this one.", 400);
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-2");
});
it("spoken Stop tears down immediately after authenticated speech-end even with active playback and pending assessment", () => {
  start();
  transport.receive!({ type: "output.activity", state: "active" });
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "transcript", speaker: "child", delta: "Stop.", startMs: 100, endMs: 200 });
  expect(transport.close).not.toHaveBeenCalled();
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(transport.close).toHaveBeenCalledOnce();
  expect(runtime.snapshot().runtime?.phase).toBe("stopped");
  expect(runtime.snapshot().status).toBe("ended");
});
it.each(['"Stop."', 'The tutor said "stop".', "Don't stop."])(
  "reported/quoted/negated Stop never tears down: %s",
  text => {
    const events = start();
    events.childTurn(text, 100);
    expect(transport.close).not.toHaveBeenCalled();
  },
);
it("unbound learner text and tutor Stop have no stop authority", () => {
  const events = start();
  transport.receive!({ type: "transcript", speaker: "child", delta: "Stop.", startMs: 100, endMs: 200 });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  events.tutorTurn("Stop.", 300);
  expect(transport.close).not.toHaveBeenCalled();
});
it("UI Stop releases immediately without quiet or speech-end", () => {
  start();
  transport.receive!({ type: "output.activity", state: "active" });
  transport.receive!({ type: "microphone.activity_started" });
  runtime.stop();
  expect(transport.close).toHaveBeenCalledOnce();
  expect(runtime.snapshot().runtime?.phase).toBe("stopped");
});
it("UI question skip records no learner text and skips remaining sibling cases", async () => {
  start("q5-a");
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  runtime.skipScene("question");
  expect(runtime.snapshot().runtime?.nodeId).toBe("q12");
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().runtime?.navigationHistory).toMatchObject([
    { hasChildTranscript: false, intent: { action: "skip", scope: "question" }, skippedNodeIds: ["q5-c", "q5-f"] },
  ]);
});

it.each(["I don't know.", "He was late because he overslept."])(
  "Stop in a separate authenticated turn releases media after %s",
  answer => {
    const events = start();
    transport.receive!({ type: "output.activity", state: "active" });
    events.childTurn(answer, 100);
    events.childTurn("Stop.", 400);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(runtime.snapshot().runtime?.phase).toBe("stopped");
  },
);
it.each([
  ["Next.", "q10-2"],
  ["Next question.", "q5-a"],
  ["Skip this one.", "q10-2"],
  ["Skip this question.", "q5-a"],
])("a separate %s after an answer retains its authored scope", async (command, target) => {
  const events = start();
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("He was late because he overslept.", 100);
  events.childTurn(command, 400);
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot().runtime?.nodeId).toBe(target);
});
it.each([100, 400])("an empty confirmed segment at %sms revalidates the authenticated parent request", async delay => {
  const events = start();
  transport.receive!({ type: "output.activity", state: "active" });
  events.childTurn("Next question.", 100);
  const originalTurn = runtime.snapshot().runtime!.childTurnId;
  await vi.advanceTimersByTimeAsync(delay);
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "microphone.speech_started" });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "q5-a", phase: "rendering", conceptEvidence: {} });
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().runtime?.navigationHistory).toMatchObject([
    { source: { childTurnId: originalTurn, transcriptRevision: 1 }, skippedNodeIds: ["q10-2", "q10-3"] },
  ]);
});
it.each(['"Stop."', 'He said "stop".', '"Next question."', 'He said "next question".', "Help me with this sentence."])(
  "a later learner turn supersedes an older next request: %s",
  async text => {
    const events = start();
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn("Next question.", 100);
    events.childTurn(text, 400);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.close).not.toHaveBeenCalled();
    expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
  },
);
it.each([
  ["He said ", '"Stop."'],
  ["Next question.", " Actually, help me."],
  ["Stop", " and explain this."],
])("same-turn fragments stay together: %s / %s", async (first, second) => {
  const events = start();
  events.childTurn("He was late because he overslept.", 100);
  transport.receive!({ type: "output.activity", state: "quiet" });
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "transcript", speaker: "child", delta: first, startMs: 400, endMs: 450 });
  transport.receive!({ type: "transcript", speaker: "child", delta: second, startMs: 451, endMs: 500 });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(transport.close).not.toHaveBeenCalled();
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
});
it("a fragmented direct Stop after an answer waits for speech-end then closes", () => {
  const events = start();
  events.childTurn("He was late because he overslept.", 100);
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "transcript", speaker: "child", delta: "St", startMs: 400, endMs: 450 });
  transport.receive!({ type: "transcript", speaker: "child", delta: "op.", startMs: 451, endMs: 500 });
  expect(transport.close).not.toHaveBeenCalled();
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(transport.close).toHaveBeenCalledOnce();
});

it("an empty segment without an authenticated command still receives bounded recovery", async () => {
  start();
  transport.receive!({ type: "output.activity", state: "quiet" });
  transport.receive!({ type: "microphone.speech_started" });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
  expect(transport.send.mock.calls.filter(([command]) => command.event_id.includes(":answer-recovery:"))).toHaveLength(
    1,
  );
});

it("projects latest rewrite words onto actual learner turns through the runtime transcript grouping", async () => {
  const { rewriteWords } = await import("../lib/lesson-runtime/mae386/rewrite-proposal");
  const events = start();
  const good = "He was late because he overslept.";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body);
      const words = rewriteWords(input.transcript);
      const start = words.findLastIndex(word => word.text === "He");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          proposal: {
            nodeId: input.nodeId,
            transcriptRevision: input.transcriptRevision,
            childActivity: "unknown",
            answerOutcome: "unclear",
            supportState: "none",
            tutorState: "asking",
            conceptObservations: [],
            currentRewrite: {
              state: "complete",
              start: words[start].id,
              end: words.at(-1)!.id,
              assistance: "independent",
              criteria: { meaning: "demonstrated", concise: "demonstrated", grammatical: "demonstrated" },
            },
          },
        }),
      };
    }),
  );
  events.childTurn("He overslept because he was late.", 100);
  await vi.advanceTimersByTimeAsync(1500);
  const earlierTurn = runtime.snapshot().runtime!.childTurnId;
  events.childTurn(`No, my revision is: ${good}`, 400);
  await vi.advanceTimersByTimeAsync(1500);
  const state = runtime.snapshot().runtime!;
  const attempt = state.rewriteProposals?.["q10-1"]?.current;
  expect(attempt).toMatchObject({ text: good, outcome: "independent", source: { transcriptRevision: 2 } });
  expect(state.childTurnId).toBeGreaterThan(earlierTurn);
  expect(attempt!.words.every(word => word.childTurnId === state.childTurnId)).toBe(true);
  expect(attempt!.context[0].text).toContain("He overslept because he was late.");
  expect(attempt!.words[0].start).toBeGreaterThan(30);
  const preserved = state.rewriteProposals!["q10-1"];
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("Next.", 700);
  await vi.advanceTimersByTimeAsync(1500);
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-2");
  runtime.confirmRendered(runtime.snapshot().display);
  const steering = transport.send.mock.calls.at(-1)![0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(steering.event_id, 1000);
  // A navigation-only revision pending assessment does not carry the preceding
  // sentence's success into a sibling; its earlier accepted attempt remains history.
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.history).toEqual(preserved.history);
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.current).toEqual(preserved.current);
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-2"]).toBeUndefined();
});

async function acceptedRewrite() {
  const { rewriteWords } = await import("../lib/lesson-runtime/mae386/rewrite-proposal");
  const events = start();
  const answer = "He was late because he overslept.";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body);
      const words = rewriteWords(input.transcript);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          proposal: {
            nodeId: input.nodeId,
            transcriptRevision: input.transcriptRevision,
            childActivity: "unknown",
            answerOutcome: "unclear",
            supportState: "none",
            tutorState: "asking",
            conceptObservations: [],
            currentRewrite: {
              state: "complete",
              start: words[0].id,
              end: words.at(-1)!.id,
              assistance: "independent",
              criteria: { meaning: "demonstrated", concise: "demonstrated", grammatical: "demonstrated" },
            },
          },
        }),
      };
    }),
  );
  events.childTurn(answer, 100);
  await vi.advanceTimersByTimeAsync(1500);
  const state = runtime.snapshot().runtime!;
  const projection = state.rewriteProposals!["q10-1"];
  expect(projection.current).toMatchObject({
    text: answer,
    outcome: "independent",
    source: { childTurnId: state.childTurnId, transcriptRevision: 1 },
  });
  expect(projection.current!.words.every(word => word.childTurnId === state.childTurnId)).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  return { events, accepted: projection.current!, history: projection.history, mastery: state.conceptEvidence };
}
function controlFragments(parts: readonly string[], atMs = 400) {
  transport.receive!({ type: "microphone.activity_started" });
  for (const [index, delta] of parts.entries()) {
    transport.receive!({
      type: "transcript",
      speaker: "child",
      delta,
      startMs: atMs + index * 51,
      endMs: atMs + index * 51 + 50,
    });
  }
}
it.each([["Stop."], ["St", "op."]])(
  "preserves the accepted rewrite through spoken Stop fragments %j",
  async (...parts) => {
    const { accepted, history, mastery } = await acceptedRewrite();
    transport.receive!({ type: "output.activity", state: "active" });
    controlFragments(parts);
    expect(transport.close).not.toHaveBeenCalled();
    expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.current).toBeNull(); // Still speaking: no control authority yet.
    transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
    expect(transport.close).toHaveBeenCalledOnce();
    expect(runtime.snapshot().runtime).toMatchObject({
      phase: "stopped",
      rewriteProposals: { "q10-1": { current: accepted, history } },
    });
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual(mastery);
  },
);
it.each([
  { parts: ["Skip ", "this one."], target: "q10-2", scope: "subpart" },
  { parts: ["Skip this ", "question."], target: "q5-a", scope: "question" },
])("preserves the accepted rewrite after fragmented $scope skip", async ({ parts, target, scope }) => {
  const { accepted, history } = await acceptedRewrite();
  transport.receive!({ type: "output.activity", state: "quiet" });
  controlFragments(parts);
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.current).toBeNull();
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.current).toEqual(accepted);
  await vi.advanceTimersByTimeAsync(1500);
  expect(runtime.snapshot().runtime?.nodeId).toBe(target);
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().runtime?.navigationHistory?.at(-1)?.intent).toEqual({ action: "skip", scope });
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]).toMatchObject({ current: accepted, history });
  expect(runtime.snapshot().runtime?.rewriteProposals?.[target]).toBeUndefined();
});
it("UI Stop remains a preserving control", async () => {
  const { accepted, history } = await acceptedRewrite();
  runtime.stop();
  expect(transport.close).toHaveBeenCalledOnce();
  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "stopped",
    rewriteProposals: { "q10-1": { current: accepted, history } },
  });
});

async function revisedRewrite(kind: "replacement" | "withdrawal", assessed: boolean) {
  const base = await acceptedRewrite();
  const text =
    kind === "replacement"
      ? "Actually replace that with: He overslept because he was late."
      : "I withdraw my answer. I haven't got a replacement yet.";
  if (assessed) {
    const { rewriteWords } = await import("../lib/lesson-runtime/mae386/rewrite-proposal");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const input = JSON.parse(init.body);
        const words = rewriteWords(input.transcript);
        const tokens = (kind === "replacement" ? "He overslept because he was late." : text).split(" ");
        const index = words.findLastIndex((_, index) =>
          tokens.every((token, offset) => words[index + offset]?.text === token),
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({
            proposal: {
              nodeId: input.nodeId,
              transcriptRevision: input.transcriptRevision,
              childActivity: "unknown",
              answerOutcome: "unclear",
              supportState: "none",
              tutorState: "asking",
              conceptObservations: [],
              currentRewrite: {
                state: kind === "replacement" ? "complete" : "withdrawn",
                start: words[index].id,
                end: words.at(-1)!.id,
                assistance: "independent",
                criteria:
                  kind === "replacement"
                    ? { meaning: "incorrect", concise: "incorrect", grammatical: "demonstrated" }
                    : { meaning: "unresolved", concise: "unresolved", grammatical: "unresolved" },
              },
            },
          }),
        };
      }),
    );
  }
  base.events.childTurn(text, 400);
  await vi.advanceTimersByTimeAsync(1500);
  const projection = runtime.snapshot().runtime!.rewriteProposals!["q10-1"];
  if (assessed) expect(projection.current?.outcome).toBe(kind === "replacement" ? "incorrect" : "unresolved");
  else expect(projection.current).toBeNull();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  return { ...base, projection };
}
it.each(
  (["replacement", "withdrawal"] as const).flatMap(kind =>
    [true, false].flatMap(assessed =>
      (["Stop.", "Skip this one."] as const).map(command => ({ kind, assessed, command })),
    ),
  ),
)(
  "never restores older credit after $kind (assessed=$assessed) followed by $command",
  async ({ kind, assessed, command }) => {
    const { projection, accepted } = await revisedRewrite(kind, assessed);
    transport.receive!({ type: "output.activity", state: command === "Stop." ? "active" : "quiet" });
    controlFragments([command.slice(0, 2), command.slice(2)], 800);
    transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
    if (command === "Stop.") {
      expect(transport.close).toHaveBeenCalledOnce();
      expect(runtime.snapshot().runtime?.phase).toBe("stopped");
    } else {
      await vi.advanceTimersByTimeAsync(1500);
      expect(runtime.snapshot().runtime?.nodeId).toBe("q10-2");
    }
    const result = runtime.snapshot().runtime!.rewriteProposals!["q10-1"];
    expect(result.current).toEqual(projection.current);
    expect(result.current).not.toEqual(accepted);
    expect(result.history).toEqual(projection.history);
    expect(result.history[0]).toEqual(accepted);
  },
);
it.each([
  ["Skip this ", "answer; I withdraw my proposal."],
  ["St", "op. Actually, replace my answer with: He overslept because he was late."],
  ["The tutor said ", '"Stop."'],
])("does not restore a candidate from a control-like prefix %j", async (...parts) => {
  const { history } = await acceptedRewrite();
  transport.receive!({ type: "output.activity", state: "quiet" });
  controlFragments(parts);
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(1500);
  expect(transport.close).not.toHaveBeenCalled();
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]).toMatchObject({ current: null, history });
});
it("revalidates late command fragments against the same completed authenticated turn", async () => {
  const { accepted, history } = await acceptedRewrite();
  controlFragments(["St"]);
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(transport.close).not.toHaveBeenCalled();
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.current).toBeNull();
  transport.receive!({ type: "transcript", speaker: "child", delta: "op.", startMs: 451, endMs: 500 });
  expect(transport.close).toHaveBeenCalledOnce();
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]).toMatchObject({ current: accepted, history });
});

it("a substantive late suffix revokes a restored skip candidate before departure", async () => {
  const { history } = await acceptedRewrite();
  transport.receive!({ type: "output.activity", state: "active" }); // Hold the existing audio-drain gate.
  controlFragments(["Skip this one."]);
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.current?.outcome).toBe("independent");
  transport.receive!({
    type: "transcript",
    speaker: "child",
    delta: " Actually I withdraw my answer.",
    startMs: 451,
    endMs: 500,
  });
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]?.current).toBeNull();
  controlFragments(["St", "op."], 800);
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(transport.close).toHaveBeenCalledOnce();
  expect(runtime.snapshot().runtime?.rewriteProposals?.["q10-1"]).toMatchObject({ current: null, history });
});
