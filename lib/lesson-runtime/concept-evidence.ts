import type { ProposedConceptObservation } from "./conversation-state-classifier";
import type { LessonNodeDefinition } from "./lesson-definition";
import { transcriptMessages, substantiveLearnerText, neutralTutorAcknowledgment } from "./tutor-observation";

export type ConceptEvidenceReference = {
  readonly runtimeId: string;
  readonly nodeId: string;
  readonly visitId: number;
  /** null for a historical utterance first seen in a later turn's snapshot. */
  readonly childTurnId: number | null;
  /** Revision where this exact quote was recorded, not a fabricated utterance timestamp. */
  readonly transcriptRevision: number;
  readonly childMessageIndex: number;
  readonly childTranscript: string;
  /** Present for multi-message evidence. Legacy fields above remain the first
   * learner anchor; this ordered span is the authoritative complete provenance.
   * Tutor entries are context only, never learner evidence. */
  readonly childMessageEndIndex?: number;
  readonly messages?: readonly {
    readonly messageIndex: number;
    readonly speaker: "Child" | "Tutor";
    readonly text: string;
  }[];
};
export type ConceptEvidenceRecord = {
  readonly criterionId: string;
  readonly status: "not_yet" | "partial" | "demonstrated";
  readonly understanding: "independent" | "prompted" | null;
  /** Advisory progress, never accepted demonstration or reveal authority. */
  readonly tentative?: boolean;
  readonly source: ConceptEvidenceReference | null;
  readonly promptingHistory: readonly {
    readonly source: ConceptEvidenceReference;
    readonly prompted: boolean | null;
  }[];
};

/** App-owned classification identity; the classifier never supplies these fields. */
type ConceptObservationSource = Pick<
  ConceptEvidenceReference,
  "runtimeId" | "nodeId" | "visitId" | "transcriptRevision"
> & { readonly childTurnId: number };

export type ConceptRevealEffect = {
  readonly type: "concept.revealed";
  readonly nodeId: string;
  readonly criterionId: string;
};

export const conceptKey = (nodeId: string, criterionId: string) => `${nodeId}:${criterionId}`;

function echoedByTutor(childText: string, tutorTexts: readonly string[]) {
  const tokens = (value: string): string[] => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const child = tokens(childText);
  if (!child.length) return false;
  const childPhrase = child.join(" ");
  return tutorTexts.some(text => {
    // Tutor questions commonly contain the answer choices or the concept vocabulary.
    // Compare against declarative utterances only, and require copied words in order.
    const statements = text.split(/(?<=[.!?])\s+/u).filter(statement => !statement.trimEnd().endsWith("?"));
    return statements.some(statement => {
      const tutor = tokens(statement);
      if (!tutor.length) return false;
      if (childPhrase === tutor.join(" ")) return true;
      // A single shared word is too common to establish copying unless it was the
      // tutor's complete utterance. Multiword answer phrases must occur contiguously.
      if (child.length < 2 || child.length > tutor.length) return false;
      return tutor.some((_, index) => tutor.slice(index, index + child.length).join(" ") === childPhrase);
    });
  });
}

