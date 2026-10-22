import { MAE386_LESSON } from "@/lib/lesson-runtime/mae386-lesson";
import { authoredQuestionProgress } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import { OUTCOME_LABELS } from "@/lib/lesson-runtime/mae386/question-outcomes";

/** Deliberate allowlist: never render rubric criteria, references or exemplars. */
export function Mae386Presentation({ nodeId, recap }: { nodeId: string; recap?: LessonSnapshot["questionRecap"] }) {
  if (recap)
    return (
      <section aria-label="Question outcomes" className="space-y-6">
        <h2 className="text-3xl">{recap.label}</h2>
        <p>Qualitative practice feedback. Unresolved evidence remains open.</p>
        <ol className="space-y-5">
          {recap.questions.map(question => (
            <li key={question.questionId}>
              <h3 className="text-xl">
                {question.questionId.toUpperCase()} · {question.title}
              </h3>
              <p>{OUTCOME_LABELS[question.outcome]}</p>
              {question.components.length > 1 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {question.components.map((part, index) => (
                    <li key={part.nodeId}>
                      Part {index + 1}: {OUTCOME_LABELS[part.outcome]}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
    );
  if (nodeId === "recap") return <h2 className="text-3xl">Preparing your practice recap…</h2>;
  const progress = authoredQuestionProgress(MAE386_LESSON, nodeId);
  const presentation = MAE386_LESSON.nodes[nodeId].presentation;
  return (
    <section aria-label="Current question" className="space-y-6">
      <p className="text-sm">
        Original exam Q{presentation.originalQuestionNumber} · Adapted for spoken practice
        {progress && progress.subpartCount > 1
          ? ` · ${progress.questionId === "q5" ? "Case" : "Sentence"} ${progress.subpartNumber} of ${progress.subpartCount}`
          : ""}
      </p>
      <h2 className="text-2xl sm:text-3xl">{presentation.title}</h2>
      {presentation.sourceText && (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5">
          <h3 className="mb-3 text-sm font-semibold">
            {progress?.questionId === "q10" ? "Original sentence" : "Current case"}
          </h3>
          <blockquote className="text-xl leading-relaxed sm:text-2xl">{presentation.sourceText}</blockquote>
        </div>
      )}
      <p className="text-2xl leading-relaxed sm:text-3xl">{presentation.prompt}</p>
      {progress?.questionId === "q10" && (
        <p>Say your revised sentence aloud. You can repeat or correct your proposal.</p>
      )}
    </section>
  );
}
