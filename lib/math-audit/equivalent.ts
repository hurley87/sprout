import type { AlgebraExpression } from "./expression";
import { isZero, multiply, polynomialBudget, PolynomialLimitError, subtract } from "./polynomial";
import { reduceRational } from "./rational";

/** Compare rational functions exactly on their common domain. */
export function equivalentExpressions(previous: AlgebraExpression, proposed: AlgebraExpression): boolean | "unknown" {
  const left = reduceRational(previous),
    right = reduceRational(proposed);
  if (!left.ok || !right.ok) return "unknown";
  try {
    const budget = polynomialBudget();
    return isZero(
      subtract(
        multiply(left.numerator, right.denominator, budget),
        multiply(right.numerator, left.denominator, budget),
      ),
    );
  } catch (error) {
    if (error instanceof PolynomialLimitError) return "unknown";
    throw error;
  }
}
