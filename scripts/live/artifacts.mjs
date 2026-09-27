import { copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { LiveEventJournal } from "./observer.mjs";
import { metrics } from "./metrics.mjs";

/** Merges transcript deltas into speaker turns (provider clock) between app events (page clock). */
export function timeline(name, micScript, log, failure) {
  const rows = [];
  let turn = null;
  let scene = null;
  const journal = new LiveEventJournal();
  let cursor = 0;
  const flush = () => {
    if (turn) rows.push(`[provider ${(turn.start / 1000).toFixed(2)}s] ${turn.who}: ${turn.text.trim()}`);
    turn = null;
  };
  for (const e of log) {
    journal.ingest([e], e.at);
    for (const observed of journal.events.slice(cursor)) {
      if (observed.kind === "turn-start" || observed.kind === "turn-end") {
        flush();
        rows.push(
          `[page ${(observed.at / 1000).toFixed(2)}s] SPROUT TURN ${observed.kind === "turn-start" ? "START" : "END"}${observed.reason ? ` (${observed.reason}; approximate)` : " (transcript observed)"}`,
        );
      }
    }
    cursor = journal.events.length;
    if (e.type === "session.input_transcript.delta" || e.type === "session.output_transcript.delta") {
      const who = e.type.includes("input") ? "CHILD TRANSCRIPT" : "SPROUT";
      if (!turn || turn.who !== who || e.start_ms - turn.end > 1200) {
        flush();
        turn = { who, start: e.start_ms, end: e.end_ms, text: "" };
      }
      turn.text += e.delta;
      turn.end = e.end_ms;
      continue;
    }
    flush();
    const page = `  [page ${(e.at / 1000).toFixed(2)}s]`;
    if (e.dir === "scenario") rows.push(`${page} SCENARIO ${e.action} ${e.scenario}${e.error ? `: ${e.error}` : ""}`);
    else if (e.dir === "ui") rows.push(`${page} SESSION ${e.live ? "live" : "ended"}`);
    else if (e.dir === "child") {
      const labels = {
        "child.action.started": "ACTION START",
        "child.action.finished": "ACTION END",
        "child.action.failed": "ACTION FAILED",
        "synthesis-start": "SYNTHESIS START",
        "synthesis-end": "SYNTHESIS END",
        "playback-start": "PLAYBACK START",
        "playback-end": "PLAYBACK END",
      };
      const details = [
        e.type,
        ...["scene", "expected", "answer", "durationMs"]
          .filter(key => e[key] !== undefined)
          .map(key => `${key}=${e[key]}`),
        e.text !== undefined ? `text=${JSON.stringify(e.text)}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      rows.push(`${page} CHILD ${labels[e.action] ?? e.action} ${details}${e.error ? ` error=${e.error}` : ""}`);
    } else if (e.dir === "scene") {
      if (scene !== e.scene) rows.push(`${page} SCENE ${scene ?? "∅"} → ${e.scene ?? "∅"}`);
      scene = e.scene;
    } else if (e.dir === "evaluate")
      rows.push(
        `${page} JEV "${e.request.utterance}" @scene ${e.request.sceneIndex} -> ${e.answer?.probability ?? "no answer"} in ${e.at - e.askedAt}ms`,
      );
    else if (e.dir === "out")
      rows.push(`${page} APP -> ${e.type}${e.content ? `: ${String(e.content).slice(0, 90)}` : ""}`);
    else if (["session.delegation.created", "session.closed", "error"].includes(e.type))
      rows.push(`${page} LIVE -> ${e.type} ${JSON.stringify(e.delegation ?? e.reason ?? e.error ?? "")}`);
  }
  flush();
  const failures = log.filter(e => e.dir === "scenario" && e.error);
  return [
    `# ${name}`,
    `mic script: ${micScript}`,
    "Clocks: page = browser arrival; provider = approximate transcript timing. Origins are independent.",
    ...rows,
    ...((failure ?? failures[0]?.error) ? ["=== SCENARIO FAILED ===", failure ?? failures[0].error] : []),
  ].join("\n");
}

/** Exports the collected session evidence; scenario is opaque log metadata. */
export async function exportArtifacts({ page, browser, dir, label, scenario, micScript, failure }) {
  let log = [];
  let unavailable;
  try {
    log = (await page.evaluate(() => window.__liveLog)) ?? [];
  } catch (error) {
    unavailable = `Browser evidence unavailable: ${error}`;
  }
  let text = timeline(label, micScript, log, failure);
  let diagnostics = null;
  // Always leave a diagnostics file, even when startup/download fails.
  writeFileSync(
    `${dir}/diagnostics.json`,
    JSON.stringify({ unavailable: "Attempt diagnostics download not completed" }, null, 2),
  );
  try {
    await page.getByText("Parent testing notes").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download attempt diagnostics" }).click(),
    ]);
    copyFileSync(await download.path(), `${dir}/diagnostics.json`);
    diagnostics = JSON.parse(readFileSync(`${dir}/diagnostics.json`, "utf8"));
    if (typeof diagnostics.ending === "string") {
      const ending = `APPLICATION SESSION END reason=${diagnostics.ending} (diagnostics; no browser timestamp)`;
      text = text.includes("=== SCENARIO FAILED ===")
        ? text.replace("=== SCENARIO FAILED ===", `${ending}\n=== SCENARIO FAILED ===`)
        : `${text}\n${ending}`;
      writeFileSync(`${dir}/timeline.txt`, text);
    }
  } catch (error) {
    writeFileSync(
      `${dir}/diagnostics.json`,
      JSON.stringify({ unavailable: `UI diagnostics export failed: ${error}` }, null, 2),
    );
    diagnostics = { unavailable: `UI diagnostics export failed: ${error}` };
  }
  const summary = metrics(log, diagnostics);
  const evidenceSummary = [
    ...(unavailable ? [unavailable] : []),
    ...(diagnostics?.unavailable ? [`diagnostics unavailable: ${diagnostics.unavailable}`] : []),
    `metrics: ${JSON.stringify(summary)}`,
  ].join("\n");
  text = text.includes("=== SCENARIO FAILED ===")
    ? text.replace("=== SCENARIO FAILED ===", `${evidenceSummary}\n=== SCENARIO FAILED ===`)
    : `${text}\n${evidenceSummary}`;
  writeFileSync(
    `${dir}/log.json`,
    JSON.stringify({ browser: browser.version(), scenario, summary, log, unavailable }, null, 2),
  );
  writeFileSync(`${dir}/timeline.txt`, text);
  return text;
}
