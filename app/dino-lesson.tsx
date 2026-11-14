"use client";

import { DINO_THEME } from "./dino-theme";
import { DinoStage } from "./dino-stage";
import { LessonScreen } from "./lesson-screen";

export default function DinoLesson({ debug = false }: { debug?: boolean }) {
  return <LessonScreen theme={DINO_THEME} debug={debug} renderStage={props => <DinoStage {...props} />} />;
}
