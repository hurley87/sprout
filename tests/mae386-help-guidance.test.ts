import { expect, it } from "vitest";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { MAE386_RUBRICS } from "../lib/lesson-runtime/mae386/rubrics";
import { MAE386_HELP_RESPONSE } from "../lib/lesson-runtime/mae386/live-instructions";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import {
  createLiveSessionConfig,
  learnerSupportInstruction,
  teachingInstruction,
} from "../lib/lesson-runtime/live-context";
import { createReducerHarness } from "./helpers/runtime-harness";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";

// These verify delivered instructions and attribution guards, not provider speech.
it("spoken help is explicitly permitted in the durable session before a first answer", () => {
  const config = createLiveSessionConfig(lesson);
  expect(config.instructions).toContain(MAE386_HELP_RESPONSE);
  expect(config.instructions).toContain("a requested conceptual hint is allowed before an attempt");
  expect(config.instructions).not.toContain("Invite the learner's own explanation without supplying missing answers");
});

it("Q8 permits requested help before an attempt while keeping unsolicited probes non-leading", () => {
  const q8 = MAE386_RUBRICS.find(question => question.id === "q8")!.units[0];
  expect(q8.tutor.avoid).toContain("unsolicited initial probe");
  expect(q8.tutor.avoid).toContain("explicit help request permits");
  const message = teachingInstruction(currentNodeContext(lesson, "q8"), lesson);
  expect(message).toContain(q8.tutor.avoid);
});

it.each(MAE386_RUBRICS.flatMap(question => question.units))(
  "$id supplies its own help guidance for both spoken requests and the Help control",
  unit => {
    const context = currentNodeContext(lesson, unit.id);
    const teaching = teachingInstruction(context, lesson);
    const help = learnerSupportInstruction(context, "help", lesson);
    for (const content of [teaching, help]) {
      expect(content).toContain(unit.tutor.help);
      expect(content).toContain(MAE386_HELP_RESPONSE);
      expect(content).not.toContain(unit.referenceAnswer);
      for (const sibling of MAE386_RUBRICS.flatMap(question => question.units).filter(other => other.id !== unit.id))
        expect(content).not.toContain(sibling.referenceAnswer);
    }
    expect(help).toContain("Stay on this subpart");
    expect(help).toContain("not an answer or evidence");
  },
);

it.each(["q8", "q5-f"])("%s Repeat remains source access rather than a hint", nodeId => {
  const context = currentNodeContext(lesson, nodeId);
  const repeat = learnerSupportInstruction(context, "repeat", lesson);
  expect(repeat).toBe(learnerSupportInstruction(context, "repeat"));
  expect(repeat).not.toContain(MAE386_HELP_RESPONSE);
  expect(repeat).toContain("without an answer or hint");
});

it("other lessons retain their existing help instruction", () => {
  const context = currentNodeContext(CATCHING_UNICORNS_LESSON, CATCHING_UNICORNS_LESSON.initialNodeId);
  expect(learnerSupportInstruction(context, "help", CATCHING_UNICORNS_LESSON)).toBe(
    learnerSupportInstruction(context, "help"),
  );
});

it("Q8 tutor explanation alone earns no credit; a later modeled learner application retains assisted provenance", () => {
  const h = createReducerHarness("help-attribution", { lesson: { ...lesson, initialNodeId: "q8" } });
  let transcript = "";
  function utterance(speaker: "child" | "tutor", text: string) {
    if (speaker === "child") h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
    transcript += `${transcript ? "\n" : ""}${speaker === "child" ? "Child" : "Tutor"}: ${text}`;
    h.send({
      type: "transcript.updated",
      source: runtimeSource(h.state),
      speaker,
      revision: h.state.transcriptRevision + 1,
      transcriptSnapshot: transcript,
      ...(speaker === "child" ? { learnerTurnText: text } : {}),
    });
    if (speaker === "child") h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  }
  utterance("child", "Can you explain how phonetic writing works?");
  utterance(
    "tutor",
    "Its marks stand for speech sounds. Combining those sounds can let you recognize a word you know when spoken. How could you use that?",
  );
  expect(h.state.conceptEvidence).toEqual({});
  expect(h.state.nodeId).toBe("q8");
  utterance(
    "child",
    "I could join the sounds in an unfamiliar written name and recognize the name I have heard. The marks encode sounds rather than pictures of meanings.",
  );
  const source = classificationSource(h.state)!;
  // Explicit mocked semantic judgment; no claim of measured Jev accuracy.
  h.send({
    type: "proposal.received",
    source,
    transcriptSnapshot: transcript,
    proposal: {
      nodeId: "q8",
      transcriptRevision: h.state.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "asking",
      conceptObservations: lesson.nodes.q8.concepts!.map(criterion => ({
        criterionId: criterion.id,
        observation: "demonstrated_prompted",
        childMessageIndex: 2,
      })),
    },
  });
  h.send({ type: "stop", runtimeId: h.state.runtimeId });
  const q8 = h.state.questionOutcomes!.questions.find(question => question.questionId === "q8")!;
  expect(q8.outcome).toBe("assisted");
  for (const criterion of q8.components[0].criteria) {
    expect(criterion.evidence?.understanding).toBe("prompted");
    expect(criterion.evidence?.source).toMatchObject({ childMessageIndex: 2, childTurnId: source.childTurnId });
    expect(criterion.evidence?.source?.childTranscript).toContain("unfamiliar written name");
  }
});
