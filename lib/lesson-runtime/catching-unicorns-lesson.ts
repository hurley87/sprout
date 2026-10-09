import {
  validateLessonDefinition,
  type ConceptCriterionDefinition,
  type LessonDefinition,
  type LessonNodeDefinition,
} from "./lesson-definition";

/**
 * Standalone, removable Catching Unicorns lesson content.
 *
 * Source basis: the reviewed inventory for the quiet-revision manuscript's Preface
 * pp. xi–xiii and Introduction pp. 3–6 in issue #65. The referenced `CU to Dave.pdf`
 * was not present in the searched workspace, so page claims are inherited from that
 * reviewed inventory and have not been independently checked against the PDF here.
 */
const SOURCE = {
  preface: "Catching Unicorns, Preface, pp. xi–xiii (source inventory in issue #65)",
  introduction: "Catching Unicorns, Introduction, pp. 3–6 (source inventory in issue #65)",
  transfer: "Application prompt only; not a canonical claim from the supplied excerpt",
} as const;

const criterion = (id: string, description: string): ConceptCriterionDefinition => ({ id, description });

const scene = (definition: {
  id: string;
  title: string;
  prompt: string;
  objective: string;
  tutorBrief: string;
  assessConversationOnEntry?: boolean;
  concepts?: readonly ConceptCriterionDefinition[];
  next: string | null;
  carry?: readonly string[];
}): LessonNodeDefinition => ({
  id: definition.id,
  presentation: { sceneId: definition.id, title: definition.title, prompt: definition.prompt },
  learningObjective: definition.objective,
  tutorBrief: definition.tutorBrief,
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
        "Focus on the learner's explanation of external, non-biological memory. Only if the explanation is unclear, ask how their example preserves information outside the learner. An explanation of information stored outside the brain with a written-note example is sufficient; do not ask them to confirm that same point. Briefly acknowledge it in a complete sentence, then pause for the app to advance. Do not define it for them. The already demonstrated engram evidence may be carried forward without re-teaching it.",
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
      next: "why-exographics",
    }),
    "why-exographics": scene({
      id: "why-exographics",
      title: "Why external symbols matter",
      prompt:
        "Try to reason through 84 + 1,045 + 693 + 719 without writing anything down. What changes when you can use paper and a pencil?",
      objective: "Explain what changes in reasoning when the source's numeric example is represented on paper.",
      tutorBrief:
        "The arithmetic result is not the target. Assess the three ideas independently. Natural paraphrases count. Ask the learner to describe what changed in their own reasoning; do not name an un-demonstrated idea or provide an example answer.",
      concepts: [
        criterion(
          "reification",
          `Source-backed (${SOURCE.preface}): explains that symbols bring representations of abstract concepts into the visual field so they can be inspected or manipulated. A paraphrase is sufficient; do not require the word reification.`,
        ),
        criterion(
          "memory-extension",
          `Source-backed (${SOURCE.preface}): explains that external representations can carry information through a longer chain of reasoning, reducing what must remain in unaided biological memory. A paraphrase is sufficient; do not require the phrase memory extension.`,
        ),
        criterion(
          "discovery",
          `Source-backed (${SOURCE.preface}): recognizes the stronger claim that exographics can participate in producing or discovering ideas, rather than only recording an idea already completed.`,
        ),
      ],
      next: "techno-literate-culture",
    }),
    "techno-literate-culture": scene({
      id: "techno-literate-culture",
      title: "Culture and literacy",
      prompt:
        "The Introduction describes four characteristics of a techno-literate culture. What do you remember about them? Start with any one, and explain how it helps the culture develop.",
      objective: "Explain each of the four characteristics presented in the Introduction.",
      tutorBrief:
        "Assess four separately; accept paraphrases. Start with any one. Rephrase around the framework and their example. Build on records, shared languages and schools; avoid repeated What else? After difficulty or a help request, offer one targeted cue: most people's basic skills, who discovers ideas, how strangers coordinate, or levels of education. If needed, explain that one characteristic and invite their own explanation of its role. Explain all four if requested; wait for an attempt first. Tutor words alone are not learner evidence; an explanation after help is supported understanding, not independent recall. Keep gaps unresolved; honor next requests.",
      concepts: [
        criterion(
          "widespread-literacy",
          `Source-backed (${SOURCE.introduction}): says most people have a minimal level of literacy, including reading, writing, and arithmetic.`,
        ),
        criterion(
          "idea-discoverers",
          `Source-backed (${SOURCE.introduction}): says a relatively small set of people can discover ideas that move the culture forward; it is not necessary for everyone to be an inventor.`,
        ),
        criterion(
          "social-coordination",
          `Source-backed (${SOURCE.introduction}): explains that social/economic structures and behaviors help large populations of strangers coexist in relative harmony; a concrete example such as laws, markets, cities, or institutions is sufficient.`,
        ),
        criterion(
          "education-system",
          `Source-backed (${SOURCE.introduction}): describes substantial education that teaches basic literacy broadly and advanced knowledge to some people so they can arrive at new ideas.`,
        ),
      ],
      next: "caf-application",
    }),
    "caf-application": scene({
      id: "caf-application",
      title: "Apply the framework",
      prompt:
        "Using the four-characteristic techno-literate-culture framework from the previous question, how would you assess the Canadian Armed Forces? Explain your conclusion with evidence.",
      objective:
        "Apply each source characteristic to evidence about an institution and explain a defensible conclusion.",
      tutorBrief:
        "This is transfer reasoning, not a source-canonical fact. Accept either conclusion, including a qualified one, when evidence is connected thoughtfully to the framework. Ask about evidence for each characteristic and what remains uncertain. Never steer toward a predetermined yes/no or treat the model's preferred conclusion as a book fact.",
      concepts: [
        criterion(
          "caf-literacy-evidence",
          `Transfer rubric (${SOURCE.transfer}): connects relevant evidence about the Canadian Armed Forces to widespread reading, writing, and arithmetic literacy.`,
        ),
        criterion(
          "caf-discovery-evidence",
          `Transfer rubric (${SOURCE.transfer}): connects relevant evidence to whether a relatively small group can develop ideas that move the institution or its wider culture forward.`,
        ),
        criterion(
          "caf-coordination-evidence",
          `Transfer rubric (${SOURCE.transfer}): connects relevant evidence to structures and behaviors that let many people coordinate or coexist.`,
        ),
        criterion(
          "caf-education-evidence",
          `Transfer rubric (${SOURCE.transfer}): connects relevant evidence to broad basic education and advanced education for some.`,
        ),
        criterion(
          "caf-defensible-conclusion",
          `Transfer rubric (${SOURCE.transfer}): offers a conclusion (yes, no, or qualified) that follows from cited framework evidence and acknowledges material limits or uncertainty. No particular conclusion is canonical.`,
        ),
      ],
      next: "synthesis",
    }),
    synthesis: scene({
      id: "synthesis",
      title: "Connect the ideas",
      prompt:
        "How do engrams, exograms, exographics, reasoning, discovery, and techno-literate culture fit together? Choose a connection and explain why it follows.",
      objective: "Explain multiple relationships among ideas addressed in the earlier scenes.",
      tutorBrief:
        "Invite the learner to choose a connection and explain why it follows. Look for multiple relationships in the learner's own explanation. Extended cognition is not a required source term. Do not name or supply missing links before evidence.",
      concepts: [
        criterion(
          "synthesis-memory-symbols",
          `Source-backed (${SOURCE.preface}; ${SOURCE.introduction}): connects external/non-biological memory with exographics as meaningful visual symbolic representation, while keeping the ideas distinct.`,
        ),
        criterion(
          "synthesis-reasoning",
          `Source-backed (${SOURCE.preface}): explains how visual symbolic representations can make abstract ideas inspectable and extend a reasoning thread.`,
        ),
        criterion(
          "synthesis-discovery-eclass",
          `Source-backed (${SOURCE.preface}): relates exographics' role in discovery to the book's e-Class, ideas that could not otherwise be discovered.`,
        ),
        criterion(
          "synthesis-culture",
          `Source-backed (${SOURCE.introduction}): connects the growth/use of exographic ideas with the rise of techno-literate culture, without treating the relationship as a rigid one-step chain.`,
        ),
      ],
      next: "recap",
    }),
    recap: scene({
      id: "recap",
      assessConversationOnEntry: true,
      title: "What the conversation showed",
      prompt: "Review your recorded strengths, one area to deepen, and a next practice exercise.",
      objective: "Close with an evidence-based recap, without converting unresolved or skipped ideas into mastery.",
      tutorBrief:
        "Use the application-supplied session summary to give substantive feedback: recorded strengths, one area to deepen, and a concrete exercise. Preserve uncertainty and prompting qualifications. Do not invent feedback from conversation memory or claim to see unsupplied screen content. Treat Canadian Armed Forces reasoning as transfer, not a source-canonical fact.",
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
    sessionGuidance: `Use only claims grounded in ${SOURCE.preface} and ${SOURCE.introduction}. The app, not you, controls scene changes and visual reveals. Let the learner answer before teaching. Keep unresolved canonical answers private except when the current scene tutor brief explicitly permits targeted scaffolding after difficulty or a request. Tutor-supplied content alone never establishes learner mastery. Natural paraphrases count. A probe must clarify the learner's meaning without putting an answer in their mouth. Honor a request to stop or skip without treating it as evidence. Google/AI/memorization may be discussed only as optional transfer conversation and cannot gate mastery.`,
    startInstruction:
      "Begin the Catching Unicorns discussion by asking the current scene's prompt, then pause for the learner.",
    nodeInstruction:
      "Teach only the current scene and objective. Apply its tutor brief. Do not preview later scenes or select a transition; reveal unresolved content only as targeted help explicitly permitted by the current scene brief; the app owns those decisions. Ask naturally and leave space for the learner to reason. When the explanation appears sufficient, briefly acknowledge the specific idea and pause without a question. You may finish this question when the explanation is sufficient or the discussion has run its course, even if assessment is uncertain. Close with a concise acknowledgment of what was discussed, then pause without a question. Do not ask whether the learner is ready to move on. The app advances after your conversational closure and audio finishes; pause for it to provide the next scene. Do not ask the learner to press Continue. Do not request repeated rephrasing, ask what feels clear, or open an optional discussion after confirming success. If the learner asks a follow-up, answer it within this scene and pause again; do not invent another requirement for completion.",
  },
  classifier: {
    objectiveInstructions:
      "Classify the learner's understanding of the current scene objective only. Treat source-backed claims as paraphrasable evidence; the Canadian Armed Forces scene is transfer reasoning, not a canonical book fact. A request to stop or skip is not evidence of understanding.",
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
  "why-exographics": {
    promptVisual: { arithmetic: "84 + 1,045 + 693 + 719", note: "The arithmetic result is not a mastery criterion." },
    reveals: {
      reification: {
        title: "Reification purpose",
        text: "Bringing representations of abstract concepts into the visual field so they can be inspected and manipulated.",
        source: SOURCE.preface,
      },
      "memory-extension": {
        title: "Memory extension purpose",
        text: "Supporting longer threads of reasoning by placing representations in the visual field rather than holding every step in biological memory.",
        source: SOURCE.preface,
      },
      discovery: {
        title: "Discovery",
        text: "Exographics can participate in discovering ideas, not only record completed thought. The Preface also points to Einstein's work on special relativity as an example.",
        source: SOURCE.preface,
      },
    },
  },
  "techno-literate-culture": {
    reveals: {
      "widespread-literacy": {
        title: "Widespread basic literacy",
        text: "Most of the population has minimal reading, writing, and arithmetic literacy.",
        source: SOURCE.introduction,
      },
      "idea-discoverers": {
        title: "A smaller group discovers ideas",
        text: "A relatively small set of people can discover ideas that move the culture forward.",
        source: SOURCE.introduction,
      },
      "social-coordination": {
        title: "Structures support coexistence",
        text: "Social and economic structures and behaviors help large populations of strangers coexist in relative harmony.",
        source: SOURCE.introduction,
      },
      "education-system": {
        title: "Substantial education",
        text: "Education teaches basic literacy broadly and advanced knowledge to some, enabling new ideas.",
        source: SOURCE.introduction,
      },
    },
  },
  "caf-application": {
    transfer: true,
    framework: [
      { sourceNodeId: "techno-literate-culture", criterionId: "widespread-literacy", revealIf: "demonstrated" },
      { sourceNodeId: "techno-literate-culture", criterionId: "idea-discoverers", revealIf: "demonstrated" },
      { sourceNodeId: "techno-literate-culture", criterionId: "social-coordination", revealIf: "demonstrated" },
      { sourceNodeId: "techno-literate-culture", criterionId: "education-system", revealIf: "demonstrated" },
    ],
    reveals: {
      "caf-literacy-evidence": {
        title: "Literacy evidence",
        text: "Evidence connected to widespread reading, writing, and arithmetic literacy.",
        source: SOURCE.transfer,
      },
      "caf-discovery-evidence": {
        title: "Discovery evidence",
        text: "Evidence connected to people developing ideas that move the institution or wider culture forward.",
        source: SOURCE.transfer,
      },
      "caf-coordination-evidence": {
        title: "Coordination evidence",
        text: "Evidence connected to structures and behaviors that support coordination among many people.",
        source: SOURCE.transfer,
      },
      "caf-education-evidence": {
        title: "Education evidence",
        text: "Evidence connected to broad basic education and advanced education for some.",
        source: SOURCE.transfer,
      },
      "caf-defensible-conclusion": {
        title: "Your conclusion",
        text: "A conclusion supported by framework evidence. Yes, no, and qualified conclusions can all be defensible; this is transfer reasoning, not a canonical fact from the excerpt.",
        source: SOURCE.transfer,
      },
    },
  },
  synthesis: {
    reveals: {
      "synthesis-memory-symbols": {
        title: "Memory and symbolic representation",
        text: "Engrams and exograms distinguish biological from non-biological memory; exographics is the broader practice of meaningful visual symbols.",
        source: `${SOURCE.introduction}; ${SOURCE.preface}`,
      },
      "synthesis-reasoning": {
        title: "Reasoning with representations",
        text: "Visual symbols can make abstract ideas inspectable and extend a thread of reasoning.",
        source: SOURCE.preface,
      },
      "synthesis-discovery-eclass": {
        title: "Discovery and the e-Class",
        text: "The book connects exographics with discovering ideas that otherwise could not be discovered, called the e-Class.",
        source: SOURCE.preface,
      },
      "synthesis-culture": {
        title: "Techno-literate culture",
        text: "The book connects exographic ideas with the rise of techno-literate culture.",
        source: SOURCE.introduction,
      },
    },
  },
  recap: {
    groups: [
      { id: "independent", title: "Demonstrated independently", evidence: "demonstrated-independent" },
      { id: "prompted", title: "Demonstrated after a prompt", evidence: "demonstrated-prompted" },
      { id: "unattributed", title: "Demonstrated · prompting unclear", evidence: "demonstrated-unattributed" },
      { id: "partial", title: "Partly explained", evidence: "partial" },
      { id: "missing", title: "Still unresolved or skipped", evidence: "not-yet-or-absent" },
    ],
    transferCriterionIds: [
      "caf-literacy-evidence",
      "caf-discovery-evidence",
      "caf-coordination-evidence",
      "caf-education-evidence",
      "caf-defensible-conclusion",
    ],
    policy:
      "Recap labels describe recorded evidence only. A skipped or unresolved criterion remains unresolved; do not append the hidden reveal text to explain it.",
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
