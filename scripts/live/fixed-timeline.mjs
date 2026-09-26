import { mkdirSync } from "node:fs";
import { buildMicTrack } from "./audio.mjs";
import { exportArtifacts } from "./artifacts.mjs";
import { runLiveSession } from "./runner.mjs";

/** Adapts the original scripted scenarios to the reusable session runner. */
export async function runFixedTimeline(name, scenario, { out, baseUrl, label = name }) {
  const dir = `${out}/${label}`;
  mkdirSync(dir, { recursive: true });
  const wav = buildMicTrack(dir, scenario);
  return runLiveSession({
    baseUrl,
    browserArgs: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
    drive: async ({ page }) => {
      const endButton = page.getByRole("button", { name: "End lesson" });
      const deadline = Date.now() + scenario.seconds * 1000;
      while (Date.now() < deadline && (await endButton.isVisible())) await page.waitForTimeout(500);
      if (scenario.stop !== "none" && (await endButton.isVisible())) await endButton.click();
    },
    collect: ({ page, browser }) =>
      exportArtifacts({
        page,
        browser,
        dir,
        label,
        scenario,
        micScript: scenario.lines.map(([t, s]) => `${t}s "${s}"`).join(" | "),
      }),
  });
}
