import {
  validateLessonDefinition,
  type ConceptCriterionDefinition,
  type LessonDefinition,
  type LessonNodeDefinition,
} from "./lesson-definition";

/**
 * Standalone, removable Catching Unicorns lesson content.
 *
 * Source basis: the reviewed inventory for the quiet-revision manuscript's
 * Introduction pp. 3–6 in issue #65. The referenced `CU to Dave.pdf`
 * was not present in the searched workspace, so page claims are inherited from that
 * reviewed inventory and have not been independently checked against the PDF here.
 */
const SOURCE = {
  introduction: "Catching Unicorns, Introduction, pp. 3–6 (source inventory in issue #65)",
} as const;

const criterion = (id: string, description: string): ConceptCriterionDefinition => ({ id, description });

const scene = (definition: {
  id: string;
  title: string;
  prompt: string;
  objective: string;
  tutorBrief: string;
  assessConversationOnEntry?: boolean;
  completeAfterTutorOutput?: boolean;
  concepts?: readonly ConceptCriterionDefinition[];
  next: string | null;
  carry?: readonly string[];
}): LessonNodeDefinition => ({
  id: definition.id,
  presentation: { sceneId: definition.id, title: definition.title, prompt: definition.prompt },
  learningObjective: definition.objective,
  tutorBrief: definition.tutorBrief,
  ...(definition.completeAfterTutorOutput ? { completeAfterTutorOutput: true } : {}),
  ...(definition.assessConversationOnEntry ? { assessConversationOnEntry: true } : {}),
  ...(definition.concepts ? { concepts: definition.concepts, completionPolicy: "all_demonstrated" as const } : {}),
  onSuccess: definition.next
    ? { kind: "node", nodeId: definition.next, ...(definition.carry ? { carryForwardCriteria: definition.carry } : {}) }
    : { kind: "complete" },
});

const engram = criterion(
  "engram-biological",
  `Source-backed (${SOURCE.introduction}): identifies an engram as biological memory held inside the mind or brain. An idea stored in the mind is a natural paraphrase of internal memory. Identifying its internal location is sufficient; do not require an explicit comparison with external memory or a more specific neuroscience account.`,
);
const exogram = criterion(
  "exogram-non-biological",
  `Source-backed (${SOURCE.introduction}): identifies an exogram as a non-biological memory representation outside biological memory, such as a written or drawn record.`,
);

