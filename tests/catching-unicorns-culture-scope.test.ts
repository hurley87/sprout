import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ScenePresentation } from "../components/catching-unicorns-demo";
import {
  CATCHING_UNICORNS_LESSON as lesson,
  CATCHING_UNICORNS_PRESENTATION as presentation,
} from "../lib/lesson-runtime/catching-unicorns-lesson";
import { currentNodeContext, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import {
  conversationStateQuestions,
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { assessmentQuestions } from "../lib/lesson-runtime/conversation-assessment";
import {
  classificationSource,
  createLessonRuntime,
  meetsAuthoredCompletionPolicy,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { answerRecoveryInstruction, teachingInstruction } from "../lib/lesson-runtime/live-context";

const nodeId = "techno-literate-culture";
const node = lesson.nodes[nodeId];
const ids = node.concepts!.map(concept => concept.id);
// Controlled classifier scores test policy/provenance, not live semantic accuracy.
function outputs(accepted: string[]): ConversationStateOutputs {
  return {
    objectiveState: {
      choice: "unclear_or_incomplete",
      confidence: 0.5,
      probabilities: { completed: 0.5, unclear_or_incomplete: 0.5, incorrect: 0, unresolved_help: 0, no_attempt: 0 },
    },
    tutorState: {
      choice: "confirmed_completion",
      confidence: 1,
      probabilities: { confirmed_completion: 1, clarifying: 0, helping: 0, asking: 0, other: 0 },
    },
    concepts: Object.fromEntries(
      ids.map(id => [
        `concept_${id}`,
        {
          choice: accepted.includes(id) ? "demonstrated_independent" : "not_yet",
          confidence: 1,
          probabilities: {
            demonstrated_independent: accepted.includes(id) ? 1 : 0,
            demonstrated_prompted: 0,
            partial: 0,
            not_yet: accepted.includes(id) ? 0 : 1,
          },
        },
      ]),
    ),
  };
}
function harness() {
  const definition = { ...lesson, initialNodeId: nodeId, conversationFirst: false };
  let state = createLessonRuntime("culture-scope", { lesson: definition, quietDrainMs: 50 });
  let transcript = "";
  const send = (event: Record<string, unknown>) => {
    state = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as LessonRuntimeEvent, definition).state;
  };
  const answer = (text: string, accepted: string[], prompted = false) => {
    transcript += `${transcript ? "\nTutor: Can you give a second example?\n" : ""}Child: ${text}`;
    send({ type: "child.turn.started", source: runtimeSource(state) });
    send({
      type: "transcript.updated",
      source: runtimeSource(state),
      speaker: "child",
      revision: state.transcriptRevision + 1,
    });
    send({ type: "child.turn.ended", source: runtimeSource(state) });
    const source = classificationSource(state)!;
    send({
      type: "proposal.received",
      source,
      transcriptSnapshot: transcript,
      proposal: {
        nodeId,
        transcriptRevision: source.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "unclear",
        supportState: "none",
        tutorState: "unknown",
        conceptObservations: accepted.map(criterionId => ({
          criterionId,
          observation: prompted ? "demonstrated_prompted" : "demonstrated_independent",
          childMessageIndex: transcript.split("\n").length - 1,
        })),
      },
    });
  };
  return {
    get state() {
      return state;
    },
    definition,
    answer,
  };
}

it("aligns the displayed/spoken task, objective, private targets and assessment scope", () => {
  const context = currentNodeContext(lesson, nodeId);
  expect(context.scene).toHaveProperty("prompt", "Give two examples of what makes a culture techno-literate.");
  const instruction = teachingInstruction(context, lesson);
  expect(instruction).toContain(String(node.presentation.prompt));
  expect(instruction).toContain("two distinct relevant characteristics");
  expect(instruction).toContain("any 2 distinct demonstrated criteria");
  expect(instruction).toContain("at most one short, neutral clarification");
  expect(instruction).toContain("do not disclose missing answers");
  expect(instruction).toContain("no optional discussion or further probes");
  expect(instruction).not.toMatch(/Assess four separately|offer one targeted cue|Explain all four if requested/);
  for (const id of ids) {
    expect(conversationStateQuestions(lesson, nodeId)[`concept_${id}`].instructions).toContain(
      node.conceptAssessmentGuidance,
    );
    expect(assessmentQuestions(lesson)[`${nodeId}:${id}:understanding`].instructions).toContain(
      node.conceptAssessmentGuidance,
    );
    expect(
      conversationStateQuestions(lesson, nodeId, "Child: Most people can read and write.")[`source_${id}`].instructions,
    ).toContain(node.conceptAssessmentGuidance);
    expect(
      assessmentQuestions(lesson, {
        runtimeId: "culture",
        generation: 1,
        visits: [{ nodeId, visitId: 1, transcript: "Child: Most people can read and write." }],
      })[`${nodeId}:${id}:evidence_0`].instructions,
    ).toContain(node.conceptAssessmentGuidance);
    expect(presentation[nodeId].reveals[id as keyof (typeof presentation)[typeof nodeId]["reveals"]].source).toContain(
      "Introduction",
    );
  }
});

it.each(ids.flatMap((id, index) => ids.slice(index + 1).map(other => [id, other])))(
  "accepts %s plus %s without the other two",
  (first, second) => {
    const h = harness();
    h.answer("Two relevant characteristics in my own words.", [first, second]);
    expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(true);
    const recovery = answerRecoveryInstruction(h.definition, h.state);
    expect(recovery).toContain(`Accepted private targets: ${[first, second].join(", ")}`);
    expect(recovery).not.toContain("Other outstanding targets");
    const decision = mapConversationObservation(
      {
        lesson: h.definition,
        nodeId,
        transcriptRevision: 1,
        transcript: "Child: Two characteristics.\nTutor: Thank you for those examples.",
      },
      outputs([first, second]),
    );
    expect(decision.outcome).toBe("allow_semantic_completion_evidence");
    expect(Object.keys(h.state.conceptEvidence)).toHaveLength(2);
  },
);

it("counts one characteristic once and accumulates distinct paraphrases with accurate evidence and reveals", () => {
  const h = harness();
  h.answer("Most people can read and write.", [ids[0]]);
  expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(false);
  const firstEvidence = structuredClone(h.state.conceptEvidence[`${nodeId}:${ids[0]}`]);
  h.answer("People are literate; they can read.", [ids[0], ids[0]]);
  expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(false);
  expect(
    mapConversationObservation(
      {
        lesson: h.definition,
        nodeId,
        transcriptRevision: 1,
        transcript: "Child: Most people can read and write.\nTutor: Thank you.",
      },
      outputs([ids[0]]),
    ).outcome,
  ).toBe("hold_scene");
  h.answer("Some people specialize in finding new ideas.", [ids[1]]);
  expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(true);
  expect(h.state.conceptEvidence[`${nodeId}:${ids[0]}`].source).toEqual(firstEvidence.source);
  expect(h.state.conceptEvidence[`${nodeId}:${ids[1]}`]).toMatchObject({
    understanding: "independent",
    source: { childTranscript: "Some people specialize in finding new ideas." },
  });
  for (const id of ids.slice(2)) expect(h.state.conceptEvidence[`${nodeId}:${id}`]).toBeUndefined();
  const html = renderToStaticMarkup(createElement(ScenePresentation, { state: h.state }));
  expect(html).toContain("Give two examples");
  expect(html).toContain(presentation[nodeId].reveals["idea-discoverers"].text);
  expect(html).not.toContain(presentation[nodeId].reveals["education-system"].text);
  expect(html).not.toContain(presentation[nodeId].reveals["social-coordination"].text);
  const caf = renderToStaticMarkup(
    createElement(ScenePresentation, { state: { ...h.state, nodeId: "caf-application" } }),
  );
  expect(presentation["caf-application"].framework).toHaveLength(4);
  expect(caf).toContain("not a source-canonical answer");
  expect(caf).toContain("Framework item 3 is not yet available from accepted evidence");
  expect(caf).toContain("Framework item 4 is not yet available from accepted evidence");
});

it.each([0, 1.5, 5, NaN])("rejects invalid authored example count %s", count => {
  expect(() =>
    validateLessonDefinition({
      ...lesson,
      nodes: { ...lesson.nodes, [nodeId]: { ...node, completionPolicy: { kind: "at_least_demonstrated", count } } },
    }),
  ).toThrow("unknown concept completion policy");
});
