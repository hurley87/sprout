import type { LessonDefinition } from "./lesson-definition";
import { neutralTutorAcknowledgment } from "./tutor-observation";
import type { ConceptEvidenceRecord, LessonRuntimeState } from "./lesson-runtime-reducer";

const list = (items: string[]) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);

/** Only contiguous learner words from accepted provenance. Neutral backchannels
 * can separate transcription fragments; substantive tutor content breaks a run.
 * Excerpt at sentence boundaries, never truncate a claim or generate a paraphrase. */
export function learnerRecapExcerpt(record: ConceptEvidenceRecord): string | undefined {
  if (record.status !== "demonstrated" || record.understanding !== "independent" || !record.source) return;
  const runs: string[] = [];
  let run = "";
  for (const message of record.source.messages ?? [{ speaker: "Child", text: record.source.childTranscript }]) {
    if (message.speaker === "Child") run += `${run ? " " : ""}${message.text}`;
    else if (!neutralTutorAcknowledgment(message.text)) {
      if (run) runs.push(run);
      run = "";
    }
  }
  if (run) runs.push(run);
  const clean = (text: string) =>
    text
      .replace(/\s+/gu, " ")
      .replace(/\s+([,.!?;:])/gu, "$1")
      .trim();
  const tutorTexts = (record.source.messages ?? [])
    .filter(message => message.speaker === "Tutor")
    .map(message => normalizeRecapSpeech(message.text));
  return runs
    .flatMap(text => {
      const normalized = clean(text);
      return Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(normalized), part =>
        clean(part.segment),
      );
    })
    .filter(text => {
      const words = text.split(/\s+/u).length;
      return (
        words >= 6 &&
        words <= 40 &&
        !/[“”"\[\]]/u.test(text) &&
        !/\b(?:instructions?|ignore|say|repeat|mastered|don't know|not sure)\b/iu.test(text) &&
        !tutorTexts.some(tutor => tutor.includes(normalizeRecapSpeech(text)))
      );
    })
    .sort((a, b) => b.split(/\s+/u).length - a.split(/\s+/u).length)[0];
}

/** The accepted reducer ledger is the sole recap authority. The asynchronous
 * cumulative assessment is diagnostic only and cannot rewrite a delivered close.
 * Deduplicate carried criteria, using the first accepted demonstration (including
 * its prompting attribution), otherwise any accepted partial record. */
export function evidenceRecap(
  lesson: LessonDefinition,
  state: Pick<LessonRuntimeState, "conceptEvidence"> | null | undefined,
) {
  let learnerDetail: string | undefined;
  let detailWords = 0;
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
      const quote = learnerRecapExcerpt(demonstrated);
      const words = quote?.split(/\s+/u).length ?? 0;
      // Prefer a substantive explanation over an earlier short definition.
      if (quote && words > detailWords) {
        detailWords = words;
        learnerDetail = `; for ${label}, you said “${quote.replace(/[.!?]+$/u, "")}”`;
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
  if (!learnerDetail && sentences.length < 3) sentences.push("Thanks for the discussion.");
  return sentences.join(" ");
}

/** Ignore punctuation/casing differences from speech recognition, never missing words. */
export const normalizeRecapSpeech = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