const lesson: LessonDefinition = {
  id: "catching-unicorns",
  initialNodeId: "engram",
  conversationFirst: true,
  recapTopics: {
    "engram-biological": "engrams",
    "exogram-non-biological": "exograms",
    "exogram-durability": "durability",
    "exogram-shareability": "sharing",
    "exogram-revisability": "revision",
    "visual-symbols": "visual symbols",
    "cultural-agreement": "shared meanings",
    "beyond-prose": "examples beyond prose",
    "abstract-concepts": "abstract ideas",
  },

  nodes: {
    engram: scene({
      id: "engram",
      title: "Engram",
      prompt: "What is an engram?",
      objective: "Explain an engram as biological memory held inside the mind or brain, in your own words.",
      tutorBrief:
        "Invite a natural explanation. If it is only called a memory, ask where it exists without supplying a location. Once the learner identifies memory or an idea stored inside the brain or mind, the explanation is sufficient. Do not ask where it exists again; uncertainty should prompt clarification of meaning, not repetition of the location. Accept evidence across their answers; do not demand a polished restatement or the word biological. Briefly accept their explanation without adding examples, contrasts or new definitions, then pause while the app advances. Do not explain exograms, external storage, notes, notebooks, files or diagrams here; those belong to the next question. Do not give the biological/internal answer. Exact terminology is unnecessary.",
      concepts: [engram],
      next: "exogram",
      carry: [engram.id],
    }),
    exogram: scene({
      id: "exogram",
      title: "Exogram",
      prompt: "What is an exogram?",
      objective: "Describe this source term in your own words and contrast it with internally held memory.",
      tutorBrief:
        "Focus on the learner's explanation of external, non-biological memory. Clarify with a question about whether a note or diagram can preserve information outside the learner. Do not define it for them. The already demonstrated engram evidence may be carried forward without re-teaching it.",
      concepts: [engram, exogram],
      next: "compare",
      carry: [engram.id, exogram.id],
    }),
    compare: scene({
      id: "compare",
      title: "Compare the two kinds of memory",
      prompt: "Compare engrams and exograms. What differences does the manuscript describe?",
      objective: "Compare engrams and exograms using only the manuscript's stated dimensions.",
      tutorBrief:
        "Assess durability, shareability, and revisability separately, using the private assessment checklist. The internal and external memory definitions were already demonstrated; do not require them again. A learner can demonstrate a property with an explanation or clear example. Ask a useful follow-up if the meaning is unclear; move on when the conversation has run its course. If unclear, ask what the learner means by a difference they already mentioned rather than naming a property. Do not claim that biological memories are never durable, shareable, or revisable.",
      concepts: [
        engram,
        exogram,
        criterion(
          "exogram-durability",
          `Source-backed (${SOURCE.introduction}): explains that the manuscript describes exograms as durable, for example by saying an external representation can persist beyond the moment of thinking.`,
        ),
        criterion(
          "exogram-shareability",
          `Source-backed (${SOURCE.introduction}): explains that an exogram can be shared with other people, for example by showing or distributing a record.`,
        ),
        criterion(
          "exogram-revisability",
          `Source-backed (${SOURCE.introduction}): explains that an exogram can be revised, edited, or otherwise changed.`,
        ),
      ],
      next: "exographics",
    }),
    exographics: scene({
      id: "exographics",
      title: "Exographics",
      prompt: "What does exographics mean?",
      objective:
        "Explain how exographics uses meaningful visual symbols and shared conventions to represent ideas, including abstract concepts, with an example beyond prose.",
      tutorBrief:
        "Assess four targets separately: meaningful visual symbols, culturally agreed meanings, an example beyond prose, and abstraction. Accept learner explanations across replies. Naming mathematics or a map establishes an example, but not automatically shared meanings or abstraction. Probe one missing target at a time using their example. Once shared conventions are explained, stop asking how marks acquire meaning. For abstraction, ask what idea or relationship the example expresses. Do not supply definitions or an example answer, count your own words as learner evidence, or reduce exographics to external storage. Ask a useful follow-up or close the question when the discussion is sufficient; uncertain assessment must not hold the conversation.",
      concepts: [
        criterion(
          "visual-symbols",
          `Source-backed (${SOURCE.introduction}): describes the inscription or use of meaningful symbols on a visual medium.`,
        ),
        criterion(
          "cultural-agreement",
          `Source-backed (${SOURCE.introduction}): explains that symbols work as representations because people in a culture agree on their meanings.`,
        ),
        criterion(
          "beyond-prose",
          `Source-backed (${SOURCE.introduction}): gives or recognizes a symbolic example beyond prose writing, such as mathematics, science, engineering, music notation, a diagram, table, graph, picture, map, sign, or emoji.`,
        ),
        criterion(
          "abstract-concepts",
          `Source-backed (${SOURCE.introduction}): explains that these representations can stand for abstract ideas that are not concrete objects in the world.`,
        ),
      ],
      next: "recap",
    }),
    recap: scene({
      id: "recap",
      assessConversationOnEntry: true,
      completeAfterTutorOutput: true,
      title: "What the conversation showed",
      prompt:
        "Review what you explained independently, what became clear after a prompt, what is still partial, and what remains to revisit.",
      objective: "Close with an evidence-based recap, without converting unresolved or skipped ideas into mastery.",
      tutorBrief: "Read the application-authored evidence recap once, then stop. No question or further exercise.",
      next: null,
    }),
  },
  recovery: {
    supportClarificationInstruction:
      "Ask briefly whether the learner wants a clarification or another try. Keep criterion descriptions, canonical answers and later scenes private unless the current scene tutor brief explicitly permits targeted help after difficulty or a request. If they want to stop or move on, acknowledge that and preserve the unresolved evidence state.",
    answerRecoveryInstruction:
      "Invite the learner to explain in their own words, or ask one short non-leading question about what they mean. Follow the current scene tutor brief: when it explicitly permits help, offer a targeted cue or brief explanation after difficulty or a request. Otherwise do not supply missing answers. If they choose to stop, do not turn the unresolved criterion into a demonstration.",
  },
  tutor: {
    persona:
      "You are a curious, respectful discussion partner helping an adult learner think through Catching Unicorns.",
    sessionGuidance: `Use only claims grounded in ${SOURCE.introduction}. The app, not you, controls scene changes and visual reveals. Let the learner answer before teaching. Keep unresolved canonical answers private except when the current scene tutor brief explicitly permits targeted scaffolding after difficulty or a request. Tutor-supplied content alone never establishes learner mastery. Natural paraphrases count. Give one brief, specific acknowledgment of the learner’s contribution; avoid stacking agreement phrases, repeating their answer, or adding an unnecessary question. Vary the wording naturally. When closing, include a concise acceptance or move-on signal, then pause for the app. When the learner is uncertain, offer appropriate encouragement or clarification within the current brief. Never reconfirm an adequate accepted answer or request its repetition. After "I don't know", offer at most one useful clarification or hint where the scene permits it, then close the question if they remain unsure. A request to move on needs no clarification. Do not probe indefinitely or manufacture understanding. A probe must clarify the learner's meaning without putting an answer in their mouth. Honor a request to stop or skip without treating it as evidence.`,
    startInstruction:
      "Begin the Catching Unicorns discussion by asking the current scene's prompt, then pause for the learner.",
    nodeInstruction:
      "Teach only the current scene and objective. Apply its tutor brief. Do not preview later scenes or select a transition; reveal unresolved content only as targeted help explicitly permitted by the current scene brief; the app owns those decisions. Ask naturally and leave space for the learner to reason. When the explanation appears sufficient, briefly acknowledge the specific idea and pause without a question. You may finish this question when the explanation is sufficient or the discussion has run its course, even if assessment is uncertain. Briefly say we can move on, then end without a question. The app advances after your conversational closure and audio finishes; pause for it to provide the next scene. Do not ask the learner to press Continue. Do not request repeated rephrasing, ask what feels clear, or open an optional discussion after confirming success. If the learner asks a follow-up, answer it within this scene and pause again; do not invent another requirement for completion.",
  },
  classifier: {
    objectiveInstructions:
      "Classify the learner's understanding of the current scene objective only. Treat source-backed claims as paraphrasable evidence. A request to stop or skip is not evidence of understanding.",
    objectiveCriteria: {
      completed:
        "The learner has settled the current conversational objective and demonstrated every authored necessary concept criterion. A generic correct response or acknowledgment is not enough when any criterion is missing or partial. A demonstrated concept may be prompted where the scene's authored completion policy permits it; do not require independent-only evidence unless that policy says so. Unresolved concepts remain unresolved and cannot be counted as completed.",
      incorrect: "The learner has settled on a materially incorrect response to the current objective.",
      unclear_or_incomplete: "The response is ambiguous, partial, unfinished, or does not settle the objective.",
      unresolved_help: "The learner still needs help or has asked for help that remains unresolved.",
      no_attempt: "There is no learner attempt at the current objective.",
    },
    tutorInstructions:
      "Classify only the latest relevant tutor response as a conversational act, separately from learner mastery. The application checks mastery independently. Give explicit acceptance precedence: yeah that's right, that fits, that answers it, or you've described it correctly is confirmed_completion when not followed by another question or request to try again. A confirming response may add a term, paraphrase, contrast, or explanatory detail (such as memory trace or not a note on paper); that does not turn the acceptance into help. Helping means guidance towards an answer without accepting the learner's answer. Earlier questions do not make a later acceptance clarifying. Carried criteria need not be restated. Questions seeking further explanation are clarifying or asking.",
    tutorCriteria: {
      confirmed_completion:
        "The latest tutor response explicitly accepts the learner's answer as correct or sufficient, without a further question or request to try again. Added explanation, vocabulary or contrast may accompany acceptance. Observe the acceptance act; this label alone does not establish learner mastery.",
      clarifying: "The tutor asks the learner to explain, repeat, or disambiguate without supplying a missing answer.",
      helping:
        "The tutor provides guidance, a hint, answer content or an example towards an answer without explicitly accepting the learner's answer. Explanatory detail following explicit acceptance belongs to confirmed_completion instead.",
      asking: "The tutor invites a response to the current scene.",
      other: "No relevant tutor response or another conversational function.",
    },
  },
};

