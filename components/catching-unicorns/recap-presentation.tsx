import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
} from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { ConceptEvidenceRecord, LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { evidenceFor, revealText, sceneIds } from "./presentation-helpers";

const recapSceneLabel = (id: string) =>
  ({
    engram: "Engram prompt",
    exogram: "Exogram prompt",
    compare: "Comparison scene",
    exographics: "Visual practice scene",
    "why-exographics": "Arithmetic example",
    "techno-literate-culture": "Culture framework",
    "caf-application": "Transfer scene",
    synthesis: "Connections scene",
    recap: "Recap",
  })[id] ?? "Lesson scene";

export function RecapPresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  const evidenceGroups = [
    {
      id: "independent",
      title: "Demonstrated independently",
      filter: (item: ConceptEvidenceRecord) => item.status === "demonstrated" && item.understanding === "independent",
    },
    {
      id: "prompted",
      title: "Demonstrated after a prompt",
      filter: (item: ConceptEvidenceRecord) => item.status === "demonstrated" && item.understanding === "prompted",
    },
    {
      id: "unattributed",
      title: "Demonstrated · prompting unclear",
      filter: (item: ConceptEvidenceRecord) => item.status === "demonstrated" && item.understanding === null,
    },
    { id: "partial", title: "Partly explained", filter: (item: ConceptEvidenceRecord) => item.status === "partial" },
  ];
  const all = sceneIds.flatMap(id =>
    (CATCHING_UNICORNS_LESSON.nodes[id].concepts ?? []).map(concept => ({
      nodeId: id,
      criterionId: concept.id,
      evidence: evidenceFor(state, id, concept.id),
      reveal: revealText(id as keyof typeof CATCHING_UNICORNS_PRESENTATION, concept.id),
    })),
  );
  const groups = evidenceGroups
    .map(group => ({
      ...group,
      entries: all.filter(item => item.evidence && group.filter(item.evidence)),
    }))
    .filter(group => group.id !== "unattributed" || group.entries.length > 0);
  const unresolved = all.filter(item => item.evidence?.status !== "demonstrated");
  return (
    <div className="space-y-5" data-scene="recap">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-800">Catching Unicorns · recap</p>
        <h2 className="mt-2 text-3xl font-semibold">What this conversation showed</h2>
        <p className="mt-3 max-w-3xl text-slate-600">
          A record of accepted evidence from this session. Transfer reasoning is kept separate from source-backed
          concepts.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(group => (
          <section className="rounded-2xl border bg-white p-4" key={group.id}>
            <h3 className="font-semibold">{group.title}</h3>
            {group.entries.length ? (
              <ul className="mt-3 space-y-3">
                {group.entries.map(item => (
                  <li key={`${item.nodeId}:${item.criterionId}`}>
                    <p className="font-medium">
                      {item.evidence?.status === "demonstrated"
                        ? (item.reveal?.title ?? recapSceneLabel(item.nodeId))
                        : recapSceneLabel(item.nodeId)}
                    </p>
                    <p className="text-sm text-slate-600">
                      {item.evidence?.source?.childTranscript
                        ? `“${item.evidence.source.childTranscript}”`
                        : "Accepted evidence recorded."}
                    </p>
                    {item.nodeId === "caf-application" && (
                      <p className="mt-1 text-xs font-medium text-indigo-800">Transfer/application reasoning</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Nothing recorded in this group.</p>
            )}
          </section>
        ))}
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 md:col-span-2">
          <h3 className="font-semibold text-amber-950">Still unresolved or skipped</h3>
          {unresolved.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {unresolved.map(item => (
                <li className="rounded-xl bg-white/80 p-3 text-sm" key={`${item.nodeId}:${item.criterionId}`}>
                  <span className="font-medium">{recapSceneLabel(item.nodeId)}</span>
                  <span className="text-slate-600">
                    {" "}
                    · {item.evidence?.status === "partial" ? "partial evidence" : "one unresolved item"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm">Every authored criterion has accepted evidence.</p>
          )}
        </section>
      </div>
    </div>
  );
}
