import { expect, it, vi } from "vitest";
import {
  WORK_EXTRACTION_MODEL,
  WORK_EXTRACTION_SCHEMA,
  createResponsesWorkProvider,
  extractWork,
  parseWorkExtraction,
  parseWorkExtractionInput,
  type WorkExtractionInput,
} from "../lib/calculus/work-extraction";

const input: WorkExtractionInput = {
  problemId: "cubic-minus-linear",
  learnerTurns: [
    { id: "learner_1", text: "for x cubed I bring the three down so it's three x squared" },
    { id: "learner_2", text: "and four x just becomes four, so three x squared minus four" },
  ],
  tutorTurns: [{ id: "tutor_1", text: "What's the derivative of x cubed? It's three x squared." }],
};
const threeXSquared = {
  op: "multiply",
  args: [
    { op: "number", value: 3 },
    { op: "power", base: { op: "variable", name: "x" }, exponent: 2 },
  ],
};
const step = (stepId: string, quote: string, expression: unknown = threeXSquared, method: unknown = null) => ({
  stepId,
  expression,
  method,
  quote,
});

it("validates the request: known problem, bounded unique learner turns", () => {
  expect(parseWorkExtractionInput(structuredClone(input))).toEqual(input);
  expect(() => parseWorkExtractionInput({ ...input, problemId: "other" })).toThrow();
  expect(() => parseWorkExtractionInput({ ...input, learnerTurns: [] })).toThrow();
  expect(() => parseWorkExtractionInput({ ...input, extra: true })).toThrow();
  expect(() =>
    parseWorkExtractionInput({ ...input, learnerTurns: [input.learnerTurns[0], input.learnerTurns[0]] }),
  ).toThrow();
});

it("keeps only items quoted from learner speech for known steps", () => {
  const extraction = parseWorkExtraction(
    {
      steps: [
        step("d-cubic", "three x squared"),
        // Quoted from the tutor, not the learner: dropped.
        step("d-cubic", "It's three x squared."),
        step("unknown-step", "three x squared"),
        step("d-linear", "four x just becomes four", { op: "number", value: 4 }),
        step("d-linear", "four", { op: "script" }),
      ],
      final: null,
      unclear: null,
    },
    input,
  );
  expect(extraction.steps.map(item => [item.stepId, item.quote])).toEqual([
    ["d-cubic", "three x squared"],
    ["d-linear", "four x just becomes four"],
  ]);
});

it("needs a method for method steps and an expression for expression steps", () => {
  const sine: WorkExtractionInput = {
    problemId: "quadratic-sine",
    learnerTurns: [{ id: "learner_1", text: "use the product rule" }],
    tutorTurns: [],
  };
  const extraction = parseWorkExtraction(
    {
      steps: [step("method", "product rule", null, "product"), step("d-square", "product rule", null, "product")],
      final: null,
      unclear: null,
    },
    sine,
  );
  expect(extraction.steps).toEqual([{ stepId: "method", expression: null, method: "product", quote: "product rule" }]);
});

it("rejects structurally malformed output", () => {
  expect(() => parseWorkExtraction({ steps: [], final: null }, input)).toThrow();
  expect(() => parseWorkExtraction({ steps: [], final: null, unclear: null, correct: true }, input)).toThrow();
});

it("sends the authored steps but never accepted answers to the model", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                steps: [step("d-cubic", "three x squared")],
                final: { expression: threeXSquared, quote: "three x squared minus four" },
                unclear: null,
              }),
            },
          ],
        },
      ],
    }),
  );
  const result = await extractWork(input, createResponsesWorkProvider("key", transport));
  expect(result.status).toBe("ok");
  const body = JSON.parse(transport.mock.calls[0][1]!.body as string);
  expect(body.model).toBe(WORK_EXTRACTION_MODEL);
  expect(body.text.format.schema).toEqual(WORK_EXTRACTION_SCHEMA);
  const model = JSON.parse(body.input);
  expect(model.steps).toEqual([
    { stepId: "d-cubic", label: "Derivative of x³", kind: "expression" },
    { stepId: "d-linear", label: "Derivative of the 4x term", kind: "expression" },
  ]);
  expect(body.input).not.toContain("accepted");
  expect(body.input).not.toContain("finalForms");
  expect(JSON.stringify(body)).not.toContain("key");
});

it("reports provider failure, malformed output, and cancellation", async () => {
  const failing = { generate: async () => Promise.reject(new Error("down")) };
  expect(await extractWork(input, failing)).toEqual({ status: "provider-failure" });
  expect(await extractWork(input, { generate: async () => ({ nope: true }) })).toEqual({ status: "malformed" });
  const controller = new AbortController();
  controller.abort();
  expect(await extractWork(input, failing, { signal: controller.signal })).toEqual({ status: "cancelled" });
});
