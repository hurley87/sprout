import type { LessonDefinition } from "./lesson-definition";
import type { ConceptEvidenceRecord, LessonRuntimeState } from "./lesson-runtime-reducer";

const list = (items: string[]) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);

/** The accepted reducer ledger is the sole recap authority. The asynchronous
 * cumulative assessment is diagnostic only and cannot rewrite a delivered close.
 * Deduplicate carried criteria, using the first accepted demonstration (including
 * its prompting attribution), otherwise any accepted partial record. */
export function evidenceRecap(
  lesson: LessonDefinition,
  state: Pick<LessonRuntimeState, "conceptEvidence"> | null | undefined,
) {
  const groups = {
    independent: [] as string[],
    prompted: [] as string[],
    uncertain: [] as string[],
    partial: [] as string[],
    unresolved: [] as string[],
  };
  for (const [id, label] of Object.entries(lesson.recapTopics ?? {})) {
    const records: ConceptEvidenceRecord[] = Object.values(lesson.nodes).flatMap(node => {
      if (!node.concepts?.some(concept => concept.id === id)) return [];
      const record = state?.conceptEvidence[`${node.id}:${id}`];
      return record ? [record] : [];
    });
    records.sort(
      (a, b) =>
        (a.source?.visitId ?? 0) - (b.source?.visitId ?? 0) ||
        (a.source?.transcriptRevision ?? 0) - (b.source?.transcriptRevision ?? 0),
    );
    const demonstrated = records.find(record => record.status === "demonstrated");
    if (demonstrated)
      groups[demonstrated.understanding === null ? "uncertain" : demonstrated.understanding].push(label);
    else groups[records.some(record => record.status === "partial") ? "partial" : "unresolved"].push(label);
  }
  const sentences: string[] = [];
  if (groups.independent.length) sentences.push(`You independently explained ${list(groups.independent)}.`);
  const supported = [];
  if (groups.prompted.length) supported.push(`after a prompt, you explained ${list(groups.prompted)}`);
  if (groups.uncertain.length) supported.push(`you explained ${list(groups.uncertain)}, with prompting unclear`);
  if (supported.length) sentences.push(`${supported.join("; ").replace(/^./u, char => char.toUpperCase())}.`);
  const unfinished = [];
  if (groups.partial.length) unfinished.push(`partly explained: ${list(groups.partial)}`);
  if (groups.unresolved.length) unfinished.push(`unresolved or skipped: ${list(groups.unresolved)}`);
  if (unfinished.length) sentences.push(`${unfinished.join("; ").replace(/^./u, char => char.toUpperCase())}.`);
  sentences.push("Thanks for the discussion.");
  return sentences.join(" ");
}

/** Ignore punctuation/casing differences from speech recognition, never missing words. */
export const normalizeRecapSpeech = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
