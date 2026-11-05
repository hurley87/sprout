import { parseAlgebraExpression, type AlgebraExpression } from "../math-audit/expression";
import { formatExpression } from "../math-audit/format";

/** Stable pre-order addresses; at the cap, leaves are dropped before other parts. */
export type PathStep =
  { child: "args"; index: number } | { child: "left" | "right" | "argument" | "base" | "exponent" };
export type Part = {
  id: string;
  path: PathStep[];
  description: string;
  aliases: string[];
  latex: string;
  op: AlgebraExpression["op"];
  kind: "expression" | "exponent";
};
export const MATH_SCRIBE_PART_LIMIT = 64;
export function safeClarification(question: string, parts: Pick<Part, "id" | "description">[] = []): string {
  let known: string | undefined;
  const clean = question.replace(/\bp\d+\b/gi, id => {
    const part = parts.find(candidate => candidate.id === id);
    if (part) known = part.description;
    return part?.description ?? id;
  });
  if (/\\|\^|[{}]|\bp\d+\b/i.test(clean)) {
    const description = known && !/\\|\^|[{}]|\bp\d+\b/i.test(known) ? known : undefined;
    return description ? `What should ${description} become?` : "Which part do you mean, and what should it become?";
  }
  return clean;
}
export type ReplacePartResult =
  { ok: true; expression: AlgebraExpression } | { ok: false; reason: "bad-path" | "invalid-replacement" | "limit" };

function atPath(expression: AlgebraExpression, path: readonly PathStep[]): AlgebraExpression | number | null {
  let current: AlgebraExpression | number = expression;
  for (const step of path) {
    if (!step || typeof step !== "object" || typeof current === "number") return null;
    if (step.child === "args") {
      if (
        (current.op !== "add" && current.op !== "multiply") ||
        !Number.isInteger(step.index) ||
        step.index < 0 ||
        step.index >= current.args.length
      )
        return null;
      current = current.args[step.index];
    } else if (
      (step.child === "left" || step.child === "right") &&
      (current.op === "divide" || current.op === "subtract")
    ) {
      current = current[step.child];
    } else if (step.child === "argument" && current.op === "negate") current = current.argument;
    else if ((step.child === "base" || step.child === "exponent") && current.op === "power")
      current = current[step.child];
    else return null;
  }
  return current;
}

