/** Reviewed synthetic transcripts and criterion-level reducer expectations, not model performance claims. */
export type FixtureObservation = "demonstrated_independent" | "demonstrated_prompted" | "partial" | "not_yet";

export const CATCHING_UNICORNS_TRANSCRIPT_FIXTURES = {
  engram: {
    sufficient: {
      transcript:
        "Tutor: What is an engram?\nChild: It is memory held by a biological mind, unlike a note kept outside the person.",
      observations: { "engram-biological": "demonstrated_independent" },
    },
    partial: {
      transcript: "Tutor: What is an engram?\nChild: It is a memory...",
      observations: { "engram-biological": "partial" },
    },
    misconception: {
      transcript: "Tutor: What is an engram?\nChild: It is a written note stored outside the brain.",
      observations: { "engram-biological": "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: What is an engram?\nChild: A note on paper.\nChild: Wait, that's outside me; an engram is memory in a biological mind.",
      observations: { "engram-biological": "demonstrated_independent" },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: What is an engram?\nChild: I am not sure.\nTutor: Where does that memory exist, and how would it differ from a note?\nChild: In a biological mind; the note is outside it.",
      observations: { "engram-biological": "demonstrated_prompted" },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: An engram is memory held by a biological mind, unlike a note outside it.\nChild: An engram is memory held by a biological mind, unlike a note outside it.",
      observations: {},
    },
  },
  exogram: {
    sufficient: {
      transcript:
        "Tutor: What is an exogram?\nChild: A record outside a biological mind that can hold information, like a diagram kept on paper.",
      observations: { "exogram-non-biological": "demonstrated_independent" },
    },
    partial: {
      transcript: "Tutor: What is an exogram?\nChild: Something like a notebook.",
      observations: { "exogram-non-biological": "partial" },
    },
    misconception: {
      transcript: "Tutor: What is an exogram?\nChild: It is ordinary memory stored biologically in my head.",
      observations: { "exogram-non-biological": "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: What is an exogram?\nChild: A memory in my brain.\nChild: Actually, the notebook is the outside record; that is the exogram.",
      observations: { "exogram-non-biological": "demonstrated_independent" },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: What is an exogram?\nChild: Not sure.\nTutor: Can a symbol or note keep information outside your biological memory?\nChild: Yes, the note stores it externally.",
      observations: { "exogram-non-biological": "demonstrated_prompted" },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: An exogram is a non-biological record outside the mind.\nChild: An exogram is a non-biological record outside the mind.",
      observations: {},
    },
  },
  compare: {
    sufficient: {
      transcript:
        "Tutor: Compare engrams and exograms.\nChild: The first is biological memory, and the second is outside it. The external record can last, be passed to others, and be edited.",
      observations: {
        "engram-biological": "demonstrated_independent",
        "exogram-non-biological": "demonstrated_independent",
        "exogram-durability": "demonstrated_independent",
        "exogram-shareability": "demonstrated_independent",
        "exogram-revisability": "demonstrated_independent",
      },
    },
    mixedCriteria: {
      transcript:
        "Tutor: Compare their properties.\nChild: An engram is biological memory and an exogram is an outside record. An external record can remain available longer, though I am not sure how durable it is. I cannot say whether it can be shared or revised.",
      observations: {
        "engram-biological": "demonstrated_independent",
        "exogram-non-biological": "demonstrated_independent",
        "exogram-durability": "partial",
      },
    },
    partial: {
      transcript: "Tutor: How do they compare?\nChild: One lasts longer, I think...",
      observations: { "exogram-durability": "partial" },
    },
    misconception: {
      transcript:
        "Tutor: How do they compare?\nChild: The source says an exogram is biological and cannot be changed or shared.",
      observations: { "engram-biological": "not_yet", "exogram-non-biological": "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: Compare their properties.\nChild: Only exograms are revisable.\nChild: Wait, I should not say engrams can never change; the source says exograms are revisable, durable, and shareable.",
      observations: {
        "exogram-durability": "demonstrated_independent",
        "exogram-shareability": "demonstrated_independent",
        "exogram-revisability": "demonstrated_independent",
      },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: Compare the two.\nChild: I cannot remember.\nTutor: What could happen to an external record over time, with another person, or when edited?\nChild: It can persist, be shared, and be revised.",
      observations: {
        "exogram-durability": "demonstrated_prompted",
        "exogram-shareability": "demonstrated_prompted",
        "exogram-revisability": "demonstrated_prompted",
      },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: Exograms are durable, shareable, and revisable; the excerpt does not say biological memory is never those things.\nChild: Exograms are durable, shareable, and revisable; the excerpt does not say biological memory is never those things.",
      observations: {},
    },
  },
  exographics: {
    sufficient: {
      transcript:
        "Tutor: What is exographics?\nChild: It is using meaningful symbols on things we can see. People agree on what they mean, and equations, maps, and diagrams can show even abstract ideas.",
      observations: {
        "visual-symbols": "demonstrated_independent",
        "cultural-agreement": "demonstrated_independent",
        "beyond-prose": "demonstrated_independent",
        "abstract-concepts": "demonstrated_independent",
      },
    },
    partial: {
      transcript: "Tutor: What is exographics?\nChild: It is just an exogram, just writing things down.",
      observations: { "visual-symbols": "partial" },
    },
    misconception: {
      transcript:
        "Tutor: What is exographics?\nChild: It means any data stored anywhere, whether people understand its signs or see it.",
      observations: { "visual-symbols": "not_yet", "cultural-agreement": "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: What is exographics?\nChild: Just prose writing.\nChild: Actually, a map or equation also uses meaningful symbols people understand, and can represent an abstract idea.",
      observations: {
        "visual-symbols": "demonstrated_independent",
        "cultural-agreement": "demonstrated_independent",
        "beyond-prose": "demonstrated_independent",
        "abstract-concepts": "demonstrated_independent",
      },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: How is exographics broader than one exogram?\nChild: I do not know.\nTutor: Could a map or graph represent an idea even though it is not prose?\nChild: Yes; its visible symbols have shared meanings and can represent abstract things.",
      observations: {
        "visual-symbols": "demonstrated_prompted",
        "cultural-agreement": "demonstrated_prompted",
        "beyond-prose": "demonstrated_prompted",
        "abstract-concepts": "demonstrated_prompted",
      },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: Exographics uses culturally agreed meaningful symbols on visual media, beyond prose, to represent abstract ideas.\nChild: Exographics uses culturally agreed meaningful symbols on visual media, beyond prose, to represent abstract ideas.",
      observations: {},
    },
  },
  "why-exographics": {
    sufficient: {
      transcript:
        "Tutor: What changes when you use paper for 84 + 1,045 + 693 + 719?\nChild: The marks let me see and move the quantities around. I do not have to hold every intermediate step in mind, so I can follow a longer chain and sometimes discover something new, not just record it.",
      observations: {
        reification: "demonstrated_independent",
        "memory-extension": "demonstrated_independent",
        discovery: "demonstrated_independent",
      },
    },
    partial: {
      transcript: "Tutor: What changes when you can write?\nChild: It is easier...",
      observations: { reification: "partial", "memory-extension": "partial" },
    },
    misconception: {
      transcript:
        "Tutor: What does paper change?\nChild: It only copies a thought after it is already finished; it cannot help produce a new idea.",
      observations: { discovery: "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: What does paper change?\nChild: It is just for storing the answer.\nChild: More than that: I can inspect the marks, keep steps outside my head, and work out an idea I might not otherwise reach.",
      observations: {
        reification: "demonstrated_independent",
        "memory-extension": "demonstrated_independent",
        discovery: "demonstrated_independent",
      },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: What changes in that sum when you use paper?\nChild: Not sure.\nTutor: Could you say more about what felt different once you started writing?\nChild: I can inspect the marks, keep intermediate steps outside my memory, and maybe work out an idea I would not otherwise reach.",
      observations: {
        reification: "demonstrated_prompted",
        "memory-extension": "demonstrated_prompted",
        discovery: "demonstrated_prompted",
      },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: Paper can make abstract representations visible, extend reasoning beyond biological memory, and help discover ideas rather than only record them.\nChild: Paper can make abstract representations visible, extend reasoning beyond biological memory, and help discover ideas rather than only record them.",
      observations: {},
    },
  },
  "techno-literate-culture": {
    sufficient: {
      transcript:
        "Tutor: What characteristics make a culture techno-literate?\nChild: Basic reading, writing, and arithmetic are common; a smaller group can develop new ideas; institutions help strangers live together; and education teaches basic skills broadly and advanced knowledge to some.",
      observations: {
        "widespread-literacy": "demonstrated_independent",
        "idea-discoverers": "demonstrated_independent",
        "social-coordination": "demonstrated_independent",
        "education-system": "demonstrated_independent",
      },
    },
    partial: {
      transcript: "Tutor: What characteristics matter?\nChild: Lots of people use technology...",
      observations: {},
    },
    misconception: {
      transcript:
        "Tutor: What makes a culture techno-literate?\nChild: Everyone must be an inventor, and technology use alone is enough.",
      observations: { "idea-discoverers": "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: What characteristics matter?\nChild: Everyone needs to discover ideas.\nChild: Actually the book says a relatively small group can, while most people need basic literacy, shared structures help strangers coexist, and education develops knowledge.",
      observations: {
        "idea-discoverers": "demonstrated_independent",
        "widespread-literacy": "demonstrated_independent",
        "social-coordination": "demonstrated_independent",
        "education-system": "demonstrated_independent",
      },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: What characteristics matter?\nChild: I forget.\nTutor: Which part of your explanation would you like to expand?\nChild: Most people read, write, and calculate; institutions coordinate strangers; some people discover ideas; education teaches the basics and advanced knowledge to some.",
      observations: {
        "widespread-literacy": "demonstrated_prompted",
        "idea-discoverers": "demonstrated_prompted",
        "social-coordination": "demonstrated_prompted",
        "education-system": "demonstrated_prompted",
      },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: Most people have basic literacy, a smaller group discovers ideas, structures support strangers living together, and education teaches basic and advanced knowledge.\nChild: Most people have basic literacy, a smaller group discovers ideas, structures support strangers living together, and education teaches basic and advanced knowledge.",
      observations: {},
    },
  },
  "caf-application": {
    sufficient: {
      transcript:
        "Tutor: Is the Canadian Armed Forces a techno-literate culture?\nChild: I would say partly yes: its training and technical roles suggest advanced education and idea development, and its rules coordinate many people. I would still need evidence about literacy across the population before making a stronger claim.",
      observations: {
        "caf-education-evidence": "demonstrated_independent",
        "caf-discovery-evidence": "demonstrated_independent",
        "caf-coordination-evidence": "demonstrated_independent",
        "caf-defensible-conclusion": "demonstrated_independent",
      },
    },
    partial: {
      transcript: "Tutor: Is it a techno-literate culture?\nChild: Yes, because it is modern.",
      observations: { "caf-defensible-conclusion": "partial" },
    },
    misconception: {
      transcript:
        "Tutor: Is it a techno-literate culture?\nChild: There is one correct answer in the book, and I do not need to connect evidence to the four characteristics.",
      observations: { "caf-defensible-conclusion": "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: Is it a techno-literate culture?\nChild: Definitely yes because it uses technology.\nChild: That is not enough. I would make a qualified case using education and coordination, while checking literacy and idea-development evidence.",
      observations: {
        "caf-education-evidence": "demonstrated_independent",
        "caf-coordination-evidence": "demonstrated_independent",
        "caf-defensible-conclusion": "demonstrated_independent",
      },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: Is it a techno-literate culture?\nChild: Unsure.\nTutor: Which parts of the framework could you connect to evidence, and what would remain uncertain?\nChild: Training may support the education part and rules may coordinate people, but I would need more evidence for broad literacy and idea discovery. So my answer is qualified.",
      observations: {
        "caf-education-evidence": "demonstrated_prompted",
        "caf-coordination-evidence": "demonstrated_prompted",
        "caf-defensible-conclusion": "demonstrated_prompted",
      },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: You could argue it is a techno-literate culture because of training and coordination, but the conclusion is transfer reasoning and should acknowledge missing evidence.\nChild: You could argue it is a techno-literate culture because of training and coordination, but the conclusion is transfer reasoning and should acknowledge missing evidence.",
      observations: {},
    },
    defensibleYes: {
      transcript:
        "Tutor: Is the Canadian Armed Forces a techno-literate culture?\nChild: I would say yes for the institution: its members use reading, writing, and arithmetic; specialists can develop ideas; rules coordinate a large group; and training teaches basic and advanced knowledge. I would want evidence before extending the claim to society as a whole.",
      observations: {
        "caf-literacy-evidence": "demonstrated_independent",
        "caf-discovery-evidence": "demonstrated_independent",
        "caf-coordination-evidence": "demonstrated_independent",
        "caf-education-evidence": "demonstrated_independent",
        "caf-defensible-conclusion": "demonstrated_independent",
      },
    },
    defensibleNo: {
      transcript:
        "Tutor: Is the Canadian Armed Forces a techno-literate culture?\nChild: I would say not established on the evidence we have. It may have advanced training, specialists, and coordination, but I do not have evidence that basic literacy is widespread across the relevant population; since all four characteristics matter, I would withhold the label for now.",
      observations: {
        "caf-literacy-evidence": "demonstrated_independent",
        "caf-discovery-evidence": "demonstrated_independent",
        "caf-coordination-evidence": "demonstrated_independent",
        "caf-education-evidence": "demonstrated_independent",
        "caf-defensible-conclusion": "demonstrated_independent",
      },
    },
  },
  synthesis: {
    sufficient: {
      transcript:
        "Tutor: How do these ideas connect?\nChild: Biological memory is different from external records. Exographics is how meaningful visual symbols make abstract ideas inspectable and keep reasoning going. That can help discover ideas in the e-Class, which contributes to the kind of culture the book describes.",
      observations: {
        "synthesis-memory-symbols": "demonstrated_independent",
        "synthesis-reasoning": "demonstrated_independent",
        "synthesis-discovery-eclass": "demonstrated_independent",
        "synthesis-culture": "demonstrated_independent",
      },
    },
    partial: {
      transcript: "Tutor: How do these ideas connect?\nChild: They all involve memory somehow...",
      observations: { "synthesis-memory-symbols": "partial" },
    },
    misconception: {
      transcript:
        "Tutor: How do these ideas connect?\nChild: Exographics and exogram are identical words for the same thing, and writing only records finished thought.",
      observations: { "synthesis-memory-symbols": "not_yet", "synthesis-reasoning": "not_yet" },
    },
    selfCorrection: {
      transcript:
        "Tutor: How do they connect?\nChild: An exogram is exographics.\nChild: More carefully, one is an external memory representation and the other is a broader symbolic practice; those symbols can extend reasoning and participate in discovery.",
      observations: {
        "synthesis-memory-symbols": "demonstrated_independent",
        "synthesis-reasoning": "demonstrated_independent",
      },
    },
    nonLeadingProbe: {
      transcript:
        "Tutor: How do the ideas connect?\nChild: I am not sure.\nTutor: Could you expand on one part of what you have explained so far?\nChild: Symbols put abstract ideas where I can inspect them and extend a reasoning chain, which can help me discover something new.",
      observations: { "synthesis-reasoning": "demonstrated_prompted" },
    },
    tutorLeakageEcho: {
      transcript:
        "Tutor: External memory differs from biological memory; exographics represents abstract ideas visibly, extends reasoning, and can contribute to e-Class discovery and techno-literate culture.\nChild: External memory differs from biological memory; exographics represents abstract ideas visibly, extends reasoning, and can contribute to e-Class discovery and techno-literate culture.",
      observations: {},
    },
  },
} as const;

/** Opposed transfer conclusions remain evidence-linked and non-canonical. */
export const CATCHING_UNICORNS_TRANSFER_FIXTURES = {
  defensibleYes: CATCHING_UNICORNS_TRANSCRIPT_FIXTURES["caf-application"].defensibleYes.transcript,
  defensibleNo: CATCHING_UNICORNS_TRANSCRIPT_FIXTURES["caf-application"].defensibleNo.transcript,
  weak: CATCHING_UNICORNS_TRANSCRIPT_FIXTURES["caf-application"].partial.transcript,
} as const;

export const REQUIRED_TRANSCRIPT_VARIANTS = [
  "sufficient",
  "partial",
  "misconception",
  "selfCorrection",
  "nonLeadingProbe",
  "tutorLeakageEcho",
] as const;
