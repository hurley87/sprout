"use client";

import { useMemo } from "react";
import { ChristmasTreeStage } from "./christmas-tree-stage";
import { christmasTreeTheme } from "./christmas-tree-theme";
import { LessonScreen } from "./lesson-screen";
import styles from "./christmas-tree-stage.module.css";

export default function ChristmasTreeLesson({ seed, debug = false }: { seed: number; debug?: boolean }) {
  const theme = useMemo(() => christmasTreeTheme(seed), [seed]);

  return (
    <LessonScreen
      theme={theme}
      debug={debug}
      renderStage={props => <ChristmasTreeStage seed={seed} {...props} />}
      startButtonClassName={styles.play}
    />
  );
}
