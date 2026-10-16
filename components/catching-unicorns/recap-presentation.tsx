import styles from "../catching-unicorns-demo.module.css";
import { CATCHING_UNICORNS_LESSON } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { evidenceRecap } from "@/lib/lesson-runtime/evidence-recap";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";

export function RecapPresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  return (
    <div className={styles.recapScene} data-scene="recap" aria-live="polite">
      <h2 className={styles.recapTitle}>What this conversation showed</h2>
      <p className={styles.recapText}>{evidenceRecap(CATCHING_UNICORNS_LESSON, state)}</p>
    </div>
  );
}
