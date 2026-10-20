import { expect, vi } from "vitest";

// Opt-in suite-wide differential replay. Existing regression scenarios drive the
// real runtime/reducer; every reduction also executes the pinned old reducer.
vi.mock("../../lib/lesson-runtime/lesson-runtime-reducer", async importOriginal => {
  const current = await importOriginal<typeof import("../../lib/lesson-runtime/lesson-runtime-reducer")>();
  const baseline = await import("../fixtures/issue-77-baseline/reducer");
  return {
    ...current,
    createLessonRuntime(...args: Parameters<typeof current.createLessonRuntime>) {
      const result = current.createLessonRuntime(...args);
      expect(result, "baseline initial state").toEqual(baseline.createLessonRuntime(...args));
      return result;
    },
    reduceLessonRuntime(...args: Parameters<typeof current.reduceLessonRuntime>) {
      const result = current.reduceLessonRuntime(...args);
      const previous = baseline.reduceLessonRuntime(...args);
      expect(result.state, `baseline state after ${args[1].type}`).toEqual(previous.state);
      expect(result.effects, `baseline effects after ${args[1].type}`).toEqual(previous.effects);
      expect(result.state === args[0], `baseline ignored-event identity after ${args[1].type}`).toBe(
        previous.state === args[0],
      );
      // proposalConsumption is new observational metadata, intentionally excluded.
      return result;
    },
  };
});
