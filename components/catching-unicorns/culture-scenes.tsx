import { CATCHING_UNICORNS_PRESENTATION } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import {
  conceptPresentation,
  sceneConcepts,
  EvidenceCard,
  UnresolvedCard,
  SceneHeader,
  type SceneProps,
} from "./presentation-helpers";

export function CultureScene({ state, nodeId, node }: SceneProps) {
  const concepts = sceneConcepts(state, nodeId);
  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        {concepts.map((concept, index) => (
          <EvidenceCard key={concept.criterionId} concept={concept}>
            <UnresolvedCard
              title={`Characteristic ${index + 1}`}
              evidence={concept.evidence}
              className="rounded-xl border border-slate-200 bg-white p-4"
              statusClassName="mt-3"
            />
          </EvidenceCard>
        ))}
      </div>
    </div>
  );
}

export function ApplicationScene({ state, nodeId, node }: SceneProps) {
  const concepts = sceneConcepts(state, nodeId);
  const application = CATCHING_UNICORNS_PRESENTATION["caf-application"];
  const references = application.framework.map(reference =>
    conceptPresentation(state, reference.sourceNodeId, reference.criterionId),
  );
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
              <EvidenceCard concept={reference}>
                <p className="text-sm text-slate-500">
                  Framework item {index + 1} is not yet available from accepted evidence.
                </p>
              </EvidenceCard>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        {concepts.map((concept, index) => (
          <EvidenceCard key={concept.criterionId} concept={concept}>
            <UnresolvedCard
              title={`Application evidence ${index + 1}`}
              evidence={concept.evidence}
              className="rounded-xl border border-indigo-200 bg-white p-4"
              statusClassName="mt-2"
            />
          </EvidenceCard>
        ))}
      </div>
    </div>
  );
}

export function SynthesisScene({ state, nodeId, node, revealCards }: SceneProps) {
  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        {revealCards.map(concept => (
          <div className="relative" key={concept.criterionId}>
            <EvidenceCard concept={concept}>
              <article className="flex min-h-28 items-center justify-center rounded-2xl border border-dashed bg-white p-4 text-sm text-slate-500">
                Unresolved connection
              </article>
            </EvidenceCard>
          </div>
        ))}
      </div>
    </div>
  );
}
