"use client";

import { ICE_CREAM_THEME } from "./ice-cream-theme";
import { IceCreamStage } from "./ice-cream-stage";
import { LessonScreen } from "./lesson-screen";

export default function IceCreamLesson({ debug = false }: { debug?: boolean }) {
  return <LessonScreen theme={ICE_CREAM_THEME} debug={debug} renderStage={props => <IceCreamStage {...props} />} />;
}
