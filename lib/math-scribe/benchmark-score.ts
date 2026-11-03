type Item = { intent: string; operation?: { expression?: unknown } };
type Result = { status: string; interpretations?: Item[]; diagnostics?: { dropped: unknown[] } };

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => equal(v, right[i]))
    );
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(key => Object.hasOwn(rightRecord, key) && equal(leftRecord[key], rightRecord[key]))
  );
}

export function scoreInterpretation(expected: Item[], result: Result) {
  const actual = result.status === "ok" ? (result.interpretations ?? []) : [];
  const hasExpressions = expected.some(item => item.operation?.expression !== undefined);
  const expectedClarification = expected.some(item => item.intent === "clarify");
  const negative = expected.length === 0 || expectedClarification;
  return {
    exact: result.status === "ok" && equal(expected, actual),
    intent:
      result.status === "ok" &&
      equal(
        expected.map(item => item.intent),
        actual.map(item => item.intent),
      ),
    faithfulExpression: hasExpressions
      ? result.status === "ok" &&
        expected.length === actual.length &&
        expected.every((item, index) => equal(item.operation?.expression, actual[index]?.operation?.expression))
      : null,
    clarification: expectedClarification
      ? result.status === "ok" && actual.some(item => item.intent === "clarify")
      : null,
    falseCommit: negative && actual.some(item => item.intent === "propose" || item.intent === "correct"),
    drops: result.diagnostics?.dropped.length ?? 0,
  };
}

export function summarizeScores(rows: { score: ReturnType<typeof scoreInterpretation>; latencyMs: number }[]) {
  const rate = (values: (boolean | null)[]) => {
    const applicable = values.filter((value): value is boolean => value !== null);
    return applicable.length ? applicable.filter(Boolean).length / applicable.length : null;
  };
  const latencies = rows.map(row => row.latencyMs).sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    latencies.length ? latencies[Math.ceil(fraction * latencies.length) - 1] : null;
  return {
    runs: rows.length,
    exactMatchRate: rate(rows.map(row => row.score.exact)),
    intentMatchRate: rate(rows.map(row => row.score.intent)),
    faithfulExpressionRate: rate(rows.map(row => row.score.faithfulExpression)),
    clarificationRate: rate(rows.map(row => row.score.clarification)),
    falseCommits: rows.filter(row => row.score.falseCommit).length,
    drops: rows.reduce((total, row) => total + row.score.drops, 0),
    latencyP50Ms: percentile(0.5),
    latencyP95Ms: percentile(0.95),
  };
}
