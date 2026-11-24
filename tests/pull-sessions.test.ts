import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionArgs, sessionLocalPath } from "../scripts/pull-sessions.mjs";

describe("parseSessionArgs", () => {
  it("defaults to production", () => {
    expect(parseSessionArgs([]).prefix).toBe("sessions/production/");
  });

  it.each(["production", "preview", "development"])("accepts the %s environment", environment => {
    expect(parseSessionArgs(["--env", environment]).prefix).toBe(`sessions/${environment}/`);
  });

  it("narrows the prefix to a lesson", () => {
    expect(parseSessionArgs(["--lesson", "dino-car-crunch"]).prefix).toBe("sessions/production/dino-car-crunch/");
    expect(parseSessionArgs(["--env", "preview", "--lesson", "dino-car-crunch"]).prefix).toBe(
      "sessions/preview/dino-car-crunch/",
    );
  });

  it("supports all environments, including with a lesson filter", () => {
    expect(parseSessionArgs(["--all"])).toEqual({ prefix: "sessions/", lesson: undefined });
    expect(parseSessionArgs(["--all", "--lesson", "dino-car-crunch"])).toEqual({
      prefix: "sessions/",
      lesson: "dino-car-crunch",
    });
  });

  it.each([
    { args: ["--env", "staging"] },
    { args: ["--env"] },
    { args: ["--lesson"] },
    { args: ["--lesson", ""] },
    { args: ["--lesson", "../dino"] },
    { args: ["--all", "--env", "production"] },
    { args: ["--unknown"] },
    { args: ["production"] },
  ])("rejects $args", ({ args }) => {
    expect(() => parseSessionArgs(args)).toThrow();
  });
});

describe("sessionLocalPath", () => {
  const root = resolve("example-repo");

  it("mirrors the blob pathname under the repo", () => {
    const pathname = "sessions/production/dino-car-crunch/2026-11-24/01-02-03-runtime.json";
    expect(sessionLocalPath(root, pathname)).toBe(resolve(root, pathname));
  });

  it.each([
    "sessions/../report.json",
    "sessions/production/../report.json",
    "sessions/production/report..json",
    "/sessions/production/report.json",
    "other/production/report.json",
    "sessions-other/production/report.json",
    "sessions/production\\report.json",
    "sessions//report.json",
    "sessions/",
  ])("rejects %s", pathname => {
    expect(() => sessionLocalPath(root, pathname)).toThrow("Unsafe session pathname.");
  });
});
