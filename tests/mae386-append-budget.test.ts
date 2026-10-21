import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { createLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
import {
  freezeQuestionOutcomes,
  questionRecap,
  OUTCOME_LABELS,
  type QuestionOutcome,
} from "../lib/lesson-runtime/mae386/question-outcomes";
import {
  teachingInstruction,
  learnerSupportInstruction,
  answerRecoveryInstruction,
  missingAnswerCheckInstruction,
  supersedeAnswerCheckInstruction,
} from "../lib/lesson-runtime/live-context";

const messages: Record<string, string> = {};
for (const node of Object.values(lesson.nodes)) {
  const context = currentNodeContext(lesson, node.id);
  messages[`${node.id}:teaching`] = teachingInstruction(context, lesson, node.id === lesson.initialNodeId);
  if (!node.completeAfterTutorOutput)
    for (const request of ["help", "repeat"] as const)
      messages[`${node.id}:${request}`] = learnerSupportInstruction(context, request);
}
const initial = createLessonRuntime("budget", { lesson });
const frozen = freezeQuestionOutcomes(lesson, initial);
for (const outcome of Object.keys(OUTCOME_LABELS) as QuestionOutcome[]) {
  const recap = questionRecap({ ...frozen, questions: frozen.questions.map(question => ({ ...question, outcome })) });
  messages[`recap:${outcome}`] = teachingInstruction(currentNodeContext(lesson, "recap"), lesson, false, recap.spoken);
}
// Include a full UUID and maximum safe integer identities, not a short test ID.
const recoveryEventId = `ffffffff-ffff-4fff-bfff-ffffffffffff:answer-recovery:${Number.MAX_SAFE_INTEGER}:${Number.MAX_SAFE_INTEGER}:${Number.MAX_SAFE_INTEGER}`;
messages.recovery_missing = missingAnswerCheckInstruction(recoveryEventId);
messages.recovery_superseded = supersedeAnswerCheckInstruction(recoveryEventId);
messages.recovery_answer = answerRecoveryInstruction(lesson, { ...initial, hasChildTranscript: true });
messages.clarification = lesson.recovery.supportClarificationInstruction;

// Explicit calibration input for scripts/measure-live-append-budgets.py. Normal
// tests only read the checked-in independently tokenized, content-hashed fixture.
if (process.env.SPROUT_APPEND_BUDGET_INPUT)
  writeFileSync(process.env.SPROUT_APPEND_BUDGET_INPUT, JSON.stringify(messages, null, 2));
const measured = JSON.parse(
  readFileSync(new URL("./fixtures/mae386-append-token-budgets.json", import.meta.url), "utf8"),
) as {
  tokenizers: string[];
  messages: Record<string, { sha256: string; tokens: Record<string, number> }>;
};
it("covers every actual node/control and all recap labels without relaxing the browser budget", () => {
  expect(Object.keys(measured.messages).sort()).toEqual(Object.keys(messages).sort());
  expect(measured.tokenizers).toEqual(["o200k_base", "cl100k_base"]);
});
it.each(Object.entries(messages))(
  "%s retains a calibrated margin below the documented 500-token append limit",
  (id, content) => {
    const row = measured.messages[id];
    expect(row, "Regenerate token calibration after an intentional message edit").toBeDefined();
    expect(createHash("sha256").update(content).digest("hex")).toBe(row.sha256);
    for (const tokenizer of measured.tokenizers) expect(row.tokens[tokenizer]).toBeLessThanOrEqual(450);
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(2000);
    if (id.endsWith(":teaching") && !id.startsWith("recap:")) {
      expect(content).toContain("Private focus (never read aloud):");
      expect(content).not.toContain("undefined");
    }
  },
);
