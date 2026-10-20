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
      // The new authored counting policy intentionally differs from the historical
      // reducer. Compare legacy gates on the same inputs; policy outcomes are tested separately.
      const legacyArgs: typeof args = [args[0], args[1], { ...args[2], answerAcceptance: undefined }];
      if (args[2].answerAcceptance && args[1].type === "proposal.received" &&
          args[1].proposal && typeof args[1].proposal === "object" && !Array.isArray(args[1].proposal)) {
        const proposal = { ...args[1].proposal as Record<string, unknown> };
        Reflect.deleteProperty(proposal, "answerCommitment");
        legacyArgs[1] = { ...args[1], proposal };
      }
      const comparable = args[2].answerAcceptance ? current.reduceLessonRuntime(...legacyArgs) : result;
      const previous = baseline.reduceLessonRuntime(...legacyArgs);
      expect(comparable.state, `baseline state after ${args[1].type}`).toEqual(previous.state);
      expect(comparable.effects, `baseline effects after ${args[1].type}`).toEqual(previous.effects);
      expect(comparable.state === args[0], `baseline ignored-event identity after ${args[1].type}`).toBe(
        previous.state === args[0],
      );
      // proposalConsumption is new observational metadata, intentionally excluded.
      return result;
    },
  };
});
