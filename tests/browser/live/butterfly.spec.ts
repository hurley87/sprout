import { test, expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { installChildScenarios, type Checkpoint } from "../../helpers/child-scenario";
import type { InjectionTiming, WindowEvidence } from "../../helpers/injection-window";
import type { SpeechFixture } from "../../helpers/synthetic-microphone";
import { ready, observeUntil } from "./flow";
import { settledTutorResponse } from "./signals";
import { detail } from "./evidence";
import { completeButterflyPrerequisite } from "./setup";
import {
  assertButterflySafety,
  assertButterflyCompletion,
  butterflySummary,
  formatButterflySummary,
  BUTTERFLY_OBSERVATION_MS,
} from "./butterfly-evidence";

// Five independently selectable windows, one attempt each; never a timing cross-product.
const cases = [
  { name: "barge-in-output", kind: "barge-in", timing: "during-output", fixture: "barge-in" },
  { name: "noise-output", kind: "noise", timing: "during-output" },
  { name: "noise-confirmation", kind: "noise", timing: "confirmation-quiet" },
  { name: "filler-confirmation", kind: "filler", timing: "confirmation-quiet", fixture: "uh" },
  { name: "filler-classifier", kind: "filler", timing: "classifier-in-flight", fixture: "uh" },
] as const satisfies readonly { name: string; kind: string; timing: InjectionTiming; fixture?: SpeechFixture }[];
const answerVoice = process.env.SPROUT_BUTTERFLY_ANSWER_VOICE ?? "Albert";
if (answerVoice !== "Albert" && answerVoice !== "Samantha")
  throw new Error("SPROUT_BUTTERFLY_ANSWER_VOICE must be Albert or Samantha");
const answerFixture: SpeechFixture = answerVoice === "Albert" ? "hesitant-three" : "hesitant-three-samantha";
const observeOnly = process.env.SPROUT_BUTTERFLY_OBSERVE_ONLY === "1";
const replyToRecovery = process.env.SPROUT_BUTTERFLY_REPLY_TO_RECOVERY === "1";

for (const scenario of cases) {
  test(
    `butterfly ${scenario.name}: ${observeOnly ? "evidence probe" : "product regression"}`,
    {
      tag: [
        "@butterfly",
        `@${scenario.name}`,
        `@${scenario.kind}`,
        `@${scenario.timing}`,
        observeOnly ? "@probe" : "@regression",
      ],
    },
    async ({ page }, info) => {
      info.annotations.push({ type: "answer-voice", description: `${answerVoice}: ${answerFixture}` });
      if (replyToRecovery)
        info.annotations.push({
          type: "recovery-mode",
          description: "one fresh learner answer after a heard production recovery prompt; not automatic completion",
        });
      const deadline = Date.now() + info.timeout - 20_000;
      const budget = () => {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error("Butterfly observation budget exhausted");
        return Math.min(left, 25_000);
      };
      page.setDefaultTimeout(5000);
      const harness = await installChildScenarios(page, info);
      try {
        await harness.run(`butterfly-${scenario.name}`, async child => {
          let landed: WindowEvidence | null = null;
          let freshAnswerRecovery = false;
          let bodyFailed = false;
          try {
            await page.goto("/");
            await child.parentStart();
            // All decoding and checksum validation happen before the answer/confirmation race.
            await child.preload(answerFixture);
            if (replyToRecovery && scenario.kind === "filler") await child.preload("answer-three");
            if ("fixture" in scenario) await child.preload(scenario.fixture);
            const initial = await child.checkpoint();
            let from: Checkpoint = {
              after: { runtimeId: initial.after.runtimeId, offset: 0 },
              scope: { runtimeId: initial.after.runtimeId },
            };
            for (const node of ["count-1-duck", "count-2-ducks"] as const) {
              await ready(page, child, harness.observer, node, from, budget);
              from = await completeButterflyPrerequisite(child, harness.observer, node, budget);
            }
            await ready(page, child, harness.observer, "count-3-butterflies", from, budget);
            const answerFrom = await child.checkpoint();
            // Arm concurrently so output/transcript events during answer playback remain eligible.
            const injection = child.injectInWindow(
              {
                from: answerFrom,
                timing: scenario.timing,
                audio:
                  "fixture" in scenario
                    ? { fixture: scenario.fixture }
                    : { noise: { seed: 30, durationMs: 40, amplitude: 0.2 } },
              },
              budget(),
            );
            // Settle both actions before evidence capture, including failures.
            const [answer, injected] = await Promise.allSettled([child.sayFixture(answerFixture), injection]);
            if (injected.status === "fulfilled") landed = injected.value;
            if (answer.status === "rejected") throw answer.reason;
            expect(answer.value).toBe("ended");
            if (injected.status === "rejected") throw injected.reason;
            await child.assert("bounded observation after injected audio", async () => {
              const until = landed!.afterStartMs + BUTTERFLY_OBSERVATION_MS;
              do {
                budget();
                const value = (await harness.observer.read())!;
                if (value.snapshot.status === "ended" || value.nowMs >= until) break;
                await delay(25);
              } while (true);
            });
            if (replyToRecovery && !observeOnly && scenario.kind === "filler") {
              const observed = (await harness.observer.read())!;
              const recovery = observed.events.findLast(
                event =>
                  event.type === "answer_recovery.requested" &&
                  event.runtimeId === landed!.state.runtimeId &&
                  event.visitId === landed!.state.visitId &&
                  event.childTurnId! > landed!.state.childTurnId &&
                  event.atMs >= landed!.afterStartMs,
              );
              if (recovery && observed.snapshot.status === "live") {
                const offset = observed.events.indexOf(recovery) + 1;
                await observeUntil(
                  child,
                  harness.observer,
                  "fresh heard recovery clarification",
                  value => {
                    const state = value.snapshot.runtime;
                    const tutor = value.events
                      .slice(offset)
                      .findLast(
                        event =>
                          event.type === "transcript.snapshot" &&
                          event.transcriptSpeaker === "tutor" &&
                          event.runtimeId === recovery.runtimeId &&
                          event.visitId === recovery.visitId &&
                          event.childTurnId === recovery.childTurnId,
                      );
                    if (
                      !tutor ||
                      !state ||
                      state.runtimeId !== recovery.runtimeId ||
                      state.visitId !== recovery.visitId ||
                      state.nodeId !== recovery.nodeId ||
                      state.childTurnId !== recovery.childTurnId ||
                      value.snapshot.awaitingSteering
                    )
                      return false;
                    const text = detail<{ transcript: string }>(tutor).transcript.split("\n").at(-1) ?? "";
                    return (
                      /^Tutor:/i.test(text) &&
                      /repeat|say.*again|one more time/i.test(text) &&
                      settledTutorResponse(value, offset)
                    );
                  },
                  budget(),
                );
                expect(await child.sayFixture("answer-three")).toBe("ended");
                freshAnswerRecovery = true;
                await observeUntil(
                  child,
                  harness.observer,
                  "fresh learner recovery completes lesson",
                  value => value.snapshot.status === "ended",
                  budget(),
                );
              }
            }
            const report = (await child.evidence())!;
            await child.assert("landed window and cancellation/identity/ordering safety", async () => {
              assertButterflySafety(report, landed!, scenario.kind === "barge-in", freshAnswerRecovery);
            });
            if (!observeOnly && scenario.kind !== "barge-in") {
              await child.assert("noise/filler must recover with exactly one legitimate final completion", async () => {
                assertButterflyCompletion(report, landed!, freshAnswerRecovery); // Known starvation stays a failing regression, outside @baseline.
              });
            }
          } catch (error) {
            bodyFailed = true;
            throw error;
          } finally {
            try {
              const report = await harness.observer.report();
              if (report) {
                const now = (await harness.observer.read())!.nowMs;
                const summary = butterflySummary(
                  report,
                  landed,
                  now,
                  scenario.kind === "barge-in",
                  freshAnswerRecovery,
                );
                info.annotations.push({
                  type: observeOnly ? "evidence-only" : "regression-outcome",
                  description: summary.outcome,
                });
                for (const [name, body, contentType] of [
                  ["butterfly-summary.json", JSON.stringify(summary, null, 2), "application/json"],
                  ["butterfly-summary.txt", formatButterflySummary(scenario.name, summary, observeOnly), "text/plain"],
                ]) {
                  const path = info.outputPath(name);
                  await writeFile(path, body);
                  await info.attach(name, { path, contentType });
                }
              }
            } catch (error) {
              if (!bodyFailed) throw error;
              info.annotations.push({
                type: "summary-incomplete",
                description: error instanceof Error ? error.message : String(error),
              });
            }
          }
        });
      } finally {
        await harness.dispose();
      }
    },
  );
}
