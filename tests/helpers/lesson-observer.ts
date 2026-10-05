import type { Page } from "@playwright/test";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import type { LessonDiagnostic, LessonEventCursor, LessonObservation } from "../../lib/lesson-runtime/lesson-runtime";

export type LessonEventScope = Pick<LessonDiagnostic, "runtimeId"> &
  Partial<Pick<LessonDiagnostic, "visitId" | "childTurnId" | "nodeId" | "transcriptRevision">>;

/** Exact production identities, never inferred from tutor wording or classifier semantics. */
export function matchesLessonEvent(event: LessonDiagnostic, scope: LessonEventScope) {
  return Object.entries(scope).every(([key, value]) => event[key as keyof LessonDiagnostic] === value);
}

/** Match a subset of structured detail, including render identity and proposal fields. */
function matchesDetail(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  return Object.entries(expected).every(
    ([key, value]) => Object.hasOwn(actual, key) && matchesDetail((actual as Record<string, unknown>)[key], value),
  );
}

export async function installLessonObserver(page: Page) {
  await page.addInitScript(() => {
    (window as LessonObservationWindow).__SPROUT_OBSERVE_LESSON__ = true;
  });
  return new LessonObserver(page);
}

export class LessonObserver {
  constructor(private readonly page: Page) {}

  async read(after?: LessonEventCursor): Promise<LessonObservation | null> {
    return this.page.evaluate(cursor => {
      const bridge = (window as LessonObservationWindow).sproutLessonObservation;
      if (!bridge) throw new Error("Lesson observation bridge is not attached");
      return bridge.read(cursor);
    }, after);
  }

  async report() {
    return this.page.evaluate(() => {
      const bridge = (window as LessonObservationWindow).sproutLessonObservation;
      if (!bridge) throw new Error("Lesson observation bridge is not attached");
      return bridge.report();
    });
  }

  /** Capture before the action being observed. Restart invalidates this cursor. */
  async cursor(): Promise<LessonEventCursor> {
    const observation = await this.read();
    if (!observation) throw new Error("No lesson runtime to scope the wait");
    return observation.cursor;
  }

  /** Searches only events strictly after the supplied cursor, in journal order. */
  async waitForEvent(
    type: string,
    options: {
      after: LessonEventCursor;
      scope: LessonEventScope;
      timeoutMs?: number;
      detail?: Record<string, unknown>;
    },
  ): Promise<{ event: LessonDiagnostic; cursor: LessonEventCursor }> {
    if (options.after.runtimeId !== options.scope.runtimeId) throw new Error("Cursor and scope runtime differ");
    const deadline = Date.now() + (options.timeoutMs ?? 10_000);
    let cursor = options.after;
    do {
      const observation = await this.read(cursor);
      if (!observation) throw new Error("Lesson runtime detached during wait");
      const index = observation.events.findIndex(
        event =>
          event.type === type &&
          matchesLessonEvent(event, options.scope) &&
          (options.detail === undefined || matchesDetail(event.detail, options.detail)),
      );
      if (index >= 0)
        return {
          event: observation.events[index],
          cursor: { runtimeId: cursor.runtimeId, offset: cursor.offset + index + 1 },
        };
      cursor = observation.cursor;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error(
      `Timed out waiting for ${type} after ${JSON.stringify(options.after)} in ${JSON.stringify(options.scope)}`,
    );
  }
}
