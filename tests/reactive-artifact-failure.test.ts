import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const session = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../scripts/live/runner.mjs", () => ({ runLiveSession: session.run }));
import { runReactiveScenario } from "../scripts/live/reactive-runner.mjs";
const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
  vi.clearAllMocks();
});

it("retains placeholders and complete failure evidence when browser launch fails", async () => {
  const phase = "launch";
  const out = mkdtempSync(join(tmpdir(), "sprout-failure-"));
  dirs.push(out);
  session.run.mockRejectedValue(new Error(`${phase} original cause`));
  await expect(
    runReactiveScenario("test", { timeoutMs: 120000 }, { out, baseUrl: "http://127.0.0.1:3000", label: "test-2" }),
  ).rejects.toThrow(`${phase} original cause`);
  const read = (file: string) => readFileSync(join(out, "test-2", file), "utf8");
  expect(read("timeline.txt")).toContain("=== SCENARIO FAILED ===");
  expect(read("failure.txt")).toContain(`${phase} original cause`);
  expect(JSON.parse(read("diagnostics.json"))).toHaveProperty("unavailable");
  expect(JSON.parse(read("log.json"))).toMatchObject({
    scenario: {
      name: "test",
      label: "test-2",
      mode: "reactive",
      timeoutMs: 120000,
      baseUrl: "http://127.0.0.1:3000",
      startedAt: expect.any(String),
    },
  });
});

it("keeps the assertion cause when collection and later cleanup encounter failures", async () => {
  const out = mkdtempSync(join(tmpdir(), "sprout-failure-"));
  dirs.push(out);
  const page = {
    evaluate: vi.fn(async () => []),
    getByRole: vi.fn(() => ({ isVisible: async () => false })),
    getByText: vi.fn(() => ({
      click: async () => {
        throw new Error("diagnostics failed");
      },
    })),
  };
  session.run.mockImplementation(
    async ({
      drive,
      collect,
    }: {
      drive: (context: { page: typeof page; observer: object }) => Promise<void>;
      collect: (context: { page: typeof page; browser: { version: () => string } }) => Promise<void>;
    }) => {
      await drive({ page, observer: {} });
      await collect({ page, browser: { version: () => "fake" } });
      throw new Error("cleanup failed");
    },
  );
  await expect(
    runReactiveScenario(
      "test",
      {
        timeoutMs: 1000,
        run: async () => {
          throw new Error("original assertion evidence");
        },
      },
      { out, baseUrl: "http://127.0.0.1:3000" },
    ),
  ).rejects.toThrow("original assertion evidence");
  const read = (file: string) => readFileSync(join(out, "test", file), "utf8");
  expect(read("failure.txt")).toContain("original assertion evidence");
  expect(read("failure.txt")).not.toContain("cleanup failed");
  expect(read("timeline.txt")).toContain("original assertion evidence");
  expect(JSON.parse(read("diagnostics.json"))).toHaveProperty(
    "unavailable",
    expect.stringContaining("diagnostics failed"),
  );
});
