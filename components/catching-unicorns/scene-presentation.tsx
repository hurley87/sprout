import type { SessionSummary } from "@/lib/lesson-runtime/session-summary";
import styles from "../catching-unicorns-demo.module.css";
import { CATCHING_UNICORNS_LESSON } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { sceneConcepts, hasReveal, sceneIds, EvidenceCard, UnresolvedCard, SceneHeader } from "./presentation-helpers";
import { MemoryPromptScene, MemoryComparisonScene } from "./memory-scenes";
import { ExographicsPromptScene, ExographicsReasoningScene } from "./exographics-scenes";
import { CultureScene, ApplicationScene, SynthesisScene } from "./culture-scenes";
import { RecapPresentation } from "./recap-presentation";

export function ScenePresentation({
  state,
  summary,
}: {
  state: LessonRuntimeState | null | undefined;
  summary?: SessionSummary;
}) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const learned = sceneIds.slice(0, sceneIds.indexOf(nodeId)).flatMap(id =>
    sceneConcepts(state, id)
      .filter(hasReveal)
      .filter(concept => concept.demonstrated),
  );

  return (
    <>
      <CurrentScenePresentation state={state} summary={summary} />
      {nodeId !== "recap" && learned.length > 0 && (
        <section className={styles.learned} aria-labelledby="learned-so-far-title">
          <h3 id="learned-so-far-title">Learned so far</h3>
          <ul className={styles.learnedList}>
            {learned.map(({ criterionId, item }) => (
              <li key={criterionId}>
                <details className={styles.learnedConcept}>
                  <summary>{item.title}</summary>
                  <p>{item.text}</p>
                  <p className={styles.learnedSource}>Source: {item.source}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CurrentScenePresentation({
  state,
  summary,
}: {
  state: LessonRuntimeState | null | undefined;
  summary?: SessionSummary;
}) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const node = CATCHING_UNICORNS_LESSON.nodes[nodeId];

  if (nodeId === "recap") return <RecapPresentation state={state} summary={summary} />;

  const revealCards = sceneConcepts(state, nodeId).filter(hasReveal);

  const props = { state, nodeId, node, revealCards };

  if (nodeId === "engram" || nodeId === "exogram") return <MemoryPromptScene {...props} nodeId={nodeId} />;
  if (nodeId === "compare") return <MemoryComparisonScene {...props} />;
  if (nodeId === "exographics") return <ExographicsPromptScene {...props} />;
  if (nodeId === "techno-literate-culture") return <CultureScene {...props} />;
  if (nodeId === "caf-application") return <ApplicationScene {...props} />;
  if (nodeId === "synthesis") return <SynthesisScene {...props} />;
  if (nodeId === "why-exographics") return <ExographicsReasoningScene {...props} />;

  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        {revealCards.map(concept => (
          <EvidenceCard key={concept.criterionId} concept={concept}>
            <UnresolvedCard
              title="Concept not yet revealed"
              evidence={concept.evidence}
              className="rounded-xl border bg-white p-4"
            />
          </EvidenceCard>
        ))}
      </div>
    </div>
  );
}
