import type { TranscriptEvent } from "./events";
import type { Evidence } from "./session-recorder";

/** A session interval is an envelope, not necessarily exact acoustic timing.
 * Explicit mappings and conservative source bounds retain their own provenance. */
export function sessionSpeechInterval(evidence: Evidence | undefined) {
  if (evidence?.type !== "utterance") return undefined;
  const timing = evidence.sessionTiming;
  if (
    timing?.clock !== "session" ||
    !Number.isFinite(timing.startMs) ||
    timing.startMs < 0 ||
    !Number.isFinite(timing.endMs) ||
    timing.endMs < timing.startMs
  )
    return undefined;
  if (timing.provenance === "mapped_provider") return timing;
  if (timing.provenance === "source_timeline_bound") {
    const provider = evidence.providerTiming;
    if (
      !provider ||
      provider.clock !== "provider" ||
      !Number.isFinite(provider.startMs) ||
      provider.startMs < 0 ||
      !Number.isFinite(provider.endMs) ||
      provider.endMs < provider.startMs ||
      !Number.isSafeInteger(timing.sourceId) ||
      timing.sourceId < 1 ||
      provider.sourceId !== timing.sourceId ||
      !Number.isFinite(timing.sourceRequestedAtMs) ||
      !Number.isFinite(timing.inputOpenedAtMs) ||
      timing.inputOpenedAtMs < 0 ||
      !timing.inputScene.sceneId ||
      !Number.isFinite(timing.inputScene.displayedAtMs) ||
      timing.inputScene.displayedAtMs < 0 ||
      timing.inputScene.displayedAtMs > timing.inputOpenedAtMs ||
      timing.sourceRequestedAtMs > timing.inputOpenedAtMs ||
      timing.startMs !== Math.max(timing.inputOpenedAtMs, Math.floor(timing.sourceRequestedAtMs + provider.startMs)) ||
      evidence.firstObservedAtMs === undefined ||
      !Number.isFinite(evidence.firstObservedAtMs) ||
      evidence.lastObservedAtMs === undefined ||
      !Number.isFinite(evidence.lastObservedAtMs) ||
      evidence.lastObservedAtMs < evidence.firstObservedAtMs ||
      timing.startMs > evidence.firstObservedAtMs ||
      timing.endMs < evidence.lastObservedAtMs
    )
      return undefined;
    return timing;
  }
  if (
    timing.provenance !== "source_input_bound" ||
    !Number.isSafeInteger(timing.sourceId) ||
    timing.sourceId < 1 ||
    evidence.providerTiming?.sourceId !== timing.sourceId ||
    evidence.providerTiming.clock !== "provider" ||
    !Number.isFinite(evidence.providerTiming.startMs) ||
    evidence.providerTiming.startMs < 0 ||
    !Number.isFinite(evidence.providerTiming.endMs) ||
    evidence.providerTiming.endMs < evidence.providerTiming.startMs ||
    !timing.inputScene.sceneId ||
    !Number.isFinite(timing.inputScene.displayedAtMs) ||
    timing.inputScene.displayedAtMs < 0 ||
    timing.inputScene.displayedAtMs > timing.startMs ||
    evidence.firstObservedAtMs === undefined ||
    !Number.isFinite(evidence.firstObservedAtMs) ||
    evidence.lastObservedAtMs === undefined ||
    !Number.isFinite(evidence.lastObservedAtMs) ||
    evidence.lastObservedAtMs < evidence.firstObservedAtMs ||
    timing.startMs > evidence.firstObservedAtMs ||
    timing.endMs < evidence.lastObservedAtMs
  )
    return undefined;
  return timing;
}

/** GPT-Live intervals are approximate positions measured since source startup.
 * Startup cannot precede the request which creates it. Receipt is only an upper
 * bound; neither local VAD nor an estimated context acknowledgment is a fence.
 * A stopped/delayed timeline widens this envelope instead of moving its end
 * back in time. Impossible/future offsets fail closed. */