export function listParts(expression: AlgebraExpression, options?: { limit?: number }): Part[] {
  const limit =
    options?.limit === undefined
      ? MATH_SCRIBE_PART_LIMIT
      : Math.max(0, Math.min(MATH_SCRIBE_PART_LIMIT, Number.isFinite(options.limit) ? Math.floor(options.limit) : 0));
  const candidates: Omit<Part, "id">[] = [];
  function visit(node: AlgebraExpression, path: PathStep[], description: string) {
    candidates.push({ path, description, aliases: [], latex: formatExpression(node), op: node.op, kind: "expression" });
    const suffix = description === "whole line" ? "" : ` of ${description.replace(/^the /, "")}`;
    const go = (child: AlgebraExpression, step: PathStep, label: string) => visit(child, [...path, step], label);
    if (node.op === "multiply" || node.op === "add") {
      node.args.forEach((child, index) =>
        go(child, { child: "args", index }, `${node.op === "multiply" ? "factor" : "term"} ${index + 1}${suffix}`),
      );
    } else if (node.op === "subtract") {
      go(node.left, { child: "left" }, `term 1${suffix}`);
      go(node.right, { child: "right" }, `term 2${suffix}`);
    } else if (node.op === "divide") {
      const division = path.length === 0 && node.left.op === "divide" && node.right.op === "divide";
      go(node.left, { child: "left" }, division ? "dividend" : `numerator${suffix}`);
      go(node.right, { child: "right" }, division ? "divisor" : `denominator${suffix}`);
    } else if (node.op === "negate") go(node.argument, { child: "argument" }, `argument${suffix}`);
    else if (node.op === "power") {
      go(node.base, { child: "base" }, `base${suffix}`);
      candidates.push({
        path: [...path, { child: "exponent" }],
        description: `exponent${suffix}`,
        aliases: [],
        latex: String(node.exponent),
        op: "power",
        kind: "exponent",
      });
    }
  }
  visit(expression, [], "whole line");
  const fractions = candidates.filter(
    part =>
      part.kind === "expression" &&
      part.op === "divide" &&
      !(
        part.path.length === 0 &&
        expression.op === "divide" &&
        expression.left.op === "divide" &&
        expression.right.op === "divide"
      ),
  );
  const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  fractions.forEach((part, index) => {
    if (ordinals[index]) part.aliases.push(`the ${ordinals[index]} fraction`);
  });
  if (expression.op === "divide" && (expression.left.op === "subtract" || expression.left.op === "add")) {
    const top = candidates.find(part => JSON.stringify(part.path) === JSON.stringify([{ child: "left" }]));
    const bottom = candidates.find(part => JSON.stringify(part.path) === JSON.stringify([{ child: "right" }]));
    const topFractions = fractions.filter(part => part.path.length === 2 && part.path[0].child === "left");
    if (topFractions.length === 2) {
      const outer = candidates.find(part => part.path.length === 0);
      if (outer) outer.aliases = [];
      top?.aliases.push("the top", "the big numerator", "the outer numerator");
      bottom?.aliases.push("the outside denominator", "the bottom", "the outer denominator");
      topFractions.forEach((fraction, index) => {
        const name = `the ${ordinals[index]} fraction on top`;
        fraction.aliases = [name, `the ${ordinals[index]} fraction`];
        fraction.description = `${ordinals[index]} fraction on top`;
        for (const child of candidates) {
          if (
            child.path.length !== fraction.path.length + 1 ||
            JSON.stringify(child.path.slice(0, -1)) !== JSON.stringify(fraction.path)
          )
            continue;
          const step = child.path.at(-1);
          if (step?.child === "left" || step?.child === "right")
            child.description = `${step.child === "left" ? "numerator" : "denominator"} of ${name}`;
        }
      });
    }
  } else if (expression.op === "divide" && expression.left.op === "divide" && expression.right.op !== "divide") {
    // A single fraction over an outside denominator, e.g. after combining the fractions on
    // top: name it as the top fraction rather than numbering the whole line a fraction.
    const at = (path: PathStep[]) => candidates.find(part => JSON.stringify(part.path) === JSON.stringify(path));
    const outer = at([]);
    if (outer) outer.aliases = [];
    const top = at([{ child: "left" }]);
    if (top) {
      top.description = "top fraction";
      top.aliases = ["the top fraction", "the big numerator", "the outer numerator"];
    }
    at([{ child: "right" }])?.aliases.push("the outside denominator", "the bottom", "the outer denominator");
    for (const side of ["left", "right"] as const) {
      const child = at([{ child: "left" }, { child: side }]);
      if (child) child.description = `${side === "left" ? "numerator" : "denominator"} of the top fraction`;
    }
  }
  const selected =
    candidates.length <= limit
      ? candidates
      : (() => {
          const nonLeaves = candidates.filter(
            part => part.kind === "exponent" || (part.op !== "number" && part.op !== "variable"),
          );
          const keep = new Set(nonLeaves.slice(0, limit));
          for (const part of candidates) if (keep.size < limit) keep.add(part);
          return candidates.filter(part => keep.has(part));
        })();
  return selected.map((part, index) => ({ id: `p${index}`, ...part }));
}

export function getPart(
  expression: AlgebraExpression,
  address: string | readonly PathStep[],
): AlgebraExpression | number | null {
  const path = typeof address === "string" ? listParts(expression).find(part => part.id === address)?.path : address;
  return Array.isArray(path) ? atPath(expression, path) : null;
}

export function replacePart(
  expression: AlgebraExpression,
  path: readonly PathStep[],
  replacement: AlgebraExpression | number,
): ReplacePartResult {
  if (!Array.isArray(path) || atPath(expression, path) === null) return { ok: false, reason: "bad-path" };
  const target = atPath(expression, path);
  if (
    typeof target === "number"
      ? typeof replacement !== "number" || !Number.isSafeInteger(replacement)
      : typeof replacement !== "object" || replacement === null
  )
    return { ok: false, reason: "invalid-replacement" };
  function replace(node: AlgebraExpression, depth: number): AlgebraExpression | number {
    if (depth === path.length) return replacement;
    const step = path[depth];
    if (step.child === "args" && (node.op === "add" || node.op === "multiply"))
      return {
        ...node,
        args: node.args.map((child, index) =>
          index === step.index ? (replace(child, depth + 1) as AlgebraExpression) : child,
        ),
      };
    if ((step.child === "left" || step.child === "right") && (node.op === "subtract" || node.op === "divide"))
      return { ...node, [step.child]: replace(node[step.child], depth + 1) } as AlgebraExpression;
    if (step.child === "argument" && node.op === "negate")
      return { ...node, argument: replace(node.argument, depth + 1) as AlgebraExpression };
    if (step.child === "base" && node.op === "power")
      return { ...node, base: replace(node.base, depth + 1) as AlgebraExpression };
    if (step.child === "exponent" && node.op === "power") return { ...node, exponent: replacement as number };
    return node;
  }
  const parsed = parseAlgebraExpression(replace(expression, 0));
  return parsed.ok
    ? { ok: true, expression: parsed.expression }
    : { ok: false, reason: parsed.reason === "limit" ? "limit" : "invalid-replacement" };
}
