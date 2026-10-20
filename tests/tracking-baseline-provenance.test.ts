import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import dependencies from "./fixtures/issue-77-baseline/dependencies.json";
import { expect, it } from "vitest";

it("pins the exact pre-instrumentation reducer bytes after reversing only import relocation", () => {
  const relocated = readFileSync(new URL("./fixtures/issue-77-baseline/reducer.ts", import.meta.url), "utf8");
  const original = relocated
    .replace("// Pinned pre-instrumentation reducer; see README.md. Only relative import paths changed.\n", "")
    .replaceAll('"../../../lib/events"', '"../events"')
    .replaceAll('from "../../../lib/lesson-runtime/', 'from "./');
  expect(createHash("sha256").update(original).digest("hex")).toBe(
    "4c6cfad2942257e8e9652d3423609d34dc6ef7639b781c5bc6d303e622267b04",
  );
});

it("uses unchanged transitive baseline dependencies rather than a second application tree", () => {
  for (const [path, digest] of Object.entries(dependencies)) {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(digest);
  }
});
