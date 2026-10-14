import assert from "node:assert/strict";
import type { LessonObservation } from "../../../lib/lesson-runtime/lesson-runtime";
import { COUNTING_LESSON_GRAPH, type CountingNodeId } from "../../../lib/lesson-runtime/counting-lesson";
import { runtimeSource } from "../../helpers/counting-runtime";
import type { ChildScenario, Checkpoint } from "../../helpers/child-scenario";
import { matchesLessonEvent, type LessonObserver } from "../../helpers/lesson-observer";
import { classifierEvidence, currentChildText, detail } from "./evidence";
import { LIVE_CORRECT_ANSWERS } from "./answers";
import { observeUntil } from "./flow";
import { settledTutorResponse } from "./signals";

type SetupNode = Extract<CountingNodeId, "count-1-duck" | "count-2-ducks">;

/** Setup only: a semantic score abstention can elicit one fresh learner clarification.
 * It cannot be treated as authority, cause a render, or change baseline assertions. */
export function prerequisiteDecision(value: LessonObservation, from: Checkpoint, nextNode: CountingNodeId) {
  assert.equal(value.cursor.runtimeId, from.after.runtimeId, "setup attempt restarted");
  const events = value.events.slice(from.after.offset);
  const rendered = events.find(
    e =>
      e.type === "render.confirmed" &&
      e.runtimeId === from.scope.runtimeId &&
      e.nodeId === nextNode &&
      e.visitId === from.scope.visitId! + 1,
  );
  if (rendered) return { kind: "advanced" as const, event: rendered };
  const state = value.snapshot.runtime;
  if (
    !state ||
    state.phase !== "active" ||
    state.visitId !== from.scope.visitId ||
    state.nodeId !== from.scope.nodeId ||
    value.snapshot.awaitingSteering ||
    !settledTutorResponse(value, from.after.offset)
  )
    return null;
  const work = events.findLast(
    e =>
      e.type.startsWith("classifier.") &&
      [
        "classifier.started",
        "classifier.cancelled",
        "classifier.result",
        "classifier.held",
        "classifier.abstained",
        "classifier.error",
      ].includes(e.type),
  );
  if (!work) return null;
  if (
    !matchesLessonEvent(work, {
      ...runtimeSource(state),
      nodeId: state.nodeId,
      transcriptRevision: state.transcriptRevision,
    })
  )
    return null;
  if (work.type === "classifier.error")
    throw new Error(`Prerequisite classifier failed: ${JSON.stringify(work.detail)}`);
  if (work.type === "classifier.held")
    throw new Error(`Prerequisite held; no automatic setup clarification: ${JSON.stringify(work.detail)}`);
  if (work.type !== "classifier.abstained") return null;
  assert(work.childTurnId! > from.scope.childTurnId!, "prerequisite abstention borrowed earlier turn");
  const { request, diagnostic } = classifierEvidence(value.events, work);
  assert.equal(work.transcriptSpeaker, "tutor");
  assert.equal(detail<{ proposal: unknown }>(work).proposal, null);
  assert.equal(diagnostic.decision, "abstained");
  assert.equal(diagnostic.outcome, "unresolved");
  assert(
    [
      "objectiveState_no_winner",
      "tutorState_no_winner",
      "objectiveState_competing_options",
      "tutorState_competing_options",
    ].includes(diagnostic.reason ?? ""),
    "non-semantic prerequisite abstention cannot trigger clarification",
  );
  assert.equal(
    diagnostic.outputs?.objectiveState.choice,
    "completed",
    "prerequisite answer was not classified completed",
  );
  assert.equal(
    diagnostic.outputs?.tutorState.choice,
    "confirmed_completion",
    "prerequisite lacks tutor confirmation classification",
  );
  const quantity = COUNTING_LESSON_GRAPH[state.nodeId as CountingNodeId].quantity;
  const word = ["one", "two", "three"][quantity - 1];
  assert(
    new RegExp(`\\b(?:${word}|${quantity})\\b`, "i").test(currentChildText(value.events, request)),
    "prerequisite correct total not heard in current child turn",
  );
  return { kind: "clarify" as const, event: work, diagnostic };
}

export async function completeButterflyPrerequisite(
  child: ChildScenario,
  observer: LessonObserver,
  node: SetupNode,
  budget: () => number,
) {
  const next = COUNTING_LESSON_GRAPH[node].onSuccess;
  assert.equal(next.kind, "node");
  if (next.kind !== "node") throw new Error("Prerequisite has no next node");
  for (let attempt = 0; attempt < 2; attempt++) {
    const from = await child.checkpoint();
    assert.equal(await child.sayFixture(LIVE_CORRECT_ANSWERS[node]), "ended");
    const value = await observeUntil(
      child,
      observer,
      `prerequisite ${node}: render or canonical semantic abstention`,
      value => prerequisiteDecision(value, from, next.nodeId) !== null,
      budget(),
    );
    const decision = prerequisiteDecision(value, from, next.nodeId)!;
    if (decision.kind === "advanced") return from;
    if (attempt === 1)
      throw new Error(
        `Prerequisite ${node} still abstained after one learner clarification; butterfly not reached. ${JSON.stringify(decision.diagnostic)}`,
      );
    await child.assert(`prerequisite clarification on ${node}: ${JSON.stringify(decision.diagnostic)}`, async () => {
      assert.equal(prerequisiteDecision((await observer.read())!, from, next.nodeId)?.kind, "clarify");
    });
    // Loop captures a NEW turn/revision checkpoint and sends committed audio through the microphone.
  }
  throw new Error("Prerequisite clarification budget exhausted");
}
