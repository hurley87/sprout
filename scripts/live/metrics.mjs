/**
 * Per-run numbers for the issue #3 comparison: what Jev was asked, how long it
 * took, and how closely the scene and Sprout's speech followed an advance.
 */
export function metrics(log, diagnostics = null) {
  const evaluations = log
    .filter(e => e.dir === "evaluate")
    .map(e => ({
      utterance: e.request.utterance,
      sceneIndex: e.request.sceneIndex,
      probability: e.answer?.probability ?? null,
      latencyMs: e.at - e.askedAt,
      askedAt: e.askedAt,
    }));
  const scenes = log.filter(e => e.dir === "scene" && e.scene);
  const childSpoke = log.filter(e => e.type === "session.input_transcript.delta");
  const sproutSpoke = log.filter(e => e.type === "session.output_transcript.delta");
  const sproutBetween = (from, to) =>
    sproutSpoke
      .filter(e => e.at > from && e.at <= to)
      .map(e => e.delta)
      .join("")
      .trim();
  const words = text => (text ? text.split(/\s+/).length : 0);
  // The seam: what Sprout said after the child's last word and before the app
  // told it the outcome. More than a brief acknowledgment means Sprout had
  // already started its next move and the app's instruction lands mid-turn.
  const decisions = evaluations.map((e, i) => {
    const spoke = childSpoke.findLast(d => d.at <= e.askedAt);
    const until = evaluations[i + 1]?.askedAt ?? Infinity;
    const told = log.find(
      o =>
        o.dir === "out" &&
        o.at >= e.askedAt &&
        o.at < until &&
        /just changed|has not changed/.test(String(o.content ?? "")),
    );
    const decidedAt = told?.at ?? log.find(r => r.dir === "evaluate" && r.askedAt === e.askedAt)?.at;
    const before = spoke && decidedAt ? sproutBetween(spoke.at, decidedAt) : "";
    const firstWord = spoke && sproutSpoke.find(d => d.at > spoke.at);
    return {
      utterance: e.utterance,
      outcome: told ? (String(told.content).includes("just changed") ? "advanced" : told.type) : "none",
      sproutBeforeDecision: before,
      sproutWordsBeforeDecision: words(before),
      // Last word heard to the first word Sprout says after it: the silence the child hears.
      speechToFirstWordMs: firstWord ? firstWord.at - spoke.at : null,
      speechToInstructionMs: spoke && told ? told.at - spoke.at : null,
    };
  });
  const advances = scenes.slice(1).map(scene => {
    // The evaluation that caused this scene is the last one before it.
    const cause = evaluations.findLast(e => e.askedAt <= scene.at);
    const spoke = cause ? childSpoke.findLast(e => e.at <= cause.askedAt) : undefined;
    const told = log.find(e => e.dir === "out" && e.at >= scene.at && String(e.content ?? "").includes("just changed"));
    return {
      scene: scene.scene,
      probability: cause?.probability ?? null,
      // What the child actually waits: last word heard, through to new pixels.
      speechToSceneMs: spoke ? scene.at - spoke.at : null,
      // The evaluation alone, once the utterance was judged complete.
      decisionToSceneMs: cause ? scene.at - cause.askedAt : null,
      sceneToInstructionMs: told ? told.at - scene.at : null,
    };
  });
  const timing = diagnostics?.events ? diagnosticsTimelines(diagnostics.events) : null;
  return {
    evaluations,
    decisions,
    advances,
    scenesShown: scenes.map(scene => scene.scene),
    delegationsRefused: log.filter(e => e.type === "session.delegation.created").length,
    // Application diagnostics use the session-relative Date.now clock. Keep
    // these separate from browser arrival/provider timestamps in `log`.
    timingClock: timing ? "application session-relative milliseconds" : null,
    answerTimelines: timing,
  };
}

