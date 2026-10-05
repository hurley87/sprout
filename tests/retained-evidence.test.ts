import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { retainAttempt, RETENTION_LIMIT, ATTEMPT_BYTE_LIMIT } from "./helpers/retained-evidence";

it("retains two reruns across output cleanup and refuses overwrite, unsafe roots and quota without deletion", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "sprout-retention-"));
  const root = path.join(folder, "retained");
  const output = path.join(folder, "playwright");
  try {
    await mkdir(output);
    const first = await retainAttempt(
      root,
      { attemptId: "one", runtimeId: "runtime-one", scenario: "same" },
      { "report.json": "first" },
      output,
    );
    await rm(output, { recursive: true });
    await mkdir(output);
    const second = await retainAttempt(
      root,
      { attemptId: "two", runtimeId: "runtime-two", scenario: "same" },
      { "report.json": "second" },
      output,
    );
    expect(await readFile(path.join(first.directory, "report.json"), "utf8")).toBe("first");
    expect(JSON.parse(await readFile(second.index, "utf8"))).toMatchObject({
      runtimeId: "runtime-two",
      files: ["report.json"],
    });
    await expect(
      retainAttempt(root, { attemptId: "one", runtimeId: "runtime-one", scenario: "same" }, {}),
    ).rejects.toThrow();
    await expect(
      retainAttempt(output, { attemptId: "three", runtimeId: null, scenario: "same" }, {}, output),
    ).rejects.toThrow("outside");
    await expect(
      retainAttempt(
        root,
        { attemptId: "large", runtimeId: null, scenario: "same" },
        { "report.json": "x".repeat(ATTEMPT_BYTE_LIMIT + 1) },
      ),
    ).rejects.toThrow("8 MiB");
    for (let i = 2; i < RETENTION_LIMIT; i++) await mkdir(path.join(root, `reserved-${i}`));
    await expect(retainAttempt(root, { attemptId: "full", runtimeId: null, scenario: "same" }, {})).rejects.toThrow(
      "capacity",
    );
    expect((await readdir(root)).length).toBe(RETENTION_LIMIT);
    expect(await readFile(path.join(first.directory, "report.json"), "utf8")).toBe("first");
  } finally {
    await rm(folder, { recursive: true });
  }
});
