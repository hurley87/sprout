import { example as e, learner, tutor, type QuestionRubric } from "./rubric-types";

export const ARGUMENT_RUBRICS: readonly QuestionRubric[] = [
  {
    id: "q12",
    title: "The CAF as a techno-literate culture",
    mode: "institutional transfer",
    adaptation:
      "Condenses the embodied-ideation preamble; retains assessment of the CAF against the book's four characteristics. The CAF is an institution nested in a wider society, so a qualified conclusion is welcome.",
    units: [
      {
        id: "q12",
        originalPart: "Q12, complete question",
        prompt:
          "Using the book's characteristics, assess whether the Canadian Armed Forces can be considered a techno-literate culture. Explain your reasoning.",
        referenceAnswer:
          "A qualified yes is defensible as an institutional analogy: personnel use reading, writing and arithmetic in orders, reports and logistics; specialists develop or adapt ideas and doctrine; rules, roles and procedures coordinate large groups beyond personal acquaintance; and training/education transmit basic and specialized knowledge. These are plausible illustrative applications, not CAF facts established by the manuscript. A qualified no is also defensible: the CAF may exhibit the characteristics but is a specialized institution that depends on broader Canadian literacy, research, law and education rather than being a whole self-sustaining culture. Explain how each characteristic applies or depends on that wider context; using technology alone is insufficient.",
        criteria: [
          {
            id: "literacy",
            basis: "course-inference",
            sources: ["culture"],
            description:
              "Applies widespread basic reading, writing and arithmetic to a plausible CAF practice (e.g. written orders, reports, logistical calculations) or explains its institutional dependence on wider society. Listing literacy without application is partial.",
          },
          {
            id: "innovation",
            basis: "course-inference",
            sources: ["culture"],
            description:
              "Applies a smaller group advancing ideas to plausible specialists/research/doctrine development, or explains how the CAF depends on outside innovators. Owning advanced equipment alone is insufficient.",
          },
          {
            id: "coordination",
            basis: "course-inference",
            sources: ["culture"],
            description:
              "Applies structures and norms enabling large groups of strangers to coexist/cooperate to rules, roles, procedures or related institutions. Do not require the CAF to be decentralized in precisely the same way as the manuscript's city examples.",
          },
          {
            id: "education",
            basis: "course-inference",
            sources: ["culture"],
            description:
              "Applies substantial education/training passing on basic and advanced knowledge, including a concrete practice or a reasoned account of dependence on wider educational institutions.",
          },
          {
            id: "qualified-assessment",
            basis: "open-ended-argument",
            sources: ["culture"],
            description:
              "Connects the four applied characteristics to a defensible qualified yes/no assessment, acknowledging institution-versus-society scope where relevant. Do not require yes or invented precise institutional facts.",
          },
        ],
        tutor: {
          probe: "How does your example connect to the characteristics you are using?",
          help: "On request name a missing source characteristic, without supplying its CAF application; have the learner apply it. Mark only criteria using substantive help as assisted.",
          avoid:
            "Do not reduce this to soldiers use technology or require a yes verdict. Do not fabricate CAF policies, population statistics or research programs.",
          close:
            "Accept a well-reasoned application of all four with a qualified conclusion; close without demanding a particular institutional label. Preserve missing dimensions separately.",
        },
        review:
          "The four general characteristics are source-backed (Introduction p. 6). All CAF applications and the boundary of culture are provisional inference/argument, not a direct manuscript classification. Bill's review is needed for official calibration only.",
        examples: [
          e(
            "caf-qualified-yes",
            "complete",
            "As an institutional culture, yes: orders and logistics use reading, writing and arithmetic; specialist groups refine doctrine and techniques; ranks, rules and procedures coordinate strangers; and training passes on basic and advanced skills. These fit the four characteristics, though the forces also depend on wider Canadian society.",
            {
              literacy: "independent",
              innovation: "independent",
              coordination: "independent",
              education: "independent",
              "qualified-assessment": "independent",
            },
            "Applies each characteristic concretely and qualifies the analogy; illustrative rather than asserted official policy.",
          ),
          e(
            "caf-only-literacy",
            "partial",
            "Officers read orders, write reports and calculate supplies, so there is evidence of basic literacy and arithmetic.",
            {
              literacy: "independent",
              innovation: "missing",
              coordination: "missing",
              education: "missing",
              "qualified-assessment": "missing",
            },
            "One well-supported dimension does not imply the other three.",
          ),
          e(
            "caf-no-education",
            "partial",
            "I think yes: written orders and supply calculations show literacy, specialists refine doctrine, and ranks and rules coordinate strangers. I haven't considered how people learn those skills.",
            {
              literacy: "independent",
              innovation: "independent",
              coordination: "independent",
              education: "missing",
              "qualified-assessment": "partial",
            },
            "Three dimensions shown; the explicitly missing education dimension prevents a complete assessment.",
          ),
          e(
            "caf-technology-only",
            "incorrect",
            "They have computers and weapons, so by definition they are a techno-literate culture even if nobody can read or learn anything.",
            {
              literacy: "incorrect",
              innovation: "missing",
              coordination: "missing",
              education: "incorrect",
              "qualified-assessment": "incorrect",
            },
            "Technology possession replaces the actual criteria and explicitly denies literacy/education.",
          ),
          e(
            "caf-organized",
            "ambiguous",
            "It's organized and technical, so probably.",
            {
              literacy: "missing",
              innovation: "missing",
              coordination: "partial",
              education: "missing",
              "qualified-assessment": "unresolved",
            },
            "Ask what organized means and how it meets a criterion; do not fill the other dimensions in.",
          ),
          e(
            "caf-qualified-no",
            "alternate",
            "Not a whole independent culture, in my view. Personnel use written orders and supply arithmetic; specialists develop doctrine; rules and ranks coordinate strangers; training transmits specialist knowledge. But all four depend partly on Canada's schools, research and law, so I would call it a techno-literate subculture rather than a complete society.",
            {
              literacy: "independent",
              innovation: "independent",
              coordination: "independent",
              education: "independent",
              "qualified-assessment": "independent",
            },
            "A different conclusion fully applies the four dimensions and states a reasoned boundary.",
          ),
          e(
            "caf-one-helped-dimension",
            "assisted",
            [
              learner(
                "Reports and calculations show literacy; specialists refine doctrine; rules coordinate strangers. Those fit, with dependence on society outside the CAF.",
              ),
              tutor("The fourth characteristic concerns education passing on basic and advanced knowledge."),
              learner(
                "Then training courses and specialist instruction would be the fourth part. With those included I would call it a techno-literate institutional culture, not a separate society.",
              ),
            ],
            {
              literacy: "independent",
              innovation: "independent",
              coordination: "independent",
              education: "assisted",
              "qualified-assessment": "assisted",
            },
            "Preserve earlier unaided dimensions; the fourth application and completed synthesis follow relevant help.",
            [1, 3],
          ),
        ],
      },
    ],
  },
  {
    id: "q14",
    title: "Culture and cognitive potential",
    mode: "two-argument construction",
    adaptation:
      "Retains the printed position: argue that absence of e-Class objects does not imply cognitive limitation. Requires two genuinely different arguments, not agreement or repeated assertions.",
    units: [
      {
        id: "q14",
        originalPart: "Q14, complete question",
        prompt:
          "Take the position that not producing e-Class objects does not mean a society's people are cognitively limited. Give two different arguments supporting that position.",
        referenceAnswer:
          "One argument is that people in oral cultures demonstrate sophisticated reasoning and invention, for example adapting clothing, bows and environmental knowledge to Arctic conditions; lack of a particular exographic product does not establish lack of intelligence. A different argument is that access to tools, education and practice changes the tasks people can perform: the manuscript's discussion of educated children of nonliterate parents supports learned opportunity rather than inherited inability. Alternatives include a carefully bounded evolutionary-timescale argument or explaining how unfamiliar test conventions can hide ability. Two examples of the same practical-innovation argument count as one reason unless the learner explains a distinct inferential basis.",
        criteria: [
          {
            id: "no-innate-inferiority",
            basis: "source-backed",
            sources: ["learningPotential", "cognitiveDivide"],
            description:
              "Explains or clearly endorses the required distinction: absence of e-Class products does not imply innate cognitive inferiority. This is the assigned argumentative position, not a demand for unreasoned agreement. Do not claim no task-performance differences can exist.",
          },
          {
            id: "first-argument",
            basis: "open-ended-argument",
            sources: ["cognitiveDivide"],
            description:
              "Provides one substantive reason linked to the conclusion, e.g. sophisticated oral-cultural innovation, educability with opportunity/tools, task/test familiarity, or a bounded evolutionary argument. Bare equality slogans or names of artifacts without the inferential link are insufficient.",
          },
          {
            id: "second-distinct-argument",
            basis: "open-ended-argument",
            sources: ["learningPotential", "cognitiveDivide"],
            description:
              "Provides a second substantive reason with a genuinely different inferential basis from the first. Two examples of sophisticated innovation or two paraphrases of equal ability are only one argument. Accept other coherent, evidence-aware arguments; do not require the exemplar's exact pair. Additional good reasons do not make an answer wrong.",
          },
        ],
        tutor: {
          probe: "What different reason could support that conclusion, beyond the reason you already gave?",
          help: "If asked, distinguish showing skill from showing how opportunity changes performance; invite a new argument and mark the hinted dimension assisted.",
          avoid:
            "Do not supply two reasons and credit assent. Do not interpret lack of schooling as innate deficiency or tell a student they must believe a worldview rather than construct the assigned argument.",
          close:
            "Once two distinct reasoned supports are present, close without requiring a third or the book's exact examples. Preserve one-reason answers as partial even if confidently expressed.",
        },
        review:
          "The manuscript explicitly rejects innate inferiority, especially pp. 195, 198–201 and 206–207. Choice and distinctness of learner arguments are interpretive, with novel arguments judged on their reasoning; no official marks without calibration.",
        examples: [
          e(
            "innovation-and-opportunity",
            "complete",
            "No. Inuit clothing and hunting knowledge show sophisticated practical reasoning without these e-Class products. Separately, children of nonliterate parents can learn literate reasoning through education, so access and practice explain performance better than inherited inability.",
            {
              "no-innate-inferiority": "independent",
              "first-argument": "independent",
              "second-distinct-argument": "independent",
            },
            "Practical counterevidence and educability/opportunity are two different arguments.",
          ),
          e(
            "only-one-argument",
            "partial",
            "No: Inuit clothing is carefully engineered for the conditions, which shows sophisticated problem-solving.",
            {
              "no-innate-inferiority": "independent",
              "first-argument": "independent",
              "second-distinct-argument": "missing",
            },
            "A substantive reason, but only one.",
          ),
          e(
            "two-examples-one-reason",
            "partial",
            "No: they make excellent parkas, which shows intelligence, and they make clever bows, which also shows intelligence.",
            {
              "no-innate-inferiority": "independent",
              "first-argument": "independent",
              "second-distinct-argument": "partial",
            },
            "Two instances of practical ingenuity repeat one inferential basis.",
          ),
          e(
            "literacy-is-intelligence",
            "incorrect",
            "They are less intelligent by birth because they cannot read, and their lack of equations proves their brains are inferior.",
            {
              "no-innate-inferiority": "incorrect",
              "first-argument": "incorrect",
              "second-distinct-argument": "incorrect",
            },
            "Conflates a learned cultural technology with innate potential; fails the assigned position and reasoning.",
          ),
          e(
            "two-labels",
            "ambiguous",
            "Not necessarily: culture, and education.",
            {
              "no-innate-inferiority": "partial",
              "first-argument": "unresolved",
              "second-distinct-argument": "unresolved",
            },
            "Potential dimensions named without explaining either argument or their distinction.",
          ),
          e(
            "evolution-and-test-conventions",
            "alternate",
            "A few thousand years of writing is not a good basis for assuming a new innately superior kind of human. And an unfamiliar syllogism test can measure schooling in accepting fictional premises rather than general capacity to reason. Neither absence of writing nor that test result proves inherited inferiority.",
            {
              "no-innate-inferiority": "independent",
              "first-argument": "independent",
              "second-distinct-argument": "independent",
            },
            "Two alternative bounded arguments; does not claim timescale alone proves complete equality.",
          ),
          e(
            "tutor-reasons-only",
            "echo",
            [
              tutor("One could point to sophisticated oral innovation and to learning with educational opportunity."),
              learner("Yes, exactly those two."),
            ],
            { "no-innate-inferiority": "partial", "first-argument": "missing", "second-distinct-argument": "missing" },
            "Tutor reasoning and learner assent are not two learner-authored arguments.",
            [],
          ),
        ],
      },
    ],
  },
  {
    id: "q15",
    title: "Useful science without ultimate explanation",
    mode: "critical reasoning",
    adaptation:
      "Condenses the long gravity/imagination challenge, keeping its invitation to explain what an argument dismissing incomplete science misses. The suggested exam opening is optional. No requirement to defend an inaccurate claim about modern physics.",
    units: [
      {
        id: "q15",
        originalPart: "Q15, complete question",
        prompt:
          "The exam challenges science because even a theory of gravity may not fully explain why gravity exists. What does that criticism miss? Explain why science can still be worthwhile without an ultimate explanation.",
        referenceAnswer:
          "Scientific understanding can be incomplete yet useful: a model may predict observations, support action or technology, and be tested and improved without settling every deeper why. A complete answer distinguishes incomplete explanation from worthlessness and develops at least one concrete reason for value. One defensible argument is that predictions let us plan navigation or engineering even without an ultimate account of gravity. Another emphasizes comparing models with evidence and revising failures rather than treating all imagined explanations as equivalent. A third emphasizes practical discovery, such as the manuscript's NMR-to-MRI account, without claiming useful technology proves an ultimate ontology. Explicit discussion of evidence, testing or limits is an optional strength, not an additional condition of completeness. Accept a reasoned critique that science should pursue deeper explanations while recognizing these intermediate achievements. The manuscript describes Newton's hypothesized gravity and imagination in theory; the general predictive/testable/revisable defense is an authored argumentative synthesis, not the author's canonical answer.",
        criteria: [
          {
            id: "incomplete-not-worthless",
            basis: "open-ended-argument",
            sources: ["imagination", "scientificUse"],
            description:
              "Addresses the challenge by distinguishing lack of an ultimate explanation from absence of scientific value. May qualify or criticize explanatory limits, but gives a reasoned account rather than merely agreeing with the suggested opening.",
          },
          {
            id: "substantive-use",
            basis: "open-ended-argument",
            sources: ["scientificUse"],
            description:
              "Develops at least one concrete, defensible mechanism of value, such as prediction enabling planning, practical technology, organizing observations, or improvement through testing. No mandatory checklist of all four prediction/evidence/testability/revisability terms and no requirement for multiple arguments.",
          },
          {
            id: "evidence-and-limits",
            optional: true,
            basis: "open-ended-argument",
            sources: ["imagination", "scientificUse"],
            description:
              "Optional extension: explains an evidential constraint or limit on the usefulness claim, such as checking predictions against observations, revising failure, comparing evidence, or using a model within tested bounds. Its absence must not reduce an otherwise complete argument to partial. This is an authored feedback dimension, not a quoted manuscript rule. Explicit misconceptions about science may still affect the required argument criteria; missing this optional extension alone cannot.",
          },
        ],
        tutor: {
          probe: "What useful consequence follows from the example in your argument?",
          help: "On request offer one dimension such as checking a prediction, then invite the learner's own explanation/application and record assistance. Avoid giving a complete philosophical paragraph first.",
          avoid:
            "Do not demand one philosophical conclusion, every listed keyword, a personal rejection of religion, or assent to the exam's rhetoric. Do not call the authored synthesis the book's canonical answer or claim science already settles every deeper explanation.",
          close:
            "Close once the learner distinguishes incomplete explanation from lack of value and develops one concrete usefulness argument or qualified critique. Do not require a separate account of testing, evidence or limits, or force another argument after one well-developed account suffices.",
        },
        review:
          "Provisional open-ended rubric. Chapter 3 p. 49 and Chapter 6 p. 84 establish imagination/hypothesized gravity; Chapter 6 pp. 79–80 gives a practical science example. The two required reasoning dimensions are authored extrapolation. Evidence-and-limits is optional feedback only, excluded from required assessment targets. Bill's review gates official/exam-aligned marks or reliability claims, not formative qualitative feedback.",
        examples: [
          e(
            "prediction-with-limits",
            "complete",
            "We need not know the ultimate cause of gravity to use a model that predicts where something will move. We can check those predictions against observations and use the model within the range where it works, revising it when it fails. That is useful even if a deeper why remains open.",
            {
              "incomplete-not-worthless": "independent",
              "substantive-use": "independent",
              "evidence-and-limits": "independent",
            },
            "Connects incomplete explanation, a concrete predictive use and empirical limits.",
          ),
          e(
            "usefulness-slogan",
            "partial",
            "Science doesn't have to fully explain a phenomenon to be useful.",
            { "incomplete-not-worthless": "partial", "substantive-use": "missing", "evidence-and-limits": "missing" },
            "Repeating the exam's suggested opening is not a developed argument.",
          ),
          e(
            "predictive-utility-without-limits",
            "complete",
            "Even without explaining why gravity ultimately exists, we can use a gravitational model to predict tides and plan when ships enter a harbour. Being able to plan that passage is useful while the deepest why remains unanswered.",
            {
              "incomplete-not-worthless": "independent",
              "substantive-use": "independent",
              "evidence-and-limits": "missing",
            },
            "A complete concrete predictive-utility argument. No separate account of empirical testing or limits is required; the optional dimension remains missing without reducing completeness.",
          ),
          e(
            "fiction-equivalence",
            "incorrect",
            "Gravity is unseen, so scientific predictions are no better than any story I invent and there is no point checking anything.",
            {
              "incomplete-not-worthless": "incorrect",
              "substantive-use": "incorrect",
              "evidence-and-limits": "incorrect",
            },
            "Unobserved explanatory entities do not make empirical prediction/checking worthless.",
          ),
          e(
            "belief-alone",
            "ambiguous",
            "Science works because we believe in it.",
            {
              "incomplete-not-worthless": "unresolved",
              "substantive-use": "unresolved",
              "evidence-and-limits": "missing",
            },
            "Ask what works and how it is checked; do not infer an empirical argument from belief.",
          ),
          e(
            "practical-mri-argument",
            "alternate",
            "The book's move from NMR observations to MRI shows why incomplete science matters: it can produce useful images for medicine. We can evaluate and improve those images against observations without pretending that a working scanner answers every fundamental question.",
            {
              "incomplete-not-worthless": "independent",
              "substantive-use": "independent",
              "evidence-and-limits": "independent",
            },
            "A practical, evidence-aware alternative using an actual manuscript example; usefulness is not claimed to prove ultimate truth.",
          ),
          e(
            "qualified-critique",
            "alternate",
            "Prediction alone isn't every kind of explanation, and deeper causes still matter. But testing rival accounts tells us which describes observations better and where to investigate next. That progress remains worthwhile while the ultimate account is unfinished.",
            {
              "incomplete-not-worthless": "independent",
              "substantive-use": "independent",
              "evidence-and-limits": "independent",
            },
            "A defensible critical position recognizes useful progress without treating prediction as the whole of science.",
          ),
          e(
            "model-improvement",
            "complete",
            "An incomplete model can organize observations into a pattern we can test. If new evidence contradicts it, revising it can produce better understanding. That process has value without a final answer to every why.",
            {
              "incomplete-not-worthless": "independent",
              "substantive-use": "independent",
              "evidence-and-limits": "independent",
            },
            "A third complete line of argument: organizing evidence and revising models, without requiring a practical gadget.",
          ),
        ],
      },
    ],
  },
];
