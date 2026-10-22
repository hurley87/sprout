export const MAE386_SOURCES = {
  exam: { path: "docs/sources/mae386/questions.pdf", pages: 16, identity: "MAE386 Final Examination, April 2026" },
  manuscript: {
    path: "docs/sources/mae386/catchin-unicorns.pdf",
    pages: 259,
    identity: "Catching Unicorns, Bill Hurley and David Hurley, Preface dated September 2025",
    pdfCreationDate: "2025-09-17T19:56:11Z",
  },
  verifiedOn: "2026-10-20",
  pageConvention:
    "Citations use printed manuscript pages. pdfPages are one-based viewer positions, not zero-based indices. Arabic printed pages in this file have pdfPage = printedPage + 14.",
} as const;

/** Summaries of inspected passages, not verbatim quotations or claims of external fact verification. */
export const MANUSCRIPT_PASSAGES = {
  reification: {
    chapter: "Chapter 1: The Role of Exographics in the Discovery of Ideas",
    printedPages: [35, 36, 38],
    pdfPages: [49, 50, 52],
    establishes:
      "Visual inscriptions make representations of abstract concepts available for manipulation and combination. Reification concerns the representation becoming visible/concrete, not a unicorn or other referent physically coming into existence.",
  },
  memory: {
    chapter: "Chapter 1: The Role of Exographics in the Discovery of Ideas",
    printedPages: [29, 30, 37, 38],
    pdfPages: [43, 44, 51, 52],
    establishes:
      "Limited working memory and effortful long-term storage impede extended symbolic arguments. External records preserve intermediate steps for recall, enabling longer arguments. Naming storage alone omits its reasoning function.",
  },
  systems: {
    chapter: "Chapter 3: The Diaconatic: A Theory of Embodied Ideation",
    printedPages: [53, 54],
    pdfPages: [67, 68],
    establishes:
      "The manuscript presents Kahneman's System 1 as quick/intuitive and System 2 as slow/deliberate/effortful; the bat-and-ball example illustrates misleading intuition. This is a process distinction, not a division into smart/stupid people or guaranteed right/wrong answers.",
  },
  phonetic: {
    chapter: "Chapter 8: The Evolution of Exographic Technologies",
    printedPages: [111, 112],
    pdfPages: [125, 126],
    establishes:
      "Phonetic visual symbols represent speech sounds; pictographic symbols picture concepts. A novice can combine sounds to decode an unfamiliar written form of an already-known spoken word. Page 112 links this to quicker learning, not universally faster mature reading.",
  },
  eclass: {
    chapter: "Chapter 2: The Growth of the Ideasphere and the e-Class",
    printedPages: [39],
    pdfPages: [53],
    establishes:
      "The e-Class is the subset of the Ideasphere whose discovery required exographics. It is not the set of all technology or all objects later written about. The passage does not classify the three selected exam cases individually.",
  },
  oralCreation: {
    chapter: "Chapter 1: The Role of Exographics in the Discovery of Ideas",
    printedPages: [31, 38],
    pdfPages: [45, 52],
    establishes:
      "Oral poets can compose substantial stories; the manuscript names pottery, yarn and bread as innovations before exographics. This supports the possibility of oral rhyme and practical invention without writing, but is not a historical finding about the named rhyme or specific spindle.",
  },
  computing: {
    chapter: "Introduction; Chapter 3: The Diaconatic: A Theory of Embodied Ideation",
    printedPages: [9, 10, 53],
    pdfPages: [23, 24, 67],
    establishes:
      "Abstract mathematics uses exographic representations; computer scientists use computers; mathematical neural-network models underpin deep-learning breakthroughs. Applying this account to a particular ChatGPT model is a course inference, not an explicit model-specific book classification.",
  },
  culture: {
    chapter: "Introduction",
    printedPages: [5, 6],
    pdfPages: [19, 20],
    establishes:
      "Four characteristics: widespread basic reading/writing/arithmetic; a smaller group advancing ideas; structures/norms enabling large groups of strangers to coexist; and substantial basic/advanced education. Applying them to the CAF is an institutional analogy, not a book verdict about the CAF.",
  },
  learningPotential: {
    chapter: "Introduction; Chapter 1: The Role of Exographics in the Discovery of Ideas",
    printedPages: [8, 38],
    pdfPages: [22, 52],
    establishes:
      "The Introduction's child-culture-switch thought experiment and Chapter 1's discussion of children in oral societies argue for common capacity to learn culture/exographics, rather than inherited inability.",
  },
  cognitiveDivide: {
    chapter: "Chapter 16: Does Exographics Explain The Great Divide?",
    printedPages: [195, 197, 198, 199, 200, 201, 206, 207],
    pdfPages: [209, 211, 212, 213, 214, 215, 220, 221],
    establishes:
      "Distinguishes cultural differences from innate cognitive inferiority. Contrasts education/test familiarity with inherited ability, describes sophisticated Inuit innovation and environmental knowledge, and argues for shared cognitive potential. These are the manuscript's arguments; no claim that its examples prove universal cognitive equality by themselves.",
  },
  imagination: {
    chapter:
      "Chapter 3: The Diaconatic: A Theory of Embodied Ideation; Chapter 6: Collaboration and Networked Imaginations",
    printedPages: [49, 84],
    pdfPages: [63, 98],
    establishes:
      "The imagination contributes to ideation and scientific theory. Newton hypothesized invisible gravity to account for planetary motion. These passages do not provide a canonical philosophy-of-science answer or establish that science is arbitrary fiction.",
  },
  scientificUse: {
    chapter: "Chapter 6: Collaboration and Networked Imaginations",
    printedPages: [79, 80],
    pdfPages: [93, 94],
    establishes:
      "The NMR-to-MRI account illustrates observations becoming useful technology and continuing refinement. Prediction/testability/revisability as a general defense of science are reasonable argumentative extrapolations, not an enumerated answer key in this passage.",
  },
} as const;

export type PassageId = keyof typeof MANUSCRIPT_PASSAGES;
