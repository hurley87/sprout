import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chromium: { launch: vi.fn() } }));
vi.mock("@playwright/test", () => ({ chromium: mocks.chromium }));
import { runLiveSession } from "../scripts/live/runner.mjs";

afterEach(() => vi.clearAllMocks());

function browserHarness() {
  let waitReject: ((reason: Error) => void) | undefined;
  let closeCalls = 0;
  let pageClosed = false;
  const page = {
    addInitScript: async () => {},
    goto: async () => {},
    evaluate: async () => ({ entries: [], now: 0 }),
    getByRole: () => ({ click: async () => {} }),
    waitForTimeout: (ms?: number) =>
      ms === 2000
        ? Promise.resolve()
        : new Promise((_, reject) => {
            waitReject = reject;
          }),
  };
  const context = { newPage: async () => page };
  const browser = {
    newContext: async () => context,
    version: () => "test-browser",
    close: async () => {
      closeCalls++;
      pageClosed = true;
      waitReject?.(new Error("browser closed at hard deadline"));
    },
  };
  return {
    browser,
    page,
    get closeCalls() {
      return closeCalls;
    },
    get pageClosed() {
      return pageClosed;
    },
  };
}

it("closes the browser at the opt-in whole-run hard deadline and runs cleanup/failure capture", async () => {
  const harness = browserHarness();
  mocks.chromium.launch.mockResolvedValue(harness.browser);
  let cleaned = false;
  let failure: unknown;
  await expect(
    runLiveSession({
      baseUrl: "http://127.0.0.1:3000",
      deadlineAt: Date.now() + 40,
      setupPage: async () => async () => {
        cleaned = true;
      },
      drive: async ({ page }: { page: ReturnType<typeof browserHarness>["page"] }) => page.waitForTimeout(),
      collect: async () => {},
      onFailure: async ({ error }: { error: Error }) => {
        failure = error;
      },
    }),
  ).rejects.toThrow("browser closed at hard deadline");
  expect(harness.pageClosed).toBe(true);
  expect(harness.closeCalls).toBeGreaterThanOrEqual(1);
  expect(cleaned).toBe(true);
  expect(String(failure)).toContain("browser closed at hard deadline");
});

it("clears the optional deadline after a quick run", async () => {
  const harness = browserHarness();
  mocks.chromium.launch.mockResolvedValue(harness.browser);
  await runLiveSession({
    baseUrl: "http://127.0.0.1:3000",
    deadlineAt: Date.now() + 30,
    setupPage: async () => async () => {},
    drive: async () => new Promise(resolve => setTimeout(resolve, 15)),
    collect: async () => {},
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(harness.closeCalls).toBe(1);
});
