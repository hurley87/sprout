/** Bounded syntax, not a solver. Parsing neither normalizes nor repairs an attempt. */
export type MathExpression =
  | { readonly op: "number"; readonly value: number }
  | { readonly op: "variable"; readonly name: "x" }
  | { readonly op: "add" | "multiply"; readonly args: readonly MathExpression[] }
  | { readonly op: "subtract" | "divide" | "equal"; readonly left: MathExpression; readonly right: MathExpression }
  | { readonly op: "power"; readonly base: MathExpression; readonly exponent: number }
  | { readonly op: "negate" | "sin" | "cos" | "derivative"; readonly argument: MathExpression };

export const EXPRESSION_LIMITS = { nodes: 128, depth: 16, operands: 8, integer: 999999, exponent: 12 } as const;

/** JSON objects only; exact own keys prevent authority claims hiding in extra fields. */
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("Expected plain object");
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return typeof key !== "string" || !keys.includes(key) || !descriptor.enumerable || !("value" in descriptor);
    })
  ) {
    throw new Error("Unexpected or missing fields");
  }
  return value as Record<string, unknown>;
}

/** Dense JSON arrays only, including at runtime when input did not come from JSON. */
export function boundedArray(value: unknown, maximum: number, minimum = 1): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1 ||
    Array.from({ length: value.length }, (_, i) => i).some(
      i => !("value" in (Object.getOwnPropertyDescriptor(value, i) ?? {})),
    )
  ) {
    throw new Error("Invalid bounded array");
  }
  return value;
}

export function parseMathExpression(value: unknown): MathExpression {
  let nodes = 0;
  function parse(input: unknown, depth: number): MathExpression {
    if (++nodes > EXPRESSION_LIMITS.nodes || depth > EXPRESSION_LIMITS.depth) throw new Error("Expression limit");
    if (!input || typeof input !== "object") throw new Error("Missing expression");
    const op = (input as Record<string, unknown>).op;
    switch (op) {
      case "number": {
        const v = exactObject(input, ["op", "value"]).value;
        if (typeof v !== "number" || !Number.isSafeInteger(v) || Math.abs(v) > EXPRESSION_LIMITS.integer)
          throw new Error("Invalid integer");
        return { op, value: v };
      }
      case "variable":
        if (exactObject(input, ["op", "name"]).name !== "x") throw new Error("Unsupported variable");
        return { op, name: "x" };
      case "add":
      case "multiply": {
        const args = boundedArray(exactObject(input, ["op", "args"]).args, EXPRESSION_LIMITS.operands, 2);
        return { op, args: args.map(arg => parse(arg, depth + 1)) };
      }
      case "subtract":
      case "divide":
      case "equal": {
        const v = exactObject(input, ["op", "left", "right"]);
        return { op, left: parse(v.left, depth + 1), right: parse(v.right, depth + 1) };
      }
      case "power": {
        const v = exactObject(input, ["op", "base", "exponent"]);
        if (
          typeof v.exponent !== "number" ||
          !Number.isSafeInteger(v.exponent) ||
          Math.abs(v.exponent) > EXPRESSION_LIMITS.exponent
        )
          throw new Error("Invalid exponent");
        return { op, base: parse(v.base, depth + 1), exponent: v.exponent };
      }
      case "negate":
      case "sin":
      case "cos":
      case "derivative": {
        const v = exactObject(input, ["op", "argument"]);
        return { op, argument: parse(v.argument, depth + 1) };
      }
      default:
        throw new Error("Unsupported operator");
    }
  }
  return parse(value, 1);
}
