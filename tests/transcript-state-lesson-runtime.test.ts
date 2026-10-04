import { describe, expect, it } from "vitest";
import type { ConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";
import { COUNTING_LESSON_GRAPH, type CountingNodeId } from "../lib/lesson-runtime/counting-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type ClassificationSource,
  type LessonRuntimeEvent,
  type LessonRuntimeResult,
} from "../lib/lesson-runtime/lesson-runtime-reducer";

type WithoutTime<T> = T extends unknown ? Omit<T, "atMs"> : never;

/** Mock semantic observations only; this harness never imports or calls Jev. */
class Runtime {
  state = createLessonRuntime("test-runtime", { quietDrainMs: 100 });
  result: LessonRuntimeResult = { state: this.state, effects: [] };

  send(event: WithoutTime<LessonRuntimeEvent>, atMs = this.state.nowMs + 1) {
    this.result = reduceLessonRuntime(this.state, { ...event, atMs });
    this.state = this.result.state;
    return this.result;
  }

  childStart() {
    return this.send({ type: "child.turn.started", source: runtimeSource(this.state) });
  }

  transcript(speaker: "child" | "tutor" | "unknown") {
    return this.send({
      type: "transcript.updated",
      source: runtimeSource(this.state),
      speaker,
      revision: this.state.transcriptRevision + 1,
    });
  }

  childTurn() {
    this.childStart();
    this.transcript("child");
    this.send({ type: "child.turn.ended", source: runtimeSource(this.state) });
  }

  proposal(
    fields: Partial<ConversationStateProposal> = {},
    source: ClassificationSource = classificationSource(this.state)!,
  ) {
    const proposal: ConversationStateProposal = {
      nodeId: this.state.nodeId,
      transcriptRevision: this.state.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "unknown",
      ...fields,
    };
    return this.send({ type: "proposal.received", source, proposal });
  }

  accept() {
    this.childTurn();
    return this.proposal();
  }

  acknowledge() {
    this.transcript("tutor");
    return this.proposal({ tutorState: "acknowledging" });
  }

  output(state: "active" | "quiet" | "unavailable") {
    return this.send({ type: "output.activity", source: runtimeSource(this.state), state });
  }

  tick(atMs = this.state.nowMs + 100) {
    return this.send({ type: "clock.tick", source: runtimeSource(this.state) }, atMs);
  }

  drain() {
    this.output("active");
    this.output("quiet");
    return this.tick();
  }

  pending() {
    this.accept();
    this.acknowledge();
    return this.drain();
  }

  confirm() {
    return this.send({
      type: "render.confirmed",
      runtimeId: this.state.runtimeId,
      identity: this.state.pendingRender!.identity,
    });
  }
}

function expectNoTransition(runtime: Runtime) {
  expect(runtime.state.phase).toBe("active");
  expect(runtime.state.pendingRender).toBeNull();
  expect(runtime.result.effects).toEqual([]);
}

