import styles from "../catching-unicorns-demo.module.css";
import { CATCHING_UNICORNS_LESSON } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { sceneConcepts, hasReveal, sceneIds } from "./presentation-helpers";
import { MemoryPromptScene, MemoryComparisonScene } from "./memory-scenes";
import { ExographicsPromptScene } from "./exographics-scenes";
import { RecapPresentation } from "./recap-presentation";

export function ScenePresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const learned = sceneIds.slice(0, sceneIds.indexOf(nodeId)).flatMap(id =>
    sceneConcepts(state, id)
      .filter(hasReveal)
      .filter(concept => concept.demonstrated),
  );

  return (
    <>
      <CurrentScenePresentation state={state} />
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

function CurrentScenePresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const node = CATCHING_UNICORNS_LESSON.nodes[nodeId];

  if (nodeId === "recap") return <RecapPresentation state={state} />;

  const revealCards = sceneConcepts(state, nodeId).filter(hasReveal);

  const props = { state, nodeId, node, revealCards };

  if (nodeId === "engram" || nodeId === "exogram") return <MemoryPromptScene {...props} nodeId={nodeId} />;
  if (nodeId === "compare") return <MemoryComparisonScene {...props} />;
  if (nodeId === "exographics") return <ExographicsPromptScene {...props} />;

  throw new Error(`Unknown Catching Unicorns scene: ${nodeId}`);
}
