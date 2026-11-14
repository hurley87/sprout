"use client";

import { useState } from "react";
import { createDinoSfx } from "./dino-sfx";
import { DINO_THEME } from "./dino-theme";
import { DinoStage } from "./dino-stage";
import { LessonScreen } from "./lesson-screen";

export default function DinoLesson({ debug = false }: { debug?: boolean }) {
  const [sfx] = useState(createDinoSfx);
  return (
    <LessonScreen
      theme={DINO_THEME}
      debug={debug}
      onStart={() => void sfx.unlock()}
      renderStage={props => <DinoStage {...props} sfx={sfx} />}
    />
  );
}
