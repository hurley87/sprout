import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const normalize = value =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
const outputQuestions = {
  "duck-friends": /how many .*ducks?/i,
  "butterfly-garden": /how many .*butterfl(?:y|ies)/i,
  picnic: /how many .*strawberr(?:y|ies)/i,
};
const assetFiles = {
  "ack-v1-hello-duck": "hello-duck.wav",
  "ack-v1-duck-friends": "duck-friends.wav",
  "ack-v1-butterfly-garden": "butterfly-garden.wav",
  "ack-v1-picnic": "picnic.wav",
  "ack-v1-pond": "pond.wav",
  "ack-v2-hello-duck-careful-count": "hello-duck-variation.wav",
  "ack-v2-duck-friends-fine-team": "duck-friends-variation.wav",
  "ack-v2-butterfly-garden-fluttering": "butterfly-garden-variation.wav",
  "ack-v2-picnic-careful-count": "picnic-variation.wav",
  "ack-v2-pond-waddling": "pond-variation.wav",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function analyzeTrial(dir, expectedSceneIndices) {
  const diagnostics = readJson(join(dir, "diagnostics.json"));
  const metadata = readJson(join(dir, "recording-metadata.json"));
  const transcriptDoc = readJson(join(dir, "recording-transcript.json"));
  const browserLog = readJson(join(dir, "log.json"));
  const segments = transcriptDoc.payload?.segments ?? transcriptDoc.segments ?? [];
  const events = diagnostics.events;
  const localPlayback = events.filter(
    event => event.type === "acknowledgment.playback" && event.detail?.type === "local_playback",
  );
  const firstLocal = localPlayback.find(event => event.detail.state === "started")?.detail;
  const recordingOffsetFromSessionClockMs = firstLocal
    ? metadata.startedAtPerformanceMs - firstLocal.sessionClockOrigin
    : undefined;
  const recordingStartAttemptMs = diagnostics.liveStartedAtMs + recordingOffsetFromSessionClockMs;
  const errors = [];
  const transitions = [];
  const scenes = [...new Set(localPlayback.map(event => event.detail.identity.evaluatedSceneIndex))].sort(
    (a, b) => a - b,
  );
  if (JSON.stringify(scenes) !== JSON.stringify(expectedSceneIndices))
    errors.push(
      `expected evaluated scenes ${JSON.stringify(expectedSceneIndices)}, observed ${JSON.stringify(scenes)}`,
    );
  if (
    existsSync(join(dir, "failure.txt")) ||
    (existsSync(join(dir, "timeline.txt")) &&
      readFileSync(join(dir, "timeline.txt"), "utf8").includes("=== SCENARIO FAILED ==="))
  )
    errors.push("saved scenario artifacts identify a failed run");

  for (const sceneIndex of scenes) {
    const states = localPlayback.filter(event => event.detail.identity.evaluatedSceneIndex === sceneIndex);
    const attempts = [...new Set(states.map(event => event.detail.identity.playbackAttemptId))];
    const completedAttempt = attempts.findLast(id =>
      states.some(event => event.detail.identity.playbackAttemptId === id && event.detail.state === "completed"),
    );
    const attemptStates = states.filter(event => event.detail.identity.playbackAttemptId === completedAttempt);
    const attempt = attemptStates[0]?.detail.identity.choreographyEpoch;
    const state = name => attemptStates.find(event => event.detail.state === name);
    const accepted = events.find(
      event => event.type === "evaluation.advancement_accepted" && event.detail.sceneIndex === sceneIndex,
    );
    const requested = state("requested");
    const ready = state("ready");
    const started = state("started");
    const mediaEnded = state("media_ended");
    const completed = state("completed");
    const commit = events.find(event => event.type === "advance.committed" && event.detail.scene_index === sceneIndex);
    const display = events.find(event => event.type === "advance.displayed" && event.detail.scene_index === sceneIndex);
    const replacementReady = events.find(
      event => event.type === "replacement.ready" && event.detail.scene_index === sceneIndex,
    );
    const dispatch = events.find(
      event => event.type === "replacement.instruction_sent" && event.detail.scene_index === sceneIndex,
    );
    if (
      ![accepted, requested, ready, started, mediaEnded, completed, commit, display, replacementReady, dispatch].every(
        Boolean,
      )
    ) {
      errors.push(`scene ${sceneIndex}: missing a required accepted/playback/commit/display/replacement/question fact`);
      continue;
    }
    const detail = completed.detail;
    if (!(
      Number.isFinite(detail.duration) &&
      detail.duration > 0 &&
      Number.isFinite(mediaEnded.detail.mediaTime) &&
      Math.abs(mediaEnded.detail.mediaTime - detail.duration) < 0.002 &&
      Number.isFinite(mediaEnded.detail.renderFence) &&
      mediaEnded.detail.renderFence > 0 &&
      Number.isFinite(detail.outputTimestamp?.contextTime) &&
      detail.outputTimestamp.contextTime >= detail.renderFence &&
      Number.isFinite(detail.outputTimestamp?.performanceTime) &&
      detail.outputTimestamp.performanceTime > 0
    ))
      errors.push(`scene ${sceneIndex}: missing positive finite natural-end/output-fence facts`);
    const assetFile = assetFiles[detail.assetId];
    const assetSha256 = assetFile
      ? createHash("sha256")
          .update(readFileSync(join("public/audio/acknowledgments", assetFile)))
          .digest("hex")
      : null;
    if (!assetSha256 || assetSha256 !== detail.assetSha256)
      errors.push(`scene ${sceneIndex}: selected asset bytes do not match the pinned public WAV`);
    const recordingClipStartMs = started.detail.sessionAtMs - recordingOffsetFromSessionClockMs;
    const recordingClipEndMs = mediaEnded.detail.sessionAtMs - recordingOffsetFromSessionClockMs;
    const clipSpeech = [];
    for (const speaker of new Set(segments.map(segment => segment.speaker))) {
      const text = segments
        .filter(
          segment =>
            segment.speaker === speaker &&
            segment.end * 1000 >= recordingClipStartMs - 200 &&
            segment.start * 1000 <= recordingClipEndMs + 200,
        )
        .map(segment => segment.text)
        .join(" ");
      if (normalize(text).includes(normalize(detail.text))) clipSpeech.push({ speaker, text });
    }
    if (!clipSpeech.length)
      errors.push(`scene ${sceneIndex}: selected clip sentence missing from its recorded playback window`);
    if (detail.outputTimestamp?.contextTime < detail.renderFence)
      errors.push(`scene ${sceneIndex}: output clock did not pass the render fence`);
    if (!(
      accepted.at <= requested.at &&
      requested.at <= ready.at &&
      ready.at <= started.at &&
      started.at < mediaEnded.at &&
      mediaEnded.at <= completed.at &&
      completed.at <= commit.at &&
      commit.at <= display.at &&
      display.at <= replacementReady.at &&
      replacementReady.at <= dispatch.at
    ))
      errors.push(`scene ${sceneIndex}: phase chronology is not monotonic`);

    const released = events.find(
      event =>
        event.type === "choreography.next_question_released" &&
        event.detail.questionToken === dispatch.detail.question_token,
    );
    const sceneId = released?.detail.display?.sceneId;
    const pattern = outputQuestions[sceneId];
    const dispatchAudioMs = dispatch.at - recordingStartAttemptMs;
    const displayAudioMs =
      (released?.detail.display?.displayedAtMs ?? Number.POSITIVE_INFINITY) - recordingOffsetFromSessionClockMs;
    const question = segments.find(
      segment =>
        segment.start * 1000 >= Math.max(dispatchAudioMs - 200, displayAudioMs) &&
        segment.start * 1000 <= dispatchAudioMs + 8_000 &&
        pattern?.test(segment.text),
    );
    if (!question)
      errors.push(
        `scene ${sceneIndex}: no independently transcribed ${sceneId ?? "next-scene"} question after display and dispatch`,
      );

    transitions.push({
      evaluatedSceneIndex: sceneIndex,
      evaluatedDisplay: detail.display?.sceneId,
      nextDisplay: sceneId,
      originSourceId: detail.identity.originSourceId,
      playbackSourceId: detail.identity.owningSourceId,
      replacementSourceId: replacementReady.detail.source_id,
      choreographyEpoch: attempt,
      playbackAttemptId: detail.identity.playbackAttemptId,
      selectedAssetId: detail.assetId,
      selectedAssetSha256: detail.assetSha256,
      selectedAssetFile: assetFile,
      selectedAssetBytesVerified: assetSha256 === detail.assetSha256,
      acceptedToStartedMs: started.at - accepted.at,
      assetFetchDecodeMs: ready.at - requested.at,
      localReadyToStartMs: started.at - ready.at,
      mediaDurationMs: mediaEnded.detail.mediaTime * 1000,
      outputFenceDrainMs: completed.at - mediaEnded.at,
      completedToCommitMs: commit.at - completed.at,
      commitToDisplayMs: display.at - commit.at,
      replacementReadyLatencyMs: replacementReady.detail.prepare_latency_ms,
      displayToReplacementReadyMs: replacementReady.at - display.at,
      replacementReadyToQuestionDispatchMs: dispatch.at - replacementReady.at,
      playbackAttempts: attempts.length,
      retries: Math.max(0, attempts.length - 1),
      replacementAttempts: events.filter(
        event => event.type === "replacement.triggered" && event.detail.scene_index === sceneIndex,
      ).length,
      replacementRetries: Math.max(
        0,
        events.filter(event => event.type === "replacement.triggered" && event.detail.scene_index === sceneIndex)
          .length - 1,
      ),
      recordedClipWindowMs: [recordingClipStartMs, recordingClipEndMs],
      recordingMatchedText: clipSpeech[0]?.text ?? null,
      independentlyTranscribedQuestion: question ? { startSeconds: question.start, text: question.text } : null,
      dispatchToTranscribedQuestionOnsetMs: question ? question.start * 1000 - dispatchAudioMs : null,
      outputFencePassed: detail.outputTimestamp?.contextTime >= detail.renderFence,
    });

    if (metadata.startedAtPageMs !== undefined && Number.isFinite(metadata.startedAtPageMs)) {
      const domScenes = (browserLog.log ?? []).filter(event => event.dir === "scene");
      const clipStartPageMs = metadata.startedAtPageMs + recordingClipStartMs;
      const clipEndPageMs = metadata.startedAtPageMs + recordingClipEndMs;
      const sceneBeforeClip = domScenes.filter(event => event.at <= clipStartPageMs).at(-1)?.scene;
      const sceneAtQuestion = question
        ? domScenes.filter(event => event.at <= metadata.startedAtPageMs + question.start * 1000).at(-1)?.scene
        : null;
      const interveningScene = domScenes.find(event => event.at > clipStartPageMs && event.at < clipEndPageMs);
      const domAlignmentPassed =
        sceneBeforeClip === detail.display.sceneId && !interveningScene && sceneAtQuestion === sceneId;
      transitions.at(-1).domRecordingAlignment = {
        status: domAlignmentPassed ? "verified" : "failed",
        clock: "recording start performance.now mapped to live page-relative clock",
        oldSceneDuringClip: sceneBeforeClip,
        nextSceneAtRecordedQuestion: sceneAtQuestion,
        interveningSceneChangeDuringClip: interveningScene ?? null,
      };
      if (!domAlignmentPassed)
        errors.push(`scene ${sceneIndex}: recorded clip/question does not align with observed DOM scene intervals`);
    } else {
      transitions.at(-1).domRecordingAlignment = {
        status: "unavailable",
        note: "This first run predates the saved recording-start page-clock bridge; app/recording alignment is analyzed on the canonical session/performance clocks only.",
      };
    }
  }

  const recordingBytes = readFileSync(join(dir, "session-recording.webm"));
  const hash = createHash("sha256").update(recordingBytes).digest("hex");
  if (hash !== metadata.sha256) errors.push("recording SHA-256 does not match capture metadata");
  const transcribedHash = transcriptDoc.audioSha256 ?? transcriptDoc.recordingSha256;
  if (transcribedHash !== hash) errors.push("independent transcription is not bound to this recording SHA-256");
  const resourcePath = join(dir, "acknowledgment-resource-timing.json");
  const resources = existsSync(resourcePath) ? readJson(resourcePath).resources : null;
  return {
    label: dir.split("/").slice(-2).join("/"),
    mode: diagnostics.model,
    createdAt: diagnostics.createdAt,
    browser: diagnostics.browser,
    recordingDurationMs: metadata.stoppedAtPerformanceMs - metadata.startedAtPerformanceMs,
    recording: {
      path: join(dir, "session-recording.webm"),
      mimeType: metadata.mimeType,
      bytes: metadata.bytes,
      sha256: hash,
    },
    independentTranscription: {
      model: transcriptDoc.model ?? "gpt-4o-transcribe-diarize",
      segments: segments.length,
      audioSha256: transcribedHash,
      boundToRecordingSha256: transcribedHash === hash,
      hashBinding: transcriptDoc.transcriptionRecordBinding ?? "audio hash captured alongside the transcription result",
    },
    appDurableRecordingStatus: "not established by these artifacts; local harness capture retained",
    recordingOffsetFromSessionClockMs,
    recordingStartAttemptMs,
    acknowledgmentPreloadResources: resources,
    transitions,
    errors,
    passed: errors.length === 0,
  };
}

export function analyzeIssue47(root = "test-results/issue-47") {
  const cases = [
    ["live-trial-1", "issue47-four-scene", [0, 1, 2]],
    ["live-trial-2", "issue47-four-scene", [0, 1, 2]],
    ["live-trial-3", "interruption", [0]],
  ];
  const trials = cases.map(([parent, child, expected]) => analyzeTrial(join(root, parent, child), expected));
  const report = {
    generatedAt: new Date().toISOString(),
    clockNote:
      "Provider transcript offsets are excluded from recording alignment. ASR segment times are recording-relative estimates; local app session, browser performance, and provider clocks remain distinct.",
    trials,
  };
  writeFileSync(join(root, "analysis-summary.json"), JSON.stringify(report, null, 2));
  return trials;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const trials = analyzeIssue47(process.argv[2] ?? "test-results/issue-47");
  console.log(
    JSON.stringify(
      trials.map(trial => ({
        label: trial.label,
        passed: trial.passed,
        recordingDurationMs: trial.recordingDurationMs,
        transitions: trial.transitions.length,
        errors: trial.errors,
      })),
      null,
      2,
    ),
  );
  if (trials.some(trial => !trial.passed)) process.exitCode = 1;
}
