import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { GARDEN_RESCUE_NODE_IDS } from "../../../lib/lesson-runtime/garden-rescue-lesson";
import { installChildScenarios, type Checkpoint, type ChildScenario } from "../../helpers/child-scenario";
import type { SpeechFixture } from "../../helpers/synthetic-microphone";
import { observeUntil } from "./flow";
import { settledTutorResponse } from "./signals";

const answers: SpeechFixture[] = ["answer-three-ducks", "answer-three", "four", "four"];

for (const mode of ["correct", "correction", "help", "release"] as const) {
  test(`garden rescue: ${mode} full playthrough`, { tag: ["@garden", `@garden-${mode}`] }, async ({ page }, info) => {
    test.setTimeout(240_000);
    const deadline = Date.now() + info.timeout - 20_000;
    const budget = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Garden observation budget exhausted");
      return Math.min(30_000, remaining);
    };
    const harness = await installChildScenarios(page, info);
    try {
      await harness.run(`garden-${mode}`, async child => {
        await page.goto("/games/garden?debug=1");
        await child.parentStart();
        const initial = await child.checkpoint();
        let from: Checkpoint = { after: { runtimeId: initial.after.runtimeId, offset: 0 }, scope: initial.scope };
        try {
          for (const [index, nodeId] of GARDEN_RESCUE_NODE_IDS.entries()) {
            const rendered = await child.waitForEvent("render.confirmed", {
              from,
              scope: { nodeId, visitId: undefined },
              timeoutMs: budget(),
            });
            await observeUntil(
              child,
              harness.observer,
              `settled prompt on ${nodeId}`,
              value =>
                value.snapshot.runtime?.nodeId === nodeId &&
                value.snapshot.runtime.visitId === rendered.event.visitId &&
                !value.snapshot.awaitingSteering &&
                settledTutorResponse(value, rendered.cursor.offset - 1),
              budget(),
            );
            if (index === 0 && mode !== "correct") {
              const attempts = mode === "release" ? 3 : 1;
              for (let attempt = 0; attempt < attempts; attempt++) {
                const before = await child.checkpoint();
                expect(await child.sayFixture(mode === "correction" ? "answer-two" : "help")).toBe("ended");
                if (mode === "release" && attempt === attempts - 1) {
                  from = before;
                  break;
                }
                await observeUntil(
                  child,
                  harness.observer,
                  "difficulty recorded and tutor response settled",
                  value =>
                    value.events
                      .slice(before.after.offset)
                      .some(
                        e =>
                          ["classifier.held", "classifier.abstained"].includes(e.type) &&
                          e.visitId === before.scope.visitId,
                      ) && settledTutorResponse(value, before.after.offset),
                  budget(),
                );
              }
            }
            if (!(index === 0 && mode === "release")) {
              from = await child.checkpoint();
              expect(await child.sayFixture(answers[index])).toBe("ended");
            }
            if (index === GARDEN_RESCUE_NODE_IDS.length - 1) {
              await child.waitForEvent("lesson.ended", {
                from,
                scope: { visitId: undefined },
                detail: { reason: "lesson_completed" },
                timeoutMs: budget(),
              });
            }
          }
          await expect(page.locator("[data-game-status]")).toHaveAttribute(
            "data-game-status",
            mode === "release" ? "finished" : "celebrating",
          );
          const downloading = page.waitForEvent("download");
          await page
            .getByRole("complementary", { name: "Developer diagnostics" })
            .getByRole("button", { name: "Export diagnostics" })
            .click();
          const download = await downloading;
          const path = info.outputPath("garden-diagnostics.json");
          await download.saveAs(path);
          await info.attach("garden-diagnostics", { path, contentType: "application/json" });
          const exported = JSON.parse(await readFile(path, "utf8"));
          const { summary, events } = exported.game;
          expect(summary.integrity).toEqual({ ok: true, issues: [] });
          expect(summary.ending).toBe(mode === "release" ? "completed_with_release" : "completed_all_restored");
          expect(summary.rehearsals.map((v: { questId: string }) => v.questId)).toEqual(
            GARDEN_RESCUE_NODE_IDS.slice(0, 3),
          );
          expect(summary.transfer).toMatchObject({
            questId: "fresh-challenge",
            probe: "transfer",
            outcome: "succeeded",
          });
          if (mode === "release") {
            expect(summary.rehearsals[0]).toMatchObject({
              outcome: "released_after_support_limit",
              supportLimit: { status: "reached" },
            });
            expect(summary.rehearsals[0].difficulties.length).toBeGreaterThanOrEqual(3);
          }
          if (mode === "correction") expect(summary.rehearsals[0].selfCorrected).toBe(true);
          if (mode === "help")
            expect(summary.rehearsals[0].difficulties).toEqual(
              expect.arrayContaining([expect.objectContaining({ kind: "help_request" })]),
            );
          for (const [i, event] of events.entries()) {
            if (event.type === "world.effect")
              expect(events.slice(0, i)).toContainEqual(
                expect.objectContaining({ type: "quest.succeeded", questId: event.questId, visitId: event.visitId }),
              );
          }
        } finally {
          await attachTiming(child, info);
        }
      });
    } finally {
      await harness.dispose();
    }
  });
}

async function attachTiming(child: ChildScenario, info: import("@playwright/test").TestInfo) {
  const report = await child.evidence();
  const events = report?.events ?? [];
  const speech = child.records.filter(r => r.name === "sayFixture" && r.kind === "end");
  const turns = speech.map((record, index) => {
    const end = record.atMs;
    const active = events.find(
      e =>
        end !== null &&
        e.atMs >= end &&
        (speech[index + 1]?.atMs == null || e.atMs < speech[index + 1].atMs!) &&
        e.type === "output.activity" &&
        (e.detail as { state?: string } | null)?.state === "active",
    );
    return {
      fixture: record.trigger,
      utteranceEndMs: end,
      tutorAudioStartMs: active?.atMs ?? null,
      latencyMs: end !== null && active ? active.atMs - end : null,
    };
  });
  const quiet = events.filter(
    e => e.type === "output.activity" && (e.detail as { state?: string } | null)?.state === "quiet",
  );
  const deadAirGaps = quiet.map(event => {
    const next = events.find(
      e =>
        e.atMs > event.atMs &&
        (e.type === "microphone.speech_started" ||
          (e.type === "output.activity" && (e.detail as { state?: string } | null)?.state === "active")),
    );
    return { startMs: event.atMs, endMs: next?.atMs ?? null, durationMs: next ? next.atMs - event.atMs : null };
  });
  await info.attach("garden-timing.json", {
    body: JSON.stringify(
      { clock: "runtime relative milliseconds; fixture end includes observer scheduling", turns, deadAirGaps },
      null,
      2,
    ),
    contentType: "application/json",
  });
}