/** Correlate only events carrying the same scene and answer version. */
export function diagnosticsTimelines(events) {
  const keyed = new Map();
  // Older releases omitted revision on candidate/request/evaluation/advance
  // events. Infer it only when the complete artifact has exactly one known
  // revision for that scene+answer; repeated versions with multiple revisions
  // remain explicitly ambiguous.
  const revisionsByAnswer = new Map();
  for (const event of events) {
    const detail = event.detail ?? {};
    const version = detail.version ?? detail.answer_version;
    const sceneIndex = Number.isInteger(detail.sceneIndex) ? detail.sceneIndex : detail.scene_index;
    const candidateRevision = Number.isInteger(detail.revision) ? detail.revision : detail.transcript_revision;
    if (!Number.isInteger(sceneIndex) || typeof version !== "string" || !Number.isInteger(candidateRevision)) continue;
    const identity = `${sceneIndex}:${version}`;
    const revisions = revisionsByAnswer.get(identity) ?? new Set();
    revisions.add(candidateRevision);
    revisionsByAnswer.set(identity, revisions);
  }
  const rowFor = (sceneIndex, version, revision = null) => {
    if (!Number.isInteger(sceneIndex) || typeof version !== "string") return null;
    let resolvedRevision = revision;
    let revisionCorrelation;
    if (!Number.isInteger(revision)) {
      const known = revisionsByAnswer.get(`${sceneIndex}:${version}`);
      if (known?.size === 1) {
        resolvedRevision = [...known][0];
        revisionCorrelation = "inferred_unique_revision";
      } else if (known && known.size > 1) revisionCorrelation = "ambiguous_revision";
    }
    const key = `${sceneIndex}:${resolvedRevision ?? "?"}:${version}`;
    if (!keyed.has(key))
      keyed.set(key, {
        sceneIndex,
        transcriptRevision: resolvedRevision ?? null,
        answerVersion: version,
        ...(revisionCorrelation ? { revisionCorrelation } : {}),
      });
    const row = keyed.get(key);
    if (revisionCorrelation) row.revisionCorrelation = revisionCorrelation;
    return row;
  };
  for (const event of events) {
    const detail = event.detail ?? {};
    const version = detail.version ?? detail.answer_version;
    const sceneIndex = Number.isInteger(detail.sceneIndex) ? detail.sceneIndex : detail.scene_index;
    const candidateRevision = Number.isInteger(detail.revision) ? detail.revision : detail.transcript_revision;
    const revision = Number.isInteger(candidateRevision) ? candidateRevision : null;
    const row = rowFor(sceneIndex, version, revision);
    if (!row) continue;
    if (event.type === "answer.candidate") {
      row.candidateRecordedAtMs = event.at;
      row.utterance = typeof detail.utterance === "string" ? detail.utterance.trim() : null;
      if (Number.isFinite(detail.transcript_at)) row.finalChildTranscriptAtMs = detail.transcript_at;
    } else if (event.type === "answer.requesting") row.evaluationRequestedAtMs = event.at;
    else if (event.type === "answer.evaluated") row.evaluationCompletedAtMs = event.at;
    else if (event.type === "advance.committed") row.sceneCommitAtMs = event.at;
    else if (event.type === "advance.displayed") row.sceneDisplayedAtMs = event.at;
    else if (event.type === "answer.response_gate_released") {
      row.applicationResponseReleasedAtMs = event.at;
      row.gateReleaseReason = detail.reason ?? null;
      row.gateDecision = detail.decision ?? row.gateDecision ?? null;
      row.gateContextSentAtMs = Number.isFinite(detail.context_sent_at) ? detail.context_sent_at : null;
      row.gateEligibleAtMs = Number.isFinite(detail.eligible_at) ? detail.eligible_at : null;
    } else if (event.type === "answer.response_gate_cancelled") {
      row.gateCancelledAtMs = event.at;
      row.gateCancellationReason = detail.reason ?? null;
    } else if (event.type === "answer.response_gate_observed") {
      row.gateObservations ??= [];
      row.conditionDurationMs ??= {};
      row.observedBlockedUnionMs ??= 0;
      const prior = row.gateObservations.at(-1);
      if (prior) {
        const duration = Math.max(0, event.at - prior.at);
        for (const condition of prior.conditions) {
          const deadline =
            condition === "output_transcript_quiet"
              ? prior.outputQuietAtMs
              : condition === "correction_window"
                ? prior.correctionReadyAtMs
                : condition === "vad_grace"
                  ? prior.vadGraceUntilMs
                  : undefined;
          const endAtMs = Number.isFinite(deadline) ? Math.min(event.at, deadline) : event.at;
          const conditionDuration = Math.max(0, endAtMs - prior.at);
          const entry = row.conditionDurationMs[condition] ?? { durationMs: 0, intervals: [] };
          entry.durationMs += conditionDuration;
          entry.intervals.push({ startAtMs: prior.at, endAtMs, durationMs: conditionDuration });
          row.conditionDurationMs[condition] = entry;
        }
        if (prior.outputBlocked) row.observedBlockedUnionMs += duration;
      }
      row.gateObservations.push({
        at: event.at,
        trigger: detail.trigger ?? null,
        conditions: detail.conditions ?? [],
        outputBlocked: detail.output_blocked === true,
        outputQuietAtMs: detail.output_quiet_at,
        correctionReadyAtMs: detail.correction_ready_at,
        vadGraceUntilMs: detail.vad_grace_until,
      });
      if (detail.decision) row.gateDecision = detail.decision;
      row.gateIdentity = { sceneIndex, transcriptRevision: revision, answerVersion: version };
      if (Number.isFinite(detail.output_quiet_at)) row.outputQuietAtMs = detail.output_quiet_at;
      if (Number.isFinite(detail.eligible_at)) row.gateEligibleAtMs = detail.eligible_at;
      if (detail.blocked_output_activity)
        row.blockedProviderOutputActivityCount = (row.blockedProviderOutputActivityCount ?? 0) + 1;
      if (detail.trigger === "identity_superseded") row.gateSupersededAtMs = event.at;
    } else if (event.type === "answer.response_gate_deadline_updated") {
      row.outputQuietDeadlineUpdates ??= [];
      row.outputQuietDeadlineUpdates.push({
        atMs: event.at,
        previousDeadlineAtMs: detail.previous_deadline_at ?? null,
        deadlineAtMs: detail.deadline_at,
        extensionMs: detail.extension_ms ?? null,
      });
    }
  }
  const answerStartAt = row =>
    row.finalChildTranscriptAtMs ?? row.candidateRecordedAtMs ?? row.evaluationRequestedAtMs ?? Infinity;
  const rows = [...keyed.values()].sort((a, b) => answerStartAt(a) - answerStartAt(b));
  const sprout = events.filter(event => event.type === "transcript.sprout");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const release = row.applicationResponseReleasedAtMs;
    const nextAnswer = rows[i + 1];
    const nextAnswerBoundary = nextAnswer?.finalChildTranscriptAtMs ?? nextAnswer?.candidateRecordedAtMs;
    const next =
      release === undefined
        ? undefined
        : sprout.find(
            event => event.at > release && (nextAnswerBoundary === undefined || event.at < nextAnswerBoundary),
          );
    row.firstObservedSproutResponseAtMs = next?.at ?? null;
    row.firstObservedSproutResponseClock = next ? "application session-relative" : null;
    // No provider completion or acoustic onset signal exists in this harness.
    row.providerOutputCompletionAtMs = null;
    row.audibleOnsetAtMs = null;
    row.conditionDurationsAreOverlapping = true;
    row.stabilizationWaitAfterEvaluationMs =
      row.sceneCommitAtMs === undefined || row.evaluationCompletedAtMs === undefined
        ? null
        : row.sceneCommitAtMs - row.evaluationCompletedAtMs;
    row.tutorResponseDelayAfterReleaseMs = next && release !== undefined ? next.at - release : null;
    row.finalTranscriptToEvaluationRequestMs =
      row.finalChildTranscriptAtMs === undefined || row.evaluationRequestedAtMs === undefined
        ? null
        : row.evaluationRequestedAtMs - row.finalChildTranscriptAtMs;
    row.finalTranscriptToEvaluationCompletionMs =
      row.finalChildTranscriptAtMs === undefined || row.evaluationCompletedAtMs === undefined
        ? null
        : row.evaluationCompletedAtMs - row.finalChildTranscriptAtMs;
    row.finalTranscriptToSceneCommitMs =
      row.finalChildTranscriptAtMs === undefined || row.sceneCommitAtMs === undefined
        ? null
        : row.sceneCommitAtMs - row.finalChildTranscriptAtMs;
    row.finalTranscriptToFirstObservedResponseMs =
      row.finalChildTranscriptAtMs === undefined || !next ? null : next.at - row.finalChildTranscriptAtMs;
  }
  return rows;
}
