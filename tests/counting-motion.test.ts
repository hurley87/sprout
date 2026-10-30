import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COUNTING_LESSON, INITIAL_COUNTING_NODE_ID } from "../lib/lesson-runtime/counting-lesson";
import { runtimeSource, type LessonRuntimeState } from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";
import { lessonPresentation, showsSuccessFeedback, stageMotion, voiceActivity } from "../app/lesson-presentation";
import { CountingStage } from "../app/counting-stage";
import { VoiceCue } from "../app/voice-cue";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

type Proposal = {
  childActivity: string;
  answerOutcome: string;
  answerCommitment: string;
  supportState: string;
  tutorState: string;
};
const correct: Proposal = {
  childActivity: "unknown",
  answerOutcome: "correct",
  answerCommitment: "committed",
  supportState: "none",
  tutorState: "listening",
};

function scenario() {
  const h = createReducerHarness("motion", { lesson: COUNTING_LESSON, quietDrainMs: 100 });
  let display: LessonSnapshot["display"] = {
    token: "motion:initial",
    nodeId: INITIAL_COUNTING_NODE_ID,
    sceneId: "hello-duck",
  };
  const snapshot = (overrides: Partial<LessonSnapshot> = {}) => ({
    status: "live" as const,
    error: null,
    awaitingSteering: false,
    display,
    runtime: h.state,
    ...overrides,
  });
  const success = (overrides?: Partial<LessonSnapshot>) => showsSuccessFeedback(snapshot(overrides), COUNTING_LESSON);
  const answer = (proposal: Proposal = correct, revision = h.state.transcriptRevision + 1) => {
    const source = prepareLearnerClassification(h, revision);
    h.send({
      type: "proposal.received",
      source,
      proposal: { ...proposal, nodeId: source.nodeId, transcriptRevision: source.transcriptRevision },
    });
  };
  const tutor = (state: "active" | "quiet") =>
    h.send({ type: "output.activity", source: runtimeSource(h.state), state });
  return {
    h,
    snapshot,
    success,
    answer,
    tutor,
    confirm() {
      display = h.state.pendingRender!.identity;
      h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: display });
    },
  };
}

describe("counting success feedback", () => {
  it("shows only once the accepted answer has an observed tutor reply on the displayed visit", () => {
    const s = scenario();
    expect(s.success()).toBe(false);
    s.answer();
    expect(s.h.state.answerAccepted).toBe(true);
    // Accepted learner evidence alone must not be praised before Sprout replies.
    expect(s.success()).toBe(false);
    s.tutor("active");
    expect(s.success()).toBe(true);
    s.h.send({ type: "transcript.updated", source: runtimeSource(s.h.state), revision: 2, speaker: "tutor" });
    expect(s.success()).toBe(true);
    // Still true while the answered group drains; only the reducer commits the next scene.
    s.tutor("quiet");
    expect(s.h.state.phase).toBe("active");
    expect(s.success()).toBe(true);
  });

  it("never carries over into the transition or the next visit", () => {
    const s = scenario();
    s.answer();
    s.tutor("active");
    s.tutor("quiet");
    s.h.send({ type: "clock.tick", source: runtimeSource(s.h.state) }, 150);
    expect(s.h.state.phase).toBe("rendering");
    expect(s.success()).toBe(false);
    s.confirm();
    expect(s.h.state).toMatchObject({ phase: "active", nodeId: "count-2-ducks", visitId: 2 });
    expect(s.success()).toBe(false);
    expect(s.success({ awaitingSteering: true })).toBe(false);
  });

  it.each<[string, Partial<Proposal>]>([
    ["wrong", { answerOutcome: "incorrect" }],
    ["unclear", { answerOutcome: "unclear" }],
    ["uncommitted", { answerCommitment: "unresolved" }],
    ["withdrawn", { answerCommitment: "withdrawn" }],
    ["help request", { supportState: "needs_help" }],
    ["still answering", { childActivity: "answering" }],
  ])("is not triggered by a %s answer, even when Sprout replies", (_, change) => {
    const s = scenario();
    s.answer({ ...correct, ...change });
    s.tutor("active");
    expect(s.h.state.answerAccepted).toBe(false);
    expect(s.success()).toBe(false);
  });

  it("is withdrawn when the child interrupts or a newer answer supersedes it", () => {
    const interrupted = scenario();
    interrupted.answer();
    interrupted.tutor("active");
    expect(interrupted.success()).toBe(true);
    interrupted.h.send({ type: "child.turn.started", source: runtimeSource(interrupted.h.state) });
    expect(interrupted.success()).toBe(false);
    expect(stageMotion(interrupted.snapshot(), COUNTING_LESSON)).toBe("calm");

    const superseded = scenario();
    superseded.answer();
    superseded.tutor("active");
    superseded.answer({ ...correct, answerOutcome: "incorrect" });
    superseded.tutor("quiet");
    superseded.tutor("active");
    expect(superseded.success()).toBe(false);
  });

  it("rejects a stale display, Stop, disconnect and failure", () => {
    const s = scenario();
    s.answer();
    s.tutor("active");
    expect(s.success()).toBe(true);
    const stale = { token: "motion:old", nodeId: "count-2-ducks", sceneId: "duck-friends" };
    expect(s.success({ display: stale })).toBe(false);
    expect(s.success({ error: "Provider failure" })).toBe(false);
    expect(s.success({ status: "ended" })).toBe(false);
    s.h.send({ type: "stop", runtimeId: s.h.state.runtimeId });
    expect(s.h.state.phase).toBe("stopped");
    expect(s.success()).toBe(false);
    expect(stageMotion(s.snapshot({ status: "ended" }), COUNTING_LESSON)).toBe("calm");
    expect(showsSuccessFeedback(null, COUNTING_LESSON)).toBe(false);
  });
});

