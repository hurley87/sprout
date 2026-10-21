import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import Mae386Demo from "../components/mae386-demo";
import { Mae386Presentation } from "../components/mae386/presentation";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { authoredQuestionProgress } from "../lib/lesson-runtime/lesson-definition";
import { MAE386_RUBRICS } from "../lib/lesson-runtime/mae386/rubrics";
import { createLessonRuntime, reduceLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { questionRecap, OUTCOME_LABELS } from "../lib/lesson-runtime/mae386/question-outcomes";

it("starts with eight progress segments, bounded controls and opt-in diagnostics", () => {
  const normal = renderToStaticMarkup(createElement(Mae386Demo));
  expect(normal.match(/data-state=/g)).toHaveLength(8);
  expect(normal).toContain('aria-valuetext="Question 1 of 8"');
  for (const control of ["Start practice", "Help", "Repeat question", "Skip question", "Stop"])
    expect(normal).toContain(control);
  expect(normal).not.toContain("Session details");
  expect(renderToStaticMarkup(createElement(Mae386Demo, { debug: true }))).toContain("Session details");
});

it.each(MAE386_RUBRICS.flatMap(question => question.units.map(unit => ({ question, unit }))))(
  "shows only the current source and prompt for $unit.id without private answers",
  ({ question, unit }) => {
    const html = renderToStaticMarkup(createElement(Mae386Presentation, { nodeId: unit.id }));
    const text = html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    expect(text).toContain(lesson.nodes[unit.id].presentation.prompt);
    if (unit.visibleSource) expect(text).toContain(unit.visibleSource);
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(authoredQuestionProgress(lesson, unit.id)?.questionNumber).toBe(MAE386_RUBRICS.indexOf(question) + 1);
    for (const sibling of question.units.filter(sibling => sibling.id !== unit.id)) {
      if (sibling.visibleSource) expect(text).not.toContain(sibling.visibleSource);
    }
    for (const criterion of unit.criteria) expect(text).not.toContain(criterion.description);
    expect(text).not.toMatch(/reference answer|example response|marks|pass\/fail/i);
  },
);

it("renders the runtime's immutable eight-question recap with mixed subpart detail and no private rubric", () => {
  const initial = createLessonRuntime("presentation", { lesson });
  const stopped = reduceLessonRuntime(initial, { type: "stop", runtimeId: initial.runtimeId, atMs: 10 }, lesson).state;
  const frozen = stopped.questionOutcomes!;
  const recap = questionRecap(frozen, true);
  const before = renderToStaticMarkup(createElement(Mae386Presentation, { nodeId: "q1", recap }));
  expect(before).toContain("Session ended early");
  expect(before.match(/<h3/g)).toHaveLength(8);
  expect(before.match(/Part [123]:/g)).toHaveLength(6);
  expect(before).not.toContain("evidence-and-limits");
  // The provided frozen snapshot remains the sole input even when the current
  // node changes to recap; there is no live assessment/evidence input to merge.
  expect(renderToStaticMarkup(createElement(Mae386Presentation, { nodeId: "recap", recap }))).toBe(before);
  expect(recap.questions).toBe(frozen.questions);
  expect(Object.isFrozen(recap.questions)).toBe(true);
  const outcomes = Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[];
  const mixed = questionRecap({
    ...frozen,
    questions: frozen.questions.map((q, i) => ({
      ...q,
      outcome: outcomes[i % outcomes.length],
      components: q.components.map((c, j) => ({ ...c, outcome: outcomes[(i + j) % outcomes.length] })),
    })),
  });
  const html = renderToStaticMarkup(createElement(Mae386Presentation, { nodeId: "recap", recap: mixed }));
  for (const label of Object.values(OUTCOME_LABELS)) expect(html).toContain(label);
});
