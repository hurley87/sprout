import { expect, type Page } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import type { ChildScenario, Checkpoint } from "../../helpers/child-scenario";
import { COUNTING_LESSON_GRAPH, type CountingNodeId } from "../../../lib/lesson-runtime/counting-lesson";
import type { LessonObservation } from "../../../lib/lesson-runtime/lesson-runtime";
import type { LessonObserver } from "../../helpers/lesson-observer";
import { settledPrompt } from "./signals";
export async function observeUntil(
  child: ChildScenario,
  observer: LessonObserver,
  name: string,
  predicate: (value: LessonObservation) => boolean,
  timeoutMs = 25_000,
  missingEvidence: () => string = () => "",
) {
  let found!: LessonObservation;
  await child.assert(name, async () => {
    const deadline = Date.now() + timeoutMs;
    do {
      const value = await observer.read();
      if (!value) throw new Error("attempt detached");
      if (predicate(value)) {
        found = value;
        return;
      }
      if (value.snapshot.status === "ended") throw new Error(`lesson ended before ${name}`);
      await delay(25);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${name}. ${missingEvidence()}`);
  });
  return found;
}

/** PCM quiet alone cannot release the next child action: also require acknowledged steering and a stable tutor transcript. */
export async function ready(
  page: Page,
  child: ChildScenario,
  observer: LessonObserver,
  nodeId: CountingNodeId,
  from: Checkpoint,
  budget: () => number,
) {
  const rendered = await child.waitForEvent("render.confirmed", {
    from,
    scope: { visitId: undefined, nodeId },
    timeoutMs: budget(),
  });
  const visitId = rendered.event.visitId!;
  const value = await observeUntil(
    child,
    observer,
    `settled tutor prompt on ${nodeId}`,
    value => settledPrompt(value, nodeId, visitId, from.after.runtimeId),
    budget(),
  );
  const node = COUNTING_LESSON_GRAPH[nodeId];
  await child.assert(`rendered ${nodeId} matches observed identity`, async () => {
    await expect(
      page.getByRole("img", {
        name: `${node.quantity} ${node.object}${node.quantity === 1 ? "" : "s"} to count`,
        exact: true,
      }),
    ).toHaveAttribute("data-render-token", value.snapshot.display.token);
  });
}
