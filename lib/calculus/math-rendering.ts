import { renderToString } from "katex";
import { parseMathExpression, type MathExpression } from "./math-expression";

export type MathDisplay = { readonly latex: string; readonly text: string };
const group = (value: MathDisplay): MathDisplay => ({
  latex: `\\left(${value.latex}\\right)`,
  text: `open parenthesis ${value.text} close parenthesis`,
});
// Binding strength: sums < products < unary minus < powers < atoms and functions.
function precedence(e: MathExpression): number {
  switch (e.op) {
    case "add":
    case "subtract":
    case "equal":
      return 1;
    case "multiply":
    case "divide":
      return 2;
    case "negate":
      return 3;
    case "power":
      return 4;
    case "number":
      return e.value < 0 ? 3 : 5;
    default:
      return 5;
  }
}
const startsWithDigit = (latex: string) => /^[\d-]/.test(latex);

/** Only validated, bounded syntax enters the serializer. Parentheses appear only where
 * precedence needs them, so the display stays faithful without extra grouping.
 * No comparison normalization, solver, or provider-supplied LaTeX is involved.
 */
export function serializeMathExpression(input: unknown): MathDisplay {
  function child(e: MathExpression, minimum: number): MathDisplay {
    const value = render(e);
    return precedence(e) < minimum ? group(value) : value;
  }
  function render(e: MathExpression): MathDisplay {
    switch (e.op) {
      case "number": {
        const value = String(e.value);
        return { latex: value, text: value.startsWith("-") ? `negative ${value.slice(1)}` : value };
      }
      case "variable":
        return { latex: "x", text: "x" };
      case "add": {
        const args = e.args.map(arg => child(arg, 1));
        return {
          latex: args.map((arg, i) => (i && !arg.latex.startsWith("-") ? `+ ${arg.latex}` : arg.latex)).join(" "),
          text: args.map(arg => arg.text).join(" plus "),
        };
      }
      case "multiply": {
        const args = e.args.map((arg, i) => child(arg, i ? 4 : 3));
        // Juxtapose like handwriting (3x^2); a dot where digits would run together or
        // a factor would read as part of a trig argument.
        const dot = (i: number) =>
          i > 0 && (startsWithDigit(args[i].latex) || ["sin", "cos"].includes(e.args[i - 1].op));
        return {
          latex: args.map((arg, i) => (dot(i) ? `\\cdot ${arg.latex}` : arg.latex)).join(" "),
          text: args.map(arg => arg.text).join(" times "),
        };
      }
      case "subtract":
      case "equal": {
        const left = child(e.left, 1),
          right = child(e.right, e.op === "subtract" ? 2 : 1);
        return {
          latex: `${left.latex} ${e.op === "subtract" ? "-" : "="} ${right.latex}`,
          text: `${left.text} ${e.op === "subtract" ? "minus" : "equals"} ${right.text}`,
        };
      }
      case "divide": {
        const left = render(e.left),
          right = render(e.right);
        return {
          latex: `\\frac{${left.latex}}{${right.latex}}`,
          text: `fraction with numerator ${group(left).text} and denominator ${group(right).text} end fraction`,
        };
      }
      case "power": {
        const base = child(e.base, 5);
        return {
          latex: `${base.latex}^{${e.exponent}}`,
          text: `${base.text} to the power ${e.exponent < 0 ? `negative ${-e.exponent}` : e.exponent}`,
        };
      }
      case "negate": {
        const arg = child(e.argument, 3);
        return { latex: `-${arg.latex}`, text: `negative ${arg.text}` };
      }
      case "sin":
      case "cos":
      case "derivative": {
        const arg = e.argument.op === "variable" ? render(e.argument) : group(render(e.argument));
        return {
          latex: `${e.op === "derivative" ? "\\frac{d}{dx}" : `\\${e.op}`} ${arg.latex}`,
          text: `${e.op === "derivative" ? "derivative with respect to x of" : e.op === "sin" ? "sine of" : "cosine of"} ${arg.text}`,
        };
      }
    }
  }
  return render(parseMathExpression(input));
}

/** Never use KaTeX error HTML or interpolate an exception into markup. The only
 * HTML returned here is successful KaTeX output from our finite AST vocabulary.
 */
export function renderMathExpression(
  input: unknown,
): { readonly ok: true; readonly html: string; readonly text: string } | { readonly ok: false; readonly text: string } {
  let display: MathDisplay;
  try {
    display = serializeMathExpression(input);
  } catch {
    return { ok: false, text: "Equation unavailable: invalid or unsupported expression." };
  }
  try {
    return {
      ok: true,
      text: display.text,
      html: renderToString(display.latex, {
        output: "html",
        displayMode: false,
        trust: false,
        strict: "error",
        throwOnError: true,
        maxExpand: 100,
        maxSize: 20,
        macros: {},
      }),
    };
  } catch {
    return { ok: false, text: `Equation formatting unavailable. ${display.text}` };
  }
}
