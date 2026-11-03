import type { AlgebraExpression } from "./expression";

/** Render supported expressions as compact LaTeX that `readAlgebraLatex` reads back to
 * an equivalent expression: parentheses only where precedence needs them, and an
 * explicit `\cdot` wherever juxtaposition would merge digits or read as a mixed number.
 */
const SUM = 1,
  PRODUCT = 2,
  ATOM = 4;
const precedence = (e: AlgebraExpression): number =>
  e.op === "add" || e.op === "subtract"
    ? SUM
    : e.op === "multiply" || e.op === "negate" || (e.op === "number" && e.value < 0)
      ? PRODUCT
      : e.op === "power"
        ? 3
        : ATOM;
/** Leading minus sign: written in parentheses after `+`, `-` or another factor. */
const signed = (e: AlgebraExpression) => e.op === "negate" || (e.op === "number" && e.value < 0);
const wrap = (e: AlgebraExpression, minimum: number) =>
  precedence(e) < minimum ? `(${formatExpression(e)})` : formatExpression(e);

export function formatExpression(expression: AlgebraExpression): string {
  switch (expression.op) {
    case "number":
      return String(expression.value);
    case "variable":
      return expression.name;
    case "add":
      // A later negative term is parenthesized rather than written as `+-`.
      return expression.args
        .map((part, i) => (i && signed(part) ? `(${formatExpression(part)})` : formatExpression(part)))
        .join("+");
    case "subtract":
      return `${formatExpression(expression.left)}-${signed(expression.right) ? `(${formatExpression(expression.right)})` : wrap(expression.right, PRODUCT)}`;
    case "multiply":
      return expression.args
        .map((part, i) => {
          const text = signed(part) ? `(${formatExpression(part)})` : wrap(part, PRODUCT + 1);
          return i && /^(\d|\\frac)/.test(text) ? String.raw`\cdot ${text}` : text;
        })
        .join("");
    case "negate":
      return `-${wrap(expression.argument, 3)}`;
    case "divide":
      return String.raw`\frac{${formatExpression(expression.left)}}{${formatExpression(expression.right)}}`;
    case "power": {
      const exponent = String(expression.exponent);
      const base = expression.base.op === "variable" || (expression.base.op === "number" && expression.base.value >= 0);
      return `${base ? formatExpression(expression.base) : `(${formatExpression(expression.base)})`}^${exponent.length === 1 ? exponent : `{${exponent}}`}`;
    }
  }
}
