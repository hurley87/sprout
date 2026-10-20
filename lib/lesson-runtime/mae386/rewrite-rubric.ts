import { example as e, learner, tutor, type QuestionRubric, type RubricUnit } from "./rubric-types";

const labels = (
  meaning: "independent" | "assisted" | "partial" | "incorrect" | "unresolved" | "missing",
  concise = meaning,
  grammatical = meaning,
) => ({ meaning, concise, grammatical });

const sentences = [
  {
    id: "q10-1",
    part: "Q10(a), sentence 1",
    original: "The reason why he was late is that he overslept.",
    answer: "He was late because he overslept.",
    alternate: "Because he overslept, he was late.",
    modestReduction: "The reason he was late is that he overslept.",
    hint: "The reason why ... is that is a long way of expressing a causal link; because can express that link.",
    bad: "He overslept because he was late.",
    ambiguous: "He was late because he over... slept? Or left?",
    partial: "Because he overslept.",
    note: "Retain both lateness and oversleeping and the causal direction: oversleeping explains lateness. Merely saying he overslept omits the lateness claim.",
    partialReason:
      "Gives the cause as a dependent-clause fragment but omits the lateness proposition and a complete main clause. Clarify the full proposed sentence.",
  },
  {
    id: "q10-2",
    part: "Q10(a), sentence 2",
    original: "The two of them collaborated together on the project.",
    answer: "They collaborated on the project.",
    alternate: "They worked together on the project.",
    modestReduction: "The two of them collaborated on the project.",
    hint: "Collaborated already means working together; together repeats that meaning.",
    bad: "They competed on the project.",
    ambiguous: "They... on the project. Worked?",
    partial: "They worked on the project.",
    note: "Retain joint work on the same project. They can refer to the already established pair; do not require an explicit two. Together is redundant with collaborated, but necessary to preserve joint work when collaborated is replaced by worked.",
    partialReason:
      "Preserves the project/work but does not express joint work; they could have worked separately. Ask whether the learner intends collaboration rather than assuming it.",
  },
  {
    id: "q10-3",
    part: "Q10(b)",
    original: "His toolkit is comprised of the habits, heuristics, and external scaffolds he builds in order to think.",
    answer: "His toolkit consists of the habits, heuristics, and external scaffolds he builds to think.",
    alternate: "His toolkit comprises the habits, heuristics, and external scaffolds he builds to think.",
    modestReduction:
      "His toolkit consists of the habits, heuristics, and external scaffolds he builds in order to think.",
    hint: "In order to can be shortened to to without changing the purpose relation; consists of is another way to express the toolkit's composition.",
    bad: "His toolkit consists only of habits.",
    ambiguous: "His toolkit comprises... habits, heuristics, and... I lost the rest.",
    partial: "His toolkit consists of habits and heuristics.",
    note: "Retain all three categories, ownership and the building-for-thinking relationship. Accept comprises, consists of, is made up of or another grammatical equivalent, with actual shortening. No spelling or punctuation judgment. The manuscript is not a usage authority on comprised of; prefer uncontroversial alternatives without treating a disputed usage preference as an absolute spoken-grammar rule.",
    partialReason:
      "Retains the toolkit and two categories but omits external scaffolds and the building-for-thinking relationship; shortening alone is insufficient.",
  },
] as const;

