/** Framework-free redaction audit shared by the unit and browser export tests. Returns the paths
 * that break a rule; an empty list means the value passes. */
const CREDENTIAL_KEY = /secret|token|api[-_]?key|authorization|password|bearer/i;
const LONG_STRING = 512;

/** Render identities (`display.token`, `renderToken`) are derived from the run ID and visit, not
 * credentials: `${runId}:initial`, `${runId}:stopped` or `JSON.stringify([runId, visitId, ...])`. */
function isRenderIdentity(key: string, value: unknown, runId: string) {
  return (
    (key === "token" || key === "renderToken") &&
    typeof value === "string" &&
    (value === `${runId}:initial` || value === `${runId}:stopped` || value.startsWith(`[${JSON.stringify(runId)},`))
  );
}

export function redactionViolations(value: unknown, runId: string): string[] {
  const violations: string[] = [];
  const visit = (node: unknown, path: string) => {
    if (typeof node === "string") {
      if (/^\s*data:/i.test(node)) violations.push(`${path}: data URL`);
      else if (node.length > LONG_STRING && /^[A-Za-z0-9+/_=-]+$/.test(node.replace(/[\r\n]+/g, "")))
        violations.push(`${path}: long base64-like string`);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    if (ArrayBuffer.isView(node) || node instanceof ArrayBuffer) {
      violations.push(`${path}: binary ${Object.prototype.toString.call(node)}`);
      return;
    }
    const entries = Object.entries(node);
    // A typed array serialized to JSON becomes an object keyed "0", "1", ...
    if (!Array.isArray(node) && entries.length > 16 && entries.every(([key]) => /^\d+$/.test(key)))
      violations.push(`${path}: serialized typed array`);
    for (const [key, nested] of entries) {
      const at = Array.isArray(node) ? `${path}[${key}]` : `${path}.${key}`;
      if (
        !Array.isArray(node) &&
        CREDENTIAL_KEY.test(key) &&
        nested !== null &&
        nested !== undefined &&
        nested !== "" &&
        !isRenderIdentity(key, nested, runId)
      )
        violations.push(`${at}: credential-like key carries a value`);
      visit(nested, at);
    }
  };
  visit(value, "$");
  return violations;
}