export const CATCHING_UNICORNS_LESSON = validateLessonDefinition(lesson);
export const CATCHING_UNICORNS_SCENE_IDS = Object.keys(CATCHING_UNICORNS_LESSON.nodes);

/** Client-side reveal payloads stay outside current-node tutor/classifier context. */
export const CATCHING_UNICORNS_PRESENTATION = {
  engram: {
    reveals: {
      "engram-biological": {
        title: "Engram",
        text: "Biological memory: memory held within a biological mind.",
        source: SOURCE.introduction,
      },
    },
  },
  exogram: {
    reveals: {
      "exogram-non-biological": {
        title: "Exogram",
        text: "Non-biological memory: a representation kept outside biological memory.",
        source: SOURCE.introduction,
      },
    },
  },
  compare: {
    reveals: {
      "exogram-durability": {
        title: "Durable",
        text: "The source describes exograms as durable; it does not claim that biological memory can never last.",
        source: SOURCE.introduction,
      },
      "exogram-shareability": {
        title: "Shareable",
        text: "An exogram can be shared with other people.",
        source: SOURCE.introduction,
      },
      "exogram-revisability": {
        title: "Revisable",
        text: "An exogram can be revised or changed.",
        source: SOURCE.introduction,
      },
    },
  },
  exographics: {
    reveals: {
      "visual-symbols": {
        title: "Meaningful symbols on visual media",
        text: "Exographics is the inscription or use of meaningful symbols on a visual medium.",
        source: SOURCE.introduction,
      },
      "cultural-agreement": {
        title: "Shared meaning",
        text: "Symbols represent ideas through culturally agreed meanings.",
        source: SOURCE.introduction,
      },
      "beyond-prose": {
        title: "More than prose",
        text: "Equations, diagrams, tables, graphs, maps, music notation, pictures, signs, and emojis can also be symbolic representations.",
        source: SOURCE.introduction,
      },
      "abstract-concepts": {
        title: "Abstract ideas",
        text: "Symbols can represent abstract concepts that are not concrete objects in the world.",
        source: SOURCE.introduction,
      },
    },
  },
} as const;

/** Every reveal must map to exactly one criterion in its scene (recap is evidence projection only). */
export function validateCatchingUnicornsPresentation(): void {
  for (const [nodeId, data] of Object.entries(CATCHING_UNICORNS_PRESENTATION)) {
    if (!("reveals" in data)) continue;
    const concepts = CATCHING_UNICORNS_LESSON.nodes[nodeId]?.concepts ?? [];
    const revealIds = Object.keys(data.reveals);
    if (
      new Set(revealIds).size !== revealIds.length ||
      revealIds.some(id => !concepts.some(concept => concept.id === id))
    )
      throw new Error(`Catching Unicorns presentation has an unmapped reveal in ${nodeId}`);
  }
}

validateCatchingUnicornsPresentation();
