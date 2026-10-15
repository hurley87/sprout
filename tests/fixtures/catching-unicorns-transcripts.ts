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
} as const;

export const REQUIRED_TRANSCRIPT_VARIANTS = [
  "sufficient",
  "partial",
  "misconception",
  "selfCorrection",
  "nonLeadingProbe",
  "tutorLeakageEcho",
] as const;
