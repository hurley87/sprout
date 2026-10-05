import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { installChildScenarios } from "../helpers/child-scenario";
import { defaultRetentionRoot } from "../helpers/retained-evidence";
import { createLessonRuntime } from "../../lib/lesson-runtime/lesson-runtime-reducer";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";

// Run this test twice with the same Playwright outputDir: old retained evidence must survive.
test("retained harness evidence survives repeated Playwright output cleanup", async ({ page }, info) => {
  const root = defaultRetentionRoot();
  const previous: { file: string; content: string }[] = [];
  for (const folder of await readdir(root).catch(() => [] as string[])) {
    const file = path.join(root, folder, "index.json");
    const content = await readFile(file, "utf8").catch(() => null);
    if (content && JSON.parse(content).scenario === "provider-free-retention") {
      previous.push({ file, content });
      for (const name of JSON.parse(content).files) {
        const artifact = path.join(root, folder, name);
        const payload = await readFile(artifact, "utf8").catch(() => null);
        if (payload !== null) previous.push({ file: artifact, content: payload });
      }
    }
  }
  const harness = await installChildScenarios(page, info);
  await page.route("**/retention-fixture", route =>
    route.fulfill({ contentType: "text/html", body: "<main>Offline retention fixture</main>" }),
  );
  await page.goto("/retention-fixture");
  const state = createLessonRuntime(crypto.randomUUID());
  await page.evaluate(value => {
    let nowMs = 0;
    const bridge: NonNullable<LessonObservationWindow["sproutLessonObservation"]> = {
      read: () => ({
        nowMs: ++nowMs,
        cursor: { runtimeId: value.runtimeId, offset: 0 },
        snapshot: {
          runtime: value,
          status: "ended",
          transcript: "",
          awaitingSteering: false,
          diagnostics: [],
          error: null,
          display: { nodeId: value.nodeId, sceneId: "hello-duck", token: "offline" },
        },
        events: [],
      }),
      report: () =>
        ({
          runtimeId: value.runtimeId,
          status: "ended",
          runtime: value,
          error: null,
          events: [],
        }) as unknown as ReturnType<NonNullable<LessonObservationWindow["sproutLessonObservation"]>["report"]>,
    };
    Object.defineProperty(window, "sproutLessonObservation", { configurable: true, value: bridge });
    const button = document.createElement("button");
    button.textContent = "Unlock retained audio";
    document.body.append(button);
  }, state);
  await page.getByRole("button", { name: "Unlock retained audio" }).click();
  try {
    const result = await harness.run("provider-free-retention", async child => {
      await child.checkpoint();
      await child.sayFixture("uh");
    });
    const retained = result.companion.retention!;
    expect(retained.runtimeId).toBe(state.runtimeId);
    const index = JSON.parse(await readFile(retained.index, "utf8"));
    expect(index).toMatchObject({ runtimeId: state.runtimeId, attemptId: result.companion.attemptId });
    expect(index.files).toEqual(["report.json", "timeline.txt", "harness.json"]);
    const saved = JSON.parse(await readFile(path.join(retained.directory, "harness.json"), "utf8"));
    expect(saved.outboundAudio.records.map((row: { boundary: string }) => row.boundary)).toEqual(["start", "ended"]);
    expect(saved.outboundAudio.records[0].runtimeId).toBe(state.runtimeId);
    for (const old of previous) expect(await readFile(old.file, "utf8")).toBe(old.content);
    await info.attach("retention-verification.json", {
      body: JSON.stringify({ previous: previous.map(row => row.file), retained }),
      contentType: "application/json",
    });
  } finally {
    await harness.dispose();
  }
});
