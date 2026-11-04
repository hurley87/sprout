import { expect, it } from "vitest";
import fixtures from "./fixtures/math-scribe-utterances.json";
import {
  createResponsesScribeProvider,
  interpretSpeech,
  parseScribeInput,
  parseScribeWithDrops,
  SCRIBE_LIMITS,
} from "../lib/math-scribe/interpretation";
import { createSession, reduceSession } from "../lib/math-scribe/session";
import { listParts } from "../lib/math-scribe/parts";
import { readAlgebraLatex } from "../lib/math-audit/latex";

it("validates the new operation shapes and their parts", () => {
  const input = parseScribeInput({
    workingLatex: "x",
    baseLatex: "x",
    pendingStatus: "none",
    learnerTurns: [{ id: "l", text: "do it" }],
    tutorTurns: [],
  });
  const parse = (operation: object) =>
    parseScribeWithDrops(
      { interpretations: [{ intent: "propose", source: "instruction", quote: "do it", operation }] },
      input,
    );
  for (const kind of ["combine-fractions", "flatten-nested-fraction"])
    expect(parse({ kind, partId: "p0" }).interpretations).toHaveLength(1);
  for (const kind of ["scale-fraction", "multiply-part"]) {
    expect(parse({ kind, partId: "p0", factor: 2 }).interpretations).toHaveLength(1);
    expect(parse({ kind, partId: "p0", factor: { op: "bogus" } }).interpretations).toHaveLength(0);
    expect(parse({ kind, partId: "p999", factor: 2 }).interpretations).toHaveLength(0);
    expect(parse({ kind, partId: "p0" }).interpretations).toHaveLength(0);
  }
});

for (const fixture of fixtures)
  it(`accepts fixture: ${fixture.name}`, async () => {
    const input = parseScribeInput({
      workingLatex: fixture.workingLatex,
      baseLatex: fixture.baseLatex,
      pendingStatus: fixture.pendingStatus,
      learnerTurns: fixture.learnerTurns,
      tutorTurns: fixture.tutorTurns,
      ...("openQuestion" in fixture ? { openQuestion: fixture.openQuestion } : {}),
    });
    const result = await interpretSpeech(input, { generate: async () => ({ interpretations: fixture.expected }) });
    expect(result).toMatchObject({ status: "ok", interpretations: fixture.expected, diagnostics: { dropped: [] } });
    if (result.status !== "ok") throw new Error(result.status);
    const line = readAlgebraLatex(input.workingLatex);
    if (!line.ok) throw new Error(line.reason);
    const session = createSession({ problemId: "test", latex: input.baseLatex });
    if (!session.ok) throw new Error(session.reason);
    let state = session.state;
    if (input.pendingStatus !== "none") {
      state = reduceSession(state, {
        type: "interpretation",
        requestId: "setup",
        basedOnRevision: state.revision,
        interpretation: {
          intent: "propose",
          source: "report",
          quote: "setup",
          operation: { kind: "replace-line", expression: line.expression },
        },
        at: 0,
      }).state;
      expect(state.pending).not.toBeNull();
    }
    for (const [index, interpretation] of result.interpretations.entries()) {
      if ("operation" in interpretation && "partId" in interpretation.operation)
        expect(listParts(line.expression).map(part => part.id)).toContain(interpretation.operation.partId);
      const reduced = reduceSession(state, {
        type: "interpretation",
        requestId: `r${index}`,
        basedOnRevision: state.revision,
        interpretation,
        at: 0,
      });
      expect(reduced.notice.kind).not.toBe("stale");
      if (interpretation.intent === "propose" && interpretation.operation.kind !== "non-unique")
        expect(reduced.state.pending).not.toBeNull();
      if (interpretation.intent === "correct") expect(reduced.notice.kind).toBe("proposed");
      state = reduced.state;
    }
  });

it("drops invalid or non-learner evidence and rejects malformed envelopes", () => {
  const input = parseScribeInput({
    workingLatex: "x",
    baseLatex: "x",
    pendingStatus: "none",
    learnerTurns: [{ id: "l", text: "replace it" }],
    tutorTurns: [{ id: "t", text: "use y" }],
  });
  const output = {
    interpretations: [
      { intent: "confirm", quote: "use y" },
      {
        intent: "propose",
        source: "instruction",
        quote: "replace it",
        operation: { kind: "replace-part", partId: "p99", expression: { op: "number", value: 1 } },
      },
      {
        intent: "correct",
        quote: "replace it",
        operation: { kind: "replace-line", expression: { op: "variable", name: "z" } },
      },
    ],
  };
  expect(parseScribeWithDrops(output, input).dropped.map(item => item.reason)).toEqual([
    "unquoted",
    "unknown-part",
    "invalid-expression",
  ]);
  expect(() => parseScribeWithDrops({ interpretations: [], extra: true }, input)).toThrow();
  expect(() => parseScribeInput({ ...input, learnerTurns: [] })).toThrow();
  expect(() => parseScribeInput({ ...input, workingLatex: "?" })).toThrow();
  expect(() => parseScribeInput({ ...input, tutorTurns: input.learnerTurns })).toThrow();
  expect(() => parseScribeInput({ ...input, extra: true })).toThrow();
  const openQuestion = { question: "Inside?", prompt: "six times", operation: "factor" };
  const withQuestion = parseScribeInput({ ...input, openQuestion });
  expect(withQuestion.openQuestion).toEqual(openQuestion);
  expect(
    parseScribeWithDrops({ interpretations: [{ intent: "confirm", quote: "six times" }] }, withQuestion).dropped[0]
      .reason,
  ).toBe("unquoted");
  expect(() =>
    parseScribeInput({ ...input, openQuestion: { ...openQuestion, question: "a".repeat(SCRIBE_LIMITS.question + 1) } }),
  ).toThrow();
  expect(() => parseScribeInput({ ...input, openQuestion: { ...openQuestion, extra: true } })).toThrow();
});

it("uses server-derived parts, the shared model, and bounded provider responses", async () => {
  const input = parseScribeInput({
    workingLatex: "x+1",
    baseLatex: "x+1",
    pendingStatus: "none",
    learnerTurns: [{ id: "l", text: "yes" }],
    tutorTurns: [],
  });
  let sent: Record<string, unknown> = {};
  const provider = createResponsesScribeProvider("key", async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: '{"interpretations":[]}' }] }],
    });
  });
  expect(await interpretSpeech(input, provider)).toMatchObject({ status: "ok", interpretations: [] });
  expect(JSON.parse(sent.input as string).parts[0]).toMatchObject({ id: "p0", description: "whole line" });
  expect(sent.reasoning).toEqual({ effort: "low" });
  expect(await interpretSpeech(input, { generate: async () => ({ bad: true }) })).toMatchObject({
    status: "malformed",
  });
  expect(await interpretSpeech(input, { generate: () => new Promise(() => {}) }, { timeoutMs: 1 })).toEqual({
    status: "timeout",
  });
  expect(SCRIBE_LIMITS.bytes).toBeGreaterThan(0);
});