describe("transcript-state lesson runtime authority", () => {
  it("accepts correct alone without granting a transition", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.tick();
    expect(runtime.state.answerAccepted).toBe(true);
    expect(runtime.state.acknowledgmentObserved).toBe(false);
    expectNoTransition(runtime);
  });

  it("requires relevant tutor audio even after correct and a later acknowledgment", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("quiet");
    runtime.tick();
    expect(runtime.state.acknowledgmentObserved).toBe(true);
    expect(runtime.state.tutorOutputDrained).toBe(false);
    expectNoTransition(runtime);
  });

  it("requires a later acknowledgment classification even after audio has drained", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.drain();
    expect(runtime.state.tutorOutputDrained).toBe(true);
    expectNoTransition(runtime);
  });

  it("does not accept acknowledgment from a child-authored correct snapshot or its duplicate", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.proposal({ tutorState: "acknowledging" });
    const state = runtime.state;
    expect(runtime.proposal({ tutorState: "acknowledging" }).state).toBe(state);
    runtime.drain();
    expect(runtime.state.acknowledgmentObserved).toBe(false);
    expectNoTransition(runtime);
  });

  it.each([false, true])(
    "a current tutor snapshot bootstraps completion after child classification is superseded (drained audio: %s)",
    alreadyDrained => {
      const runtime = new Runtime();
      runtime.childTurn();
      const childRequest = classificationSource(runtime.state)!;
      const childClaims = { nodeId: childRequest.nodeId, transcriptRevision: childRequest.transcriptRevision };
      if (alreadyDrained) runtime.drain();
      runtime.transcript("tutor");
      const tutorRequest = classificationSource(runtime.state)!;
      const state = runtime.state;
      expect(runtime.proposal(childClaims, childRequest).state).toBe(state);
      expect(runtime.state.acceptedAnswerRevision).toBeNull();
      runtime.proposal({ tutorState: "acknowledging" }, tutorRequest);
      if (alreadyDrained) {
        expect(runtime.state.phase).toBe("rendering");
        expect(runtime.result.effects).toEqual([
          {
            type: "render.requested",
            identity: { token: '["test-runtime",2]', nodeId: "count-2-ducks", sceneId: "duck-friends" },
          },
        ]);
      } else {
        expect(runtime.state).toMatchObject({ answerAccepted: true, acknowledgmentObserved: true });
        expectNoTransition(runtime);
      }
      // The old child-only result remains stale even after semantic authority or a render is established.
      const after = runtime.state;
      expect(runtime.proposal(childClaims, childRequest).state).toBe(after);
      expect(runtime.result.effects).toEqual([]);
    },
  );

  it("a first tutor classification can establish both semantic conditions but still requires sustained audio drain", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.output("active");
    runtime.transcript("tutor");
    const source = classificationSource(runtime.state)!;
    runtime.proposal({ tutorState: "acknowledging" }, source);
    expect(runtime.state).toMatchObject({
      answerAccepted: true,
      acknowledgmentObserved: true,
      acceptedAnswerRevision: source.transcriptRevision,
    });
    expectNoTransition(runtime);
    const state = runtime.state;
    expect(runtime.proposal({ tutorState: "acknowledging" }, source).state).toBe(state);
    expect(runtime.result.effects).toEqual([]);
    runtime.output("quiet");
    const quietAt = runtime.state.quietSinceMs!;
    runtime.tick(quietAt + 99);
    expectNoTransition(runtime);
    runtime.tick(quietAt + 100);
    expect(runtime.state.phase).toBe("rendering");
  });

  it.each([
    { answerOutcome: "incorrect" },
    { answerOutcome: "unclear" },
    { answerOutcome: "none" },
    { supportState: "needs_help" },
  ] satisfies Partial<ConversationStateProposal>[])(
    "a tutor acknowledgment with %j cannot bootstrap completion even with drained audio",
    fields => {
      const runtime = new Runtime();
      runtime.childTurn();
      runtime.drain();
      runtime.transcript("tutor");
      runtime.proposal({ tutorState: "acknowledging", ...fields });
      expect(runtime.state).toMatchObject({
        answerAccepted: false,
        acknowledgmentObserved: false,
        acceptedAnswerRevision: null,
        tutorOutputObserved: false,
      });
      expectNoTransition(runtime);
    },
  );

  it("a tutor snapshot without current-turn child evidence cannot bootstrap semantics", () => {
    const runtime = new Runtime();
    runtime.childStart();
    runtime.send({ type: "child.turn.ended", source: runtimeSource(runtime.state) });
    runtime.transcript("tutor");
    const source = { ...runtimeSource(runtime.state), nodeId: runtime.state.nodeId, transcriptRevision: 1 };
    const state = runtime.state;
    expect(runtime.proposal({ tutorState: "acknowledging" }, source).state).toBe(state);
    expect(runtime.state).toMatchObject({ answerAccepted: false, acknowledgmentObserved: false });
    expectNoTransition(runtime);
  });

  it("a tutor snapshot cannot bootstrap semantics while the child is speaking", () => {
    const runtime = new Runtime();
    runtime.childStart();
    runtime.transcript("child");
    runtime.transcript("tutor");
    const source = { ...runtimeSource(runtime.state), nodeId: runtime.state.nodeId, transcriptRevision: 2 };
    const state = runtime.state;
    expect(runtime.proposal({ tutorState: "acknowledging" }, source).state).toBe(state);
    expect(runtime.state).toMatchObject({ answerAccepted: false, acknowledgmentObserved: false });
    expectNoTransition(runtime);
  });

  it("supports A: correct, acknowledgment, audio, sustained quiet, authored render request", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    const quietAt = runtime.state.nowMs;
    runtime.tick(quietAt + 99);
    expectNoTransition(runtime);
    const result = runtime.tick(quietAt + 100);
    expect(result.effects).toEqual([
      {
        type: "render.requested",
        identity: { token: '["test-runtime",2]', nodeId: "count-2-ducks", sceneId: "duck-friends" },
      },
    ]);
    expect(runtime.state).toMatchObject({ nodeId: "count-2-ducks", phase: "rendering", lessonComplete: false });
  });

  it("supports B: correct, audio, quiet, later acknowledgment, sustained current quiet", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.output("active");
    runtime.output("quiet");
    const quietAt = runtime.state.nowMs;
    runtime.acknowledge();
    expect(runtime.state.quietSinceMs).toBe(quietAt);
    expectNoTransition(runtime);
    runtime.tick(quietAt + 100);
    expect(runtime.state.phase).toBe("rendering");
  });

  it("can authorize B when acknowledgment arrives after quiet has already been sustained", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.drain();
    expectNoTransition(runtime);
    runtime.acknowledge();
    expect(runtime.state.phase).toBe("rendering");
  });

  it("remembers post-child output that starts before the correct classification returns", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    const requestSource = classificationSource(runtime.state)!;
    runtime.output("active");
    expect(runtime.state).toMatchObject({ tutorOutputObserved: true, acceptedAnswerRevision: null });
    expectNoTransition(runtime);
    runtime.proposal({}, requestSource);
    runtime.acknowledge();
    expectNoTransition(runtime);
    runtime.output("quiet");
    const quietAt = runtime.state.quietSinceMs!;
    runtime.tick(quietAt + 99);
    expectNoTransition(runtime);
    runtime.tick(quietAt + 100);
    expect(runtime.state.phase).toBe("rendering");
    expect(runtime.state.pendingRender!.identity.nodeId).toBe("count-2-ducks");
  });

  it("uses still-current sustained quiet when tutor audio fully drains before correct classification", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    const requestSource = classificationSource(runtime.state)!;
    runtime.drain();
    const quietAt = runtime.state.quietSinceMs!;
    expect(runtime.state).toMatchObject({ tutorOutputObserved: true, tutorOutputDrained: true, answerAccepted: false });
    expectNoTransition(runtime);
    runtime.proposal({}, requestSource);
    expect(runtime.state.quietSinceMs).toBe(quietAt);
    expectNoTransition(runtime);
    runtime.acknowledge();
    expect(runtime.state.phase).toBe("rendering");
    expect(runtime.result.effects.map(effect => effect.type)).toEqual(["render.requested"]);
  });

  it.each([
    { answerOutcome: "incorrect" },
    { answerOutcome: "unclear" },
    { answerOutcome: "none" },
    { supportState: "needs_help" },
  ] satisfies Partial<ConversationStateProposal>[])(
    "classification %j clears post-child audio captured while classification was in flight",
    fields => {
      const runtime = new Runtime();
      runtime.childTurn();
      runtime.drain();
      expect(runtime.state.tutorOutputObserved).toBe(true);
      runtime.proposal(fields);
      expect(runtime.state).toMatchObject({
        answerAccepted: false,
        tutorOutputObserved: false,
        tutorOutputDrained: false,
        quietSinceMs: null,
      });
      // Even restored semantic authority cannot reuse the discarded audio.
      runtime.acknowledge();
      runtime.acknowledge();
      runtime.tick();
      expect(runtime.state.acknowledgmentObserved).toBe(true);
      expectNoTransition(runtime);
    },
  );

  it.each(["incorrect", "unclear", "none"] as const)("%s never grants completion authority", answerOutcome => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.proposal({ answerOutcome, tutorState: "acknowledging" });
    runtime.drain();
    expect(runtime.state.answerAccepted).toBe(false);
    expectNoTransition(runtime);
  });

  it("needs_help invalidates a correct candidate and its audio evidence", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.drain();
    runtime.transcript("tutor");
    runtime.proposal({ supportState: "needs_help", tutorState: "acknowledging" });
    expect(runtime.state.acceptedAnswerRevision).toBeNull();
    expect(runtime.state.tutorOutputObserved).toBe(false);
    expectNoTransition(runtime);
  });

  it.each(["unknown", "asking", "listening", "clarifying", "helping"] as const)(
    "%s is not an acknowledgment",
    tutorState => {
      const runtime = new Runtime();
      runtime.accept();
      runtime.drain();
      runtime.transcript("tutor");
      runtime.proposal({ tutorState });
      expectNoTransition(runtime);
    },
  );

  it.each(["incorrect", "unclear", "none"] as const)(
    "a latest %s answer supersedes the earlier correct candidate",
    answerOutcome => {
      const runtime = new Runtime();
      runtime.accept();
      runtime.drain();
      runtime.transcript("tutor");
      expect(runtime.state.answerAccepted).toBe(false);
      runtime.proposal({ answerOutcome });
      expect(runtime.state).toMatchObject({ answerAccepted: false, acknowledgmentObserved: false });
      expectNoTransition(runtime);
      runtime.acknowledge();
      expect(runtime.state.acknowledgmentObserved).toBe(true);
      expect(runtime.state.tutorOutputObserved).toBe(false);
      expectNoTransition(runtime);
    },
  );

  it("an unclassified newer revision cannot use older semantic authority", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    runtime.transcript("tutor");
    runtime.tick();
    expect(runtime.state.answerAccepted).toBe(false);
    expect(runtime.state.acknowledgmentObserved).toBe(false);
    expectNoTransition(runtime);
  });

  it.each(["child", "unknown"] as const)("a %s transcript update clears old answer and audio", speaker => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.drain();
    runtime.transcript(speaker);
    expect(runtime.state.acceptedAnswerRevision).toBeNull();
    expect(runtime.state.tutorOutputObserved).toBe(false);
    runtime.tick();
    expectNoTransition(runtime);
  });

  it("new child speech invalidates evidence before its transcript arrives and rejects the old turn", () => {
    const runtime = new Runtime();
    runtime.accept();
    const oldSource = classificationSource(runtime.state)!;
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    runtime.childStart();
    expect(runtime.state).toMatchObject({ answerAccepted: false, tutorOutputObserved: false, childSpeaking: true });
    expect(classificationSource(runtime.state)).toBeNull();
    const state = runtime.state;
    expect(runtime.proposal({}, oldSource).state).toBe(state);
    runtime.send({ type: "child.turn.ended", source: runtimeSource(runtime.state) });
    expect(classificationSource(runtime.state)).toBeNull();
    runtime.tick();
    expectNoTransition(runtime);
    runtime.transcript("child");
    runtime.proposal();
    runtime.acknowledge();
    runtime.tick();
    expectNoTransition(runtime);
    runtime.drain();
    expect(runtime.state.phase).toBe("rendering");
  });

  it("does not classify ongoing local child speech, even if the proposal says correct", () => {
    const runtime = new Runtime();
    runtime.childStart();
    runtime.transcript("child");
    const source = { ...runtimeSource(runtime.state), nodeId: runtime.state.nodeId, transcriptRevision: 1 };
    const state = runtime.state;
    expect(runtime.proposal({}, source).state).toBe(state);
    expectNoTransition(runtime);
  });

  it.each([{ transcriptRevision: 0 }, { transcriptRevision: 2 }, { nodeId: "count-2-ducks" as CountingNodeId }])(
    "ignores stale/wrong model identity %j",
    claims => {
      const runtime = new Runtime();
      runtime.childTurn();
      const state = runtime.state;
      expect(runtime.proposal(claims).state).toBe(state);
      runtime.tick();
      expectNoTransition(runtime);
    },
  );

  it.each([
    { runtimeId: "earlier-runtime" },
    { visitId: 0 },
    { childTurnId: 0 },
    { nodeId: "count-2-ducks" as CountingNodeId },
    { transcriptRevision: 0 },
  ])("ignores stale/wrong app request source %j even with correct current claims", sourceFields => {
    const runtime = new Runtime();
    runtime.childTurn();
    const state = runtime.state;
    expect(runtime.proposal({}, { ...classificationSource(state)!, ...sourceFields }).state).toBe(state);
    expectNoTransition(runtime);
  });

  it("ignores a delayed classification of a superseded snapshot", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    const source = classificationSource(runtime.state)!;
    runtime.transcript("tutor");
    const state = runtime.state;
    expect(runtime.proposal({ transcriptRevision: source.transcriptRevision }, source).state).toBe(state);
  });

  it("rejects model-selected commands without consuming a valid revision", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    const source = classificationSource(runtime.state)!;
    const proposal = {
      nodeId: source.nodeId,
      transcriptRevision: source.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "acknowledging",
      nextNodeId: "count-3-butterflies",
    };
    const state = runtime.state;
    expect(runtime.send({ type: "proposal.received", source, proposal }).state).toBe(state);
    runtime.proposal();
    expect(runtime.state.answerAccepted).toBe(true);
  });

  it("pre-child-turn output and already-active PCM cannot satisfy the audio requirement", () => {
    const runtime = new Runtime();
    runtime.output("active");
    runtime.output("quiet");
    runtime.accept();
    runtime.acknowledge();
    runtime.tick();
    expectNoTransition(runtime);

    const active = new Runtime();
    active.output("active");
    active.accept();
    active.acknowledge();
    active.output("active");
    active.output("quiet");
    active.tick();
    expect(active.state.tutorOutputObserved).toBe(false);
    expectNoTransition(active);
    active.drain();
    expect(active.state.phase).toBe("rendering");
  });

  it("output beginning during child speech cannot become relevant when that speech ends", () => {
    const runtime = new Runtime();
    runtime.childStart();
    runtime.transcript("child");
    runtime.output("active");
    expect(runtime.state.tutorOutputObserved).toBe(false);
    runtime.send({ type: "child.turn.ended", source: runtimeSource(runtime.state) });
    runtime.proposal();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    runtime.tick();
    expectNoTransition(runtime);
    runtime.drain();
    expect(runtime.state.phase).toBe("rendering");
  });

  it("an ended child turn without its own transcript cannot establish candidate audio", () => {
    const runtime = new Runtime();
    runtime.childStart();
    runtime.send({ type: "child.turn.ended", source: runtimeSource(runtime.state) });
    runtime.output("active");
    runtime.transcript("child");
    runtime.proposal();
    runtime.acknowledge();
    runtime.output("quiet");
    runtime.tick();
    expect(runtime.state.tutorOutputObserved).toBe(false);
    expectNoTransition(runtime);
  });

  it("new child speech immediately clears unclassified candidate audio and cannot carry it forward", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.output("active");
    expect(runtime.state.tutorOutputObserved).toBe(true);
    runtime.childStart();
    expect(runtime.state).toMatchObject({ tutorOutputObserved: false, tutorOutputDrained: false, quietSinceMs: null });
    runtime.transcript("child");
    runtime.send({ type: "child.turn.ended", source: runtimeSource(runtime.state) });
    runtime.proposal();
    runtime.acknowledge();
    // Previous-turn output is still active; repeating active does not manufacture a new onset.
    runtime.output("active");
    runtime.output("quiet");
    runtime.tick();
    expectNoTransition(runtime);
  });

  it.each(["child", "unknown"] as const)("a %s update invalidates unclassified candidate audio", speaker => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.drain();
    expect(runtime.state.tutorOutputObserved).toBe(true);
    runtime.transcript(speaker);
    expect(runtime.state).toMatchObject({ tutorOutputObserved: false, tutorOutputDrained: false, quietSinceMs: null });
    runtime.tick();
    expectNoTransition(runtime);
  });

  it.each([{ runtimeId: "old-runtime" }, { visitId: 0 }, { childTurnId: 0 }])(
    "a stale audio source %j cannot establish post-child candidate audio",
    staleSource => {
      const runtime = new Runtime();
      runtime.childTurn();
      const state = runtime.state;
      expect(
        runtime.send({ type: "output.activity", source: { ...runtimeSource(state), ...staleSource }, state: "active" })
          .state,
      ).toBe(state);
      runtime.proposal();
      runtime.acknowledge();
      runtime.output("quiet");
      runtime.tick();
      expectNoTransition(runtime);
    },
  );

  it("unavailable clears candidate audio even before semantic acceptance", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.drain();
    expect(runtime.state.tutorOutputObserved).toBe(true);
    runtime.output("unavailable");
    expect(runtime.state).toMatchObject({ tutorOutputObserved: false, tutorOutputDrained: false, quietSinceMs: null });
    runtime.proposal();
    runtime.acknowledge();
    runtime.output("quiet");
    runtime.tick();
    expectNoTransition(runtime);
    runtime.drain();
    expect(runtime.state.phase).toBe("rendering");
  });

  it("renewed active output resets quiet captured before semantic acceptance", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.drain();
    expect(runtime.state.tutorOutputDrained).toBe(true);
    runtime.output("active");
    expect(runtime.state).toMatchObject({ tutorOutputObserved: true, tutorOutputDrained: false, quietSinceMs: null });
    runtime.proposal();
    runtime.acknowledge();
    runtime.tick();
    expectNoTransition(runtime);
    runtime.output("quiet");
    const quietAt = runtime.state.quietSinceMs!;
    runtime.tick(quietAt + 99);
    expectNoTransition(runtime);
    runtime.tick(quietAt + 100);
    expect(runtime.state.phase).toBe("rendering");
  });

  it("renewed active output resets the sustained quiet deadline", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    runtime.tick(runtime.state.nowMs + 99);
    runtime.output("active");
    expect(runtime.state.quietSinceMs).toBeNull();
    expect(runtime.state.tutorOutputDrained).toBe(false);
    runtime.tick();
    expectNoTransition(runtime);
    runtime.output("quiet");
    const quietAt = runtime.state.nowMs;
    runtime.tick(quietAt + 99);
    expectNoTransition(runtime);
    runtime.tick(quietAt + 100);
    expect(runtime.state.phase).toBe("rendering");
  });

  it("unavailable is never quiet and a subsequent quiet cannot restore lost audio evidence", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    runtime.output("unavailable");
    runtime.tick();
    expect(runtime.state.tutorOutputDrained).toBe(false);
    expectNoTransition(runtime);
    runtime.output("quiet");
    runtime.tick();
    expectNoTransition(runtime);
    runtime.drain();
    expect(runtime.state.phase).toBe("rendering");
  });

  it("repeated quiet observations preserve the original quiet deadline", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    const quietAt = runtime.state.quietSinceMs!;
    runtime.output("quiet");
    expect(runtime.state.quietSinceMs).toBe(quietAt);
    runtime.tick(quietAt + 100);
    expect(runtime.state.phase).toBe("rendering");
  });

  it("releases only newly rendered current-node context, once, for the exact render identity", () => {
    const runtime = new Runtime();
    runtime.pending();
    expect(classificationSource(runtime.state)).toBeNull();
    expect(runtime.result.effects.map(effect => effect.type)).toEqual(["render.requested"]);
    const identity = runtime.state.pendingRender!.identity;
    const result = runtime.confirm();
    const node = COUNTING_LESSON_GRAPH["count-2-ducks"];
    expect(result.effects).toEqual([
      {
        type: "steering.ready",
        renderToken: identity.token,
        context: {
          nodeId: node.id,
          scene: { id: node.sceneId, object: node.object, quantity: node.quantity },
          learningObjective: node.learningObjective,
          tutorBrief: node.tutorBrief,
        },
      },
    ]);
    expect(JSON.stringify(result.effects)).not.toContain("onSuccess");
    expect(JSON.stringify(result.effects)).not.toContain("count-3-butterflies");
    expect(runtime.state.phase).toBe("active");
    const state = runtime.state;
    expect(runtime.send({ type: "render.confirmed", runtimeId: state.runtimeId, identity }).state).toBe(state);
    expect(runtime.result.effects).toEqual([]);
    runtime.tick();
    expectNoTransition(runtime);
  });

  it.each([
    { token: "wrong-render" },
    { nodeId: "count-3-butterflies" as CountingNodeId },
    { sceneId: "butterfly-garden" as const },
  ])("a mismatched render %j does not release context or consume the pending render", mismatch => {
    const runtime = new Runtime();
    runtime.pending();
    const state = runtime.state;
    expect(
      runtime.send({
        type: "render.confirmed",
        runtimeId: state.runtimeId,
        identity: { ...state.pendingRender!.identity, ...mismatch },
      }).state,
    ).toBe(state);
    expect(runtime.result.effects).toEqual([]);
    expect(runtime.confirm().effects[0].type).toBe("steering.ready");
  });

  it("same token from another runtime cannot confirm a render", () => {
    const runtime = new Runtime();
    runtime.pending();
    const state = runtime.state;
    expect(
      runtime.send({
        type: "render.confirmed",
        runtimeId: "old-runtime",
        identity: state.pendingRender!.identity,
      }).state,
    ).toBe(state);
  });

  it.each(["stop", "disconnect", "child.turn.started", "active", "unavailable"] as const)(
    "%s cancels an unconfirmed success render and makes its later confirmation inert",
    interruption => {
      const runtime = new Runtime();
      runtime.pending();
      const { identity, origin } = runtime.state.pendingRender!;
      if (interruption === "stop" || interruption === "disconnect") {
        runtime.send({ type: interruption, runtimeId: runtime.state.runtimeId });
      } else if (interruption === "child.turn.started") {
        runtime.send({ type: interruption, source: origin });
      } else {
        runtime.send({ type: "output.activity", source: origin, state: interruption });
      }
      expect(runtime.state).toMatchObject({
        phase: "stopped",
        nodeId: "count-1-duck",
        pendingRender: null,
        lessonComplete: false,
      });
      expect(runtime.send({ type: "render.confirmed", runtimeId: runtime.state.runtimeId, identity }).effects).toEqual(
        [],
      );
    },
  );

  it.each(["stop", "disconnect"] as const)("%s during quiet prevents all future completion", type => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    runtime.send({ type, runtimeId: runtime.state.runtimeId });
    runtime.tick();
    expect(runtime.state.phase).toBe("stopped");
    expect(runtime.result.effects).toEqual([]);
  });

  it.each(["child", "unknown"] as const)(
    "a new %s transcript during rendering revokes completion even without a speech-start event",
    speaker => {
      const runtime = new Runtime();
      runtime.pending();
      const { identity, origin } = runtime.state.pendingRender!;
      runtime.send({
        type: "transcript.updated",
        source: origin,
        revision: runtime.state.transcriptRevision + 1,
        speaker,
      });
      expect(runtime.state).toMatchObject({ phase: "stopped", nodeId: "count-1-duck", pendingRender: null });
      expect(runtime.send({ type: "render.confirmed", runtimeId: runtime.state.runtimeId, identity }).effects).toEqual(
        [],
      );
    },
  );

  it("stale visit audio, ticks, speech, and proposals cannot act during or after a render", () => {
    const runtime = new Runtime();
    runtime.pending();
    const { origin } = runtime.state.pendingRender!;
    const pending = runtime.state;
    expect(runtime.proposal({}, origin).state).toBe(pending);
    runtime.confirm();
    runtime.accept();
    const state = runtime.state;
    for (const type of ["child.turn.started", "clock.tick"] as const) {
      expect(runtime.send({ type, source: origin }).state).toBe(state);
    }
    expect(runtime.send({ type: "output.activity", source: origin, state: "active" }).state).toBe(state);
    // Model claims are current; app-owned visit identity is still old.
    expect(runtime.proposal({}, { ...classificationSource(state)!, visitId: origin.visitId }).state).toBe(state);
  });

  it("follows all authored edges to a terminal render and never releases a future node", () => {
    const runtime = new Runtime();
    const tokens: string[] = [];
    for (const nodeId of ["count-1-duck", "count-2-ducks", "count-3-butterflies"]) {
      expect(runtime.state.nodeId).toBe(nodeId);
      runtime.pending();
      tokens.push(runtime.state.pendingRender!.identity.token);
      if (nodeId === "count-3-butterflies") {
        expect(runtime.state.lessonComplete).toBe(true);
        expect(runtime.state.pendingRender!.identity).toEqual({
          token: '["test-runtime",4]',
          nodeId: null,
          sceneId: null,
        });
      }
      runtime.confirm();
    }
    expect(new Set(tokens).size).toBe(3);
    expect(runtime.state).toMatchObject({ phase: "complete", lessonComplete: true, pendingRender: null });
    expect(runtime.result.effects).toEqual([{ type: "lesson.completed", renderToken: '["test-runtime",4]' }]);
    const state = runtime.state;
    expect(runtime.tick().state).toBe(state);
    expect(runtime.childStart().state).toBe(state);
    expect(runtime.result.effects).toEqual([]);
  });

  it("an interrupted terminal render does not leave the lesson complete", () => {
    const runtime = new Runtime();
    for (let i = 0; i < 2; i++) {
      runtime.pending();
      runtime.confirm();
    }
    runtime.pending();
    const { identity, origin } = runtime.state.pendingRender!;
    runtime.send({ type: "child.turn.started", source: origin });
    expect(runtime.state).toMatchObject({ phase: "stopped", nodeId: "count-3-butterflies", lessonComplete: false });
    expect(runtime.send({ type: "render.confirmed", runtimeId: runtime.state.runtimeId, identity }).effects).toEqual(
      [],
    );
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "ignores non-increasing or invalid transcript revision %s",
    revision => {
      const runtime = new Runtime();
      runtime.accept();
      const state = runtime.state;
      expect(
        runtime.send({ type: "transcript.updated", source: runtimeSource(state), revision, speaker: "tutor" }).state,
      ).toBe(state);
    },
  );

  it.each([-1, NaN, Infinity])("invalid event time %s cannot advance a gate", atMs => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    const state = runtime.state;
    expect(runtime.tick(atMs).state).toBe(state);
    expect(runtime.tick(state.nowMs - 1).state).toBe(state);
    expectNoTransition(runtime);
  });

  it("supports a configurable small drain interval and deterministic replay", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    const state = { ...runtime.state, quietDrainMs: 20 };
    const event: LessonRuntimeEvent = {
      type: "clock.tick",
      source: runtimeSource(state),
      atMs: state.nowMs + 20,
    };
    const before = structuredClone(state);
    expect(reduceLessonRuntime(state, event)).toEqual(reduceLessonRuntime(before, event));
    expect(reduceLessonRuntime(state, event).state.phase).toBe("rendering");
    expect(state).toEqual(before);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid drain configuration %s", quietDrainMs => {
    expect(() => createLessonRuntime("runtime", { quietDrainMs })).toThrow();
  });
});

