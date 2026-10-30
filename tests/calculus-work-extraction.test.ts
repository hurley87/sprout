import { expect, it, vi } from "vitest";
import {
  EXTRACTION_LIMITS,
  WORK_EXTRACTION_MODEL,
  WORK_EXTRACTION_SCHEMA,
  createResponsesWorkProvider,
  extractWork,
  parseWorkExtraction,
  parseWorkExtractionInput,
  parseWorkExtractionWithDrops,
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
const step = (stepId: string, quote: string, expression: unknown = threeXSquared) => ({ stepId, expression, quote });

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
        step("d-cubic", "What's the derivative of x cubed?"),
        step("unknown-step", "three x squared"),
        step("d-linear", "four x just becomes four", { op: "number", value: 4 }),
        step("d-linear", "four", { op: "script" }),
      ],
      rule: null,
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

it("reports each dropped item with the reason, alongside the raw model output", async () => {
  const tutorQuoted = step("d-cubic", "What's the derivative of x cubed?");
  const unknown = step("unknown-step", "three x squared");
  const badExpression = step("d-linear", "four", { op: "script" });
  const rule = { method: "magic", quote: "four" };
  const final = { expression: threeXSquared, quote: "three x squared plus four" };
  const output = {
    steps: [step("d-cubic", "three x squared"), tutorQuoted, unknown, badExpression],
    rule,
    final,
    unclear: null,
  };
  const { extraction, dropped } = parseWorkExtractionWithDrops(output, input);
  expect(extraction.steps).toHaveLength(1);
  expect(extraction.final).toBeNull();
  expect(dropped).toEqual([
    { item: "step", reason: "unquoted", value: tutorQuoted },
    { item: "step", reason: "unknown-step", value: unknown },
    { item: "step", reason: "invalid-expression", value: badExpression },
    { item: "rule", reason: "unknown-method", value: rule },
    { item: "final", reason: "unquoted", value: final },
  ]);
  expect(await extractWork(input, { generate: async () => output })).toEqual({
    status: "ok",
    extraction,
    diagnostics: { raw: output, dropped },
  });
});

it("keeps an answer the learner paused through, quoted across consecutive turns", () => {
  const paused: WorkExtractionInput = {
    problemId: "quadratic-sine",
    learnerTurns: [
      { id: "learner_1", text: ". And, the derivative of sine x is cos x" },
      { id: "learner_2", text: " [breath] And the final answer is" },
      { id: "learner_3", text: " x squared" },
      { id: "learner_4", text: " times cos x" },
      { id: "learner_5", text: " plus" },
      { id: "learner_6", text: " two x times sine x" },
    ],
    tutorTurns: [{ id: "tutor_1", text: "So it's x squared cos x plus two x sine x." }],
  };
  const final = (quote: string) =>
    parseWorkExtraction({ steps: [], rule: null, final: { expression: threeXSquared, quote }, unclear: null }, paused)
      .final?.quote ?? null;
  const spanning = "And the final answer is x squared times cos x plus two x times sine x";
  expect(final(spanning)).toBe(spanning);
  expect(final("cos x And the final answer")).toBe("cos x And the final answer");
  // Words out of order, or the tutor's phrasing, are still not learner speech.
  expect(final("x squared plus two x times sine x")).toBeNull();
  expect(final("x squared cos x plus two x sine x")).toBeNull();
});

