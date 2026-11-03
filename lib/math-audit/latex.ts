import { ALGEBRA_EXPRESSION_LIMITS, parseAlgebraExpression, type AlgebraExpression } from "./expression";

/** Integers, x/y, +/-, products, slash/div, frac variants, groups and integer powers.
 * Slash/div chains or ungrouped right-hand juxtaposition, div followed by a product,
 * mixed numbers, separated digits and stacked powers are ambiguous. Flat sums and
 * products over eight operands return limit. Fractions and div are binary divide;
 * fraction div fraction is divide(divide(A,B),divide(C,D)), while fraction times
 * fraction is multiply(divide(A,B),divide(C,D)).
 */
export type LatexReadResult =
  | { ok: true; expression: AlgebraExpression }
  | { ok: false; reason: "ambiguous" | "unsupported" | "malformed" | "limit"; detail: string; position?: number };

type FailureReason = Exclude<LatexReadResult, { ok: true }>["reason"];
type Token = { kind: string; text: string; position: number; end: number };
class ReadFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    detail: string,
    readonly position: number,
  ) {
    super(detail);
  }
}

export function readAlgebraLatex(source: string): LatexReadResult {
  try {
    if (source.length > 2000) throw new ReadFailure("limit", "Source length limit", 2000);
    const tokens: Token[] = [];
    for (let position = 0; position < source.length;) {
      const start = position;
      const char = source[position];
      if (/\s/.test(char)) {
        position++;
        continue;
      }
      if (char === "\\") {
        position++;
        if (position < source.length && /[,;\s]/.test(source[position])) {
          position++;
          continue;
        }
        while (position < source.length && /[a-zA-Z]/.test(source[position])) position++;
        if (position === start + 1 && position < source.length) position++;
        const text = source.slice(start, position);
        const kind =
          (
            {
              "\\frac": "frac",
              "\\dfrac": "frac",
              "\\tfrac": "frac",
              "\\times": "*",
              "\\cdot": "*",
              "\\div": "div",
              "\\left": "left",
              "\\right": "right",
            } as Record<string, string>
          )[text] ?? "unsupported";
        tokens.push({ kind, text, position: start, end: position });
      } else if (/\d/.test(char)) {
        while (position < source.length && /\d/.test(source[position])) position++;
        tokens.push({ kind: "number", text: source.slice(start, position), position: start, end: position });
      } else {
        position++;
        const kind = char === "x" || char === "y" ? "variable" : "+-*/^(){}".includes(char) ? char : "unsupported";
        tokens.push({ kind, text: char, position: start, end: position });
      }
    }
    tokens.push({ kind: "end", text: "end of input", position: source.length, end: source.length });
    let index = 0;
    let depth = 0;
    const current = () => tokens[index];
    const fail = (reason: FailureReason, detail: string, token = current()): never => {
      throw new ReadFailure(reason, detail, token.position);
    };
    const take = (kind: string) => {
      if (current().kind === "unsupported") fail("unsupported", `Unsupported token: ${current().text}`);
      if (current().kind !== kind) fail("malformed", `Expected ${kind}, found ${current().text}`);
      return tokens[index++];
    };
    const startsAtom = (token: Token) => ["number", "variable", "(", "{", "left", "frac"].includes(token.kind);
    const combine = (op: "add" | "multiply", left: AlgebraExpression, right: AlgebraExpression): AlgebraExpression => {
      const args = left.op === op ? [...left.args, right] : [left, right];
      if (args.length > ALGEBRA_EXPRESSION_LIMITS.operands) fail("limit", "Operand limit");
      return { op, args };
    };
    const nested = (read: () => AlgebraExpression): AlgebraExpression => {
      if (++depth > ALGEBRA_EXPRESSION_LIMITS.depth) fail("limit", "Expression depth limit");
      const result = read();
      depth--;
      return result;
    };
    function group(open: "(" | "{", close: ")" | "}"): AlgebraExpression {
      take(open);
      const expression = nested(sum);
      take(close);
      return expression;
    }
    function atom(): AlgebraExpression {
      const token = current();
      if (token.kind === "unsupported") fail("unsupported", `Unsupported token: ${token.text}`);
      if (token.kind === "number") {
        index++;
        const value = Number(token.text);
        if (!Number.isSafeInteger(value) || value > ALGEBRA_EXPRESSION_LIMITS.integer)
          fail("limit", "Integer limit", token);
        return { op: "number", value };
      }
      if (token.kind === "variable") {
        index++;
        return { op: "variable", name: token.text as "x" | "y" };
      }
      if (token.kind === "(") return group("(", ")");
      if (token.kind === "{") return group("{", "}");
      if (token.kind === "left") {
        index++;
        take("(");
        const expression = nested(sum);
        take("right");
        take(")");
        return expression;
      }
      if (token.kind === "frac") {
        index++;
        const left = group("{", "}");
        const right = group("{", "}");
        return { op: "divide", left, right };
      }
      return fail("malformed", `Expected operand, found ${token.text}`);
    }
    function power(): AlgebraExpression {
      const base = atom();
      if (current().kind !== "^") return base;
      index++;
      const braced = current().kind === "{";
      if (braced) index++;
      let sign = 1;
      if (current().kind === "-" || current().kind === "+") {
        if (current().kind === "-") sign = -1;
        index++;
      }
      const token = current();
      if (token.kind !== "number") {
        if (["end", "}", ")"].includes(token.kind)) fail("malformed", "Missing exponent", token);
        fail("unsupported", `Unsupported exponent: ${token.text}`, token);
      }
      index++;
      const exponent = sign * Number(token.text);
      if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > ALGEBRA_EXPRESSION_LIMITS.exponent)
        fail("limit", "Exponent limit", token);
      if (braced && current().kind !== "}" && current().kind !== "end")
        fail("unsupported", `Unsupported exponent: ${current().text}`);
      if (braced) take("}");
      if (current().kind === "^") fail("ambiguous", "Stacked exponents require grouping");
      return { op: "power", base, exponent };
    }
    function unary(): AlgebraExpression {
      if (current().kind === "+" || current().kind === "-") {
        const negative = current().kind === "-";
        index++;
        const argument = nested(unary);
        return negative ? { op: "negate", argument } : argument;
      }
      return power();
    }
    function product(): AlgebraExpression {
      let result = unary();
      while (true) {
        const token = current();
        if (token.kind === "/" || token.kind === "div") {
          index++;
          const right = unary();
          if (
            startsAtom(current()) ||
            current().kind === "/" ||
            current().kind === "div" ||
            (token.kind === "div" && current().kind === "*")
          )
            fail("ambiguous", "Division extent requires grouping");
          result = { op: "divide", left: result, right };
        } else if (token.kind === "*" || startsAtom(token)) {
          const implicit = token.kind !== "*";
          const previous = tokens[index - 1];
          if (implicit && previous.kind === "number" && token.kind === "number")
            fail("ambiguous", "Separated digits are ambiguous", token);
          if (implicit && previous.kind === "number" && token.kind === "frac")
            fail("ambiguous", "Mixed-number notation is ambiguous", token);
          if (!implicit) index++;
          result = combine("multiply", result, unary());
        } else break;
      }
      return result;
    }
    function sum(): AlgebraExpression {
      let result = product();
      while (current().kind === "+" || current().kind === "-") {
        const operation = current().kind;
        index++;
        const right = product();
        result = operation === "+" ? combine("add", result, right) : { op: "subtract", left: result, right };
      }
      return result;
    }
    const expression = sum();
    if (current().kind === "unsupported") fail("unsupported", `Unsupported token: ${current().text}`);
    if (current().kind !== "end") fail("malformed", `Unexpected token: ${current().text}`);
    const parsed = parseAlgebraExpression(expression);
    if (!parsed.ok)
      return { ok: false, reason: parsed.reason === "limit" ? "limit" : "malformed", detail: parsed.detail };
    return parsed;
  } catch (error) {
    if (error instanceof ReadFailure)
      return { ok: false, reason: error.reason, detail: error.message, position: error.position };
    throw error;
  }
}
