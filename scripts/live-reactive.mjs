/** One billed reactive smoke: observe Sprout, synthesize One!, await real evaluation. */
import { mkdirSync, writeFileSync } from "node:fs";
import { runLiveSession } from "./live/runner.mjs";
import { setupSyntheticMicrophone } from "./live/microphone.mjs";
import { createSimulatedChild } from "./live/child.mjs";
import { exportArtifacts } from "./live/artifacts.mjs";

const dir = process.env.LIVE_OUT ?? "test-results/live-reactive";
mkdirSync(dir, { recursive: true });
let child;
let failure;
const result = await runLiveSession({
  baseUrl: process.env.BASE_URL ?? "http://127.0.0.1:3000",
  browserArgs: ["--autoplay-policy=no-user-gesture-required"],
  setupPage: async page => {
    const cleanup = await setupSyntheticMicrophone(page);
    child = createSimulatedChild({ page });
    return async () => {
      try {
        await child.close();
      } finally {
        await cleanup();
      }
    };
  },
  drive: async ({ page, observer }) => {
    try {
      const turn = await observer.waitForSproutTurnEnd();
      await page.evaluate(turn => {
        window.__liveLog.push({ dir: "child", action: "observed-turn-end", at: window.__liveNow(), turn });
      }, turn);
      const after = await observer.checkpoint();
      await child.say("One!");
      const evaluation = await observer.waitForEvaluation({ after });
      const log = await page.evaluate(() => window.__liveLog);
      const synthesis = log.find(e => e.dir === "child" && e.action === "synthesis-start");
      const heard = log
        .filter(e => e.dir === "in" && e.type === "session.input_transcript.delta" && e.at >= synthesis.at)
        .map(e => e.delta)
        .join("");
      if (
        !/\b(one|1)\b/i.test(heard) ||
        !/\b(one|1)\b/i.test(evaluation.utterance) ||
        !Number.isFinite(evaluation.probability)
      )
        throw new Error(
          `Reactive speech was not transcribed and evaluated successfully: ${JSON.stringify({ heard, evaluation })}`,
        );
    } catch (error) {
      failure = error;
      writeFileSync(`${dir}/failure.txt`, String(error));
    } finally {
      const end = page.getByRole("button", { name: "End lesson" });
      if (await end.isVisible()) await end.click();
    }
  },
  collect: ({ page, browser }) =>
    exportArtifacts({
      page,
      browser,
      dir,
      label: "reactive-one",
      scenario: { mode: "reactive", text: "One!" },
      micScript: "runtime child.say after observer turn-end (transcript approximation)",
    }),
});
console.log(result);
if (failure) throw failure;
