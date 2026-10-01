import type { Evidence } from "../lib/session-recorder";

const timingLabels = {
  mapped_provider: "mapped provider clock",
  source_input_bound: "conservative source input bound; not exact speech time",
  source_timeline_bound: "conservative source timeline bound; not exact speech time",
};

export function EvidenceDetail({ evidence }: { evidence: Evidence }) {
  switch (evidence.type) {
    case "utterance":
      return (
        <>
          <p>
            {evidence.speaker} · {evidence.state}: {evidence.text}
          </p>
          <p>
            Provider utterance: {evidence.startMs ?? "unknown"}–{evidence.endMs ?? "unknown"} ms
          </p>
          <p>
            Transcript received (approximate session time): {evidence.firstObservedAtMs ?? "unknown"}–
            {evidence.lastObservedAtMs ?? "unknown"} ms
          </p>
          <p>
            Speech timing in session:{" "}
            {evidence.sessionTiming
              ? `${evidence.sessionTiming.startMs}–${evidence.sessionTiming.endMs} ms (${timingLabels[evidence.sessionTiming.provenance]})`
              : "unverified"}
          </p>
          {evidence.responseScene && (
            <p>
              Scene when transcript arrived: {evidence.responseScene.sceneId} · {evidence.responseScene.status}. This
              does not establish the scene during speech.
            </p>
          )}
          {evidence.recognition === "needs_confirmation" && (
            <p>Recognition needs confirmation; this response does not establish a counting mistake.</p>
          )}
        </>
      );
    case "scene_displayed":
      return (
        <>
          <p>
            Scene actually displayed: {evidence.sceneId} · Target quantity: {evidence.targetQuantity}
          </p>
          <ol>
            {evidence.items.map((item, index) => (
              <li key={index}>
                {item.emoji} {item.label}
              </li>
            ))}
          </ol>
          <p>Arrangement/context: {evidence.arrangement}</p>
        </>
      );
    case "support":
      return (
        <p>
          Support · {evidence.source} · {evidence.mode}: {evidence.description}
        </p>
      );
  }
}