export function sourceTimelineBound(
  event: Pick<TranscriptEvent, "sourceId" | "startMs" | "endMs">,
  sourceRequestedAtMs: number,
  inputOpenedAtMs: number,
  inputScene: { sceneId: string; displayedAtMs: number },
  receivedAtMs: number,
):
  | Extract<
      NonNullable<Extract<Evidence, { type: "utterance" }>["sessionTiming"]>,
      { provenance: "source_timeline_bound" }
    >
  | undefined {
  const startMs = Math.max(inputOpenedAtMs, Math.floor(sourceRequestedAtMs + event.startMs));
  if (
    !Number.isSafeInteger(event.sourceId) ||
    event.sourceId! < 1 ||
    !Number.isFinite(sourceRequestedAtMs) ||
    !Number.isFinite(inputOpenedAtMs) ||
    inputOpenedAtMs < 0 ||
    sourceRequestedAtMs > inputOpenedAtMs ||
    !Number.isFinite(event.startMs) ||
    event.startMs < 0 ||
    !Number.isFinite(event.endMs) ||
    event.endMs < event.startMs ||
    !Number.isFinite(receivedAtMs) ||
    startMs > receivedAtMs
  )
    return undefined;
  return {
    clock: "session",
    provenance: "source_timeline_bound",
    sourceId: event.sourceId!,
    sourceRequestedAtMs,
    inputOpenedAtMs,
    inputScene: { ...inputScene },
    startMs,
    endMs: receivedAtMs,
  };
}

export type DisplayedSceneEvent = { _id: string; atMs: number; evidence?: Evidence; timeline?: unknown };

/** Shared scene check for Observer and parent-correction callers. Callers must
 * additionally enforce finalization, speaker attribution and recognition. */
export function responseSceneValidity(
  response: Evidence | undefined,
  scene: DisplayedSceneEvent | undefined,
  canonicalEvents: DisplayedSceneEvent[],
) {
  const interval = sessionSpeechInterval(response);
  const fenced =
    interval?.provenance === "source_input_bound" ||
    (interval?.provenance === "source_timeline_bound" && interval.startMs === interval.inputOpenedAtMs);
  const displayedScenes = canonicalEvents.filter(event => event.evidence?.type === "scene_displayed");
  const priorScenes = interval
    ? displayedScenes.filter(event => event.atMs < interval.startMs || (fenced && event.atMs === interval.startMs))
    : [];
  const latestAt = Math.max(...priorScenes.map(event => event.atMs), -1);
  const latest = priorScenes.filter(event => event.atMs === latestAt);
  const transitionsDuringSpeech = Boolean(
    interval &&
    displayedScenes.some(
      event =>
        event.atMs >= interval.startMs &&
        event.atMs <= interval.endMs &&
        !(
          fenced &&
          event._id === scene?._id &&
          event.atMs === interval.inputScene.displayedAtMs &&
          event.evidence?.type === "scene_displayed" &&
          event.evidence.sceneId === interval.inputScene.sceneId
        ),
    ),
  );
  const citedSceneIsCurrent = latest.length === 1 && latest[0]._id === scene?._id;
  const fenceMatchesScene =
    !fenced ||
    (scene?.evidence?.type === "scene_displayed" &&
      interval.inputScene.sceneId === scene.evidence.sceneId &&
      interval.inputScene.displayedAtMs === scene.atMs);
  const attribution = response?.type === "utterance" ? response.responseScene : undefined;
  const attributionMatchesScene =
    !attribution ||
    (attribution.status === "stable" &&
      scene?.evidence?.type === "scene_displayed" &&
      attribution.sceneId === scene.evidence.sceneId &&
      attribution.displayedAtMs === scene.atMs);
  return {
    hasSpeechInterval: Boolean(interval),
    transitionsDuringSpeech,
    citedSceneIsCurrent,
    fenceMatchesScene,
    attributionMatchesScene,
    valid:
      Boolean(interval) &&
      !transitionsDuringSpeech &&
      citedSceneIsCurrent &&
      fenceMatchesScene &&
      attributionMatchesScene,
  };
}
