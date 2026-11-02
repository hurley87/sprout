import type { AlgebraExpression } from "./expression";

/** Render supported expressions without relying on implicit precedence. */
export function formatExpression(expression: AlgebraExpression): string {
  switch (expression.op) {
    case "number":
      return String(expression.value);
    case "variable":
      return expression.name;
    case "add":
      return expression.args.map(part => `(${formatExpression(part)})`).join("+");
    case "multiply":
      return expression.args.map(part => `(${formatExpression(part)})`).join(String.raw`\times `);
    case "subtract":
      return `(${formatExpression(expression.left)})-(${formatExpression(expression.right)})`;
    case "divide":
      return String.raw`\frac{${formatExpression(expression.left)}}{${formatExpression(expression.right)}}`;
    case "negate":
      return `-(${formatExpression(expression.argument)})`;
    case "power":
      return `(${formatExpression(expression.base)})^{${expression.exponent}}`;
  }
}
