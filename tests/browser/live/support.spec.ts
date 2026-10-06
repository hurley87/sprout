import { test, expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { installChildScenarios, type Checkpoint } from "../../helpers/child-scenario";
import { COUNTING_NODE_IDS, COUNTING_LESSON_GRAPH } from "../../../lib/lesson-runtime/counting-lesson";
import { LIVE_CORRECT_ANSWERS } from "./answers";
import { assertCompletedLesson } from "./evidence";
import { observeUntil, ready } from "./flow";
import { settledTutorResponse } from "./signals";
import {
  assertFreshRecovery,
  assertHoldWindow,
  assertStoppedWindow,
  assertUnresolvedSpeech,
  HOLD_MS,
  SILENCE_MS,
} from "./support-evidence";
import { UNRESOLVED } from "./behaviors";

for (const mode of ["help", "incomplete", "ambiguous", "offTopic", "silence", "stop"] as const) {
  const tag = mode === "offTopic" ? "off-topic" : mode;
  test(
    `support ${tag}: unresolved two-duck objective holds and ${mode === "stop" ? "parent Stop ends progression" : "fresh learner answer recovers"}`,
    { tag: ["@support", `@${tag}`] },
    async ({ page }, info) => {
      const deadline = Date.now() + info.timeout - 20_000;
      const budget = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Scenario observation budget exhausted; collecting attempt evidence");
        return Math.min(25_000, remaining);
      };
      page.setDefaultTimeout(5000);
      const harness = await installChildScenarios(page, info);
      try {
        await harness.run(`support-${tag}`, async child => {
          await page.goto("/");
          await child.parentStart();
          const initial = await child.checkpoint();
          let from: Checkpoint = {
            after: { runtimeId: initial.after.runtimeId, offset: 0 },
            scope: { runtimeId: initial.after.runtimeId },
          };
          let recovery: Checkpoint | undefined;
          for (const node of COUNTING_NODE_IDS) {
            await ready(page, child, harness.observer, node, from, budget);
            if (node === "count-2-ducks") {
              const holdFrom = await child.checkpoint();
              const startMs = (await harness.observer.read())!.nowMs;
              if (mode === "stop") {
                await child.parentStop(); // Actual authority, distinct from requestStop() speech.
                await child.staySilent(HOLD_MS);
                await child.assert("parent Stop prevents all further progression for three seconds", async () => {
                  assertStoppedWindow(
                    (await child.evidence())!,
                    holdFrom,
                    startMs,
                    (await harness.observer.read())!.nowMs,
                  );
                  const microphone = await harness.microphone.state();
                  expect(microphone.trackStates).toContain("ended");
                });
                return;
              }
              if (mode === "silence") {
                await child.staySilent(SILENCE_MS);
                await child.assert("five seconds of connected silence cannot supply learner authority", async () => {
                  const report = (await child.evidence())!;
                  assertHoldWindow(report, holdFrom, startMs, (await harness.observer.read())!.nowMs, SILENCE_MS);
                  expect(
                    report.events
                      .slice(holdFrom.after.offset)
                      .some(e => ["microphone.speech_started", "runtime.event.child.turn.started"].includes(e.type)),
                  ).toBe(false);
                  expect((await harness.microphone.state()).activeSources).toBe(0);
                });
                // Any reprompt during silence must settle before fresh speech.
                await observeUntil(
                  child,
                  harness.observer,
                  "settled current tutor prompt after silence",
                  value => settledTutorResponse(value, 0),
                  budget(),
                );
              } else {
                const fixture = UNRESOLVED[mode];
                expect(await child.sayFixture(fixture.fixture)).toBe("ended");
                let missing = "No fresh canonical hold/abstention after utterance";
                let observedEvent: import("../../../lib/lesson-runtime/lesson-runtime").LessonDiagnostic | undefined;
                const decision = await observeUntil(
                  child,
                  harness.observer,
                  "heard unresolved utterance and canonical non-completion decision",
                  value =>
                    value.events.slice(holdFrom.after.offset).some(event => {
                      if (!["classifier.held", "classifier.abstained"].includes(event.type)) return false;
                      try {
                        assertUnresolvedSpeech(value.events, event, holdFrom, fixture.heard, mode === "help");
                        observedEvent = event;
                        return true;
                      } catch (error) {
                        missing = error instanceof Error ? error.message : String(error);
                        return false;
                      } // Continue observing; timeout includes the missing evidence.
                    }),
                  budget(),
                  () => missing,
                );
                const event = observedEvent!;
                await child.assert("heard utterance, current classifier identity and scaffold evidence", async () => {
                  assertUnresolvedSpeech(decision.events, event, holdFrom, fixture.heard, mode === "help");
                });
                await child.assert("unresolved objective holds throughout three seconds after decision", async () => {
                  let value;
                  do {
                    budget();
                    value = (await harness.observer.read())!;
                    assertHoldWindow((await child.evidence())!, holdFrom, startMs, value.nowMs, 0);
                    await delay(25);
                  } while (value.nowMs < event.atMs + HOLD_MS);
                });
                await observeUntil(
                  child,
                  harness.observer,
                  "settled tutor response before learner continuation",
                  value => settledTutorResponse(value, holdFrom.after.offset),
                  budget(),
                );
              }
              await child.assert("entire unresolved window remains safe until fresh recovery", async () => {
                assertHoldWindow((await child.evidence())!, holdFrom, startMs, (await harness.observer.read())!.nowMs);
              });
              recovery = await child.checkpoint();
            }
            from = await child.checkpoint();
            await child.assert(`learner answer audio completes on ${node}`, async () => {
              expect(await child.sayFixture(LIVE_CORRECT_ANSWERS[node])).toBe("ended");
            });
            await observeUntil(
              child,
              harness.observer,
              `fresh child transcript on ${node}`,
              value =>
                value.events
                  .slice(from.after.offset)
                  .some(
                    e =>
                      e.type === "transcript.snapshot" &&
                      e.visitId === from.scope.visitId &&
                      e.transcriptSpeaker === "child" &&
                      e.childTurnId! > from.scope.childTurnId!,
                  ),
              budget(),
            );
            const next = COUNTING_LESSON_GRAPH[node].onSuccess;
            if (next.kind === "node")
              await child.waitForEvent("render.confirmed", {
                from,
                scope: { nodeId: next.nodeId, visitId: undefined },
                timeoutMs: budget(),
              });
            else
              await child.waitForEvent("lesson.ended", {
                from,
                scope: { visitId: undefined },
                detail: { reason: "lesson_completed" },
                timeoutMs: budget(),
              });
          }
          await child.assert("fresh learner recovery and complete production lesson journal", async () => {
            const report = (await child.evidence())!;
            assertFreshRecovery(report, recovery!);
            assertCompletedLesson(report);
            await expect(page.getByRole("img", { name: "Lesson complete", exact: true })).toBeVisible();
          });
        });
      } finally {
        await harness.dispose(); // run() preserves journal/actions/final state/timeline before teardown.
      }
    },
  );
}
