import { test, expect, type Page } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { installChildScenarios, type ChildScenario, type Checkpoint } from "../../helpers/child-scenario";
import {
  COUNTING_NODE_IDS,
  COUNTING_LESSON_GRAPH,
  type CountingNodeId,
} from "../../../lib/lesson-runtime/counting-lesson";
import { type LessonObservation } from "../../../lib/lesson-runtime/lesson-runtime";
import type { LessonObserver } from "../../helpers/lesson-observer";
import { settledPrompt, settledTutorResponse } from "./signals";
import { LIVE_CORRECT_ANSWERS } from "./answers";
import { assertCompletedLesson, assertWrongWindow, assertWrongDecision, type Report } from "./evidence";

async function observeUntil(
  child: ChildScenario,
  observer: LessonObserver,
  name: string,
  predicate: (value: LessonObservation) => boolean,
  timeoutMs = 25_000,
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
    throw new Error(`Timed out waiting for ${name}`);
  });
  return found;
}

/** PCM quiet alone cannot release the next child action: also require acknowledged steering and a stable tutor transcript. */
async function ready(
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

for (const [mode, title, tag] of [
  ["happy", "happy path: all correct through final-node completion", "@happy-path"],
  [
    "incorrect",
    "incorrect then correct: hold two-duck visit before recovery and completion",
    "@incorrect-then-correct",
  ],
  ["correction", "self-correction: settled two-duck answer authorizes complete lesson", "@self-correction"],
] as const) {
  test(title, { tag: ["@baseline", tag] }, async ({ page }, info) => {
    // Fail waits before the outer test timeout, leaving time for report collection and cleanup.
    const deadline = Date.now() + info.timeout - 20_000;
    const budget = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Scenario observation budget exhausted; collecting attempt evidence");
      return Math.min(25_000, remaining);
    };
    page.setDefaultTimeout(5000);
    // Read-only local resource inventory. Native behavior and provider routes remain untouched.
    await page.addInitScript(() => {
      const resources = { contexts: [] as AudioContext[], peers: [] as RTCPeerConnection[] };
      const Context = window.AudioContext;
      const Peer = window.RTCPeerConnection;
      window.AudioContext = class extends Context {
        constructor(options?: AudioContextOptions) {
          super(options);
          resources.contexts.push(this);
        }
      };
      window.RTCPeerConnection = class extends Peer {
        constructor(options?: RTCConfiguration) {
          super(options);
          resources.peers.push(this);
        }
      };
      Object.assign(window, { lessonTestResources: resources });
    });
    const harness = await installChildScenarios(page, info);
    try {
      await page.goto("/");
      await harness.run(title, async child => {
        await child.parentStart();
        const initial = await child.checkpoint();
        let from: Checkpoint = {
          after: { runtimeId: initial.after.runtimeId, offset: 0 },
          scope: { runtimeId: initial.after.runtimeId },
        };
        for (const node of COUNTING_NODE_IDS) {
          await ready(page, child, harness.observer, node, from, budget);
          if (node === "count-2-ducks" && mode === "incorrect") {
            const wrongFrom = await child.checkpoint();
            const startMs = (await harness.observer.read())!.nowMs;
            expect(await child.sayFixture("answer-three-ducks")).toBe("ended");
            const isWrongDecision = (event: LessonObservation["events"][number]) =>
              ["classifier.held", "classifier.abstained"].includes(event.type) &&
              event.runtimeId === wrongFrom.scope.runtimeId &&
              event.visitId === wrongFrom.scope.visitId &&
              event.childTurnId! > wrongFrom.scope.childTurnId!;
            const decision = await observeUntil(
              child,
              harness.observer,
              "non-completion classifier decision after wrong answer",
              value => value.events.slice(wrongFrom.after.offset).some(isWrongDecision),
              budget(),
            );
            const held = decision.events.slice(wrongFrom.after.offset).find(isWrongDecision)!;
            await child.assert("production verdict hears the wrong answer and holds", async () => {
              const report = (await child.evidence())!;
              const { request } = assertWrongDecision(report.events, held);
              expect(request.childTurnId).toBeGreaterThan(wrongFrom.scope.childTurnId!);
            });
            // Monitor the whole journal, not just the final screen, throughout the bounded hold.
            await child.assert(
              "wrong answer cannot advance for three seconds after non-completion decision",
              async () => {
                const until = held.atMs + 3000;
                let value: LessonObservation;
                do {
                  budget();
                  value = (await harness.observer.read())!;
                  expect(value.snapshot.runtime?.visitId).toBe(wrongFrom.scope.visitId);
                  expect(value.snapshot.status).toBe("live");
                  await delay(25);
                } while (value.nowMs < until);
                assertWrongWindow(value.events, wrongFrom.scope.visitId!, startMs, value.nowMs);
              },
            );
            // A new response waits for fresh post-wrong tutor output and transcript settlement too.
            await observeUntil(
              child,
              harness.observer,
              "settled tutor response to wrong answer",
              value => settledTutorResponse(value, wrongFrom.after.offset),
              budget(),
            );
          }
          from = await child.checkpoint();
          await child.assert(`audio playback on ${node} completes`, async () => {
            expect(
              await (mode === "correction" && node === "count-2-ducks"
                ? child.say("Three. Uh, I mean two.")
                : child.sayFixture(LIVE_CORRECT_ANSWERS[node])),
            ).toBe("ended");
          });
          await observeUntil(
            child,
            harness.observer,
            `GPT-Live child transcript on ${node} after answer audio`,
            value =>
              value.events
                .slice(from.after.offset)
                .some(
                  event =>
                    event.type === "transcript.snapshot" &&
                    event.visitId === from.scope.visitId &&
                    event.transcriptSpeaker === "child" &&
                    event.childTurnId! > from.scope.childTurnId!,
                ),
            budget(),
          );
          const next = COUNTING_LESSON_GRAPH[node].onSuccess;
          if (next.kind === "node") {
            await child.waitForEvent("render.confirmed", {
              from,
              scope: { nodeId: next.nodeId, visitId: undefined },
              timeoutMs: budget(),
            });
          } else
            await child.waitForEvent("lesson.ended", {
              from,
              scope: { visitId: undefined },
              detail: { reason: "lesson_completed" },
              timeoutMs: budget(),
            });
        }
        await child.assert("complete production lesson evidence and teardown", async () => {
          assertCompletedLesson((await child.evidence()) as Report, mode === "correction");
          await expect(page.getByRole("img", { name: "Lesson complete", exact: true })).toBeVisible();
          const microphone = await harness.microphone.state();
          expect(microphone.requests).toBe(1);
          expect(microphone.activeSources).toBe(0);
          expect(microphone.trackStates).toEqual(["live", "ended"]);
          const resources = await resourceState(page);
          expect(resources.peers.length).toBeGreaterThan(0);
          expect(resources.peers.every(state => state === "closed")).toBe(true);
          expect(resources.contexts.filter(state => state !== "closed")).toEqual(["running"]); // synthetic destination retained until artifacts collected
          expect(resources.audioDetached).toBe(true);
        });
      });
    } finally {
      await harness.dispose(); // run() already retained report/actions/timeline, including any assertion failure
      const resources = await resourceState(page);
      await info.attach("resource-teardown.json", {
        body: JSON.stringify({ resources, microphone: await harness.microphone.state() }, null, 2),
        contentType: "application/json",
      });
      expect(resources.contexts.every(state => state === "closed")).toBe(true);
      expect(resources.peers.every(state => state === "closed")).toBe(true);
    }
  });
}

async function resourceState(page: Page) {
  return page.evaluate(() => {
    const resources = (
      window as unknown as { lessonTestResources: { contexts: AudioContext[]; peers: RTCPeerConnection[] } }
    ).lessonTestResources;
    return {
      contexts: resources.contexts.map(context => context.state),
      peers: resources.peers.map(peer => peer.connectionState),
      audioDetached: [...document.querySelectorAll("audio")].every(audio => audio.srcObject === null),
    };
  });
}
