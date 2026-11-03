import { exactObject } from "../calculus/math-expression";
import { parseAlgebraExpression, type AlgebraExpression } from "../math-audit/expression";
import { formatExpression } from "../math-audit/format";
import { getPart, listParts, replacePart, type PathStep } from "./parts";

/** Replace parts or lines, flip division, move powers, or set signs; never repair or choose a strategy. */
export type ScribeOperation =
  | { kind: "replace-part"; partId: string; expression: AlgebraExpression | number }
  | { kind: "replace-line"; expression: AlgebraExpression }
  | { kind: "division-to-reciprocal"; partId: string }
  | { kind: "negative-power-to-denominator"; partId: string }
  | { kind: "denominator-to-negative-power"; partId: string }
  | { kind: "set-sign"; partId: string; sign: "plus" | "minus" }
  | { kind: "non-unique"; name: "factor" | "expand" | "simplify" | "cancel" | "combine" | "other"; partId?: string };

export type OperationResult =
  | {
      ok: true;
      expression: AlgebraExpression;
      origin: "spoken-expression" | "scribed-operation";
      changed: { partId: string | null; description: string; before: string; after: string };
    }
  | {
      ok: false;
      reason: "unknown-part" | "not-applicable" | "needs-result" | "limit" | "invalid-operation";
      detail: string;
    };

const failure = (reason: Exclude<OperationResult, { ok: true }>["reason"], detail: string): OperationResult => ({
  ok: false,
  reason,
  detail,
});
const one: AlgebraExpression = { op: "number", value: 1 };
const text = (value: AlgebraExpression | number) =>
  typeof value === "number" ? String(value) : formatExpression(value);

function validate(value: unknown): ScribeOperation {
  if (!value || typeof value !== "object") throw new Error();
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  let keys: string[];
  switch (kind) {
    case "replace-part":
      keys = ["kind", "partId", "expression"];
      break;
    case "replace-line":
      keys = ["kind", "expression"];
      break;
    case "division-to-reciprocal":
    case "negative-power-to-denominator":
    case "denominator-to-negative-power":
      keys = ["kind", "partId"];
      break;
    case "set-sign":
      keys = ["kind", "partId", "sign"];
      break;
    case "non-unique":
      keys = Object.prototype.hasOwnProperty.call(value, "partId") ? ["kind", "name", "partId"] : ["kind", "name"];
      break;
    default:
      throw new Error();
  }
  const object = exactObject(value, keys);
  if (keys.includes("partId") && typeof object.partId !== "string") throw new Error();
  if (kind === "set-sign" && object.sign !== "plus" && object.sign !== "minus") throw new Error();
  if (
    kind === "non-unique" &&
    !["factor", "expand", "simplify", "cancel", "combine", "other"].includes(object.name as string)
  )
    throw new Error();
  if (kind === "replace-line" || kind === "replace-part") {
    if (typeof object.expression === "number" && kind === "replace-part") {
      if (!Number.isSafeInteger(object.expression)) throw new Error();
    } else {
      const parsed = parseAlgebraExpression(object.expression);
      if (!parsed.ok && parsed.reason !== "limit") throw new Error();
    }
  }
  return object as ScribeOperation;
}

export function describeOperation(operation: ScribeOperation): string {
  switch (operation.kind) {
    case "replace-part":
      return "Replaced the selected part";
    case "replace-line":
      return "Replaced the line";
    case "division-to-reciprocal":
      return "Flipped the divisor and changed division to multiplication";
    case "negative-power-to-denominator":
      return "Moved the negative power to the denominator";
    case "denominator-to-negative-power":
      return "Rewrote the denominator as a negative power";
    case "set-sign":
      return `Set the sign to ${operation.sign}`;
    case "non-unique":
      return "Asked for the student's result";
  }
}

