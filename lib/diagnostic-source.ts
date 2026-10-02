import { responseSceneValidity, sessionSpeechInterval } from "./evidence-timing";
import type { InspectableSessionRecord } from "./session-recorder";

export type CanonicalReviewEvent = InspectableSessionRecord["events"][number];
export function diagnosticPlaybackAnchor(event: CanonicalReviewEvent) {
  const interval = sessionSpeechInterval(event.evidence);
  if (interval)
    return {
      atMs: interval.startMs,
      label:
        interval.provenance === "mapped_provider"
          ? "Play from mapped session speech time"
          : "Play from conservative bound (may precede speech)",
    };
  const receipt = event.evidence?.type === "utterance" ? event.evidence.firstObservedAtMs : undefined;
  if (typeof receipt === "number" && Number.isFinite(receipt) && receipt >= 0)
    return { atMs: receipt, label: "Play from approximate transcript receipt" };
  return { atMs: event.atMs, label: "Play from approximate saved event time" };
}

/** IDs are the only historical lookup authority. Event keys/times/current scene are not substitutes. */
export function diagnosticSource(record: InspectableSessionRecord | undefined, eventId: string) {
  return record?.events.find(event => event.id === eventId);
}
export function diagnosticSpeechScenes(response: CanonicalReviewEvent, record: InspectableSessionRecord) {
  // A partial identity map cannot establish absence of competing canonical displays.
  if (!sessionSpeechInterval(response.evidence) || record.events.some(event => !event.id)) return [];
  const events = record.events.map(event => ({ ...event, _id: event.id! }));
  return record.events.filter(
    event =>
      event.evidence?.type === "scene_displayed" &&
      responseSceneValidity(response.evidence, { ...event, _id: event.id! }, events).valid,
  );
}