/** Validate and merge observations without owning runtime transitions. */
export function applyConceptObservations(
  conceptEvidence: Readonly<Record<string, ConceptEvidenceRecord>>,
  node: Pick<LessonNodeDefinition, "id" | "concepts">,
  source: ConceptObservationSource,
  observations: readonly ProposedConceptObservation[] | undefined,
  transcriptSnapshot: string | undefined,
): { conceptEvidence: Readonly<Record<string, ConceptEvidenceRecord>>; effects: ConceptRevealEffect[] } {
  if (!node.concepts?.length || !observations?.length || !transcriptSnapshot) return { conceptEvidence, effects: [] };
  const messages = transcriptMessages(transcriptSnapshot);
  if (!messages) return { conceptEvidence, effects: [] };
  const candidates = messages.flatMap((message, index) =>
    message.speaker === "Child" && substantiveLearnerText(message.text) ? [index] : [],
  );
  const evidence = { ...conceptEvidence };
  const effects: ConceptRevealEffect[] = [];
  for (const observation of observations) {
    if (!node.concepts.some(concept => concept.id === observation.criterionId)) continue;
    const key = conceptKey(node.id, observation.criterionId);
    const previous = evidence[key];
    // Absence has no supporting utterance and is never an independent attempt.
    if (observation.observation === "not_yet") {
      evidence[key] = previous ?? {
        criterionId: observation.criterionId,
        status: "not_yet",
        understanding: null,
        source: null,
        promptingHistory: [],
      };
      continue;
    }
    // Legacy proposals may identify a source only when there is one substantive
    // learner utterance. Never guess the latest answer in a cumulative snapshot.
    const childMessageIndex =
      observation.childMessageIndex === undefined
        ? candidates.length === 1
          ? candidates[0]
          : null
        : observation.childMessageIndex;
    if (childMessageIndex === null) continue;
    const end = observation.childMessageEndIndex ?? childMessageIndex;
    const spanning = end !== childMessageIndex;
    if (
      spanning
        ? messages[childMessageIndex]?.speaker !== "Child" || messages[end]?.speaker !== "Child"
        : !candidates.includes(childMessageIndex)
    )
      continue;
    const selectedMessages = messages
      .slice(childMessageIndex, end + 1)
      .map((message, offset) => ({ messageIndex: childMessageIndex + offset, ...message }));
    const learnerMessages = selectedMessages.filter(message => message.speaker === "Child");
    if (!learnerMessages.some(message => substantiveLearnerText(message.text))) continue;
    const childTranscript = messages[childMessageIndex].text.trim();
    const echoed = learnerMessages
      .filter(message => substantiveLearnerText(message.text))
      .every(message =>
        echoedByTutor(
          message.text,
          messages
            .slice(0, message.messageIndex)
            .filter(prior => prior.speaker === "Tutor")
            .map(prior => prior.text),
        ),
      );
    const interveningHelpUnresolved =
      spanning &&
      selectedMessages.some(message => message.speaker === "Tutor" && !neutralTutorAcknowledgment(message.text)) &&
      observation.observation === "demonstrated_independent";
    const tentative = observation.observation === "partial_uncertain";
    let status: ConceptEvidenceRecord["status"] =
      observation.observation === "partial" || tentative ? "partial" : "demonstrated";
    let understanding: ConceptEvidenceRecord["understanding"] =
      observation.observation === "demonstrated_independent"
        ? "independent"
        : observation.observation === "demonstrated_prompted"
          ? "prompted"
          : null;
    if ((echoed || interveningHelpUnresolved) && status === "demonstrated") {
      status = "partial";
      understanding = null;
    }
    // Uncertain progress must never erase accepted mastery. Prompting belongs
    // to the selected utterance, so a later tutor paraphrase cannot change it.
    if (tentative && previous?.status === "demonstrated") continue;
    const sameUtterance = (reference: ConceptEvidenceReference) =>
      reference.runtimeId === source.runtimeId &&
      reference.nodeId === source.nodeId &&
      reference.visitId === source.visitId &&
      reference.childMessageIndex === childMessageIndex;
    const existingAttempt = previous?.promptingHistory.find(entry => sameUtterance(entry.source));
    const contentKey = (text: string) =>
      (
        text
          .replace(/\[[^\]]*(?:\]|$)/gu, " ")
          .toLocaleLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? []
      )
        .filter(word => !["uh", "um", "hmm", "well", "ah", "oh"].includes(word))
        .join(" ");
    const spanKey = (span: ConceptEvidenceReference["messages"]) =>
      JSON.stringify(span?.map(message => [message.messageIndex, message.speaker, contentKey(message.text)]));
    // A later locator for an overlapping explanation must not truncate or
    // shift accepted provenance. Extending a partial anchor is still allowed.
    const acceptedSource = previous?.source;
    if (
      previous?.status === "demonstrated" &&
      acceptedSource &&
      acceptedSource.runtimeId === source.runtimeId &&
      acceptedSource.nodeId === source.nodeId &&
      acceptedSource.visitId === source.visitId &&
      acceptedSource.childMessageIndex <= end &&
      (acceptedSource.childMessageEndIndex ?? acceptedSource.childMessageIndex) >= end &&
      (acceptedSource.childMessageIndex !== childMessageIndex ||
        (acceptedSource.childMessageEndIndex ?? acceptedSource.childMessageIndex) > end) &&
      (previous.understanding === understanding || status !== "demonstrated" || understanding === null)
    )
      continue;
    const unchanged =
      existingAttempt &&
      (existingAttempt.source.childMessageEndIndex ?? existingAttempt.source.childMessageIndex) === end &&
      contentKey(existingAttempt.source.childTranscript) === contentKey(childTranscript) &&
      (!spanning || spanKey(existingAttempt.source.messages) === spanKey(selectedMessages));
    const evidenceReference: ConceptEvidenceReference = unchanged
      ? existingAttempt.source
      : {
          runtimeId: source.runtimeId,
          nodeId: source.nodeId,
          visitId: source.visitId,
          childTurnId:
            !spanning && childMessageIndex === messages.findLastIndex(message => message.speaker === "Child")
              ? source.childTurnId
              : null,
          transcriptRevision: source.transcriptRevision,
          childMessageIndex,
          childTranscript,
          ...(spanning ? { childMessageEndIndex: end, messages: selectedMessages } : {}),
        };
    // Reclassification of an unchanged utterance is not a fresh attempt. Once
    // attribution is known, an ambiguous cumulative label cannot rewrite it.
    if (
      unchanged &&
      previous?.status === "demonstrated" &&
      (status !== "demonstrated" || understanding === null || previous.understanding !== null)
    )
      continue;
    const prompted =
      observation.observation === "demonstrated_independent" && !echoed && !interveningHelpUnresolved
        ? false
        : observation.observation === "demonstrated_prompted"
          ? true
          : null;
    const promptingHistory = existingAttempt
      ? previous!.promptingHistory.map(entry =>
          entry === existingAttempt ? { source: evidenceReference, prompted } : entry,
        )
      : [...(previous?.promptingHistory ?? []), { source: evidenceReference, prompted }];
    // Retain the strongest accepted evidence and its own attribution. Later
    // uncertain or prompted attempts cannot erase an independent demonstration.
    if (
      previous?.status === "demonstrated" &&
      (status !== "demonstrated" ||
        understanding === null ||
        (previous.understanding === "independent" && understanding !== "independent"))
    ) {
      evidence[key] = { ...previous, promptingHistory };
      continue;
    }
    evidence[key] = {
      criterionId: observation.criterionId,
      status,
      understanding,
      ...(tentative ? { tentative: true } : {}),
      source: evidenceReference,
      promptingHistory,
    };
    if (status === "demonstrated" && previous?.status !== "demonstrated")
      effects.push({ type: "concept.revealed", nodeId: node.id, criterionId: observation.criterionId });
  }
  return { conceptEvidence: evidence, effects };
}
