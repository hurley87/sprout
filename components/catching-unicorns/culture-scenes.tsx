import { CATCHING_UNICORNS_PRESENTATION } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { evidenceFor, revealText, Revealed, EvidenceState, SceneHeader, type SceneProps } from "./presentation-helpers";

export function CultureScene({ state, nodeId, node, revealCards }: SceneProps) {
  const concepts = node.concepts ?? [];
  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        {concepts.map((concept, index) => {
          const result = revealCards.find(item => item.criterionId === concept.id);
          return result?.evidence?.status === "demonstrated" && result.item ? (
            <Revealed key={concept.id} item={result.item} />
          ) : (
            <article className="rounded-xl border border-slate-200 bg-white p-4" key={concept.id}>
              <h3 className="font-medium">Characteristic {index + 1}</h3>
              <div className="mt-3">
                <EvidenceState evidence={result?.evidence} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function ApplicationScene({ state, nodeId, node, revealCards }: SceneProps) {
  const concepts = node.concepts ?? [];
  const application = CATCHING_UNICORNS_PRESENTATION["caf-application"];
  const references = application.framework.map(reference => ({
    ...reference,
    evidence: evidenceFor(state, reference.sourceNodeId, reference.criterionId),
    item: revealText(reference.sourceNodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION, reference.criterionId),
  }));
  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-800">
          Transfer prompt · not a source-canonical answer
        </p>
        <h3 className="mt-2 text-xl font-semibold">Assess the institution</h3>
        <p className="mt-2 text-sm text-indigo-950">
          A yes, no, or qualified conclusion can be defensible when it follows from evidence.
        </p>
      </section>
      <section className="rounded-2xl border bg-white p-4">
        <h3 className="font-semibold">Previously demonstrated framework</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {references.map((reference, index) => (
            <div className="rounded-xl border p-3" key={reference.criterionId}>
              {reference.evidence?.status === "demonstrated" && reference.item ? (
                <Revealed item={reference.item} />
              ) : (
                <p className="text-sm text-slate-500">
                  Framework item {index + 1} is not yet available from accepted evidence.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        {concepts.map((concept, index) => {
          const result = revealCards.find(item => item.criterionId === concept.id);
          return result?.evidence?.status === "demonstrated" && result.item ? (
            <Revealed key={concept.id} item={result.item} />
          ) : (
            <article className="rounded-xl border border-indigo-200 bg-white p-4" key={concept.id}>
              <h3 className="font-medium">Application evidence {index + 1}</h3>
              <div className="mt-2">
                <EvidenceState evidence={result?.evidence} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function SynthesisScene({ state, nodeId, node, revealCards }: SceneProps) {
  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        {revealCards.map(({ criterionId, item, evidence }) => (
          <div className="relative" key={criterionId}>
            {evidence?.status === "demonstrated" ? (
              <Revealed item={item} />
            ) : (
              <article className="flex min-h-28 items-center justify-center rounded-2xl border border-dashed bg-white p-4 text-sm text-slate-500">
                Unresolved connection
              </article>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
