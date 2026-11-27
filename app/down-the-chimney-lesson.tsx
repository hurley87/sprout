"use client";
import { useMemo } from "react";
import { LessonScreen } from "./lesson-screen";
import { DownTheChimneyStage } from "./down-the-chimney-stage";
import { downTheChimneyTheme } from "./down-the-chimney-theme";
export default function DownTheChimneyLesson({ seed, debug = false }: { seed: number; debug?: boolean }) {
  const theme = useMemo(() => downTheChimneyTheme(seed), [seed]);
  return <LessonScreen theme={theme} debug={debug} renderStage={props => <DownTheChimneyStage {...props} />} />;
}
