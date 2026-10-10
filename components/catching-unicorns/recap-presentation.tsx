/** @jsxImportSource react */
import { CATCHING_UNICORNS_LESSON } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { SummaryConcept } from "@/lib/lesson-runtime/session-summary";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { buildSessionSummary, type SessionSummary } from "@/lib/lesson-runtime/session-summary";

// Repeated carried evidence shares a quotation, while every scene/source record remains visible.
function EvidenceDetails({
  concept,
  reviewStatus,
}: {
  concept: SummaryConcept;
  reviewStatus: SessionSummary["reviewStatus"];
}) {
  const quotations = new Map<string, SummaryConcept["records"]>();
  for (const record of concept.records) {
    const quote = record.live?.source?.childTranscript ?? "";
    const texts = [...new Set([quote, ...record.reviewQuotes.map(reference => reference.text)])];
    for (const text of texts) {
      if (!text && texts.some(Boolean)) continue;
      quotations.set(text, [...(quotations.get(text) ?? []), record]);
    }
  }
  return (
    <li className="border-t border-slate-200 pt-4">
      <h4 className="font-medium">
        {concept.title} · {concept.evidence}
      </h4>
      <p className="mt-1 text-sm text-slate-600">
        {concept.domain === "transfer" ? "Transfer/application reasoning" : `Source: ${concept.source}`} · prompting:{" "}
        {concept.attribution}
      </p>
      {[...quotations].map(([quote, records]) => (
        <div className="mt-3" key={quote}>
          {quote && (
            <blockquote className="border-l-2 border-emerald-200 pl-3 text-sm leading-relaxed">“{quote}”</blockquote>
          )}
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-600">
            {records.map(record => {
              const nodeId = record.key.split(":")[0];
              const source = record.live?.source;
              return (
                <li key={record.key}>
                  <span className="font-medium">
                    {CATCHING_UNICORNS_LESSON.nodes[nodeId]?.presentation.title ?? nodeId}
                  </span>
                  : live {record.live?.status ?? "unobserved"} ({record.live?.understanding ?? "attribution unclear"});
                  review {record.review?.understanding.outcome.replaceAll("_", " ") ?? reviewStatus}
                  {record.review && (
                    <>
                      {" "}
                      · assistance {record.review.assistance.outcome} · provenance{" "}
                      {record.review.evidence?.status ?? "not recorded"} · {record.reconciliation}
                    </>
                  )}
                  {record.reviewQuotes
                    .filter(reference => reference.text === quote)
                    .map(reference => (
                      <div key={reference.id} className="mt-2">
                        Review learner source · {reference.nodeId} · visit {reference.visitId} · message{" "}
                        {reference.messageIndex}
                      </div>
                    ))}
                  {source && source.childTranscript === quote && (
                    <span className="block">
                      Learner turn {source.childTurnId} ·{" "}
                      {CATCHING_UNICORNS_LESSON.nodes[source.nodeId]?.presentation.title ?? source.nodeId} · visit{" "}
                      {source.visitId} · transcript revision {source.transcriptRevision}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </li>
  );
}

export function RecapPresentation({
  state,
  summary,
}: {
  state: LessonRuntimeState | null | undefined;
  summary?: SessionSummary;
}) {
  const feedback =
    state && summary?.runtimeId === state.runtimeId ? summary : state ? buildSessionSummary(state) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-6 leading-relaxed break-words" data-scene="recap">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-800">Catching Unicorns · recap</p>
        <h2 className="mt-2 text-3xl font-semibold">What this conversation showed</h2>
        <p className="mt-3 max-w-3xl text-slate-600" aria-live="polite">
          {feedback?.notice ?? "Session evidence is not available yet."}
        </p>
      </header>
      {feedback && (
        <>
          <div className="space-y-4">
            <section className="rounded-2xl border bg-white p-5 sm:p-6">
              <h3 className="font-semibold">What you explained well</h3>
              {feedback.strengths.length ? (
                <ul className="mt-3 space-y-3">
                  {feedback.strengths.map(strength => (
                    <li key={strength.conceptId}>
                      <p>{strength.text}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm">
                  We have too little of your explanation to name a strength yet. You can still explore the next
                  exercise.
                </p>
              )}
            </section>
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
              <h3 className="font-semibold">One next step</h3>
              <p className="mt-3">{feedback.improvement.text}</p>
            </section>
            <section className="rounded-2xl border bg-white p-5 sm:p-6">
              <h3 className="font-semibold">Your next exercise</h3>
              <p className="mt-3">{feedback.exercise}</p>
            </section>
          </div>
          <details className="rounded-2xl border p-4">
            <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700">
              Evidence and review details
            </summary>
            <p className="mt-3 text-sm text-slate-600">
              Each concept appears once. Scene observations and full-review outcomes are retained separately for
              provenance, not added into a mastery score. Unobserved or uncertain evidence does not diagnose a knowledge
              gap.
            </p>
            <ul className="mt-3 space-y-3">
              {feedback.concepts.map(concept => (
                <EvidenceDetails key={concept.id} concept={concept} reviewStatus={feedback.reviewStatus} />
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
