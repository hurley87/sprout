import type { ReactNode } from "react";
import styles from "../catching-unicorns-demo.module.css";
import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
} from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { ConceptEvidenceRecord, LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";

export const sceneIds = Object.keys(CATCHING_UNICORNS_LESSON.nodes);
export type RevealItem = { readonly title: string; readonly text: string; readonly source: string };
export type ConceptPresentation = {
  nodeId: string;
  criterionId: string;
  evidence: ConceptEvidenceRecord | undefined;
  item: RevealItem | undefined;
  demonstrated: boolean;
};
export type RevealPresentation = ConceptPresentation & { item: RevealItem };

/** Join accepted evidence to authored content without changing evidence or attribution. */
export function conceptPresentation(
  state: LessonRuntimeState | null | undefined,
  nodeId: string,
  criterionId: string,
  revealNodeId = nodeId,
): ConceptPresentation {
  const evidence = state?.conceptEvidence[`${nodeId}:${criterionId}`];
  const scene = CATCHING_UNICORNS_PRESENTATION[revealNodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION];
  const reveals = (scene as { readonly reveals?: Readonly<Record<string, RevealItem>> } | undefined)?.reveals;
  return {
    nodeId,
    criterionId,
    evidence,
    item: reveals?.[criterionId],
    demonstrated: evidence?.status === "demonstrated",
  };
}

export function sceneConcepts(state: LessonRuntimeState | null | undefined, nodeId: string) {
  return (CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts ?? []).map(concept =>
    conceptPresentation(state, nodeId, concept.id),
  );
}

export function hasReveal(concept: ConceptPresentation): concept is RevealPresentation {
  return concept.item !== undefined;
}

export type SceneProps = {
  state: LessonRuntimeState | null | undefined;
  nodeId: string;
  node: (typeof CATCHING_UNICORNS_LESSON.nodes)[string];
  revealCards: RevealPresentation[];
};

/** Keep canonical card content behind the same evidence gate in every card layout. */
export function EvidenceCard({ concept, children }: { concept: ConceptPresentation; children: ReactNode }) {
  return concept.demonstrated && concept.item ? <Revealed item={concept.item} /> : children;
}

export function UnresolvedCard({
  title,
  evidence,
  className,
  statusClassName,
}: {
  title: string;
  evidence?: ConceptEvidenceRecord;
  className: string;
  statusClassName?: string;
}) {
  return (
    <article className={className}>
      <h3 className="font-medium">{title}</h3>
      {statusClassName ? (
        <div className={statusClassName}>
          <EvidenceState evidence={evidence} />
        </div>
      ) : (
        <EvidenceState evidence={evidence} />
      )}
    </article>
  );
}

export function ExplanationList({ concepts }: { concepts: RevealPresentation[] }) {
  return (
    <ul className={styles.differenceList}>
      {concepts
        .filter(concept => concept.demonstrated)
        .map(({ criterionId, item }) => (
          <li className={styles.difference} key={criterionId}>
            <span className={styles.differenceCheck} aria-hidden="true">
              ✓
            </span>
            <div>
              <h4>{item.title}</h4>
              <p>{item.text}</p>
            </div>
          </li>
        ))}
    </ul>
  );
}

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
      ? sceneConcepts(state, nodeId).every(concept => concept.demonstrated)
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
