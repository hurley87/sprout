import styles from "../catching-unicorns-demo.module.css";
import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
} from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { ConceptEvidenceRecord, LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";

export const sceneIds = Object.keys(CATCHING_UNICORNS_LESSON.nodes);
export type RevealItem = { readonly title: string; readonly text: string; readonly source: string };
export const keyFor = (nodeId: string, criterionId: string) => `${nodeId}:${criterionId}`;
export const evidenceFor = (state: LessonRuntimeState | null | undefined, nodeId: string, criterionId: string) =>
  state?.conceptEvidence[keyFor(nodeId, criterionId)];

export function revealText(
  nodeId: keyof typeof CATCHING_UNICORNS_PRESENTATION,
  criterionId: string,
): RevealItem | undefined {
  const item = CATCHING_UNICORNS_PRESENTATION[nodeId] as { readonly reveals?: Readonly<Record<string, RevealItem>> };
  return item.reveals?.[criterionId];
}

export type SceneProps = {
  state: LessonRuntimeState | null | undefined;
  nodeId: string;
  node: (typeof CATCHING_UNICORNS_LESSON.nodes)[string];
  revealCards: { criterionId: string; item: RevealItem; evidence: ConceptEvidenceRecord | undefined }[];
};

export function Revealed({ item }: { item: RevealItem }) {
  return (
    <article className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-emerald-950">{item.title}</h3>
      <p className="mt-2 text-slate-700">{item.text}</p>
      <p className="mt-3 text-xs text-slate-500">Source: {item.source}</p>
    </article>
  );
}

export function EvidenceState({ evidence }: { evidence?: ConceptEvidenceRecord }) {
  if (evidence?.status === "demonstrated")
    return (
      <span className="text-xs font-medium text-emerald-800">
        {evidence.understanding === "prompted" ? "After a prompt" : "Demonstrated"}
      </span>
    );
  return (
    <span className="text-xs text-slate-500">
      {evidence?.status === "partial" ? "Partly explained" : "Not yet demonstrated"}
    </span>
  );
}

export function SceneHeader({
  node,
  nodeId,
  state,
}: {
  node: (typeof CATCHING_UNICORNS_LESSON.nodes)[string];
  nodeId: string;
  state: LessonRuntimeState | null | undefined;
}) {
  const title =
    nodeId === "techno-literate-culture"
      ? (node.concepts ?? []).every(concept => evidenceFor(state, nodeId, concept.id)?.status === "demonstrated")
        ? "Techno-literate culture"
        : "Culture and literacy"
      : String(node.presentation.title);
  return (
    <header className={styles.sceneHeader}>
      <p className={styles.sceneTitle}>{title}</p>
      <h2 className={styles.question}>{String(node.presentation.prompt)}</h2>
    </header>
  );
}
