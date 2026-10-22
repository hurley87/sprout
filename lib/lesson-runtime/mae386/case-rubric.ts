import { example as e, type QuestionRubric, type RubricUnit } from "./rubric-types";

const cases: RubricUnit[] = [
  {
    id: "q5-a",
    originalPart: "Q5(a)",
    prompt:
      "Would this belong to the e-Class? Explain what would make exographics necessary for its discovery, or why you are uncertain.",
    visibleSource: "Any one of the models that implement OpenAI's ChatGPT. (Q5(a); spoken case adapted from the exam.)",
    referenceAnswer:
      "A defensible inference is yes: discovering/engineering the mathematical model and implementation depends on developing and manipulating symbolic mathematical and code representations beyond unaided memory. The book connects mathematical models of neural networks with deep learning, but does not give a model-specific history or classify ChatGPT. Saying yes because it is digital, uses technology, or generates written text does not apply the discovery-necessity test. Reasoned uncertainty is acceptable when it identifies the missing discovery-history evidence rather than fabricating it.",
    criteria: [
      {
        id: "discovery-test",
        basis: "source-backed",
        sources: ["eclass"],
        description:
          "Applies the e-Class test to discovery/development requiring exographics, rather than current use of technology, reading ability, or later documentation.",
      },
      {
        id: "case-reasoning",
        basis: "course-inference",
        sources: ["computing", "eclass"],
        description:
          "Relates the model's discovery to explicit mathematical/code representations and their cognitive role, or gives reasoned uncertainty about that necessity and identifies missing evidence. Yes is a defensible inference, not a mandatory model-specific book verdict. A different conclusion requires a coherent account of discovery without required exographics; a bare no is insufficient.",
      },
    ],
    tutor: {
      probe: "What about the discovery process supports your classification?",
      help: "On request explain the required-for-discovery test, then let the learner apply it. If supplying a mathematical-model example, record subsequent use as assisted.",
      avoid:
        "Do not assert a secret official yes/no key, invent OpenAI development facts, or count the generated text as proof of discovery necessity.",
      close:
        "Close after a reasoned classification or justified uncertainty, without forcing an unsupported historical certainty.",
    },
    review:
      "Provisional case application; the definition is certain within the manuscript but the ChatGPT classification is inferred. No historical model-development claims were externally verified; official calibration requires Bill's review.",
    examples: [
      e(
        "model-symbolic-development",
        "complete",
        "I would put it in the e-Class: developing its mathematical model and code requires working with symbolic representations and long calculations, not just remembering it all unaided. That's an inference about development, not because its output is text.",
        { "discovery-test": "independent", "case-reasoning": "independent" },
        "Explains the necessary exographic reasoning rather than merely observing technology; conclusion remains an inference.",
      ),
      e(
        "model-label-only",
        "partial",
        "Yes, it is in the e-Class.",
        { "discovery-test": "missing", "case-reasoning": "partial" },
        "A classification alone lacks the required reason.",
      ),
      e(
        "model-digital-test",
        "incorrect",
        "Anything electronic is e-Class by definition, so ChatGPT must be.",
        { "discovery-test": "incorrect", "case-reasoning": "incorrect" },
        "Electronics is not the book's membership test.",
      ),
      e(
        "model-unspecified-writing",
        "ambiguous",
        "People wrote about it, so probably yes.",
        { "discovery-test": "unresolved", "case-reasoning": "partial" },
        "Clarify whether writing was necessary during discovery or just documentation afterward.",
      ),
      e(
        "model-qualified-uncertainty",
        "alternate",
        "The test is whether it could have been discovered without exographics. Its mathematical design suggests it needed them, but I cannot establish that necessity from this short description. I would want evidence of how the model was designed.",
        { "discovery-test": "independent", "case-reasoning": "independent" },
        "Complete reasoning with explicitly unresolved object membership; reasoning completeness is not a definitive yes/no classification.",
      ),
    ],
  },
  {
    id: "q5-c",
    originalPart: "Q5(c)",
    prompt: "Would this nursery rhyme belong to the e-Class? Explain your reasoning and any uncertainty.",
    visibleSource:
      "The Cat and the Fiddle begins 'Hey diddle diddle, the cat and the fiddle'. The exam says its earliest print evidence dates to 1765 and places it in an earlier English nonsense-rhyme tradition. (Condensed Q5(c).)",
    referenceAnswer:
      "A defensible answer is not necessarily: people can compose and transmit rhymes orally, and printing a rhyme later does not show exographics was required to discover it. The manuscript's Homer discussion supports oral composition in principle. The exam description is not proof of the precise composition process of this rhyme, so a conditional no or explicit uncertainty with that distinction is better than pretending its date or authorship settles membership.",
    criteria: [
      {
        id: "discovery-test",
        basis: "source-backed",
        sources: ["eclass"],
        description: "Uses required-for-discovery rather than appeared-in-print as the e-Class test.",
      },
      {
        id: "case-reasoning",
        basis: "course-inference",
        sources: ["oralCreation", "eclass"],
        description:
          "Explains plausible oral composition/transmission versus later inscription and bounds what is known about this named rhyme. A qualified nonmembership or justified uncertainty is acceptable; a different argument must establish necessity, not merely usefulness, of writing.",
      },
    ],
    tutor: {
      probe: "What does the evidence of printing tell us, and what does it leave open?",
      help: "If asked, distinguish discovering a rhyme from recording one and invite their own application. Label relevant later explanation assisted.",
      avoid:
        "Do not invent a known oral author, claim that a first print date is a composition date, or classify every printed poem as e-Class.",
      close:
        "Acknowledge a defensible distinction even if exact membership remains unknown; close without requiring invented history.",
    },
    review:
      "Provisional named-case inference. The book establishes the possibility of oral composition, not the actual history of this rhyme; exam facts are source-provided premises, not independently established history.",
    examples: [
      e(
        "rhyme-oral-possibility",
        "complete",
        "I would not assume it is e-Class. A rhyme can be composed and passed on orally, and printing it later does not mean writing was needed to create it. We do not know this rhyme's exact origin from those facts.",
        { "discovery-test": "independent", "case-reasoning": "independent" },
        "Applies the necessity test and limits the historical conclusion.",
      ),
      e(
        "rhyme-bare-no",
        "partial",
        "No, it's just a nursery rhyme.",
        { "discovery-test": "missing", "case-reasoning": "partial" },
        "Genre alone does not show why writing was unnecessary.",
      ),
      e(
        "rhyme-print-equals-membership",
        "incorrect",
        "Yes, the 1765 printing proves it required writing to be invented.",
        { "discovery-test": "incorrect", "case-reasoning": "incorrect" },
        "Conflates later inscription with necessary discovery support.",
      ),
      e(
        "rhyme-date-only",
        "ambiguous",
        "It is old, so I think no.",
        { "discovery-test": "missing", "case-reasoning": "unresolved" },
        "Age alone is not the test; ask for the link to discovery.",
      ),
      e(
        "rhyme-unknown-origin",
        "alternate",
        "I cannot settle its membership. It could have been improvised orally, but a writer might have worked it out on paper. What matters is whether paper was necessary, and the first surviving print does not establish that.",
        { "discovery-test": "independent", "case-reasoning": "independent" },
        "A complete, defensible uncertainty argument rather than forced no.",
      ),
    ],
  },
  {
    id: "q5-f",
    originalPart: "Q5(f)",
    prompt:
      "Would this drop spindle belong to the e-Class? Apply the discovery test and explain what remains uncertain.",
    visibleSource:
      "Drop spindles spin wool or plant fibres into continuous yarn. The exam describes archaeological spindle evidence at Nahal Ein-Gev II about 12,500 years ago, and earlier twisted flax fibres in the Caucasus about 30,000 years ago. (Condensed Q5(f); dates are exam premises.)",
    referenceAnswer:
      "A defensible inference is probably not: people could discover how to twist fibres and construct a spindle by repeated material experimentation and demonstration, without requiring exographic reasoning. The book explicitly lists yarn among inventions before exographics. But yarn and a particular spindle are different objects, and the exam's dates alone do not prove exactly how this spindle was discovered. Accept conditional nonmembership or justified uncertainty; do not turn a plausible material-practice account into a fabricated historical finding.",
    criteria: [
      {
        id: "discovery-test",
        basis: "source-backed",
        sources: ["eclass"],
        description:
          "Applies necessity of exographics for discovery, not whether the object is a tool, can be diagrammed, or has a modern written scientific explanation.",
      },
      {
        id: "case-reasoning",
        basis: "course-inference",
        sources: ["oralCreation", "eclass"],
        description:
          "Explains how physical trial, observation and demonstration could enable discovery of spinning/spindle design, or states a reasoned evidence gap. Distinguishes yarn from the specific spindle; archaeological age and modern material science alone do not settle membership.",
      },
    ],
    tutor: {
      probe: "How might someone have discovered this, and which part of that account is supported by the description?",
      help: "On request explain necessity versus usefulness of a diagram; invite their own application without dictating a verdict.",
      avoid:
        "Do not declare prehistory alone proves no exographics, equate yarn with the exact spindle, or say the scientific explanation had to be known before practical discovery.",
      close:
        "Close on a reasoned conditional classification/uncertainty. Unresolved history does not trap the learner or become an incorrect answer.",
    },
    review:
      "Provisional specific-object classification. Yarn predating exographics is explicit on p. 38; the manuscript does not document discovery of the particular spindle in Q5(f).",
    examples: [
      e(
        "spindle-material-experiment",
        "complete",
        "Probably not: someone could experiment with twisting fibres and spinning a weight, then show others. That discovery need not use symbolic diagrams. The book's yarn example supports the possibility, but it does not prove the history of this particular spindle.",
        { "discovery-test": "independent", "case-reasoning": "independent" },
        "Applies necessity and qualifies the specific-object historical inference.",
      ),
      e(
        "spindle-bare-age",
        "partial",
        "No, because it is prehistoric.",
        { "discovery-test": "missing", "case-reasoning": "partial" },
        "Age alone does not articulate discovery necessity or an alternative discovery mechanism.",
      ),
      e(
        "spindle-science-prerequisite",
        "incorrect",
        "Yes: because scientists now describe fibre strength mathematically, the first spinner had to know that mathematics.",
        { "discovery-test": "incorrect", "case-reasoning": "incorrect" },
        "A later theoretical explanation is not a prerequisite for practical invention.",
      ),
      e(
        "spindle-tool-confusion",
        "ambiguous",
        "It helps people think, so perhaps it counts.",
        { "discovery-test": "unresolved", "case-reasoning": "partial" },
        "Being a useful artifact does not establish exographic discovery necessity.",
      ),
      e(
        "spindle-historical-gap",
        "alternate",
        "The e-Class requires writing or other exographic representations for discovery. Trial and demonstration could explain a spindle, but the dates do not tell us the actual process, so I would leave membership uncertain unless we get evidence of that process.",
        { "discovery-test": "independent", "case-reasoning": "independent" },
        "Complete justified uncertainty, without inventing a final no key.",
      ),
    ],
  },
];

export const CASE_RUBRIC: QuestionRubric = {
  id: "q5",
  title: "Applying the e-Class discovery test",
  mode: "case classification",
  adaptation:
    "Only Q5(a), (c) and (f) are discussed, in that order. The complete eight-case printed wording remains in exam-source.ts and the canonical PDF. Original 8-mark total does not apply. Case reasoning coverage can be complete while historical membership remains explicitly uncertain.",
  units: cases,
};