it("matches quotes across pauses whatever punctuation or fillers the model adds or drops", () => {
  const outer: WorkExtractionInput = {
    problemId: "composite-fifth",
    learnerTurns: [
      { id: "learner_1", text: " [tongue click ]So, the derivative of the outer power" },
      { id: "learner_2", text: " is- Uh ,5" },
      { id: "learner_3", text: ". Uh, brackets. 3x squared plus 1 to the, fourth. [breath" },
    ],
    tutorTurns: [{ id: "tutor_1", text: "Five times three x squared plus one to the fourth." }],
  };
  const quoted = (quote: string) =>
    parseWorkExtraction({ steps: [step("d-outer", quote)], rule: null, final: null, unclear: null }, outer).steps
      .length === 1;
  // Quotes the model returned in recorded sessions, rejected before.
  expect(quoted("5 . Uh, brackets. 3x squared plus 1 to the, fourth")).toBe(true);
  expect(quoted("5. Uh, brackets. 3x squared plus 1 to the, fourth")).toBe(true);
  expect(quoted("5. brackets. 3x squared plus 1 to the, fourth")).toBe(true);
  expect(
    quoted("So, the derivative of the outer power is- Uh ,5 . Uh, brackets. 3x squared plus 1 to the, fourth"),
  ).toBe(true);
  // Still the learner's words, whole and in order.
  expect(quoted("Five times three x squared plus one to the fourth")).toBe(false);
  expect(quoted("brackets 5 3x squared plus 1 to the fourth")).toBe(false);
  expect(quoted("3x squared plus 1 to the fourth breath")).toBe(false);
  expect(quoted("ower is")).toBe(false);
  expect(quoted("... ,")).toBe(false);
});

it("keeps a rule named for the whole function only when quoted from the learner", () => {
  const sine: WorkExtractionInput = {
    problemId: "quadratic-sine",
    learnerTurns: [{ id: "learner_1", text: "I'd use the chain rule" }],
    tutorTurns: [{ id: "tutor_1", text: "Think about the product rule." }],
  };
  const parse = (rule: unknown) => parseWorkExtraction({ steps: [], rule, final: null, unclear: null }, sine).rule;
  expect(parse({ method: "chain", quote: "chain rule" })).toEqual({ method: "chain", quote: "chain rule" });
  expect(parse({ method: "product", quote: "the product rule" })).toBeNull();
  expect(parse({ method: "magic", quote: "chain rule" })).toBeNull();
  expect(parse(null)).toBeNull();
});

it("rejects structurally malformed output", () => {
  expect(() => parseWorkExtraction({ steps: [], final: null, unclear: null }, input)).toThrow();
  expect(() =>
    parseWorkExtraction({ steps: [], rule: null, final: null, unclear: null, correct: true }, input),
  ).toThrow();
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
                rule: null,
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
  expect(body.reasoning).toEqual({ effort: "low" });
  expect(body.text.format.schema).toEqual(WORK_EXTRACTION_SCHEMA);
  const model = JSON.parse(body.input);
  expect(model.steps).toEqual([
    { stepId: "d-cubic", label: "Derivative of x³" },
    { stepId: "d-linear", label: "Derivative of the 4x term" },
  ]);
  expect(body.input).not.toContain("accepted");
  expect(body.input).not.toContain("finalForms");
  expect(JSON.stringify(body)).not.toContain("key");
});

it("reports provider failure, malformed output, and cancellation", async () => {
  const failing = { generate: async () => Promise.reject(new Error("down")) };
  expect(await extractWork(input, failing)).toEqual({ status: "provider-failure" });
  expect(await extractWork(input, { generate: async () => ({ nope: true }) })).toEqual({
    status: "malformed",
    diagnostics: { raw: { nope: true }, dropped: [] },
  });
  const controller = new AbortController();
  controller.abort();
  expect(await extractWork(input, failing, { signal: controller.signal })).toEqual({ status: "cancelled" });
});

it("bounds provider extraction with the shorter server timeout", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    const result = extractWork(input, { generate: () => new Promise(() => {}) });
    expect(timeout).toHaveBeenCalledWith(EXTRACTION_LIMITS.timeoutMs);
    expect(EXTRACTION_LIMITS.timeoutMs).toBeLessThan(EXTRACTION_LIMITS.clientTimeoutMs);
    controller.abort();
    expect(await result).toEqual({ status: "timeout" });
  } finally {
    timeout.mockRestore();
  }
});
