import { parseMathExpression, type MathExpression as E } from "./math-expression";
import { getCalculusPresentation, getCalculusReviewKey, type CalculusProblemId } from "./problems";

export type MathCorrectness = "valid" | "incorrect" | "unsupported" | "incomplete";
export type MathRole = "function" | "derivative";
export interface MathValidationContext {
  readonly problemId: CalculusProblemId;
  /** Omit only when working from the authored original function. For replacement,
   * callers supply the predecessor being transformed, not the replaced attempt. */
  readonly current?: { readonly expression: E; readonly role: MathRole };
  readonly operation: "rewrite" | "differentiate";
  /** Retained learner observations, not authority claims from an interpreter.
   * Free text is never graded by this mathematical checker. */
  readonly reasoning?: {
    readonly method?: "power" | "sum" | "product" | "chain" | "expand" | "other";
    readonly explanation?: string;
  };
}
export interface MathValidationResult {
  /** Detached exact syntax. Normalization is private and never repairs display. */
  readonly expression?: E;
  readonly correctness: MathCorrectness;
  readonly expressionCorrectness: MathCorrectness;
  readonly transformationCorrectness: MathCorrectness;
  readonly reasoning: "missing" | "strategy-only" | "unassessed";
  readonly faithfulness: "unassessed";
  readonly assistance: "unassessed";
  readonly independence: "unassessed";
  /** Mathematical completion only; never mastery, navigation, or independence. */
  readonly completeDerivative: boolean;
  readonly detail: string;
}

/** Finite support contract:
 * - Exact integer coefficients; associative/commutative sums/products, subtraction,
 *   negation, distribution, collecting terms and nonnegative integer powers.
 * - Polynomials in x and expressions A(x)sin(x)+B(x)cos(x)+C(x). No trig
 *   products/identities or composite trig arguments. Distinct normal forms in
 *   this domain prove inequality (polynomial/sine/cosine independence).
 * - Division ONLY by a literal nonzero integer with integral coefficient result.
 *   No variable cancellation, negative powers, rational functions or domain repair.
 * - Zero powers ONLY of a verified nonzero constant (no 0^0/domain conventions).
 * - Derivatives ONLY of the finite authored original/subexpressions below, matched
 *   modulo this algebra. No recursive differentiation or general solver.
 * - Equality ONLY at the root: both sides must be equal AND the left must denote
 *   the current expression (rewrite) or its derivative (differentiate).
 * Every subtree is checked before cancellation/zero multiplication. Degree <=24,
 * <=64 collected terms, |coeff|<=10^15, <=4096 term products per normalization.
 * Exceeding any boundary abstains, even if later cancellation would simplify it.
 * No numerical sampling. No free-text reasoning judgment or mastery evidence.
 */
