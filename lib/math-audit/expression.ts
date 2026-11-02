import { boundedArray, exactObject } from "../calculus/math-expression";

/** Bounded integer expressions in x and y; parsing never repairs input. */
export type AlgebraExpression =
  | { readonly op: "number"; readonly value: number }
  | { readonly op: "variable"; readonly name: "x" | "y" }
  | { readonly op: "add"; readonly args: readonly AlgebraExpression[] }
  | { readonly op: "multiply"; readonly args: readonly AlgebraExpression[] }
  | { readonly op: "subtract"; readonly left: AlgebraExpression; readonly right: AlgebraExpression }
  | { readonly op: "divide"; readonly left: AlgebraExpression; readonly right: AlgebraExpression }
  | { readonly op: "negate"; readonly argument: AlgebraExpression }
  | { readonly op: "power"; readonly base: AlgebraExpression; readonly exponent: number };

export const ALGEBRA_EXPRESSION_LIMITS = { nodes: 128, depth: 16, operands: 8, integer: 999999, exponent: 12 } as const;
export type AlgebraParseResult =
  | { ok: true; expression: AlgebraExpression }
  | { ok: false; reason: "malformed" | "unsupported-operator" | "unsupported-variable" | "limit"; detail: string };

class ParseFailure extends Error {
  constructor(
    readonly reason: Exclude<AlgebraParseResult, { ok: true }>["reason"],
    detail: string,
  ) {
    super(detail);
  }
}

export function parseAlgebraExpression(value: unknown): AlgebraParseResult {
  let nodes = 0;
  function parse(input: unknown, depth: number): AlgebraExpression {
    if (++nodes > ALGEBRA_EXPRESSION_LIMITS.nodes || depth > ALGEBRA_EXPRESSION_LIMITS.depth)
      throw new ParseFailure("limit", "Expression size or depth limit");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected expression object");
    const descriptor = Object.getOwnPropertyDescriptor(input, "op");
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string")
      throw new Error("Missing operator");
    const op = descriptor.value;
    switch (op) {
      case "number": {
        const number = exactObject(input, ["op", "value"]).value;
        if (typeof number !== "number" || !Number.isSafeInteger(number)) throw new Error("Expected safe integer");
        if (Math.abs(number) > ALGEBRA_EXPRESSION_LIMITS.integer) throw new ParseFailure("limit", "Integer limit");
        return { op, value: number };
      }
      case "variable": {
        const name = exactObject(input, ["op", "name"]).name;
        if (typeof name !== "string") throw new Error("Expected variable name");
        if (name !== "x" && name !== "y")
          throw new ParseFailure("unsupported-variable", `Unsupported variable: ${name}`);
        return { op, name };
      }
      case "add":
      case "multiply": {
        const raw = exactObject(input, ["op", "args"]).args;
        if (Array.isArray(raw) && raw.length > ALGEBRA_EXPRESSION_LIMITS.operands)
          throw new ParseFailure("limit", "Operand limit");
        return { op, args: boundedArray(raw, ALGEBRA_EXPRESSION_LIMITS.operands, 2).map(arg => parse(arg, depth + 1)) };
      }
      case "subtract":
      case "divide": {
        const object = exactObject(input, ["op", "left", "right"]);
        return { op, left: parse(object.left, depth + 1), right: parse(object.right, depth + 1) };
      }
      case "negate":
        return { op, argument: parse(exactObject(input, ["op", "argument"]).argument, depth + 1) };
      case "power": {
        const object = exactObject(input, ["op", "base", "exponent"]);
        if (typeof object.exponent !== "number" || !Number.isSafeInteger(object.exponent))
          throw new Error("Expected integer exponent");
        if (Math.abs(object.exponent) > ALGEBRA_EXPRESSION_LIMITS.exponent)
          throw new ParseFailure("limit", "Exponent limit");
        return { op, base: parse(object.base, depth + 1), exponent: object.exponent };
      }
      default:
        if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("Expected plain object");
        throw new ParseFailure("unsupported-operator", `Unsupported operator: ${op}`);
    }
  }
  try {
    return { ok: true, expression: parse(value, 1) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof ParseFailure ? error.reason : "malformed",
      detail: error instanceof Error ? error.message : "Invalid expression",
    };
  }
}
