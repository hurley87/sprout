/** Exact sparse integer polynomials in x,y. Degree <=24, terms <=64,
 * |coefficient| <=10^15 and <=4096 term products per operation context.
 * Budget overruns throw PolynomialLimitError; divisibility returns unknown.
 */
export const POLYNOMIAL_LIMITS = {
  degree: 24,
  terms: 64,
  coefficient: BigInt(10) ** BigInt(15),
  products: 4096,
} as const;
export type Polynomial = ReadonlyMap<string, bigint>;
export type RationalPoint = { x: Fraction; y: Fraction };
export type Fraction = { numerator: bigint; denominator: bigint };
export class PolynomialLimitError extends Error {}
export type PolynomialBudget = { products: number };
export const polynomialBudget = (): PolynomialBudget => ({ products: 0 });
const abs = (value: bigint) => (value < BigInt(0) ? -value : value);
const gcd = (left: bigint, right: bigint): bigint => {
  while (right !== BigInt(0)) [left, right] = [right, left % right];
  return abs(left);
};
const degrees = (key: string) => key.split(",").map(Number);
const compare = (left: string, right: string) => {
  const [lx, ly] = degrees(left),
    [rx, ry] = degrees(right);
  return rx - lx || ry - ly;
};
function put(result: Map<string, bigint>, key: string, coefficient: bigint) {
  if (abs(coefficient) > POLYNOMIAL_LIMITS.coefficient) throw new PolynomialLimitError("Coefficient limit");
  if (coefficient === BigInt(0)) result.delete(key);
  else result.set(key, coefficient);
  if (result.size > POLYNOMIAL_LIMITS.terms) throw new PolynomialLimitError("Term limit");
}
export function constant(value: bigint): Polynomial {
  const result = new Map<string, bigint>();
  put(result, "0,0", value);
  return result;
}
export function variable(name: "x" | "y"): Polynomial {
  return new Map([[name === "x" ? "1,0" : "0,1", BigInt(1)]]);
}
export function add(left: Polynomial, right: Polynomial): Polynomial {
  const result = new Map(left);
  for (const [key, value] of right) put(result, key, (result.get(key) ?? BigInt(0)) + value);
  return result;
}
export function negate(value: Polynomial): Polynomial {
  return new Map([...value].map(([key, coefficient]) => [key, -coefficient]));
}
export function subtract(left: Polynomial, right: Polynomial): Polynomial {
  return add(left, negate(right));
}
export function multiply(
  left: Polynomial,
  right: Polynomial,
  budget: PolynomialBudget = polynomialBudget(),
): Polynomial {
  const result = new Map<string, bigint>();
  for (const [leftKey, leftValue] of left)
    for (const [rightKey, rightValue] of right) {
      if (++budget.products > POLYNOMIAL_LIMITS.products) throw new PolynomialLimitError("Product limit");
      const [lx, ly] = degrees(leftKey),
        [rx, ry] = degrees(rightKey);
      if (lx + ly + rx + ry > POLYNOMIAL_LIMITS.degree) throw new PolynomialLimitError("Degree limit");
      const key = `${lx + rx},${ly + ry}`;
      put(result, key, (result.get(key) ?? BigInt(0)) + leftValue * rightValue);
    }
  return result;
}
export const isZero = (value: Polynomial): boolean => value.size === 0;
export const constantValue = (value: Polynomial): bigint | null =>
  value.size === 0 ? BigInt(0) : value.size === 1 && value.has("0,0") ? value.get("0,0")! : null;
export const signature = (value: Polynomial): string =>
  [...value]
    .sort(([left], [right]) => compare(left, right))
    .map(([key, coefficient]) => `${key}:${coefficient}`)
    .join(";");
export const equals = (left: Polynomial, right: Polynomial): boolean => signature(left) === signature(right);
export function formatPolynomial(value: Polynomial): string {
  const terms = [...value].sort(([left], [right]) => compare(left, right));
  if (!terms.length) return "0";
  return terms
    .map(([key, coefficient], index) => {
      const [x, y] = degrees(key);
      const variables = [
        ["x", x],
        ["y", y],
      ]
        .map(([name, degree]) => (degree ? `${name}${degree === 1 ? "" : `^${degree}`}` : ""))
        .join("");
      const magnitude = abs(coefficient);
      const term = `${magnitude === BigInt(1) && variables ? "" : magnitude}${variables}`;
      return `${coefficient < BigInt(0) ? (index ? " - " : "-") : index ? " + " : ""}${term}`;
    })
    .join("");
}
export function primitivePart(value: Polynomial): Polynomial {
  if (isZero(value)) return value;
  const content = [...value.values()].reduce((common, coefficient) => gcd(common, coefficient), BigInt(0));
  const leading = [...value.keys()].sort(compare)[0];
  const divisor = value.get(leading)! < BigInt(0) ? -content : content;
  return new Map([...value].map(([key, coefficient]) => [key, coefficient / divisor]));
}
export const primitiveSignature = (value: Polynomial): string => signature(primitivePart(value));

export function divides(
  divisor: Polynomial,
  dividend: Polynomial,
  budget: PolynomialBudget = polynomialBudget(),
): boolean | "unknown" {
  if (isZero(divisor)) return isZero(dividend);
  try {
    const normalizedDivisor = primitivePart(divisor);
    const divisorKey = [...normalizedDivisor.keys()].sort(compare)[0];
    const [dx, dy] = degrees(divisorKey);
    let remainder = primitivePart(dividend);
    while (!isZero(remainder)) {
      const key = [...remainder.keys()].sort(compare)[0];
      const [rx, ry] = degrees(key);
      if (rx < dx || ry < dy) return false;
      const leading = remainder.get(key)!;
      const divisorLeading = normalizedDivisor.get(divisorKey)!;
      const monomial = new Map([[`${rx - dx},${ry - dy}`, leading]]);
      remainder = primitivePart(
        subtract(multiply(remainder, constant(divisorLeading), budget), multiply(normalizedDivisor, monomial, budget)),
      );
    }
    return true;
  } catch (error) {
    if (error instanceof PolynomialLimitError) return "unknown";
    throw error;
  }
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === BigInt(0)) throw new Error("Zero rational denominator");
  const common = gcd(numerator, denominator);
  const sign = denominator < BigInt(0) ? -BigInt(1) : BigInt(1);
  return { numerator: (numerator / common) * sign, denominator: (denominator / common) * sign };
}
export function evaluate(value: Polynomial, point: RationalPoint): Fraction {
  const x = fraction(point.x.numerator, point.x.denominator),
    y = fraction(point.y.numerator, point.y.denominator);
  let result = fraction(BigInt(0), BigInt(1));
  for (const [key, coefficient] of value) {
    const [xDegree, yDegree] = degrees(key);
    const term = fraction(
      coefficient * x.numerator ** BigInt(xDegree) * y.numerator ** BigInt(yDegree),
      x.denominator ** BigInt(xDegree) * y.denominator ** BigInt(yDegree),
    );
    result = fraction(
      result.numerator * term.denominator + term.numerator * result.denominator,
      result.denominator * term.denominator,
    );
  }
  return result;
}
