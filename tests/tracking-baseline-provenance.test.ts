import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import dependencies from "./fixtures/issue-77-baseline/dependencies.json";
import { expect, it } from "vitest";

it("pins the exact pre-instrumentation reducer bytes after reversing only import relocation", () => {
  const relocated = readFileSync(new URL("./fixtures/issue-77-baseline/reducer.ts", import.meta.url), "utf8");
  const original = relocated
    .replace("// Pinned pre-instrumentation reducer; see README.md. Only relative import paths changed.\n", "")
    .replaceAll('"../../../lib/events"', '"../events"')
    .replace('"./proposal-parser"', '"../../../lib/lesson-runtime/conversation-state-classifier"')
    .replaceAll('from "../../../lib/lesson-runtime/', 'from "./');
  expect(createHash("sha256").update(original).digest("hex")).toBe(
    "4c6cfad2942257e8e9652d3423609d34dc6ef7639b781c5bc6d303e622267b04",
  );
});

it("pins the historical parser and remaining baseline runtime dependencies", () => {
  for (const [path, digest] of Object.entries(dependencies)) {
    const current = path === "lib/lesson-runtime/conversation-state-classifier.ts"
      ? readFileSync(new URL("./fixtures/issue-77-baseline/proposal-parser.ts", import.meta.url), "utf8")
        .replace('"../../../lib/lesson-runtime/lesson-definition"', '"./lesson-definition"')
      : readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    // A type-only authored policy option does not change the baseline's runtime dependencies.
    const bytes = path === "lib/lesson-runtime/lesson-definition.ts"
      ? current.replace('  /** Counting may accept learner answers independently of tutor confirmation. */\n  readonly answerAcceptance?: "learner_evidence";\n', "")
      : current;
    expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(digest);
  }
});