const units: RubricUnit[] = sentences.map(s => ({
  id: s.id,
  originalPart: s.part,
  prompt: "How would you say this sentence more concisely while keeping its meaning?",
  visibleSource: s.original,
  referenceAnswer: `Two acceptable authored examples: ${s.answer} / ${s.alternate} These are illustrations, not exact-match keys. ${s.note}`,
  criteria: [
    {
      id: "meaning",
      basis: "course-inference",
      sources: ["memory", "reification"],
      description: `For ${s.part}, judge only the latest complete, non-withdrawn student-proposed rewrite of the visible original. Preserve its propositions and relations: ${s.note} Quoted source text is not a submission. Tutor suggestions are not learner proposals until adopted and used in the learner's own response; simple echoes establish no independent demonstration.`,
    },
    {
      id: "concise",
      basis: "course-inference",
      sources: ["memory"],
      description:
        "The actual proposed revision uses fewer spoken words by removing redundant structure while preserving meaning. Any genuine reduction satisfying meaning and grammar can count; do not require maximum compression, every possible redundancy removed, an exact word count or a single target sentence. An unchanged original is not a concise rewrite. A shorter meaning-changing sentence does not demonstrate meaning-preserving concision; an incomplete proposition remains partial.",
    },
    {
      id: "grammatical",
      basis: "course-inference",
      sources: ["memory"],
      description:
        "The proposed spoken sentence is grammatically coherent. Judge the intended spoken wording, not ASR punctuation, spelling, accents or disfluencies outside the proposal. Uncertain transcription needs clarification, not a grammar penalty. A deliberately quoted original alone provides no proposed-rewrite evidence.",
    },
  ],
  tutor: {
    probe: "Which words are part of your final proposed sentence?",
    help: "Repeat the original exactly on request; that is source access, not answer-giving. If help is requested, explain one redundant construction and invite their own full revision. Record help relevant to the final proposal; repeating a supplied solution alone is not a demonstration.",
    avoid:
      "Do not rewrite first, demand typing, evaluate punctuation, or treat a quotation as a proposal. Do not combine parts of different proposals into an answer the learner never submitted.",
    close:
      "Acknowledge a sufficient revision once. If still ambiguous, ask one clarification. Close one subpart on settled discussion/explicit navigation, preserving the latest proposal outcome even if it is worse than an earlier attempt.",
  },
  review:
    "Provisional authored spoken-editing standard: the exam itself supplies the editing task, not the manuscript. Chapter 1 pp. 29–30 and 35–38 establish external symbolic reasoning, NOT a canonical concise-writing key or grammar rule. Usage judgments and interpreting preserved meaning are course inferences; Bill's calibration is needed for official marks only. Do not impose a minimum degree of shortening beyond a genuine reduction.",
  examples: [
    e(
      `${s.id}-complete`,
      "complete",
      s.answer,
      labels("independent"),
      "A complete proposed revision preserves the meaning, removes redundancy and is grammatical.",
    ),
    e(
      `${s.id}-alternate`,
      "alternate",
      s.alternate,
      labels("independent"),
      "A different complete valid formulation; exemplars are not exact-match patterns.",
    ),
    e(
      `${s.id}-partial`,
      "partial",
      s.partial,
      labels("partial", "partial", s.id === "q10-1" ? "partial" : "independent"),
      s.partialReason,
    ),
    e(
      `${s.id}-modest-valid-reduction`,
      "complete",
      s.modestReduction,
      labels("independent"),
      "Meaning and grammar are preserved with fewer words. Other possible shortening remains, but maximum compression is not a requirement.",
    ),
    e(
      `${s.id}-meaning-changed`,
      "incorrect",
      s.bad,
      labels("incorrect", "incorrect", "independent"),
      "Grammatical and shorter, but changes the claim; no credit for meaning-preserving concision.",
    ),
    e(
      `${s.id}-unclear-transcription`,
      "ambiguous",
      s.ambiguous,
      labels("unresolved"),
      "No complete clearly transcribed final sentence. Clarify rather than guessing the words or marking it wrong.",
    ),
    e(
      `${s.id}-unchanged-echo`,
      "echo",
      [tutor(s.original), learner(s.original)],
      labels("missing"),
      "The original is repeated unchanged; no genuine shortened proposal is demonstrated.",
      [],
    ),
    e(
      `${s.id}-quoted-original-then-revision`,
      "complete",
      `The original says, ${s.original} My revision is: ${s.answer}`,
      labels("independent"),
      "Only the explicitly proposed revision is assessed; the quotation is excluded.",
    ),
    e(
      `${s.id}-self-correction`,
      "self-correction",
      [learner(s.bad), learner(`No, I withdraw that. My revision is: ${s.answer}`)],
      labels("independent"),
      "Latest complete replacement corrects the first attempt without tutor help; earlier error remains in history.",
      [2],
    ),
    e(
      `${s.id}-segmented-correction`,
      "self-correction",
      [
        learner(s.bad),
        learner(`No, replace that with: ${s.answer.split(" ").slice(0, 3).join(" ")}...`),
        tutor("Mm-hm."),
        learner(s.answer.split(" ").slice(3).join(" ")),
      ],
      labels("independent"),
      "One replacement proposal spans two learner fragments with a neutral acknowledgment between them. Select both fragments, not words from the withdrawn first attempt; no substantive tutor hint occurred.",
      [2, 4],
    ),
    e(
      `${s.id}-worse-replacement`,
      "incorrect",
      [learner(s.answer), learner(`Actually replace that with: ${s.bad}`)],
      labels("incorrect", "incorrect", "independent"),
      "The later complete proposal governs even though earlier evidence was stronger.",
      [2],
    ),
    e(
      `${s.id}-withdrawn`,
      "ambiguous",
      [learner(s.answer), learner("I withdraw my answer. I haven't got a replacement yet.")],
      labels("unresolved"),
      "Explicit withdrawal without replacement leaves no current final answer; preserve the earlier attempt as history only.",
      [],
    ),
    e(
      `${s.id}-casual-aside`,
      "complete",
      [learner(s.answer), learner("That wording reminds me of an email I received.")],
      labels("independent"),
      "A later aside is not a replacement; the earlier actual proposal remains current.",
      [1],
    ),
    e(
      `${s.id}-help-and-own-revision`,
      "assisted",
      [tutor(s.hint), learner(`My proposed revision is: ${s.alternate}`)],
      labels("assisted"),
      "A substantive redundancy hint precedes an independently formulated revision; all claimed editing evidence is assisted conservatively.",
      [2],
    ),
    e(
      `${s.id}-tutor-answer-echo`,
      "echo",
      [tutor(`You could say: ${s.answer}`), learner(s.answer)],
      labels("partial"),
      "Simple repetition of the supplied solution is neither independent understanding nor an explained assisted application.",
      [2],
    ),
  ],
}));

export const REWRITE_RUBRIC: QuestionRubric = {
  id: "q10",
  title: "Concise spoken rewriting",
  mode: "spoken editing",
  adaptation:
    "Q10(a)'s two sentences and Q10(b)'s sentence become three ordered spoken subparts under one exam question. Source sentences stay visible. No writing/spelling/punctuation proficiency claim. Latest complete non-withdrawn proposal governs each sentence, independently of cumulative mastery.",
  units,
};
