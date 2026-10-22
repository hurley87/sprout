import { example as e, learner, tutor, type QuestionRubric } from "./rubric-types";

export const CONCEPT_RUBRICS: readonly QuestionRubric[] = [
  {
    id: "q1",
    title: "Two values of exographics",
    mode: "conceptual explanation",
    adaptation:
      "Conversational paraphrase of Q1; names may be paraphrased if both functions are unmistakable. No original exam marks.",
    units: [
      {
        id: "q1",
        originalPart: "Q1, complete question",
        prompt: "What are the two values of exographics discussed in the book? Explain what each lets us do.",
        referenceAnswer:
          "Reification puts visible representations of abstract concepts in front of us so we can manipulate and combine them. Memory extension keeps information and intermediate steps outside our limited biological memory, so we can return to them and build longer, more complex arguments. A label alone does not explain either function; an accurate explanation without the technical label still shows the concept.",
        criteria: [
          {
            id: "reification",
            basis: "source-backed",
            sources: ["reification"],
            description:
              "Explains reification: inscribing visible representations of abstract concepts makes them available for manipulation/combination in reasoning. Accept clear paraphrases without the label; physically creating the represented thing is incorrect.",
          },
          {
            id: "memory-extension",
            basis: "source-backed",
            sources: ["memory"],
            description:
              "Explains memory extension: external records hold information/intermediate steps for reuse, reducing demands on limited memory and enabling extended reasoning. Naming memory or saying writing lasts longer without that reasoning function is partial.",
          },
        ],
        tutor: {
          probe: "What does each of the two things you named let a thinker do?",
          help: "If asked, explain one missing function briefly using a written calculation or abstract symbol; invite their own application and record relevant subsequent evidence as assisted.",
          avoid:
            "Do not name a missing function or supply its explanation in the initial probe. Do not require the learner to repeat technical labels after they have explained both meanings.",
          close:
            "Acknowledge once when both meanings are clear; otherwise close on explicit navigation or after a useful probe/help exchange has run its course, preserving partial evidence.",
        },
        review:
          "Definitions are directly supported. No instructor approval is required for formative feedback; terminology recall is reported separately from conceptual coverage.",
        examples: [
          e(
            "both-functions",
            "complete",
            "Reification lets us put abstract ideas into visible symbols and work on them. Memory extension lets us keep the steps on a page, freeing memory for the next step of a long argument.",
            { reification: "independent", "memory-extension": "independent" },
            "Explains both different functions and what each enables.",
          ),
          e(
            "labels-alone",
            "partial",
            "Reification and memory extension.",
            { reification: "partial", "memory-extension": "partial" },
            "Correct names, no conceptual explanations.",
          ),
          e(
            "visible-only",
            "partial",
            "Writing an equation lets me rearrange abstract quantities I can now see.",
            { reification: "independent", "memory-extension": "missing" },
            "Reification is shown; external recall/extended reasoning is absent.",
          ),
          e(
            "memory-only",
            "partial",
            "I save intermediate totals so I can keep calculating without remembering every previous step.",
            { reification: "missing", "memory-extension": "independent" },
            "Memory extension is shown; representing abstract concepts is absent.",
          ),
          e(
            "magical-materialization",
            "incorrect",
            "Reification makes an imagined unicorn physically exist, and memory extension permanently enlarges your brain.",
            { reification: "incorrect", "memory-extension": "incorrect" },
            "Confuses representations with referents and external support with biological enlargement.",
          ),
          e(
            "things-and-remembering",
            "ambiguous",
            "It makes things real and helps you remember.",
            { reification: "unresolved", "memory-extension": "partial" },
            "Ask what becomes real and how remembering supports thought; do not infer the missing mechanisms.",
          ),
          e(
            "tokens-and-scratchpad",
            "alternate",
            "A mark for an unknown quantity gives me something visible to combine with other marks. My scratchpad holds the earlier results while I reason onward.",
            { reification: "independent", "memory-extension": "independent" },
            "Complete paraphrase with neither required technical label.",
          ),
          e(
            "help-then-application",
            "assisted",
            [
              tutor("A page can keep intermediate results while you work on later ones."),
              learner(
                "So I can leave my subtotal there and use memory to work on the next calculation rather than rehearse it.",
              ),
            ],
            { reification: "missing", "memory-extension": "assisted" },
            "Adds an application after relevant answer content; credit is assisted, only for memory extension.",
            [2],
          ),
        ],
      },
    ],
  },
  {
    id: "q6",
    title: "System 1 and System 2",
    mode: "explanation with examples",
    adaptation:
      "Preserves the two descriptions and two examples required by Q6. The printed exam says dual purpose; the manuscript calls this dual process.",
    units: [
      {
        id: "q6",
        originalPart: "Q6, complete question",
        prompt: "Explain Kahneman's System 1 and System 2 thinking, and give a convincing example of each.",
        referenceAnswer:
          "System 1 is quick, intuitive thinking, such as immediately recognizing a familiar face without working through a deliberate analysis. System 2 is slower, deliberate, effortful thinking, such as checking a multi-step calculation line by line. The same task can use either process depending on familiarity and how it is approached. System 1 is not always wrong, nor System 2 always right. Examples here are authored illustrations, not book quotations.",
        criteria: [
          {
            id: "system1-description",
            basis: "source-backed",
            sources: ["systems"],
            description:
              "Describes System 1 as quick/intuitive/automatic rather than deliberate sequential effort; speed alone without a process distinction is partial.",
          },
          {
            id: "system1-example",
            basis: "course-inference",
            sources: ["systems"],
            description:
              "Gives a plausible concrete System 1 example and makes its quick/intuitive process clear. Do not require the book's exact examples or label an entire activity inherently System 1.",
          },
          {
            id: "system2-description",
            basis: "source-backed",
            sources: ["systems"],
            description:
              "Describes System 2 as deliberate, slower, effortful analytical thinking; not a guarantee of correctness.",
          },
          {
            id: "system2-example",
            basis: "course-inference",
            sources: ["systems"],
            description:
              "Gives a plausible concrete System 2 example with deliberate checking/reasoning, distinct from merely asserting an activity is difficult.",
          },
        ],
        tutor: {
          probe: "How does the thinking work in the example you have in mind?",
          help: "On request, contrast an immediate impression with checking it step by step, then ask for their own example; label the supported explanation assisted.",
          avoid:
            "Do not supply an example and count a repeated label as the learner's example. Do not equate intuitive with stupid or deliberate with infallible.",
          close:
            "Close once the two processes and their two convincing examples are clear; do not demand the bat-and-ball puzzle or extra examples.",
        },
        review:
          "Process definitions are source-backed. Whether a novel example instantiates the process is an authored inference, assessed from the learner's reasoning rather than activity name.",
        examples: [
          e(
            "processes-and-examples",
            "complete",
            "System 1 is an immediate intuition, like recognizing my friend's face without analysing it. System 2 is deliberate effort, like working through and checking a long multiplication one step at a time.",
            {
              "system1-description": "independent",
              "system1-example": "independent",
              "system2-description": "independent",
              "system2-example": "independent",
            },
            "Both definitions and both examples have process evidence.",
          ),
          e(
            "definitions-no-examples",
            "partial",
            "System 1 is fast intuition; System 2 is slower deliberate reasoning.",
            {
              "system1-description": "independent",
              "system1-example": "missing",
              "system2-description": "independent",
              "system2-example": "missing",
            },
            "Descriptions do not substitute for examples.",
          ),
          e(
            "one-example-missing",
            "partial",
            "System 1 is intuitive, like instantly recognizing a familiar face. System 2 is effortful deliberate analysis.",
            {
              "system1-description": "independent",
              "system1-example": "independent",
              "system2-description": "independent",
              "system2-example": "missing",
            },
            "Three criteria met; System 2 example still missing.",
          ),
          e(
            "other-example-missing",
            "partial",
            "System 1 is quick intuition. System 2 is deliberate work, like checking each step in an unfamiliar calculation.",
            {
              "system1-description": "independent",
              "system1-example": "missing",
              "system2-description": "independent",
              "system2-example": "independent",
            },
            "System 1 description needs its own concrete example.",
          ),
          e(
            "reversed-processes",
            "incorrect",
            "System 1 means painstakingly checking a budget; System 2 is instantly guessing a total without checking anything.",
            {
              "system1-description": "incorrect",
              "system1-example": "incorrect",
              "system2-description": "incorrect",
              "system2-example": "incorrect",
            },
            "Names and processes are reversed.",
          ),
          e(
            "unexplained-activity",
            "ambiguous",
            "System 1 is driving; System 2 is chess.",
            {
              "system1-description": "missing",
              "system1-example": "unresolved",
              "system2-description": "missing",
              "system2-example": "unresolved",
            },
            "Either activity can use both processes; ask what the person is doing mentally.",
          ),
          e(
            "same-domain-two-processes",
            "alternate",
            "An experienced cook's instant sense that a dish needs salt is intuitive System 1. Deliberately calculating ingredient ratios and checking them is effortful System 2.",
            {
              "system1-description": "independent",
              "system1-example": "independent",
              "system2-description": "independent",
              "system2-example": "independent",
            },
            "Distinct processes within one domain are valid; examples need not be different occupations.",
          ),
        ],
      },
    ],
  },
  {
    id: "q8",
    title: "Phonetic and pictographic writing",
    mode: "comparison",
    adaptation: "Preserves Q8's comparison and central advantage, without treating a spoken answer as a reading test.",
    units: [
      {
        id: "q8",
        originalPart: "Q8, complete question",
        prompt:
          "What does a phonetic writing system represent, and what main advantage does it offer over a pictographic one?",
        referenceAnswer:
          "Phonetic symbols represent speech sounds, whereas pictographic symbols picture things or concepts. A novice reader can combine the represented sounds to decode a written word they have not seen before but may already know in speech, instead of having to recognize a separate whole picture or sign. The manuscript links this to learning to read more quickly; it does not say mature phonetic readers are always faster.",
        criteria: [
          {
            id: "sound-vs-picture",
            basis: "source-backed",
            sources: ["phonetic"],
            description:
              "Contrasts visual symbols representing speech sounds with pictures/concepts. Letters versus pictures without saying letters represent sounds is partial; avoid treating the manuscript's simplified comparison as a taxonomy of all real mixed writing systems.",
          },
          {
            id: "sound-decoding",
            basis: "source-backed",
            sources: ["phonetic"],
            description:
              "Explains the central advantage: combine represented sounds to decode an unfamiliar written word, potentially recognizing an already-known spoken word. Saying easier, fewer symbols, or faster without this mechanism is partial, not full explanation.",
          },
        ],
        tutor: {
          probe: "What would a reader do on meeting a written word they have never seen before?",
          help: "When requested, explain how combining speech sounds can connect a new written form to a familiar spoken word. Invite an application and record assistance.",
          avoid:
            "Do not lead with sound it out in an unsolicited initial probe; an explicit help request permits explaining sound combination before an attempt. Do not credit letters instead of pictures as the entire answer or claim universal speed superiority.",
          close:
            "Once the sound representation and decoding advantage are clear, acknowledge and close without a spelling exercise or another example.",
        },
        review:
          "Central advantage is explicit on printed p. 111, with learning-speed discussion on p. 112; no arbitrary instructor-only review gate.",
        examples: [
          e(
            "sound-based-decoding",
            "complete",
            "The signs stand for sounds rather than pictures of concepts. If I haven't seen a word written before, I can join its sounds and recognize a word I already know when spoken.",
            { "sound-vs-picture": "independent", "sound-decoding": "independent" },
            "Both representation and the central decoding mechanism are explained.",
          ),
          e(
            "letters-not-pictures",
            "partial",
            "It uses letters instead of pictures.",
            { "sound-vs-picture": "partial", "sound-decoding": "missing" },
            "The required sounds and decoding advantage are absent.",
          ),
          e(
            "sounds-but-no-advantage",
            "partial",
            "Its symbols represent speech sounds, while pictures show concepts.",
            { "sound-vs-picture": "independent", "sound-decoding": "missing" },
            "Correct contrast alone does not explain the advantage.",
          ),
          e(
            "separate-word-picture",
            "incorrect",
            "Each phonetic symbol pictures a whole word, so you must memorize a separate picture for every word.",
            { "sound-vs-picture": "incorrect", "sound-decoding": "incorrect" },
            "Attributes the opposite representation and denies sound combination.",
          ),
          e(
            "vague-speed",
            "ambiguous",
            "It has an alphabet, which makes it faster.",
            { "sound-vs-picture": "partial", "sound-decoding": "unresolved" },
            "Ask what symbols represent and what faster means; do not infer decoding.",
          ),
          e(
            "new-written-known-spoken",
            "alternate",
            "Pictographs depict meanings. With a sound code I can assemble the pronunciation of a new printed word from its parts, then connect that pronunciation to vocabulary I know orally.",
            { "sound-vs-picture": "independent", "sound-decoding": "independent" },
            "Complete alternative; no required use of the phrase sound it out.",
          ),
        ],
      },
    ],
  },
];
