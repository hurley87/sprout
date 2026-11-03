import { parseAlgebraExpression, type AlgebraExpression } from "./expression";
import { boundedArray } from "../calculus/math-expression";
import { localizeDiscrepancy, type Discrepancy } from "./localize";
import { readAlgebraLatex } from "./latex";
import { reduceRational, type RationalReduction } from "./rational";
import {
  constant,
  divides,
  evaluate,
  formatPolynomial,
  isZero,
  multiply,
  polynomialBudget,
  PolynomialLimitError,
  primitivePart,
  subtract,
  type Fraction,
  type Polynomial,
  type RationalPoint,
} from "./polynomial";

/** Exact bounded rational algebra in x,y; no calculus or rule validation.
 * Domains require every recorded restriction to be nonzero. Equivalence means
 * equality on the intersection, even when the domain report is not preserved.
 */
export type ExpressionInput = { latex: string } | { ast: unknown };
export type Operation = { kind: "algebraic" | "differentiate" | "integrate" | "solve" | "other"; description?: string };
export type Provenance = { previousId?: string; proposedId?: string; sourceIds?: readonly string[] };
export interface TransformationInput {
  previous: ExpressionInput;
  proposed: ExpressionInput;
  operation?: Operation;
  provenance?: Provenance;
}
export type PointWitness = { x: string; y: string };
export type DomainReport = {
  status: "preserved" | "restriction-lost" | "restriction-unverified" | "restriction-added";
  previousRestrictions: string[];
  proposedRestrictions: string[];
  lost: { restriction: string; witness: PointWitness }[];
  added: { restriction: string; witness: PointWitness }[];
  unverified: string[];
};
/** Equivalent describes the common domain, not necessarily domain preservation. */
type ResultFields = {
  reason: string;
  detail: string;
  which?: "previous" | "proposed";
  position?: number;
  evidence?: { difference?: string; witness?: PointWitness & { previous: string; proposed: string } };
  domain?: DomainReport;
  operation?: Operation;
  provenance?: Provenance;
};
export type TransformationResult = ResultFields &
  (
    | { verdict: "equivalent" }
    | { verdict: "not-equivalent"; discrepancy?: Discrepancy }
    | { verdict: "unsupported" }
    | { verdict: "ambiguous" }
  );
type Reduced = Extract<RationalReduction, { ok: true }>;

function object(value: unknown, allowed: string[], required: string[] = []): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(value).every(
      key =>
        typeof key === "string" && allowed.includes(key) && descriptors[key].enumerable && "value" in descriptors[key],
    ) && required.every(key => Object.hasOwn(descriptors, key))
  );
}
function expressionInput(value: unknown): value is ExpressionInput {
  return (object(value, ["latex"], ["latex"]) && typeof value.latex === "string") || object(value, ["ast"], ["ast"]);
}
function validInput(value: unknown): value is TransformationInput {
  if (
    !object(value, ["previous", "proposed", "operation", "provenance"], ["previous", "proposed"]) ||
    !expressionInput(value.previous) ||
    !expressionInput(value.proposed)
  )
    return false;
  if (
    Object.hasOwn(value, "operation") &&
    (!object(value.operation, ["kind", "description"], ["kind"]) ||
      !["algebraic", "differentiate", "integrate", "solve", "other"].includes(value.operation.kind as string) ||
      (Object.hasOwn(value.operation, "description") && typeof value.operation.description !== "string"))
  )
    return false;
  if (Object.hasOwn(value, "provenance")) {
    const provenance = value.provenance;
    if (
      !object(provenance, ["previousId", "proposedId", "sourceIds"]) ||
      ["previousId", "proposedId"].some(key => Object.hasOwn(provenance, key) && typeof provenance[key] !== "string") ||
      (Object.hasOwn(provenance, "sourceIds") &&
        (Object.getPrototypeOf(provenance.sourceIds) !== Array.prototype ||
          !boundedArray(provenance.sourceIds, 200, 0).every((id: unknown) => typeof id === "string")))
    )
      return false;
  }
  return true;
}
const frac = (numerator: bigint, denominator = BigInt(1)): Fraction => {
  if (denominator < BigInt(0)) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let left = numerator < BigInt(0) ? -numerator : numerator,
    right = denominator;
  while (right) [left, right] = [right, left % right];
  return { numerator: numerator / left, denominator: denominator / left };
};
const text = (value: Fraction) =>
  value.denominator === BigInt(1) ? `${value.numerator}` : `${value.numerator}/${value.denominator}`;