export const MATH_VALIDATION_LIMITS = {
  degree: 24,
  terms: 64,
  coefficient: BigInt(10) ** BigInt(15),
  products: 4096,
} as const;
// key = x degree, sine degree, cosine degree (the latter sum is at most one).
type Polynomial = Map<string, bigint>;
class OutsideDomain extends Error {}
const key = (x: number, s = 0, c = 0) => `${x},${s},${c}`;
const one = (): Polynomial => new Map([[key(0), BigInt(1)]]);
const scalar = (value: bigint): Polynomial => new Map(value === BigInt(0) ? [] : [[key(0), value]]);
function signature(p: Polynomial): string {
  return [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
function put(p: Polynomial, k: string, value: bigint) {
  if (value > MATH_VALIDATION_LIMITS.coefficient || value < -MATH_VALIDATION_LIMITS.coefficient)
    throw new OutsideDomain("Coefficient limit");
  if (value === BigInt(0)) p.delete(k);
  else p.set(k, value);
  if (p.size > MATH_VALIDATION_LIMITS.terms) throw new OutsideDomain("Term limit");
}
function add(a: Polynomial, b: Polynomial, sign = BigInt(1)): Polynomial {
  const result = new Map(a);
  for (const [k, v] of b) put(result, k, (result.get(k) ?? BigInt(0)) + sign * v);
  return result;
}
function normalizer(derivatives: ReadonlyMap<string, Polynomial>) {
  let products = 0;
  function multiply(a: Polynomial, b: Polynomial): Polynomial {
    const result: Polynomial = new Map();
    for (const [ka, va] of a)
      for (const [kb, vb] of b) {
        if (++products > MATH_VALIDATION_LIMITS.products) throw new OutsideDomain("Expansion budget");
        const aa = ka.split(",").map(Number),
          bb = kb.split(",").map(Number);
        const [x, s, c] = aa.map((v, i) => v + bb[i]);
        if (x > MATH_VALIDATION_LIMITS.degree || s + c > 1)
          throw new OutsideDomain("Degree/trigonometric product boundary");
        const k = key(x, s, c);
        put(result, k, (result.get(k) ?? BigInt(0)) + va * vb);
      }
    return result;
  }
  function normalize(e: E): Polynomial {
    switch (e.op) {
      case "number":
        return scalar(BigInt(e.value));
      case "variable":
        return new Map([[key(1), BigInt(1)]]);
      case "add":
        return e.args.map(normalize).reduce((a, b) => add(a, b));
      case "subtract":
        return add(normalize(e.left), normalize(e.right), -BigInt(1));
      case "negate":
        return add(new Map(), normalize(e.argument), -BigInt(1));
      case "multiply":
        return e.args.map(normalize).reduce(multiply);
      case "power": {
        const base = normalize(e.base);
        if (e.exponent < 0) throw new OutsideDomain("Negative powers require domain analysis");
        if (e.exponent === 0 && !(base.size === 1 && base.has(key(0))))
          throw new OutsideDomain("Zero power may hide an undefined base value");
        let result = one();
        for (let i = 0; i < e.exponent; i++) result = multiply(result, base);
        return result;
      }
      case "divide": {
        // Check both subtrees before deciding whether scalar division is supported.
        const numerator = normalize(e.left);
        normalize(e.right);
        if (e.right.op !== "number" || e.right.value === 0)
          throw new OutsideDomain("Only nonzero literal scalar divisors supported");
        const divisor = BigInt(e.right.value),
          result: Polynomial = new Map();
        for (const [k, v] of numerator) {
          if (v % divisor !== BigInt(0)) throw new OutsideDomain("Nonintegral coefficients unsupported");
          put(result, k, v / divisor);
        }
        return result;
      }
      case "sin":
      case "cos":
        if (e.argument.op !== "variable") throw new OutsideDomain("Only sin(x) and cos(x) supported");
        return new Map([[key(0, e.op === "sin" ? 1 : 0, e.op === "cos" ? 1 : 0), BigInt(1)]]);
      case "derivative": {
        // An empty table prevents nesting derivatives or deriving new rules.
        const argument = normalizer(new Map())(e.argument);
        const value = derivatives.get(signature(argument));
        if (!value) throw new OutsideDomain("Derivative argument outside authored table");
        return new Map(value);
      }
      case "equal":
        throw new OutsideDomain("Nested equality unsupported");
    }
  }
  return normalize;
}
const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const pow = (exponent: number): E => ({ op: "power", base: x, exponent });
const mul = (...args: E[]): E => ({ op: "multiply", args });
function derivativeTable(id: CalculusProblemId): ReadonlyMap<string, Polynomial> {
  const plain = normalizer(new Map());
  const original = getCalculusPresentation(id).functionExpression;
  const pairs: [E, E][] = [[original, getCalculusReviewKey(id).finalForms[0]]];
  if (id === "cubic-minus-linear") pairs.push([pow(3), mul(n(3), pow(2))], [mul(n(4), x), n(4)]);
  if (id === "quadratic-sine")
    pairs.push(
      [pow(2), mul(n(2), x)],
      [
        { op: "sin", argument: x },
        { op: "cos", argument: x },
      ],
    );
  if (id === "composite-fifth") pairs.push([{ op: "add", args: [mul(n(3), pow(2)), n(1)] }, mul(n(6), x)]);
  return new Map(pairs.map(([a, b]) => [signature(plain(a)), plain(b)]));
}
function hasDerivative(e: E): boolean {
  switch (e.op) {
    case "derivative":
      return true;
    case "add":
    case "multiply":
      return e.args.some(hasDerivative);
    case "subtract":
    case "divide":
    case "equal":
      return hasDerivative(e.left) || hasDerivative(e.right);
    case "power":
      return hasDerivative(e.base);
    case "negate":
    case "sin":
    case "cos":
      return hasDerivative(e.argument);
    default:
      return false;
  }
}
function assessReasoning(context: MathValidationContext): MathValidationResult["reasoning"] {
  const r = context.reasoning;
  if (!r?.method && !r?.explanation?.trim()) return "missing";
  // A method name alone cannot establish whether the learner's reasoning is
  // sound: valid rewrites can change which rule applies. Explanations need
  // separate assessment, including apparently misleading ones.
  return r.explanation?.trim() ? "unassessed" : "strategy-only";
}

/** Pure assessment only. Caller still owns authenticated source/board authority,
 * faithfulness, reasoning review, assistance provenance and eventual state changes.
 * undefined/null means no complete expression supplied, including strategy-only.
 * Other malformed syntax abstains; it is never evidence of incorrect mathematics.
 */
export function validateMathExpression(proposed: unknown, context: MathValidationContext): MathValidationResult {
  // Validate the authored ID even on the no-expression path.
  const original = getCalculusPresentation(context.problemId).functionExpression;
  const base = {
    reasoning: assessReasoning(context),
    faithfulness: "unassessed",
    assistance: "unassessed",
    independence: "unassessed",
  } as const;
  const result = (
    expression: E | undefined,
    expressionCorrectness: MathCorrectness,
    transformationCorrectness: MathCorrectness,
    detail: string,
  ): MathValidationResult => {
    // An unresolved transition/domain keeps the combined verdict unresolved, even
    // when the separately assessed value is wrong for this problem.
    const correctness =
      expressionCorrectness === "unsupported" || transformationCorrectness === "unsupported"
        ? "unsupported"
        : expressionCorrectness === "incorrect" || transformationCorrectness === "incorrect"
          ? "incorrect"
          : expressionCorrectness === "incomplete" || transformationCorrectness === "incomplete"
            ? "incomplete"
            : "valid";
    const value = expression?.op === "equal" ? expression.right : expression;
    const role = context.operation === "differentiate" ? "derivative" : (context.current?.role ?? "function");
    return {
      ...base,
      ...(expression ? { expression } : {}),
      correctness,
      expressionCorrectness,
      transformationCorrectness,
      completeDerivative: correctness === "valid" && role === "derivative" && !!value && !hasDerivative(value),
      detail,
    };
  };
  if (proposed == null) return result(undefined, "incomplete", "incomplete", "No executed expression supplied");
  let expression: E;
  try {
    expression = parseMathExpression(proposed);
  } catch {
    return result(
      undefined,
      "unsupported",
      "unsupported",
      "Outside bounded expression syntax; clarify before assessing",
    );
  }
  let normalize: (e: E) => Polynomial;
  let candidate: Polynomial, expected: Polynomial;
  const value = expression.op === "equal" ? expression.right : expression;
  try {
    normalize = normalizer(derivativeTable(context.problemId));
    candidate = normalize(value);
    expected = normalize(
      context.operation === "differentiate" || context.current?.role === "derivative"
        ? getCalculusReviewKey(context.problemId).finalForms[0]
        : original,
    );
  } catch (error) {
    if (!(error instanceof OutsideDomain)) throw error;
    return result(expression, "unsupported", "unsupported", error.message);
  }
  const expressionCorrectness = signature(candidate) === signature(expected) ? "valid" : "incorrect";
  try {
    const current = parseMathExpression(context.current?.expression ?? original);
    if (current.op === "equal") throw new OutsideDomain("Current context must name a value, not an assertion");
    if (context.operation === "differentiate" && (context.current?.role === "derivative" || hasDerivative(current)))
      throw new OutsideDomain("Repeated differentiation outside authored routes");
    const source: E = context.operation === "differentiate" ? { op: "derivative", argument: current } : current;
    const sourceForm = normalize(source);
    if (expression.op === "equal") {
      const left = normalize(expression.left);
      if (signature(left) !== signature(candidate))
        return result(
          expression,
          expressionCorrectness,
          "incorrect",
          "Asserted equality is false in the supported domain",
        );
      if (signature(left) !== signature(sourceForm))
        return result(
          expression,
          expressionCorrectness,
          "incorrect",
          "Equality does not describe the requested current transformation",
        );
    }
    const transition = signature(candidate) === signature(sourceForm) ? "valid" : "incorrect";
    return result(
      expression,
      expressionCorrectness,
      transition,
      transition === "valid"
        ? "Verified by bounded exact algebra and authored derivative table"
        : "Transformation changes the supported current value",
    );
  } catch (error) {
    if (!(error instanceof OutsideDomain))
      return result(expression, expressionCorrectness, "unsupported", "Invalid current expression context");
    return result(expression, expressionCorrectness, "unsupported", error.message);
  }
}
