"use client";

import { useMemo } from "react";
import { LessonScreen } from "./lesson-screen";
import { SnowflakeShowdownStage } from "./snowflake-showdown-stage";
import { snowflakeShowdownTheme } from "./snowflake-showdown-theme";

export default function SnowflakeShowdownLesson({ seed, debug = false }: { seed: number; debug?: boolean }) {
  const theme = useMemo(() => snowflakeShowdownTheme(seed), [seed]);
  return (
    <LessonScreen
      theme={theme}
      debug={debug}
      renderStage={props => <SnowflakeShowdownStage seed={seed} {...props} />}
    />
  );
}
