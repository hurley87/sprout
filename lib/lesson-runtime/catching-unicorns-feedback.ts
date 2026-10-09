/** Lesson-owned instructional choices, not new judgments of transcript quality.
 * Tiers describe what the existing rubric requires; priorities are ordinal tie-breaks.
 * Prerequisites gate extension opportunities, never suppress supported gaps.
 */
export type FeedbackMetadata = {
  strength: "reasoning" | "application" | "explanation" | "definition";
  priority: number;
  foundational?: boolean;
  prerequisites: string[];
  task: string;
};

export const CATCHING_UNICORNS_FEEDBACK: Record<string, FeedbackMetadata> = {
  "engram-biological": {
    strength: "definition",
    priority: 1,
    foundational: true,
    prerequisites: [],
    task: "Choose a remembered event. Say where that memory is held and explain why you would call it an engram, in your own words.",
  },
  "exogram-non-biological": {
    strength: "definition",
    priority: 2,
    foundational: true,
    prerequisites: ["engram-biological"],
    task: "Choose a note you could make about a remembered event. Identify where the information is kept and explain whether it is an exogram; contrast it with the remembered event.",
  },
  "visual-symbols": {
    strength: "definition",
    priority: 3,
    foundational: true,
    prerequisites: ["exogram-non-biological"],
    task: "Draw three marks to represent a simple plan. Explain what each mark means and whether your example fits exographics.",
  },
  "memory-extension": {
    strength: "reasoning",
    priority: 5,
    prerequisites: ["exogram-non-biological", "visual-symbols"],
    task: "Solve a small multi-step problem on paper. Mark the intermediate steps you would otherwise need to remember and explain what changes in your reasoning when they are written down.",
  },
  discovery: {
    strength: "definition",
    priority: 4,
    prerequisites: ["engram-biological", "exogram-non-biological", "memory-extension"],
    task: "Write or draw a small example where an external representation makes a relationship easier to notice. Identify what you noticed and explain why that helps reasoning; consider whether you recorded an idea or found a new one.",
  },
  reification: {
    strength: "reasoning",
    priority: 6,
    prerequisites: ["visual-symbols"],
    task: "Choose an abstract relationship, represent it with two symbols and a connecting mark, then change one part. Explain what you can inspect or manipulate in this representation.",
  },
  "synthesis-reasoning": {
    strength: "reasoning",
    priority: 7,
    prerequisites: ["visual-symbols", "memory-extension"],
    task: "Draw a two-step argument using symbols. Point to a relationship that becomes easier to inspect and explain how the representation helps you continue the argument.",
  },
  "synthesis-memory-symbols": {
    strength: "reasoning",
    priority: 8,
    prerequisites: ["engram-biological", "exogram-non-biological", "visual-symbols"],
    task: "Use one remembered idea and one written symbolic example. Explain how engrams, exograms and exographics relate in your examples, and identify a distinction between the terms.",
  },
  "synthesis-discovery-eclass": {
    strength: "reasoning",
    priority: 9,
    prerequisites: ["discovery"],
    task: "Sketch a problem representation that helps you notice a new relationship. Explain whether your example supports the Preface's e-Class claim and identify what further evidence you would need.",
  },
  "synthesis-culture": {
    strength: "reasoning",
    priority: 10,
    prerequisites: ["cultural-agreement", "social-coordination"],
    task: "Choose a shared symbolic practice and sketch two links to cultural life. Explain why each link follows and one reason the relationship might be more complex than a simple chain.",
  },
  "caf-defensible-conclusion": {
    strength: "reasoning",
    priority: 11,
    prerequisites: [
      "caf-literacy-evidence",
      "caf-discovery-evidence",
      "caf-coordination-evidence",
      "caf-education-evidence",
    ],
    task: "Write a yes, no or qualified conclusion about the Canadian Armed Forces using two framework characteristics. Cite evidence for each and explain one limit of your conclusion.",
  },
  "caf-discovery-evidence": {
    strength: "application",
    priority: 12,
    prerequisites: ["idea-discoverers"],
    task: "Find a checkable Canadian Armed Forces example relevant to developing new ideas. Connect it to the framework's discovery characteristic and explain what the evidence cannot establish.",
  },
  "caf-coordination-evidence": {
    strength: "application",
    priority: 13,
    prerequisites: ["social-coordination"],
    task: "Find a checkable Canadian Armed Forces example of coordination. Connect it to the framework's coordination characteristic and explain a limit of that connection.",
  },
  "caf-education-evidence": {
    strength: "application",
    priority: 14,
    prerequisites: ["education-system"],
    task: "Find checkable evidence about Canadian Armed Forces education. Compare it with the framework's education characteristic and explain what remains unknown.",
  },
  "caf-literacy-evidence": {
    strength: "application",
    priority: 15,
    prerequisites: ["widespread-literacy"],
    task: "Find checkable evidence about reading, writing or arithmetic in the Canadian Armed Forces. Connect it to the framework's literacy characteristic and explain how broadly your evidence applies.",
  },
  "cultural-agreement": {
    strength: "explanation",
    priority: 16,
    prerequisites: ["visual-symbols"],
    task: "Invent a symbol for an instruction and ask another person to interpret it. Compare their interpretation with yours and explain what makes a symbol's meaning shared.",
  },
  "abstract-concepts": {
    strength: "explanation",
    priority: 17,
    prerequisites: ["visual-symbols"],
    task: "Represent an abstract idea with a mark or diagram. Name the idea and explain how the representation stands for it rather than a concrete object.",
  },
  "exogram-durability": {
    strength: "explanation",
    priority: 18,
    prerequisites: ["exogram-non-biological"],
    task: "Take a paper note about an event. Explain what could preserve or lose that information over time, compare it with remembering the event, and relate your comparison to the manuscript's durability claim.",
  },
  "exogram-shareability": {
    strength: "explanation",
    priority: 19,
    prerequisites: ["exogram-non-biological"],
    task: "Write a short instruction for another person. Explain how you could share the record and compare that with sharing information held in your memory.",
  },
  "exogram-revisability": {
    strength: "explanation",
    priority: 20,
    prerequisites: ["exogram-non-biological"],
    task: "Write an initial plan and a revised version. Point to the changes and explain how this illustrates the manuscript's comparison of exograms and biological memory.",
  },
  "social-coordination": {
    strength: "explanation",
    priority: 21,
    prerequisites: [],
    task: "Choose an everyday situation involving strangers. Identify a structure or behavior that helps them coordinate and explain its role in the Introduction's framework.",
  },
  "education-system": {
    strength: "explanation",
    priority: 22,
    prerequisites: [],
    task: "Sketch an education system with two learning paths. Explain who each path serves and compare their roles with the Introduction's education characteristic.",
  },
  "idea-discoverers": {
    strength: "definition",
    priority: 23,
    prerequisites: [],
    task: "Choose an example of people developing a new idea. Explain who contributes and compare their role with the Introduction's discovery characteristic.",
  },
  "widespread-literacy": {
    strength: "definition",
    priority: 24,
    prerequisites: [],
    task: "List three everyday activities that use basic literacy. Explain who needs those skills and compare your examples with the Introduction's literacy characteristic.",
  },
  "beyond-prose": {
    strength: "definition",
    priority: 25,
    prerequisites: ["visual-symbols"],
    task: "Make a symbolic example that is not prose. Explain what information it conveys and why it fits the lesson's account of exographics.",
  },
};
