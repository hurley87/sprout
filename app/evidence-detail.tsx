import type { Evidence } from "../lib/session-recorder";

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
            Observed: {evidence.firstObservedAtMs ?? "unknown"}–{evidence.lastObservedAtMs ?? "unknown"} ms
          </p>
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
