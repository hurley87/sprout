import { describe, expect, expectTypeOf, it } from "vitest";
import { COUNTING_NODE_IDS } from "../lib/lesson-runtime/counting-lesson";
import {
  ANSWER_OUTCOMES,
  CHILD_ACTIVITIES,
  SUPPORT_STATES,
  TUTOR_STATES,
  parseConversationStateProposal,
  type ConversationStateClassifier,
  type ConversationStateClassifierInput,
  type ConversationStateProposal,
} from "../lib/lesson-runtime/conversation-state-classifier";

const proposal: ConversationStateProposal = {
  nodeId: "count-1-duck",
  transcriptRevision: 0,
  childActivity: "thinking",
  answerOutcome: "none",
  supportState: "none",
  tutorState: "listening",
};

describe("ConversationStateClassifier ephemeral runtime contract", () => {
  it("classifies a supplied snapshot into a state proposal or abstention, without session-record inputs", () => {
    expectTypeOf<keyof ConversationStateClassifierInput>().toEqualTypeOf<
      "lesson" | "nodeId" | "transcriptRevision" | "transcript"
    >();
    expectTypeOf<Parameters<ConversationStateClassifier["classify"]>>().toEqualTypeOf<
      [input: ConversationStateClassifierInput, signal: AbortSignal]
    >();
    expectTypeOf<ReturnType<ConversationStateClassifier["classify"]>>().toEqualTypeOf<
      Promise<ConversationStateProposal | null>
    >();
  });

  it("types exactly the descriptive fields and restricts node identity to authored IDs", () => {
    expectTypeOf<keyof ConversationStateProposal>().toEqualTypeOf<
      "nodeId" | "transcriptRevision" | "childActivity" | "answerOutcome" | "supportState" | "tutorState" | "conceptObservations"
    >();
    expectTypeOf<ConversationStateProposal["nodeId"]>().toEqualTypeOf<string>();
    expectTypeOf<ConversationStateProposal["childActivity"]>().toEqualTypeOf<
      "unknown" | "waiting" | "thinking" | "answering"
    >();
    expectTypeOf<ConversationStateProposal["answerOutcome"]>().toEqualTypeOf<
      "none" | "correct" | "incorrect" | "unclear"
    >();
    expectTypeOf<ConversationStateProposal["supportState"]>().toEqualTypeOf<"none" | "needs_help">();
  });

  it.each(COUNTING_NODE_IDS)("accepts a proposal for authored node %s", nodeId => {
    expect(parseConversationStateProposal({ ...proposal, nodeId })).toEqual({ ...proposal, nodeId });
  });

  it.each(CHILD_ACTIVITIES)(
    "represents activity %s independently of answer outcome, support, and tutor state",
    childActivity => {
      for (const answerOutcome of ANSWER_OUTCOMES) {
        for (const supportState of SUPPORT_STATES) {
          for (const tutorState of TUTOR_STATES) {
            const input = { ...proposal, childActivity, answerOutcome, supportState, tutorState };
            expect(parseConversationStateProposal(input)).toEqual(input);
          }
        }
      }
    },
  );

  it("represents thinking after an incorrect answer while needing help and the tutor is helping", () => {
    const input: ConversationStateProposal = {
      ...proposal,
      childActivity: "thinking",
      answerOutcome: "incorrect",
      supportState: "needs_help",
      tutorState: "helping",
    };
    expect(parseConversationStateProposal(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  it("checks node and revision claim shape without certifying a match to the classification request", () => {
    const request: ConversationStateClassifierInput = {
      nodeId: "count-1-duck",
      transcriptRevision: 7,
      transcript: "Tutor: How many ducks do you see?",
    };
    for (const claims of [
      { nodeId: "count-2-ducks", transcriptRevision: request.transcriptRevision },
      { nodeId: request.nodeId, transcriptRevision: request.transcriptRevision - 1 },
    ]) {
      const parsed = parseConversationStateProposal({ ...proposal, ...claims });
      expect(parsed).not.toBeNull();
      expect({ nodeId: parsed!.nodeId, transcriptRevision: parsed!.transcriptRevision }).not.toEqual({
        nodeId: request.nodeId,
        transcriptRevision: request.transcriptRevision,
      });
    }
  });

  it("rejects the obsolete whole-proposal confidence field", () => {
    expect(parseConversationStateProposal({ ...proposal, confidence: 0.9 })).toBeNull();
  });

  it.each([0, 1, 42, Number.MAX_SAFE_INTEGER])(
    "accepts nonnegative safe transcript revision %s",
    transcriptRevision => {
      expect(parseConversationStateProposal({ ...proposal, transcriptRevision })?.transcriptRevision).toBe(
        transcriptRevision,
      );
    },
  );

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, "1", null, undefined])(
    "rejects invalid transcript revision %s",
    transcriptRevision => {
      expect(parseConversationStateProposal({ ...proposal, transcriptRevision })).toBeNull();
    },
  );

  it.each(["count-4-ducks", "hello-duck", "__proto__", "constructor", "count-1-duck ", "", 0, {}, null, undefined])(
    "parses proposal node shape independently of lesson selection %j",
    nodeId => {
      const parsed = parseConversationStateProposal({ ...proposal, nodeId });
      if (typeof nodeId === "string") expect(parsed?.nodeId).toBe(nodeId);
      else expect(parsed).toBeNull();
    },
  );

  it.each(["finished", "advance", "", 0, [], {}, null, undefined])("rejects unknown or malformed state %j", state => {
    for (const field of ["childActivity", "answerOutcome", "supportState", "tutorState"]) {
      expect(parseConversationStateProposal({ ...proposal, [field]: state })).toBeNull();
    }
  });

  it.each([
    ["childActivity", "none"],
    ["childActivity", "correct"],
    ["childActivity", "incorrect"],
    ["childActivity", "unclear"],
    ["childActivity", "needs_help"],
    ["childActivity", "listening"],
    ["answerOutcome", "thinking"],
    ["answerOutcome", "answering"],
    ["answerOutcome", "waiting"],
    ["answerOutcome", "needs_help"],
    ["supportState", "incorrect"],
    ["supportState", "unclear"],
    ["supportState", "thinking"],
    ["supportState", "helping"],
    ["tutorState", "correct"],
    ["tutorState", "needs_help"],
    ["tutorState", "waiting"],
  ])("rejects a value from a different axis: %s = %s", (field, state) => {
    expect(parseConversationStateProposal({ ...proposal, [field]: state })).toBeNull();
  });

  it("rejects the legacy mixed childState contract and any added childState field", () => {
    expect(
      parseConversationStateProposal({
        nodeId: proposal.nodeId,
        transcriptRevision: proposal.transcriptRevision,
        childState: "thinking",
        tutorState: proposal.tutorState,
      }),
    ).toBeNull();
    expect(parseConversationStateProposal({ ...proposal, childState: "correct" })).toBeNull();
  });

  it.each([null, undefined, true, 7, "correct", [], [proposal], {}])("rejects malformed payload %j", value => {
    expect(parseConversationStateProposal(value)).toBeNull();
  });

  it.each(Object.keys(proposal))("requires own field %s", key => {
    const incomplete: Record<string, unknown> = { ...proposal };
    delete incomplete[key];
    expect(parseConversationStateProposal(incomplete)).toBeNull();
    expect(
      parseConversationStateProposal(
        Object.assign(Object.create({ [key]: proposal[key as keyof typeof proposal] }), incomplete),
      ),
    ).toBeNull();
  });

  it.each([
    ["nextNodeId", "count-2-ducks"],
    ["sceneToRender", "duck-friends"],
    ["advance", true],
    ["setScreen", "duck-friends"],
    ["onSuccess", { kind: "node", nodeId: "count-2-ducks" }],
    ["futureNodes", ["count-2-ducks", "count-3-butterflies"]],
    ["explanation", "The child is thinking."],
  ])("rejects additional field %s even alongside a valid correct proposal", (key, value) => {
    expect(
      parseConversationStateProposal({ ...proposal, answerOutcome: "correct", [key as string]: value }),
    ).toBeNull();
  });

  it("round-trips only current-node interpretation without future-node or graph information", () => {
    const serialized = JSON.stringify(proposal);
    expect(serialized).not.toContain("count-2-ducks");
    expect(serialized).not.toContain("count-3-butterflies");
    const parsed = parseConversationStateProposal(JSON.parse(serialized));
    expect(parsed).toEqual(proposal);
    expect(parsed).not.toBe(proposal);
    expect(Object.keys(parsed!)).toEqual([
      "nodeId",
      "transcriptRevision",
      "childActivity",
      "answerOutcome",
      "supportState",
      "tutorState",
    ]);
  });
});
