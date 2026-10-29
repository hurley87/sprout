import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkChecklist } from "../components/calculus/work-checklist";
import { emptyWork, type CalculusWork, type WorkStatus } from "../lib/calculus/work-check";
import type { CalculusSnapshot } from "../lib/lesson-runtime/calculus-runtime";

const render = (work: CalculusWork | null, flags: Partial<CalculusSnapshot> = {}) =>
  renderToStaticMarkup(
    createElement(WorkChecklist, { math: { work, checking: false, complete: false, visits: [], ...flags } }),
  );
const row = (html: string, id: string) => html.match(new RegExp(`<li[^>]*data-step="${id}"[^>]*>[\\s\\S]*?</li>`))![0];

it("preserves the work region, step hooks, hidden heading and optional label maths", () => {
  const work = emptyWork("cubic-minus-linear");
  const html = render(work);
  expect(html).toContain('<section aria-label="Your work"');
  expect(html).toMatch(/<h2 class="[^"]*srOnly[^"]*">Your work<\/h2>/);
  expect(html.match(/data-step=/g)).toHaveLength(3);
  expect(row(html, "d-cubic")).toContain('data-status="missing"');
  expect(row(html, "d-cubic")).toContain("katex");
  expect(row(html, "d-cubic")).toContain("x to the power 3");
  expect(row(html, "d-cubic")).toContain("not shown yet");
  expect(row(html, "final")).toContain("—");
  expect(html).not.toContain("Talk through each step");
  expect(html).not.toContain("Checking what you said");
  expect(html).not.toContain("data-rule");
  expect(render(null)).toContain("No problem in progress.");
  expect(render(emptyWork("composite-fifth"))).toContain("Derivative of the outer power");
});

it.each([
  ["correct", "correct", "✓"],
  ["incorrect", "needs another look", "Have another look"],
  ["unsupported", "not understood", "Didn’t catch that. Say it again"],
] as const)("renders %s feedback and retains the heard expression", (status, description, note) => {
  const work = emptyWork("quadratic-sine");
  const html = render({
    ...work,
    steps: [{ ...work.steps[0], status, expression: { op: "number", value: 42 } }, work.steps[1]],
  });
  const first = row(html, "d-square");
  expect(first).toContain(`data-status="${status}"`);
  expect(first).toContain(description);
  expect(first).toContain(note);
  expect(first).toContain("42");
  expect(
    row(render({ ...work, steps: [{ ...work.steps[0], status: "unsupported" }, work.steps[1]] }), "d-square"),
  ).toContain("—");
});

it("checks only the first missing or unsupported row, without changing recorded status", () => {
  const work = emptyWork("quadratic-sine");
  for (const status of ["missing", "unsupported"] as WorkStatus[]) {
    const html = render(
      {
        ...work,
        steps: [
          { ...work.steps[0], status: "correct" },
          { ...work.steps[1], status },
        ],
      },
      { checking: true },
    );
    expect(row(html, "d-sine")).toContain(": checking");
    expect(row(html, "d-sine")).toContain(`data-status="${status}"`);
    expect(row(html, "d-sine")).toContain("checkDots");
    expect(html.match(/: checking/g)).toHaveLength(1);
  }
  const settled = {
    ...work,
    steps: work.steps.map(item => ({ ...item, status: "correct" as const })),
    final: { ...work.final, status: "incorrect" as const },
  };
  expect(row(render(settled, { checking: true }), "final")).toContain(": checking");
  expect(render(work)).not.toContain("checkDots");
});

it("announces completion exactly and shows one advance bar instead of checking dots", () => {
  const html = render(emptyWork("quadratic-sine"), { complete: true, checking: true });
  expect(html).toContain('role="status"');
  expect(html).toContain("<span>Every step checks out.</span>");
  expect(html.match(/advanceBar/g)).toHaveLength(1);
  expect(html).not.toContain("checkDots");
  expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf("<ol"));
});

it.each([true, false])("shows only a learner-named rule, with fitting=%s feedback", fits => {
  const html = render({ ...emptyWork("quadratic-sine"), rule: { method: "product", quote: "product rule", fits } });
  expect(html).toContain('data-rule="product"');
  expect(html).toContain("Rule: Product rule");
  expect(html).toContain(fits ? "Rule fits" : "Rule does not fit");
  expect(html.includes("Look again at how the function is built.")).toBe(!fits);
});
