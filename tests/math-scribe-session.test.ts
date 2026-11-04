import { describe, expect, it } from "vitest";
import { readAlgebraLatex } from "../lib/math-audit/latex";
import { listParts } from "../lib/math-scribe/parts";
import {
  createSession,
  reduceSession,
  sessionMetrics,
  snapshot,
  SESSION_LIMITS,
  type Interpretation,
  type SessionState,
} from "../lib/math-scribe/session";

const original = String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`;
function read(latex: string) {
  const result = readAlgebraLatex(latex);
  if (!result.ok) throw new Error(result.detail);
  return result.expression;
}
function start(latex = original): SessionState {
  const result = createSession({ problemId: "problem", latex });
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
function part(state: SessionState, description: string) {
  const expression = state.pending?.versions[state.pending.current].expression ?? state.base;
  const found = listParts(expression).find(item => item.description === description);
  if (!found) throw new Error(description);
  return found.id;
}
function say(
  state: SessionState,
  interpretation: Interpretation,
  at = state.revision + 1,
  basedOnRevision = state.revision,
) {
  return reduceSession(state, {
    type: "interpretation",
    requestId: `request-${at}`,
    basedOnRevision,
    interpretation,
    at,
  });
}
function ui(state: SessionState, action: "confirm" | "undo" | "check" | "continue", at = state.revision + 1) {
  return reduceSession(state, { type: "ui", action, at });
}
function propose(state: SessionState, latex: string) {
  return say(state, {
    intent: "propose",
    operation: { kind: "replace-line", expression: read(latex) },
    source: "report",
    quote: latex,
  }).state;
}

describe("scribe session", () => {
  it("retains clarification context and clears it on resolution", () => {
    const initial = start(String.raw`\frac{x}{y}\frac{12x+30y}{x}`);
    const partId = part(initial, "numerator of factor 2");
    const event = { type: "interpretation" as const, requestId: "same", basedOnRevision: 0, at: 1 };
    const first = reduceSession(initial, {
      ...event,
      interpretation: {
        intent: "propose",
        source: "instruction",
        quote: "factor six out",
        operation: { kind: "non-unique", name: "factor", partId },
      },
    }).state;
    const open = reduceSession(first, {
      ...event,
      basedOnRevision: first.revision,
      interpretation: { intent: "clarify", question: "Inside the brackets?", quote: "six times open bracket" },
    }).state;
    expect(initial.clarification).toBeNull();
    expect(open.clarification).toMatchObject({
      question: "Inside the brackets?",
      prompt: "six times open bracket",
      operation: "factor",
      part: { id: partId, description: "numerator of factor 2", latex: "12x+30y" },
    });
    const followup = say(open, { intent: "clarify", question: "Which expression?", quote: "it would be" }).state;
    expect(followup.clarification?.prompt).toBe("six times open bracket");
    const resolved = say(open, {
      intent: "propose",
      source: "report",
      quote: "2x plus 5y",
      operation: { kind: "replace-part", partId, expression: read("6(2x+5y)") },
    }).state;
    expect(resolved.clarification).toBeNull();
    expect(ui(open, "undo").state.clarification).toBeNull();
    expect(ui(open, "check").state.clarification).toBeNull();
    expect(
      say(open, {
        intent: "propose",
        source: "instruction",
        quote: "factor denominator",
        operation: { kind: "non-unique", name: "factor", partId: part(open, "denominator of factor 2") },
      }).state.clarification?.part?.description,
    ).toBe("denominator of factor 2");
  });
  it("keeps the incorrect reciprocal and audits the correction", () => {
    let state = start();
    state = say(
      state,
      {
        intent: "propose",
        operation: { kind: "division-to-reciprocal", partId: part(state, "divisor") },
        source: "instruction",
        quote: "flip",
      },
      10,
    ).state;
    state = say(
      state,
      {
        intent: "propose",
        operation: { kind: "replace-part", partId: part(state, "numerator of factor 2"), expression: read("12+30y") },
        source: "report",
        quote: "twelve plus thirty y",
      },
      20,
    ).state;
    expect(state.pending?.status).toBe("interpreted");
    expect(state.audit.entries).toHaveLength(1);
    const rejected = ui(state, "check", 30);
    expect(rejected.notice).toMatchObject({
      kind: "checked",
      verdict: "not-equivalent",
      discrepancy: { role: "reciprocal-numerator" },
    });
    expect(JSON.stringify(rejected.notice)).not.toContain("previousPart");
    expect(rejected.state.base).toEqual(read(original));
    state = say(
      rejected.state,
      {
        intent: "correct",
        operation: {
          kind: "replace-part",
          partId: part(rejected.state, "numerator of factor 2"),
          expression: read("12x+30y"),
        },
        quote: "twelve x",
      },
      40,
    ).state;
    expect(state.pending?.versions.at(-1)?.cause).toBe("edit");
    state = ui(state, "check", 50).state;
    expect(state.history.at(-1)?.status).toBe("verified");
    expect(state.history.at(-1)?.pending?.versions).toHaveLength(3);
    expect(state.audit.entries.map(entry => entry.kind)).toEqual(["start", "step", "correction"]);
    expect(sessionMetrics(state)).toMatchObject({
      proposals: 2,
      checks: { equivalent: 1, "not-equivalent": 1 },
      stepTimes: [20, 40],
    });
    expect(snapshot(state).paper).toBe("unseen");
  });
  it("moves a negative exponent with preserved domain", () => {
    let state = start(String.raw`(2+3x^2)^3(x^2+2x)^{-2}`);
    state = say(state, {
      intent: "propose",
      operation: { kind: "negative-power-to-denominator", partId: part(state, "factor 2") },
      source: "instruction",
      quote: "move the power",
    }).state;
    expect(ui(state, "check").notice).toMatchObject({
      kind: "checked",
      verdict: "equivalent",
      domainStatus: "preserved",
    });
  });
  it("records which restrictions a cancelling step dropped", () => {
    let state = start(String.raw`\frac{3y(6x-5y)}{2x(6x-5y)}`);
    state = say(state, {
      intent: "propose",
      operation: { kind: "replace-line", expression: read(String.raw`\frac{3y}{2x}`) },
      source: "report",
      quote: "three y over two x",
    }).state;
    state = ui(state, "check").state;
    expect(state.history.at(-1)).toMatchObject({
      domainStatus: "restriction-lost",
      domainChanges: { lost: ["12x^2 - 10xy ≠ 0"], added: [], unverified: [] },
    });
    expect(state.history[0].domainChanges).toBeUndefined();
  });
  it("clarifies, logs strategy, and distinguishes recognition corrections", () => {
    let state = start("x+x");
    const before = state.base;
    state = say(state, { intent: "describe-strategy", quote: "simplify" }).state;
    expect(state.base).toEqual(before);
    state = say(state, {
      intent: "correct",
      operation: { kind: "replace-line", expression: read("2x") },
      quote: "no",
    }).state;
    expect(state.clarification?.question).toMatch(/change/);
    state = say(state, {
      intent: "propose",
      operation: { kind: "non-unique", name: "factor" },
      source: "instruction",
      quote: "factor",
    }).state;
    expect(state.clarification).not.toBeNull();
    state = say(state, { intent: "clarify", question: "Which?", readings: [read("x"), read("y")] }).state;
    expect(state.clarification?.readings).toHaveLength(2);
    state = propose(state, "2x");
    state = say(state, {
      intent: "correct",
      operation: { kind: "replace-line", expression: read("x+x") },
      quote: "I meant",
    }).state;
    expect(state.pending?.versions.at(-1)?.cause).toBe("recognition-correction");
    expect(state.audit.entries).toHaveLength(1);
    expect(sessionMetrics(state)).toMatchObject({ recognitionCorrections: 1, clarifications: 3 });
  });
  it("drops stale responses and supports branching undo and withdrawn checks", () => {
    let state = propose(start("x+x"), "2x");
    state = propose(state, "x+x");
    const oldRevision = state.revision;
    state = ui(state, "undo").state;
    const stale = say(state, { intent: "confirm", quote: "yes" }, 9, oldRevision);
    expect(stale.notice.kind).toBe("stale");
    state = propose(stale.state, "2x");
    state = ui(state, "undo").state;
    expect(state.pending?.current).toBe(0);
    state = ui(state, "check").state;
    state = ui(state, "undo").state;
    expect(state.history.at(-1)?.withdrawn).toBe(true);
    state = propose(state, "x+x");
    state = ui(state, "check").state;
    expect(state.audit.entries.map(entry => entry.kind)).toEqual(["start", "step", "correction"]);
    expect(sessionMetrics(state)).toMatchObject({ staleDrops: 1, undos: 3 });
  });
  it("keeps the revision when an event changes nothing, so a later valid response still applies", () => {
    let state = propose(start("x+x"), "2x");
    const requested = state.revision;
    const late = say(state, { intent: "confirm", quote: "yes" }, 9, requested - 1);
    expect(late.notice.kind).toBe("stale");
    expect(late.state.revision).toBe(requested);
    const help = say(late.state, { intent: "request-help", quote: "help" }, 10, requested);
    expect(help.notice).toEqual({ kind: "logged", intent: "request-help" });
    expect(help.state.revision).toBe(requested);
    state = say(help.state, { intent: "confirm", quote: "yes" }, 11, requested).state;
    expect(state.pending?.confirmed).toBe(true);
    expect(state.revision).toBe(requested + 1);
  });
  it("can continue after an unsupported check", () => {
    let state = propose(start("x"), "x^{12}x^{12}x^{12}");
    const checked = ui(state, "check");
    expect(checked.notice).toMatchObject({ kind: "checked", verdict: "unsupported" });
    state = ui(checked.state, "continue").state;
    expect(state.history.at(-1)?.status).toBe("unverified");
    expect(snapshot(state).audit.counts.unverified).toBe(1);
  });
  it("enforces bounds and returns deeply immutable serializable data", () => {
    let state = start("x");
    const operation = { kind: "replace-line" as const, expression: read("x") };
    Object.freeze(operation.expression);
    Object.freeze(operation);
    for (let index = 0; index < SESSION_LIMITS.versions; index++)
      state = say(state, { intent: "propose", operation, source: "report", quote: "x" }).state;
    expect(say(state, { intent: "propose", operation, source: "report", quote: "x" }).notice.kind).toBe("limit");
    expect(Object.isFrozen(state.pending?.versions[0].expression)).toBe(true);
    expect(() => JSON.stringify(snapshot(state))).not.toThrow();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(createSession({ problemId: "", latex: "x" }).ok).toBe(false);
  });
  it("caps the event log and accepted history without changing the line", () => {
    let state = start("x");
    for (let index = 0; index < SESSION_LIMITS.acceptedLines - 1; index++) {
      state = propose(state, "x");
      state = ui(state, "check").state;
    }
    state = propose(state, "x");
    expect(ui(state, "check").notice.kind).toBe("limit");
    while (state.log.length < SESSION_LIMITS.logEntries) state = ui(state, "confirm").state;
    const result = ui(state, "undo");
    expect(result.notice.kind).toBe("limit");
    expect(result.state).toBe(state);
  });
});
