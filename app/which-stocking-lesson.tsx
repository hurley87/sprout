"use client";
import { useMemo } from "react";
import { LessonScreen } from "./lesson-screen";
import { WhichStockingStage } from "./which-stocking-stage";
import { whichStockingTheme } from "./which-stocking-theme";
export default function WhichStockingLesson({ seed, debug = false }: { seed: number; debug?: boolean }) {
  const theme = useMemo(() => whichStockingTheme(seed), [seed]);
  return <LessonScreen theme={theme} debug={debug} renderStage={props => <WhichStockingStage {...props} />} />;
}
