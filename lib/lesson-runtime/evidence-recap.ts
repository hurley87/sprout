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
  let learnerDetail: string | undefined;
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
    if (demonstrated) {
      groups[demonstrated.understanding === null ? "uncertain" : demonstrated.understanding].push(label);
      // Quote one complete, brief learner contribution from the accepted source.
      // Supported/uncertain answers remain in their own groups; never borrow
      // tutor context or later diagnostic assessment to personalize the close.
      if (!learnerDetail && demonstrated.understanding === "independent") {
        const source = demonstrated.source;
        const messages = source?.messages;
        const candidates = messages
          ? messages.filter(message => message.speaker === "Child").map(message => message.text)
          : [source?.childTranscript ?? ""];
        const quote = candidates
          .map(text => text.trim())
          .find(text => {
            const words = text.split(/\s+/u).length;
            return (
              words >= 6 &&
              words <= 22 &&
              !/[\n\r“”"\[\]]/u.test(text) &&
              !/\b(?:instructions?|ignore|say|repeat|mastered|don't know|not sure)\b/iu.test(text) &&
              !messages?.some(message => message.speaker === "Tutor" && message.text.includes(text))
            );
          });
        if (quote) learnerDetail = `; for ${label}, you said “${quote.replace(/[.!?]+$/u, "")}”`;
      }
    } else groups[records.some(record => record.status === "partial") ? "partial" : "unresolved"].push(label);
  }
  const sentences: string[] = [];
  if (groups.independent.length)
    sentences.push(`You independently explained ${list(groups.independent)}${learnerDetail ?? ""}.`);
  const supported = [];
  if (groups.prompted.length) supported.push(`after a prompt, you explained ${list(groups.prompted)}`);
  if (groups.uncertain.length) supported.push(`you explained ${list(groups.uncertain)}, with prompting unclear`);
  if (supported.length) sentences.push(`${supported.join("; ").replace(/^./u, char => char.toUpperCase())}.`);
  const unfinished = [];
  if (groups.partial.length) unfinished.push(`partly explained: ${list(groups.partial)}`);
  if (groups.unresolved.length) unfinished.push(`unresolved or skipped: ${list(groups.unresolved)}`);
  if (unfinished.length) sentences.push(`${unfinished.join("; ").replace(/^./u, char => char.toUpperCase())}.`);
  if (!learnerDetail) sentences.push("Thanks for the discussion.");
  return sentences.join(" ");
}

/** Ignore punctuation/casing differences from speech recognition, never missing words. */
export const normalizeRecapSpeech = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
