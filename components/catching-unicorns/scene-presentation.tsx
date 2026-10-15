import styles from "../catching-unicorns-demo.module.css";
import { CATCHING_UNICORNS_LESSON } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { RecapPresentation } from "./recap-presentation";

export function ScenePresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  if (nodeId === "recap") return <RecapPresentation state={state} />;

  return (
    <div className={styles.questionScene} data-scene={nodeId} aria-live="polite">
      <h2 className={styles.question}>
        {nodeId === "compare"
          ? "How are they different?"
          : String(CATCHING_UNICORNS_LESSON.nodes[nodeId].presentation.prompt)}
      </h2>
    </div>
  );
}