describe("discarded microphone candidate revalidation", () => {
  function candidate(runtime: Runtime) {
    return runtime.send({ type: "child.candidate.started", source: runtimeSource(runtime.state) });
  }
  function discard(runtime: Runtime) {
    return runtime.send({ type: "child.candidate.discarded", source: runtimeSource(runtime.state) });
  }

  it("suspends accepted authority and requires a fresh new-turn result even for an unchanged revision", () => {
    const runtime = new Runtime();
    runtime.accept();
    runtime.acknowledge();
    runtime.output("active");
    runtime.output("quiet");
    const oldSource = classificationSource(runtime.state)!;
    const oldTurn = runtime.state.childTurnId;
    candidate(runtime);
    expect(runtime.state).toMatchObject({ answerAccepted: false, acknowledgmentObserved: false, childSpeaking: true });
    expect(classificationSource(runtime.state)).toBeNull();
    runtime.tick();
    expectNoTransition(runtime);
    discard(runtime);
    expect(runtime.state).toMatchObject({
      childTurnId: oldTurn + 1,
      hasChildTranscript: true,
      answerAccepted: false,
      acknowledgmentObserved: false,
      consumedRevision: null,
      tutorOutputObserved: true,
      tutorOutputDrained: false,
    });
    runtime.proposal({ tutorState: "acknowledging" }, oldSource);
    runtime.tick();
    expectNoTransition(runtime);
    runtime.proposal({ tutorState: "acknowledging" });
    expect(runtime.state.phase).toBe("rendering");
    expect(runtime.result.effects.map(effect => effect.type)).toEqual(["render.requested"]);
    runtime.confirm();
    expect(runtime.result.effects.map(effect => effect.type)).toEqual(["steering.ready"]);
  });

  it("can bind fresh output during a discarded candidate, with quiet measured again after discard", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    candidate(runtime);
    runtime.transcript("tutor");
    runtime.output("active");
    runtime.output("quiet");
    runtime.tick();
    discard(runtime);
    runtime.proposal({ tutorState: "acknowledging" });
    expectNoTransition(runtime);
    runtime.tick();
    expect(runtime.state.phase).toBe("rendering");
  });

  it.each(["active", "unavailable"] as const)("does not manufacture audio from pre-turn %s output", activity => {
    const runtime = new Runtime();
    runtime.output(activity);
    runtime.childTurn();
    candidate(runtime);
    runtime.transcript("tutor");
    runtime.output("quiet");
    discard(runtime);
    runtime.proposal({ tutorState: "acknowledging" });
    runtime.tick();
    expect(runtime.state.tutorOutputObserved).toBe(false);
    expectNoTransition(runtime);
  });

  it("unavailable output revokes suspended audio", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.output("active");
    candidate(runtime);
    runtime.output("unavailable");
    runtime.output("quiet");
    discard(runtime);
    runtime.transcript("tutor");
    runtime.proposal({ tutorState: "acknowledging" });
    runtime.tick();
    expect(runtime.state.tutorOutputObserved).toBe(false);
    expectNoTransition(runtime);
  });

  it("confirmed detector activity permanently invalidates suspended eligibility and audio", () => {
    const runtime = new Runtime();
    runtime.childTurn();
    runtime.output("active");
    candidate(runtime);
    runtime.transcript("tutor");
    runtime.send({ type: "child.turn.confirmed", source: runtimeSource(runtime.state) });
    discard(runtime); // A discard cannot undo confirmation.
    runtime.send({ type: "child.turn.ended", source: runtimeSource(runtime.state) });
    runtime.output("quiet");
    expect(classificationSource(runtime.state)).toBeNull();
    expect(runtime.state).toMatchObject({ hasChildTranscript: false, tutorOutputObserved: false });
    expectNoTransition(runtime);
  });

  it.each(["child", "unknown"] as const)(
    "a newer %s revision revokes suspension rather than restoring the old answer",
    speaker => {
      const runtime = new Runtime();
      runtime.childTurn();
      runtime.output("active");
      candidate(runtime);
      runtime.transcript(speaker);
      expect(runtime.state.childCandidate).toBeNull();
      discard(runtime);
      expect(runtime.state.childSpeaking).toBe(true);
      runtime.send({ type: "child.turn.ended", source: runtimeSource(runtime.state) });
      runtime.output("quiet");
      if (speaker === "child") runtime.proposal({ tutorState: "acknowledging" });
      expect(runtime.state).toMatchObject({ acknowledgmentObserved: false, tutorOutputObserved: false });
      expectNoTransition(runtime);
    },
  );

  it("candidate onset during render handoff stops and cannot be recovered by discard or confirmation", () => {
    const runtime = new Runtime();
    runtime.pending();
    const identity = runtime.state.pendingRender!.identity;
    const origin = runtime.state.pendingRender!.origin;
    runtime.send({ type: "child.candidate.started", source: origin });
    expect(runtime.state).toMatchObject({ phase: "stopped", nodeId: "count-1-duck", pendingRender: null });
    discard(runtime);
    runtime.send({ type: "render.confirmed", runtimeId: runtime.state.runtimeId, identity });
    expect(runtime.result.effects).toEqual([]);
    expect(runtime.state.phase).toBe("stopped");
  });
});
