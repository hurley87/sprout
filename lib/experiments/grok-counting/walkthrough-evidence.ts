import type { DecisionEntry } from "./proposals";
/** All deltas use the application timeline clock; wire receipt clocks stay separate. */
export function summarizeGrokWalkthrough(timeline: readonly DecisionEntry[]) {
  return ["count-1-duck", "count-2-ducks", "count-3-butterflies"].map(nodeId => {
    const events = timeline.filter(entry => entry.node === nodeId);
    const validation = events.find(entry => entry.type === "proposal.validated" && entry.reason === "correct");
    const settled = validation
      ? events.findLast(
          entry =>
            entry.type === "learner.transcript" &&
            ["settled", "revised"].includes(entry.reason) &&
            entry.sequence <= validation.sequence &&
            entry.turn === validation.turn,
        )
      : events.findLast(entry => entry.type === "learner.transcript" && ["settled", "revised"].includes(entry.reason));
    const classification =
      events.find(entry => entry.type === "classification.completed" && entry.reason === "confirmed") ??
      events.find(entry => entry.type === "classification.completed");
    const audio = classification
      ? events.find(
          entry =>
            entry.type === "audio.started" &&
            entry.response === classification.response &&
            entry.item === classification.item,
        )
      : events.find(
          entry =>
            entry.type === "audio.started" &&
            settled &&
            entry.sequence > settled.sequence &&
            entry.correlation === "bound",
        );
    const drain = audio
      ? events.findLast(
          entry => entry.type === "audio.drained" && entry.response === audio.response && entry.item === audio.item,
        )
      : undefined;
    const renderRequest = events.find(entry => entry.type === "render.requested");
    const render = renderRequest
      ? timeline.find(entry => entry.type === "render.confirmed" && entry.sequence > renderRequest.sequence)
      : undefined;
    return {
      nodeId,
      reached: Boolean(settled),
      validatedCorrectTool: Boolean(validation),
      settledLearnerAtMs: settled?.atMs ?? null,
      validatedToolAtMs: validation?.atMs ?? null,
      settledToValidatedToolMs: settled && validation ? validation.atMs - settled.atMs : null,
      jev: classification
        ? {
            reason: classification.reason,
            modelValidated: classification.classification?.modelValidated ?? false,
            latencyMs: classification.classification?.latencyMs ?? null,
          }
        : null,
      firstScheduledAcknowledgmentAudioAtMs: audio?.atMs ?? null,
      settledToFirstScheduledAcknowledgmentAudioMs: settled && audio ? audio.atMs - settled.atMs : null,
      localAcknowledgmentAudioDrainedAtMs: drain?.atMs ?? null,
      nextRenderConfirmedAtMs: render?.atMs ?? null,
      settledToNextRenderMs: settled && render ? render.atMs - settled.atMs : null,
      recoveryOrTimeoutEvents: events
        .filter(
          entry =>
            entry.type.startsWith("recovery.") ||
            entry.type.includes("timed-out") ||
            (entry.type === "classification.completed" && entry.reason === "timeout"),
        )
        .map(({ type, reason, atMs }) => ({ type, reason, atMs })),
    };
  });
}
