import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { buildSessionSummary, type SessionSummary } from "@/lib/lesson-runtime/session-summary";

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
    <div className="space-y-5" data-scene="recap">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-800">Catching Unicorns · recap</p>
        <h2 className="mt-2 text-3xl font-semibold">What this conversation showed</h2>
        <p className="mt-3 max-w-3xl text-slate-600" aria-live="polite">
          {feedback?.notice ?? "Session evidence is not available yet."}
        </p>
      </header>
      {feedback && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border bg-white p-4 md:col-span-2">
              <h3 className="font-semibold">Strengths from this session</h3>
              {feedback.strengths.length ? (
                <ul className="mt-3 space-y-3">
                  {feedback.strengths.map(strength => (
                    <li key={strength.conceptId}>
                      <p>{strength.text}</p>
                      {strength.quote && <blockquote className="text-sm text-slate-600">“{strength.quote}”</blockquote>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm">
                  There is not enough attributable evidence to name a strength yet. This is not a judgment of your
                  ability.
                </p>
              )}
            </section>
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-semibold">One area to deepen</h3>
              <p className="mt-3">{feedback.improvement.text}</p>
            </section>
            <section className="rounded-2xl border bg-white p-4">
              <h3 className="font-semibold">Try next</h3>
              <p className="mt-3">{feedback.exercise}</p>
            </section>
          </div>
          <details className="rounded-2xl border p-4">
            <summary>Evidence and review details</summary>
            <p className="mt-3 text-sm text-slate-600">
              Each concept appears once. Scene observations and full-review outcomes are retained separately for
              provenance, not added into a mastery score. Unobserved or uncertain evidence does not diagnose a knowledge
              gap.
            </p>
            <ul className="mt-3 space-y-3">
              {feedback.concepts.map(concept => (
                <li key={concept.id}>
                  <p className="font-medium">
                    {concept.title} · {concept.evidence}
                  </p>
                  <p className="text-xs text-slate-600">
                    {concept.domain === "transfer" ? "Transfer/application reasoning" : `Source: ${concept.source}`} ·
                    prompting: {concept.attribution}
                  </p>
                  {concept.quote && <blockquote className="text-sm">“{concept.quote}”</blockquote>}
                  <ul className="text-xs text-slate-500">
                    {concept.records.map(record => (
                      <li key={record.key}>
                        {record.key}: live {record.live?.status ?? "unobserved"} (
                        {record.live?.understanding ?? "attribution unclear"}); review{" "}
                        {record.review?.outcome ?? feedback.reviewStatus}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