const pointText = (point: RationalPoint): PointWitness => ({ x: text(point.x), y: text(point.y) });
const grid = [0, 1, -1, 2, -2, 3, -3, 4, -4]
  .map(value => frac(BigInt(value)))
  .concat([frac(BigInt(1), BigInt(2)), frac(-BigInt(1), BigInt(2))]);
const nonzero = (polynomial: Polynomial, point: RationalPoint) => evaluate(polynomial, point).numerator !== BigInt(0);
function* points(restriction?: Polynomial): Generator<RationalPoint> {
  for (const x of grid) for (const y of grid) yield { x, y };
  if (!restriction) return;
  for (const variable of ["x", "y"] as const) {
    const coefficient = new Map<string, bigint>(),
      remainder = new Map<string, bigint>();
    let linear = true;
    for (const [key, value] of restriction) {
      const [x, y] = key.split(",").map(Number),
        degree = variable === "x" ? x : y;
      if (degree > 1) {
        linear = false;
        break;
      }
      (degree ? coefficient : remainder).set(variable === "x" ? `0,${y}` : `${x},0`, value);
    }
    if (!linear) continue;
    for (const other of grid) {
      const base = { x: variable === "x" ? grid[0] : other, y: variable === "y" ? grid[0] : other };
      const a = evaluate(coefficient, base),
        b = evaluate(remainder, base);
      if (!a.numerator) continue;
      const root = frac(-b.numerator * a.denominator, b.denominator * a.numerator);
      yield variable === "x" ? { x: root, y: other } : { x: other, y: root };
    }
  }
}
function implied(restriction: Polynomial, others: Polynomial[]): boolean {
  try {
    const budget = polynomialBudget();
    let product = constant(BigInt(1));
    for (const other of others) product = primitivePart(multiply(product, primitivePart(other), budget));
    let power = constant(BigInt(1));
    const degree = Math.max(
      ...[...restriction.keys()].map(key =>
        key
          .split(",")
          .map(Number)
          .reduce((a, b) => a + b, 0),
      ),
    );
    for (let index = 0; index < Math.max(1, degree); index++) {
      power = primitivePart(multiply(power, product, budget));
      if (divides(restriction, power, budget) === true) return true;
    }
  } catch (error) {
    if (!(error instanceof PolynomialLimitError)) throw error;
  }
  return false;
}
function domain(previous: Polynomial[], proposed: Polynomial[]): DomainReport {
  const lost: DomainReport["lost"] = [],
    added: DomainReport["added"] = [],
    unverified: string[] = [];
  const examine = (source: Polynomial[], target: Polynomial[], result: typeof lost) => {
    for (const restriction of source) {
      if (implied(restriction, target)) continue;
      const label = `${formatPolynomial(restriction)} ≠ 0`;
      const witness = [...points(restriction)].find(
        point => !nonzero(restriction, point) && target.every(entry => nonzero(entry, point)),
      );
      if (witness) result.push({ restriction: label, witness: pointText(witness) });
      else unverified.push(label);
    }
  };
  examine(previous, proposed, lost);
  examine(proposed, previous, added);
  return {
    status: lost.length
      ? "restriction-lost"
      : unverified.length
        ? "restriction-unverified"
        : added.length
          ? "restriction-added"
          : "preserved",
    previousRestrictions: previous.map(item => `${formatPolynomial(item)} ≠ 0`),
    proposedRestrictions: proposed.map(item => `${formatPolynomial(item)} ≠ 0`),
    lost,
    added,
    unverified,
  };
}
function valueAt(value: Reduced, point: RationalPoint): Fraction {
  const numerator = evaluate(value.numerator, point),
    denominator = evaluate(value.denominator, point);
  return frac(numerator.numerator * denominator.denominator, numerator.denominator * denominator.numerator);
}
export function checkTransformation(input: TransformationInput): TransformationResult {
  let echo: Pick<TransformationResult, "operation" | "provenance"> = {};
  try {
    if (!validInput(input))
      return { verdict: "unsupported", reason: "malformed-input", detail: "Invalid transformation input" };
    echo = {
      ...(input.operation ? { operation: { ...input.operation } } : {}),
      ...(input.provenance
        ? {
            provenance: {
              ...input.provenance,
              ...(input.provenance.sourceIds ? { sourceIds: Array.from(input.provenance.sourceIds) } : {}),
            },
          }
        : {}),
    };
    if (input.operation && input.operation.kind !== "algebraic")
      return {
        verdict: "unsupported",
        reason: "requires-rule-validator",
        detail: "This operation requires a separate rule validator",
        ...echo,
      };
    const reduced: Reduced[] = [];
    const expressions: AlgebraExpression[] = [];
    for (const which of ["previous", "proposed"] as const) {
      const source = input[which],
        parsed = "latex" in source ? readAlgebraLatex(source.latex) : parseAlgebraExpression(source.ast);
      if (!parsed.ok)
        return {
          verdict: parsed.reason === "ambiguous" ? "ambiguous" : "unsupported",
          reason:
            parsed.reason === "ambiguous" || parsed.reason === "malformed"
              ? `${parsed.reason}-${which}`
              : parsed.reason,
          detail: parsed.detail,
          which,
          ...("position" in parsed && parsed.position !== undefined ? { position: parsed.position } : {}),
          ...echo,
        };
      const result = reduceRational(parsed.expression);
      if (!result.ok)
        return {
          verdict: result.reason === "undefined" && which === "proposed" ? "not-equivalent" : "unsupported",
          reason: result.reason === "undefined" ? `${which}-undefined` : result.reason,
          detail: result.detail,
          which,
          ...echo,
        };
      reduced.push(result);
      expressions.push(parsed.expression);
    }
    const [previous, proposed] = reduced,
      budget = polynomialBudget();
    const difference = subtract(
      multiply(previous.numerator, proposed.denominator, budget),
      multiply(proposed.numerator, previous.denominator, budget),
    );
    const report = domain(previous.restrictions, proposed.restrictions);
    if (isZero(difference))
      return {
        verdict: "equivalent",
        reason: "exact-equivalence",
        detail: "Equal on the common domain",
        domain: report,
        ...echo,
      };
    // The nonzero polynomial proves inequality; the witness is only illustrative.
    const witness = [...points()].find(
      point =>
        [...previous.restrictions, ...proposed.restrictions].every(restriction => nonzero(restriction, point)) &&
        nonzero(previous.denominator, point) &&
        nonzero(proposed.denominator, point) &&
        nonzero(difference, point),
    );
    return {
      verdict: "not-equivalent",
      reason: "exact-difference",
      detail: "Cross-multiplied difference is nonzero",
      discrepancy: localizeDiscrepancy(expressions[0], expressions[1]),
      evidence: {
        difference: formatPolynomial(difference),
        ...(witness
          ? {
              witness: {
                ...pointText(witness),
                previous: text(valueAt(previous, witness)),
                proposed: text(valueAt(proposed, witness)),
              },
            }
          : {}),
      },
      domain: report,
      ...echo,
    };
  } catch (error) {
    if (error instanceof PolynomialLimitError)
      return { verdict: "unsupported", reason: "limit", detail: error.message, ...echo };
    return { verdict: "unsupported", reason: "malformed-input", detail: "Invalid transformation input", ...echo };
  }
}
