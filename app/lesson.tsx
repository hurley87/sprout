"use client";

import type { CountingTheme } from "./counting-themes";
import { CountingStage } from "./counting-stage";
import { LessonScreen } from "./lesson-screen";

export default function Lesson({ theme, debug = false }: { theme: CountingTheme; debug?: boolean }) {
  return (
    <LessonScreen
      theme={theme}
      debug={debug}
      renderStage={({ node, ...props }) => (
        <CountingStage
          theme={theme}
          node={
            node
              ? {
                  id: node.id,
                  sceneId: String(node.presentation.sceneId),
                  object: String(node.presentation.object),
                  quantity: Number(node.presentation.quantity),
                }
              : null
          }
          {...props}
        />
      )}
    />
  );
}
