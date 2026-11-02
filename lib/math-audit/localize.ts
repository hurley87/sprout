import type { AlgebraExpression } from "./expression";
import { equivalentExpressions } from "./equivalent";
import { formatExpression } from "./format";

/** Localize only a unique alignment with exactly one unequal pair and all other pairs proven equal.
 * previousPart is its aligned counterpart, not an answer for a tutor to read out.
 */
export type Discrepancy =
  | {
      status: "localized";
      basis: "reciprocal-alignment" | "structural-alignment";
      role: string;
      path: string[];
      description: string;
      previousPart: string;
      proposedPart: string;
    }
  | { status: "not-localized"; detail: string };

type Pair = { previous: AlgebraExpression; proposed: AlgebraExpression; role: string; path: string[] };
type Alignment = { pair: Pair; basis: "reciprocal-alignment" | "structural-alignment" };
const one: AlgebraExpression = { op: "number", value: 1 };

function single(pairs: Pair[]): Pair | "unknown" | undefined {
  const comparisons = pairs.map(pair => equivalentExpressions(pair.previous, pair.proposed));
  if (comparisons.includes("unknown")) return "unknown";
  return comparisons.filter(value => value === false).length === 1 ? pairs[comparisons.indexOf(false)] : undefined;
}

function structural(previous: AlgebraExpression, proposed: AlgebraExpression): Pair | undefined {
  if (previous.op !== proposed.op) return;
  const provenSingle = (pairs: Pair[]) => {
    const result = single(pairs);
    return result === "unknown" ? undefined : result;
  };
  if (previous.op === "divide" && proposed.op === "divide")
    return provenSingle([
      { previous: previous.left, proposed: proposed.left, role: "numerator", path: ["numerator"] },
      { previous: previous.right, proposed: proposed.right, role: "denominator", path: ["denominator"] },
    ]);
  if (previous.op === "subtract" && proposed.op === "subtract")
    return provenSingle([
      { previous: previous.left, proposed: proposed.left, role: "term", path: ["left term"] },
      { previous: previous.right, proposed: proposed.right, role: "term", path: ["right term"] },
    ]);
  if (previous.op === "power" && proposed.op === "power" && previous.exponent === proposed.exponent)
    return provenSingle([{ previous: previous.base, proposed: proposed.base, role: "base", path: ["base"] }]);
  if ((previous.op === "add" && proposed.op === "add") || (previous.op === "multiply" && proposed.op === "multiply")) {
    const previousArgs = previous.args,
      proposedArgs = proposed.args;
    if (previousArgs.length !== proposedArgs.length) return;
    const values = proposedArgs.map(part => previousArgs.map(candidate => equivalentExpressions(candidate, part)));
    if (values.some(row => row.includes("unknown"))) return;
    const candidates: Pair[] = [];
    function match(index: number, used: number[], mismatch: Pair | undefined) {
      if (index === proposedArgs.length) {
        if (mismatch) candidates.push(mismatch);
        return;
      }
      for (let candidate = 0; candidate < previousArgs.length; candidate++) {
        if (used.includes(candidate)) continue;
        const equal = values[index][candidate];
        if (!equal && mismatch) continue;
        match(
          index + 1,
          [...used, candidate],
          equal
            ? mismatch
            : {
                previous: previousArgs[candidate],
                proposed: proposedArgs[index],
                role: proposed.op === "add" ? "term" : "factor",
                path: [`${proposed.op === "add" ? "term" : "factor"} ${index + 1}`],
              },
        );
      }
    }
    match(0, [], undefined);
    if (!candidates.length) return;
    const signature = (pair: Pair) => `${formatExpression(pair.previous)}|${formatExpression(pair.proposed)}`;
    return candidates.every(pair => signature(pair) === signature(candidates[0])) ? candidates[0] : undefined;
  }
}

function reciprocal(previous: AlgebraExpression, proposed: AlgebraExpression): Alignment | undefined {
  if (previous.op !== "divide" || proposed.op !== "multiply" || proposed.args.length !== 2) return;
  const divisor = previous.right;
  const numerator = divisor.op === "divide" ? divisor.right : one;
  const denominator = divisor.op === "divide" ? divisor.left : divisor;
  const matches: Alignment[] = [];
  for (const index of [0, 1]) {
    const factor = proposed.args[index],
      other = proposed.args[1 - index];
    const pairs: Pair[] = [
      { previous: previous.left, proposed: other, role: "unchanged-factor", path: [`factor ${2 - index}`] },
    ];
    if (factor.op === "divide")
      pairs.push(
        {
          previous: numerator,
          proposed: factor.left,
          role: "reciprocal-numerator",
          path: [`factor ${index + 1}`, "numerator"],
        },
        {
          previous: denominator,
          proposed: factor.right,
          role: "reciprocal-denominator",
          path: [`factor ${index + 1}`, "denominator"],
        },
      );
    else
      pairs.push({
        previous: { op: "divide", left: numerator, right: denominator },
        proposed: factor,
        role: "reciprocal-factor",
        path: [`factor ${index + 1}`],
      });
    const pair = single(pairs);
    if (pair === "unknown") return;
    if (pair) matches.push({ pair, basis: "reciprocal-alignment" });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function localizeDiscrepancy(previous: AlgebraExpression, proposed: AlgebraExpression): Discrepancy {
  const isReciprocal = previous.op === "divide" && proposed.op === "multiply";
  const initial = isReciprocal
    ? reciprocal(previous, proposed)
    : (() => {
        const pair = structural(previous, proposed);
        return pair ? { pair, basis: "structural-alignment" as const } : undefined;
      })();
  if (!initial) return { status: "not-localized", detail: "No unique single-difference alignment was proven" };
  let pair = initial.pair;
  for (let depth = 0; depth < 16; depth++) {
    if (!["factor", "unchanged-factor", "reciprocal-factor", "base"].includes(pair.role)) break;
    const refined = structural(pair.previous, pair.proposed);
    if (!refined) break;
    pair = { ...refined, path: [...pair.path, ...refined.path] };
  }
  const reciprocalRole = initial.pair.role;
  const role =
    reciprocalRole === "reciprocal-numerator" || reciprocalRole === "reciprocal-denominator"
      ? reciprocalRole
      : pair.role;
  const description =
    reciprocalRole === "reciprocal-numerator"
      ? "The numerator of the reciprocal factor does not match the denominator of the divisor in the previous expression."
      : reciprocalRole === "reciprocal-denominator"
        ? "The denominator of the reciprocal factor does not match the numerator of the divisor in the previous expression."
        : "The aligned parts are not equivalent.";
  return {
    status: "localized",
    basis: initial.basis,
    role,
    path: pair.path,
    description,
    previousPart: formatExpression(pair.previous),
    proposedPart: formatExpression(pair.proposed),
  };
}
