import { describe, expect, it } from "vitest";
import type { ConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";
import { COUNTING_LESSON_GRAPH, COUNTING_NODE_IDS } from "../lib/lesson-runtime/counting-lesson";
import { initialTeachingContext, SPROUT_LIVE_CONFIG, teachingInstruction } from "../lib/lesson-runtime/live-context";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";

describe("counting confirmation instruction construction (no model calls)", () => {
  const contexts = COUNTING_NODE_IDS.map(nodeId => {
    const node = COUNTING_LESSON_GRAPH[nodeId];
    return {
      nodeId,
      scene: { id: node.sceneId, object: node.object, quantity: node.quantity },
      learningObjective: node.learningObjective,
      tutorBrief: node.tutorBrief,
    };
  });

  it("supplies only the initial node in the initial private context", () => {
    const initialText = SPROUT_LIVE_CONFIG.input[0].content[0].text;
    expect(initialText).toBe(`Private initial teaching context: ${JSON.stringify(initialTeachingContext())}`);
    expect(initialText).not.toContain("onSuccess");
    expect(initialText).not.toContain("count-2-ducks");
  });

  it.each(contexts)("retains exact current scene facts and excludes graph edges for $nodeId", context => {
    const instruction = teachingInstruction(context);
    expect(instruction).toContain(`Private current-node teaching context: ${JSON.stringify(context)}`);
    expect(instruction).not.toContain("onSuccess");
    for (const other of COUNTING_NODE_IDS.filter(id => id !== context.nodeId)) {
      expect(instruction).not.toContain(other);
    }
    expect(instruction).toContain("this current scene is now rendered");
    expect(instruction).toContain("only the application changes the scene");
    expect(instruction).toContain("Follow the session counting and help guidance");
    expect(instruction).toContain("Confirm a settled successful answer with its number and object, then pause");
    expect(instruction).toContain("Wait or clarify unfinished/uncertain attempts");
  });

  it.each([["session", SPROUT_LIVE_CONFIG.instructions]])(
    "supplies success and uncertainty guidance in %s instructions",
    (_name, instruction) => {
      // These assertions cover delivered instructions, not GPT-Live's interpretation.
      expect(instruction).toContain(
        "a stated total or counting one at a time up to the displayed quantity and stopping there",
      );
      expect(instruction).toContain('"one, two" when two objects are displayed');
      expect(instruction).toContain("including after a retry or counting help");
      expect(instruction).toContain(
        "explicitly confirm that total with its number and the current scene's object name",
      );
      expect(instruction).toContain(
        '"You\'re counting carefully" may accompany this confirmation but must not replace it',
      );
      expect(instruction).toContain("a pause or hesitation alone does not establish a settled total");
      expect(instruction).toContain("If counting is still underway, wait");
      expect(instruction).toContain("ambiguous, interrupted, or incomplete");
      expect(instruction).toContain("finish or clarify without supplying the total");
      expect(instruction).toContain("If the settled total is wrong, invite another try");
      expect(instruction).toContain(
        "difficulty remains unresolved, offer a short counting hint without giving the total",
      );
      expect(instruction).toContain("Do not announce the displayed total before the child has counted");
      expect(instruction).toContain(
        "After confirming success, pause and listen for updated application screen context",
      );
    },
  );
});

describe("counted correction authority (mock semantic observations, no transcript inference)", () => {
  it.each([
    { label: "process praise alone", answerOutcome: "correct", supportState: "none", tutorState: "unknown" },
    { label: "partial count", answerOutcome: "unclear", supportState: "none", tutorState: "clarifying" },
    { label: "wrong settled total", answerOutcome: "incorrect", supportState: "none", tutorState: "helping" },
    { label: "unresolved help", answerOutcome: "unclear", supportState: "needs_help", tutorState: "helping" },
    {
      label: "correct observation with unresolved help",
      answerOutcome: "correct",
      supportState: "needs_help",
      tutorState: "acknowledging",
    },
  ] as const)("holds two ducks after $label, then permits a freshly acknowledged correction", observation => {
    let state = createLessonRuntime("counted-correction", { quietDrainMs: 100 });
    const send = (event: LessonRuntimeEvent) => {
      const result = reduceLessonRuntime(state, event);
      state = result.state;
      return result.effects;
    };
    const child = () => {
      send({ type: "child.turn.started", source: runtimeSource(state), atMs: state.nowMs + 1 });
      send({
        type: "transcript.updated",
        source: runtimeSource(state),
        speaker: "child",
        revision: state.transcriptRevision + 1,
        atMs: state.nowMs + 1,
      });
      send({ type: "child.turn.ended", source: runtimeSource(state), atMs: state.nowMs + 1 });
    };
    const tutor = (fields: Pick<ConversationStateProposal, "answerOutcome" | "supportState" | "tutorState">) => {
      send({
        type: "transcript.updated",
        source: runtimeSource(state),
        speaker: "tutor",
        revision: state.transcriptRevision + 1,
        atMs: state.nowMs + 1,
      });
      return send({
        type: "proposal.received",
        source: classificationSource(state)!,
        proposal: {
          nodeId: state.nodeId,
          transcriptRevision: state.transcriptRevision,
          childActivity: "unknown",
          ...fields,
        },
        atMs: state.nowMs + 1,
      });
    };
    const drain = () => {
      send({ type: "output.activity", source: runtimeSource(state), state: "active", atMs: state.nowMs + 1 });
      send({ type: "output.activity", source: runtimeSource(state), state: "quiet", atMs: state.nowMs + 1 });
      return send({ type: "clock.tick", source: runtimeSource(state), atMs: state.nowMs + 100 });
    };
    const success = { answerOutcome: "correct", supportState: "none", tutorState: "acknowledging" } as const;

    child();
    tutor(success);
    drain();
    const initialRender = state.pendingRender!.identity;
    send({ type: "render.confirmed", runtimeId: state.runtimeId, identity: initialRender, atMs: state.nowMs + 1 });
    expect(state.nodeId).toBe("count-2-ducks");

    child();
    tutor(observation);
    expect(drain()).toEqual([]);
    expect(state.phase).toBe("active");
    expect(state.pendingRender).toBeNull();
    const oldSource = classificationSource(state)!;

    child();
    expect(state.answerAccepted).toBe(false);
    expect(state.acknowledgmentObserved).toBe(false);
    // An old success-shaped result cannot authorize the corrected turn.
    expect(
      send({
        type: "proposal.received",
        source: oldSource,
        proposal: {
          ...success,
          childActivity: "unknown",
          nodeId: oldSource.nodeId,
          transcriptRevision: oldSource.transcriptRevision,
        },
        atMs: state.nowMs + 1,
      }),
    ).toEqual([]);
    tutor(success);
    expect(state.phase).toBe("active");
    expect(drain()).toEqual([
      {
        type: "render.requested",
        identity: { token: '["counted-correction",3]', nodeId: "count-3-butterflies", sceneId: "butterfly-garden" },
      },
    ]);
    const confirmed = send({
      type: "render.confirmed",
      runtimeId: state.runtimeId,
      identity: state.pendingRender!.identity,
      atMs: state.nowMs + 1,
    });
    expect(confirmed).toMatchObject([{ type: "steering.ready", context: { nodeId: "count-3-butterflies" } }]);
  });
});
