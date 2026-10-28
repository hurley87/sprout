import type { MathExpression as E } from "./math-expression";

export type MathComparison = "match" | "mismatch" | "unsupported";

/** Finite support contract:
 * - Exact integer coefficients; associative/commutative sums/products, subtraction,
 *   negation, distribution, collecting terms and nonnegative integer powers.
 * - Polynomials in x and expressions A(x)sin(x)+B(x)cos(x)+C(x). No trig
 *   products/identities or composite trig arguments. Distinct normal forms in
 *   this domain prove inequality (polynomial/sine/cosine independence).
 * - Division ONLY by a literal nonzero integer with integral coefficient result.
 *   No variable cancellation, negative powers, rational functions or domain repair.
 * - Zero powers ONLY of a verified nonzero constant (no 0^0/domain conventions).
 * - No derivative notation or general solver: learners state values.
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
function normalizer() {
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
      case "derivative":
        throw new OutsideDomain("Derivative notation unsupported");
      case "equal":
        throw new OutsideDomain("Nested equality unsupported");
    }
  }
  return normalize;
}
/** Exact equivalence in the bounded algebra above. "unsupported" means the check
 * abstains (outside the domain), never that the learner is wrong. An equation is
 * judged by its right-hand side, the value the learner stated. */
export function compareMathExpression(proposed: E, accepted: readonly E[]): MathComparison {
  const normalize = normalizer();
  try {
    const value = signature(normalize(proposed.op === "equal" ? proposed.right : proposed));
    return accepted.some(form => signature(normalize(form)) === value) ? "match" : "mismatch";
  } catch (error) {
    if (!(error instanceof OutsideDomain)) throw error;
    return "unsupported";
  }
}