describe("counting stage motion", () => {
  const live = (runtime: Partial<LessonRuntimeState> | null) => {
    const s = scenario();
    return s.snapshot({ runtime: runtime && { ...s.h.state, ...runtime } });
  };

  it("moves gently before Play and between answers, and holds still while the child speaks", () => {
    expect(stageMotion(null, COUNTING_LESSON)).toBe("idle");
    expect(stageMotion(live({}), COUNTING_LESSON)).toBe("idle");
    expect(stageMotion(live({ childSpeaking: true }), COUNTING_LESSON)).toBe("calm");
  });

  it("celebrates only the runtime's authored completion", () => {
    expect(stageMotion(live({ phase: "complete", lessonComplete: true }), COUNTING_LESSON)).toBe("celebrate");
    expect(stageMotion(live({ phase: "stopped" }), COUNTING_LESSON)).not.toBe("celebrate");
  });

  it("exposes motion on the stage for tests", () => {
    const markup = renderToStaticMarkup(createElement(CountingStage, { node: null, motion: "celebrate" }));
    expect(markup).toContain('data-motion="celebrate"');
    expect(markup.match(/data-celebration-character=/g)).toHaveLength(3);
    expect(markup).not.toContain("data-counting-object=");
  });
});

describe("voice activity cue", () => {
  type Snapshot = NonNullable<Parameters<typeof lessonPresentation>[0]>;
  const active: Snapshot = {
    status: "live",
    error: null,
    awaitingSteering: false,
    runtime: { phase: "active", childSpeaking: false, outputActivity: "quiet" },
  };
  const cue = (snapshot: Snapshot | null) => voiceActivity(lessonPresentation(snapshot));

  it("maps observed session, VAD and output state", () => {
    expect(cue(active)).toBe("your-turn");
    expect(cue({ ...active, runtime: { ...active.runtime!, childSpeaking: true } })).toBe("listening");
    expect(cue({ ...active, runtime: { ...active.runtime!, outputActivity: "active" } })).toBe("speaking");
    expect(cue({ ...active, awaitingSteering: true })).toBe("waiting");
    expect(cue({ ...active, runtime: { ...active.runtime!, phase: "rendering" } })).toBe("waiting");
  });

  it("shows no listening cue before the session is live or after it ends", () => {
    expect(cue(null)).toBe("off");
    expect(cue({ ...active, status: "prepared" })).toBe("off");
    expect(cue({ ...active, status: "connecting" })).toBe("off");
    expect(cue({ ...active, status: "ended", runtime: { ...active.runtime!, phase: "stopped" } })).toBe("off");
    expect(cue({ ...active, runtime: { ...active.runtime!, phase: "complete" } })).toBe("off");
    expect(cue({ ...active, error: "Provider failure" })).toBe("off");
  });

  it("draws an ear only once the child can be heard, and sound waves only while Sprout speaks", () => {
    const render = (activity: Parameters<typeof VoiceCue>[0]["activity"]) =>
      renderToStaticMarkup(createElement(VoiceCue, { activity }));
    expect(render("off")).toContain('aria-hidden="true"');
    for (const activity of ["off", "waiting", "speaking"] as const)
      expect(render(activity)).not.toMatch(/class="[^"]*ear/);
    expect(render("your-turn")).toMatch(/class="[^"]*ear/);
    expect(render("speaking")).toMatch(/class="[^"]*waves/);
  });
});
