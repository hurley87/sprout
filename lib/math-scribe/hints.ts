import type { AlgebraExpression } from "../math-audit/expression";

export function conceptHint(expression: AlgebraExpression): string {
  if (expression.op !== "divide") return "What would you like to try next?";
  const numerator = expression.left;
  if (
    numerator.op === "subtract" &&
    numerator.left.op === "divide" &&
    numerator.right.op === "divide" &&
    JSON.stringify(numerator.left.right) !== JSON.stringify(numerator.right.right)
  )
    return "To add or subtract fractions, they need a common denominator.";
  if (numerator.op === "divide" || numerator.op === "subtract" || numerator.op === "add") {
    const hasFraction = (value: AlgebraExpression): boolean =>
      value.op === "divide" ||
      (value.op === "subtract" && (hasFraction(value.left) || hasFraction(value.right))) ||
      (value.op === "add" && value.args.some(hasFraction));
    if (hasFraction(numerator) && expression.right.op === "variable" && expression.right.name === "h")
      return "Dividing by h is the same as multiplying the denominator by h.";
  }
  const hasProduct = (value: AlgebraExpression): boolean =>
    value.op === "multiply" ||
    (value.op === "subtract" && (hasProduct(value.left) || hasProduct(value.right))) ||
    (value.op === "add" && value.args.some(hasProduct));
  const factors = (value: AlgebraExpression): AlgebraExpression[] =>
    value.op === "multiply" ? value.args.flatMap(factors) : value.op === "negate" ? factors(value.argument) : [value];
  if (
    factors(numerator).some(
      factor =>
        factor.op === "variable" &&
        factors(expression.right).some(other => other.op === "variable" && other.name === factor.name),
    )
  )
    return "Look for a factor that the whole numerator and the denominator share — and remember the stated restrictions.";
  if (hasProduct(numerator)) return "Try expanding the products in the numerator and combining like terms.";
  return "What would you like to try next?";
}
