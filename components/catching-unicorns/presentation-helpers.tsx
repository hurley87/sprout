import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
} from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { ConceptEvidenceRecord, LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";

export const sceneIds = Object.keys(CATCHING_UNICORNS_LESSON.nodes);
// Recap is retained on completion, but is never a fifth question.
export const questionIds = sceneIds.filter(id => id !== "recap");
export type RevealItem = { readonly title: string; readonly text: string; readonly source: string };
export type ConceptPresentation = {
  nodeId: string;
  criterionId: string;
  evidence: ConceptEvidenceRecord | undefined;
  item: RevealItem | undefined;
  demonstrated: boolean;
};
/** Join accepted evidence to authored content without changing evidence or attribution. */
export function conceptPresentation(
  state: LessonRuntimeState | null | undefined,
  nodeId: string,
  criterionId: string,
): ConceptPresentation {
  const evidence = state?.conceptEvidence[`${nodeId}:${criterionId}`];
  const scene = CATCHING_UNICORNS_PRESENTATION[nodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION];
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
