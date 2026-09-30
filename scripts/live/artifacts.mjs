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
  const evaluationTimeline = (summary.answerTimelines ?? [])
    .filter(row => row.evaluationSchedules?.length || row.evaluationRequestedAtMs !== undefined)
    .map(
      row =>
        `evaluation scene=${row.sceneIndex} revision=${row.transcriptRevision ?? "unknown"} answer=${JSON.stringify(row.answerVersion)}; path=${row.evaluationPath ?? "unavailable"}; schedules=${JSON.stringify(row.evaluationSchedules ?? [])}; changes=${JSON.stringify(row.evaluationScheduleChanges ?? [])}; stop=${row.microphoneStopAtMs ?? "unavailable"}ms usable=${row.microphoneStopUsable ?? "unavailable"} reason=${row.microphoneStopSelectionReason ?? "unavailable"}; timer fired=${row.evaluationTimerFiredAtMs ?? "unavailable"}ms; request=${row.evaluationRequestedAtMs ?? "unavailable"}ms${row.evaluationNotRequestedReason ? ` (not requested: ${row.evaluationNotRequestedReason})` : ""}; transcript arrival→request=${row.transcriptArrivalToRequestMs ?? "unavailable"}ms; request→result=${row.requestToResultMs ?? "unavailable"}ms; result→commit=${row.resultToCommitMs ?? "unavailable"}ms; result→release=${row.resultToReleaseMs ?? "unavailable"}ms; release→observed transcript=${row.releaseToObservedTranscriptMs ?? "unavailable"}ms; release→observed decoded-media activity=${row.releaseToObservedDecodedMediaMs ?? "unavailable"}ms; acoustic onset unavailable`,
    );
  const gateTimeline = (summary.answerTimelines ?? [])
    .filter(
      row =>
        row.gateObservations?.length ||
        row.applicationResponseReleasedAtMs !== undefined ||
        row.gateCancelledAtMs !== undefined ||
        row.responseGateRecoveryFailed,
    )
    .map(row => {
      const conditions = Object.entries(row.conditionDurationMs ?? {})
        .map(([condition, value]) => `${condition}=${value.durationMs}ms`)
        .join(", ");
      const terminal =
        row.applicationResponseReleasedAtMs !== undefined
          ? `released ${row.gateDecision ?? "decision unknown"}/${row.gateReleaseReason ?? "reason unknown"} at ${row.applicationResponseReleasedAtMs}ms; context sent ${row.gateContextSentAtMs ?? "unknown"}ms`
          : row.gateCancelledAtMs !== undefined
            ? `cancelled ${row.gateCancellationReason ?? "reason unknown"} at ${row.gateCancelledAtMs}ms`
            : row.gateSupersededAtMs !== undefined
              ? `identity superseded at ${row.gateSupersededAtMs}ms; output remained blocked for the revised answer`
              : "terminal gate evidence missing";
      const transcript =
        row.firstTranscriptObservedAfterReleaseAtMs === null
          ? "first transcript after release unobserved"
          : `first transcript observed after release at ${row.firstTranscriptObservedAfterReleaseAtMs}ms (application clock)`;
      const media = row.mediaAlreadyActiveAtRelease
        ? `decoded media already active at release (${row.mediaActivityStateAtRelease})`
        : row.firstDecodedMediaActivityAfterReleaseAtMs !== null
          ? `first decoded-media activity after release at ${row.firstDecodedMediaActivityAfterReleaseAtMs}ms`
          : `decoded-media activity after release unobserved (state at release: ${row.mediaActivityStateAtRelease}; signal: ${row.mediaActivitySignalStatus})`;
      const recovery = row.responseGateRecoveryFailed
        ? `recovery failed at ${row.responseGateRecoveryFailed.at}ms after ${row.responseGateRecoveryFailed.detail?.wait_ms ?? "unknown"}ms`
        : "no recovery-failed event";
      return `response gate scene=${row.sceneIndex} revision=${row.transcriptRevision ?? "unknown"} answer=${JSON.stringify(row.answerVersion)}; ${conditions || "condition durations unavailable"}; blocked union=${row.observedBlockedUnionMs ?? "unknown"}ms (condition intervals may overlap); ${terminal}; output quiet deadline updates=${row.outputQuietDeadlineUpdates?.length ?? 0}; blocked provider transcript observations=${row.blockedProviderOutputActivityCount ?? 0}; ${transcript}; ${media}; ${recovery}; audible onset/provider completion unobserved; transcript/media observations do not prove current-answer generation, acoustic delivery or completion`;
    });
  const mediaTransitions = (diagnostics?.events ?? [])
    .filter(event => event.type === "output.media_activity")
    .map(event => {
      const identity =
        event.detail?.scene_index !== undefined && event.detail?.answer_version !== undefined
          ? ` scene=${event.detail.scene_index} revision=${event.detail.transcript_revision ?? "unknown"} answer=${JSON.stringify(event.detail.answer_version)}`
          : " answer identity unavailable on transition";
      return `output.media_activity ${event.detail?.state ?? "unknown"} at ${event.at}ms (application session-relative clock; blocked=${event.detail?.output_blocked ?? "unknown"};${identity})`;
    });
  const recoveryFailures = (diagnostics?.events ?? [])
    .filter(event => event.type === "answer.response_gate_recovery_failed")
    .map(
      event =>
        `answer.response_gate_recovery_failed scene=${event.detail?.scene_index ?? "unknown"} revision=${event.detail?.transcript_revision ?? "unknown"} answer=${JSON.stringify(event.detail?.answer_version ?? "unknown")} at ${event.at}ms after ${event.detail?.wait_ms ?? "unknown"}ms (media=${event.detail?.output_media_activity ?? "unknown"})`,
    );
  const evidenceSummary = [
    ...(unavailable ? [unavailable] : []),
    ...(diagnostics?.unavailable ? [`diagnostics unavailable: ${diagnostics.unavailable}`] : []),
    ...(evaluationTimeline.length
      ? ["Evaluation timeline (application milliseconds since attempt createdAt):", ...evaluationTimeline]
      : []),
    ...(gateTimeline.length || mediaTransitions.length || recoveryFailures.length
      ? [
          "Response gate timeline (application session-relative clock):",
          ...gateTimeline,
          ...mediaTransitions,
          ...recoveryFailures,
        ]
      : []),
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