export function applyOperation(current: AlgebraExpression, input: unknown): OperationResult {
  try {
    const operation = validate(input);
    const parsed = parseAlgebraExpression(current);
    if (!parsed.ok)
      return failure(parsed.reason === "limit" ? "limit" : "invalid-operation", "Invalid current expression");
    const expression = parsed.expression;
    const part =
      "partId" in operation && operation.partId !== undefined
        ? listParts(expression).find(item => item.id === operation.partId)
        : undefined;
    if (operation.kind === "non-unique") {
      const label = part ? ` ${part.description}` : " expression";
      const verb = {
        factor: "factored",
        expand: "expanded",
        simplify: "simplified",
        cancel: "result after cancelling",
        combine: "combined",
        other: "resulting",
      }[operation.name];
      return failure("needs-result", `Ask what the ${verb}${label} is.`);
    }
    if (operation.kind !== "replace-line" && !part) return failure("unknown-part", "The selected part was not found");
    const selectedPath: PathStep[] = part?.path ?? [];
    let path = selectedPath;
    let replacement: AlgebraExpression | number;
    const selected = getPart(expression, path)!;
    const parentPath = path.slice(0, -1);
    const parent = path.length ? getPart(expression, parentPath) : null;
    const last = path.at(-1);
    if (operation.kind === "replace-line" || operation.kind === "replace-part") replacement = operation.expression;
    else if (operation.kind === "division-to-reciprocal" || operation.kind === "denominator-to-negative-power") {
      const division =
        last?.child === "right" && parent && typeof parent !== "number" && parent.op === "divide"
          ? ((path = parentPath), parent)
          : selected;
      if (typeof division === "number" || division.op !== "divide")
        return failure("not-applicable", "Select a division or its denominator");
      const denominator = division.right;
      if (operation.kind === "division-to-reciprocal") {
        const inverse: AlgebraExpression =
          denominator.op === "divide"
            ? { op: "divide", left: denominator.right, right: denominator.left }
            : { op: "divide", left: one, right: denominator };
        replacement = { op: "multiply", args: [division.left, inverse] };
      } else {
        const power: AlgebraExpression =
          denominator.op === "power"
            ? { ...denominator, exponent: -denominator.exponent }
            : { op: "power", base: denominator, exponent: -1 };
        replacement =
          division.left.op === "number" && division.left.value === 1
            ? power
            : { op: "multiply", args: [division.left, power] };
      }
    } else if (operation.kind === "negative-power-to-denominator") {
      const power =
        last?.child === "exponent" && parent && typeof parent !== "number" && parent.op === "power"
          ? ((path = parentPath), parent)
          : selected;
      if (typeof power === "number" || power.op !== "power" || power.exponent >= 0)
        return failure("not-applicable", "Select a negative power or its exponent");
      const denominator: AlgebraExpression =
        power.exponent === -1 ? power.base : { ...power, exponent: -power.exponent };
      const powerParentPath = path.slice(0, -1),
        powerLast = path.at(-1);
      const powerParent = path.length ? getPart(expression, powerParentPath) : null;
      if (
        powerLast?.child === "args" &&
        powerParent &&
        typeof powerParent !== "number" &&
        powerParent.op === "multiply"
      ) {
        const remaining = powerParent.args.filter((_, index) => index !== powerLast.index);
        const numerator: AlgebraExpression =
          remaining.length === 1 ? remaining[0] : { op: "multiply", args: remaining };
        path = powerParentPath;
        replacement = { op: "divide", left: numerator, right: denominator };
      } else replacement = { op: "divide", left: one, right: denominator };
    } else {
      if (typeof selected === "number" || !parent || typeof parent === "number" || !last)
        return failure("not-applicable", "Select a term");
      if (parent.op === "subtract" && last.child === "right") {
        path = parentPath;
        replacement = operation.sign === "plus" ? { op: "add", args: [parent.left, parent.right] } : parent;
      } else if (
        (parent.op === "add" && last.child === "args") ||
        (parent.op === "subtract" && last.child === "left")
      ) {
        replacement =
          operation.sign === "minus"
            ? selected.op === "negate"
              ? selected
              : { op: "negate", argument: selected }
            : selected.op === "negate"
              ? selected.argument
              : selected;
      } else return failure("not-applicable", "Select a term");
    }
    const before = getPart(expression, path)!;
    const result = replacePart(expression, path, replacement);
    if (!result.ok)
      return failure(result.reason === "limit" ? "limit" : "invalid-operation", "Invalid or out-of-bounds replacement");
    const after = getPart(result.expression, path)!;
    return {
      ok: true,
      expression: result.expression,
      origin:
        operation.kind === "replace-part" || operation.kind === "replace-line"
          ? "spoken-expression"
          : "scribed-operation",
      changed: {
        partId: part?.id ?? null,
        description: part?.description ?? "whole line",
        before: text(before),
        after: text(after),
      },
    };
  } catch {
    return failure("invalid-operation", "Invalid operation");
  }
}
