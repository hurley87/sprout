import { copyFileSync, writeFileSync } from "node:fs";
import { metrics } from "./metrics.mjs";

/** Merges transcript deltas into speaker turns (provider clock) between app events (page clock). */
export function timeline(name, micScript, log) {
  const rows = [];
  let turn = null;
  const flush = () => {
    if (turn) rows.push(`${(turn.start / 1000).toFixed(1).padStart(6)}s ${turn.who}: ${turn.text.trim()}`);
    turn = null;
  };
  for (const e of log) {
    if (e.type === "session.input_transcript.delta" || e.type === "session.output_transcript.delta") {
      const who = e.type.includes("input") ? "CHILD " : "SPROUT";
      if (!turn || turn.who !== who || e.start_ms - turn.end > 1200) {
        flush();
        turn = { who, start: e.start_ms, end: e.end_ms, text: "" };
      }
      turn.text += e.delta;
      turn.end = e.end_ms;
      continue;
    }
    flush();
    const page = `  [page ${(e.at / 1000).toFixed(1)}s]`;
    if (e.dir === "child")
      rows.push(
        `${page} CHILD ACTION ${e.action}${e.text ? ` "${e.text}"` : ""}${e.trackId ? ` track=${e.trackId}` : ""}`,
      );
    else if (e.dir === "scene") rows.push(`${page} SCENE -> ${e.scene}`);
    else if (e.dir === "evaluate")
      rows.push(
        `${page} JEV "${e.request.utterance}" @scene ${e.request.sceneIndex} -> ${e.answer?.probability ?? "no answer"} in ${e.at - e.askedAt}ms`,
      );
    else if (e.dir === "out")
      rows.push(`${page} APP -> ${e.type}${e.content ? `: ${String(e.content).slice(0, 90)}` : ""}`);
    else if (["session.delegation.created", "session.closed", "error"].includes(e.type))
      rows.push(`${page} LIVE -> ${e.type} ${JSON.stringify(e.delegation ?? e.reason ?? e.error ?? "")}`);
  }
  flush();
  return [`# ${name}`, `mic script: ${micScript}`, ...rows].join("\n");
}

/** Exports the collected session evidence; scenario is opaque log metadata. */
export async function exportArtifacts({ page, browser, dir, label, scenario, micScript }) {
  const log = await page.evaluate(() => window.__liveLog);
  const summary = metrics(log);
  const text = [timeline(label, micScript, log), `metrics: ${JSON.stringify(summary)}`].join("\n");
  writeFileSync(`${dir}/log.json`, JSON.stringify({ browser: browser.version(), scenario, summary, log }, null, 2));
  writeFileSync(`${dir}/timeline.txt`, text);
  await page.getByText("Parent testing notes").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download attempt diagnostics" }).click();
  copyFileSync(await (await downloadPromise).path(), `${dir}/diagnostics.json`);
  return text;
}
