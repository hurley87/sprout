import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { JEV_MODEL } from "../lib/jev";
import {
  classifyConversationStateWithDiagnostics,
  executeConversationObserver,
} from "../lib/lesson-runtime/jev-conversation-state-classifier";
import {
  conversationObserverState,
  conversationStateQuestions,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { replayReducer } from "../lib/experiments/issue-42/provider-comparison";

const snapshots = [
  {
    lesson: COUNTING_LESSON,
    nodeId: "count-2-ducks",
    transcriptRevision: 4,
    transcript: "Child: Two\nTutor: Yes, two ducks.",
  },
  {
    lesson: CATCHING_UNICORNS_LESSON,
    nodeId: "engram",
    transcriptRevision: 7,
    transcript: "Tutor: What is an engram?\nChild: A memory stored in my brain.\nTutor: Yes, that explains it.",
  },
];
function response(input: (typeof snapshots)[number], model: string = JEV_MODEL) {
  return {
    model,
    answers: Object.fromEntries(
      Object.entries(conversationStateQuestions(input.lesson, input.nodeId, input.transcript)).map(([name, q]) => {
        const choice =
          name === "objectiveState"
            ? "completed"
            : name === "tutorState"
              ? "confirmed_completion"
              : name.startsWith("source_")
                ? "message_1"
                : "demonstrated_independent";
        return [
          name,
          {
            type: "choice",
            choice,
            confidence: 0.98,
            probabilities: Object.fromEntries(
              Object.keys(q.criteria).map(k => [k, k === choice ? 0.98 : 0.02 / (Object.keys(q.criteria).length - 1)]),
            ),
          },
        ];
      }),
    ),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each(snapshots)("uses 1.14 with unchanged Choice inputs, mapping and reducer evidence for $nodeId", async input => {
  expect(JEV_MODEL).toBe("jev-1.14.0");
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const fetcher = vi.fn<typeof globalThis.fetch>(async () => Response.json(response(input)));
  vi.stubGlobal("fetch", fetcher);
  const active = await classifyConversationStateWithDiagnostics(input, new AbortController().signal);
  expect(active.status).toBe("accepted");
  expect(active.proposal).not.toBeNull();
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
    model: "jev-1.14.0",
    state: conversationObserverState(input),
    questions: conversationStateQuestions(input.lesson, input.nodeId, input.transcript),
  });
  fetcher.mockImplementation(async () => Response.json(response(input, "jev-1.13.0")));
  const baseline = await executeConversationObserver(input, new AbortController().signal, {
    model: "jev-1.13.0",
    state: conversationObserverState(input),
    questions: conversationStateQuestions(input.lesson, input.nodeId, input.transcript),
  });
  expect(baseline).toEqual(active);
  expect(CONVERSATION_CLASSIFICATION_THRESHOLDS).toEqual({
    HIGH: 0.9,
    LOW: 0.1,
    COMPETITOR_CEILING: 0.2,
    MIN_MARGIN: 0.7,
  });
  if (input.nodeId === "engram") {
    expect(active.proposal?.conceptObservations).toEqual([
      { criterionId: "engram-biological", observation: "demonstrated_independent", childMessageIndex: 1 },
    ]);
    const replay = replayReducer(input, active.proposal);
    expect(replay.evidence["engram:engram-biological"].source?.childMessageIndex).toBe(1);
  }
});
it.each([
  ["jev-1.14.0", "jev-1.13.0"],
  ["jev-1.13.0", "jev-1.14.0"],
  ["jev-1.14.0", "jev-latest"],
] as const)("rejects %s request answered by %s", async (requested, returned) => {
  const input = snapshots[1];
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(response(input, returned))),
  );
  const decision = await executeConversationObserver(input, new AbortController().signal, {
    model: requested,
    state: conversationObserverState(input),
    questions: conversationStateQuestions(input.lesson, input.nodeId, input.transcript),
  });
  expect(decision).toMatchObject({
    status: "abstained",
    reason: "provider_model_mismatch",
    outputs: null,
    proposal: null,
  });
});
it("captures the requested model before callers can mutate an in-flight baseline request", async () => {
  const input = snapshots[1];
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve;
        }),
    ),
  );
  const request: {
    model: "jev-1.13.0" | typeof JEV_MODEL;
    state: unknown;
    questions: ReturnType<typeof conversationStateQuestions>;
  } = {
    model: "jev-1.13.0",
    state: conversationObserverState(input),
    questions: conversationStateQuestions(input.lesson, input.nodeId, input.transcript),
  };
  const pending = executeConversationObserver(input, new AbortController().signal, request);
  request.model = JEV_MODEL;
  finish(Response.json(response(input, "jev-1.13.0")));
  expect((await pending).status).toBe("accepted");
});
