import { expect, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../../lib/events";
import { summarizeGardenSession } from "../../lib/garden-rescue/evidence-summary";
import { gardenGameEvents, projectGardenGame, type GardenGameEvent } from "../../lib/garden-rescue/game-state";
import { GARDEN_RESCUE_LESSON } from "../../lib/lesson-runtime/garden-rescue-lesson";
import { LessonRuntime } from "../../lib/lesson-runtime/lesson-runtime";

/** The hoisted transport each test file passes to `mockBrowserTransport`. */
export type GardenTestTransport = {
  receive: ((event: ProviderEvent) => void) | undefined;
  send: ReturnType<typeof vi.fn<(command: ClientCommand) => void>>;
  close: ReturnType<typeof vi.fn>;
};

const NUMBERS = ["zero", "one", "two", "three", "four", "five"];
const lastLine = (transcript: string, speaker: "Child" | "Tutor") =>
  transcript
    .split("\n")
    .filter(line => line.startsWith(`${speaker}:`))
    .at(-1) ?? "";

/** Fake classifier route: labels come from the scripted words, as Jev's would. `abstain` returns
 * a null proposal for matching snapshots, leaving that tutor turn without a feedback label. */
function stubClassifier(abstain?: RegExp) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string) as {
        nodeId: string;
        transcriptRevision: number;
        transcript: string;
      };
      const tutorLast = input.transcript.split("\n").at(-1)?.startsWith("Tutor:") ?? false;
      if (abstain && tutorLast && abstain.test(lastLine(input.transcript, "Tutor")))
        return Response.json({ proposal: null });
      const quantity = (GARDEN_RESCUE_LESSON.nodes[input.nodeId].presentation as { quantity: number }).quantity;
      const child = lastLine(input.transcript, "Child").toLowerCase();
      const said = NUMBERS.findIndex(word => new RegExp(`\\b${word}\\b`).test(child));
      const answerOutcome =
        said < 0 ? (/mumble/.test(child) ? "unclear" : "none") : said === quantity ? "correct" : "incorrect";
      const tutor = lastLine(input.transcript, "Tutor");
      return Response.json({
        proposal: {
          nodeId: input.nodeId,
          transcriptRevision: input.transcriptRevision,
          childActivity: "unknown",
          answerOutcome,
          answerCommitment:
            answerOutcome === "correct" || answerOutcome === "incorrect"
              ? "committed"
              : answerOutcome === "unclear"
                ? "unresolved"
                : "no_answer",
          supportState: /\bhelp\b/.test(child) ? "needs_help" : "none",
          tutorState: !tutorLast
            ? "unknown"
            : /point/i.test(tutor)
              ? "helping"
              : /say that again/i.test(tutor)
                ? "clarifying"
                : /^Tutor: Yes/.test(tutor)
                  ? "acknowledging"
                  : "asking",
        },
      });
    }),
  );
}

/** Drives the real LessonRuntime through scripted provider events and records the game-event log
 * exactly as the Garden page derives it, from successive published snapshots. */
export async function gardenRun(transport: GardenTestTransport, abstain?: RegExp) {
  stubClassifier(abstain);
  const gameEvents: GardenGameEvent[] = [];
  let game = projectGardenGame(null);
  const runtime = new LessonRuntime(
    {} as HTMLAudioElement,
    snapshot => {
      const next = projectGardenGame(snapshot);
      gameEvents.push(...gardenGameEvents(game, next));
      game = next;
    },
    GARDEN_RESCUE_LESSON,
  );
  let t = 0;
  const emit = (event: ProviderEvent) => transport.receive!(event);
  const acknowledgeSteering = () => {
    const steer = transport.send.mock.calls.map(([command]) => command).findLast(c => c.event_id.includes(":steer:"))!;
    t += 100;
    emit({
      type: "context.appended",
      name: "session.instructions.appended",
      clientEventId: steer.event_id,
      startMs: t,
    });
  };
  runtime.confirmRendered(runtime.snapshot().display);
  acknowledgeSteering();
  const run = {
    runtime,
    gameEvents,
    async child(text: string) {
      t += 1_000;
      emit({ type: "microphone.activity_started" });
      emit({ type: "transcript", speaker: "child", delta: text, startMs: t, endMs: t + 100 });
      emit({ type: "microphone.speech_stopped", quietMs: 900 });
      await vi.advanceTimersByTimeAsync(400);
    },
    async tutor(text: string, waitMs = 1_500) {
      t += 1_000;
      emit({ type: "transcript", speaker: "sprout", delta: text, startMs: t, endMs: t + 100 });
      emit({ type: "output.activity", state: "active", sourceId: 1 });
      emit({ type: "output.activity", state: "quiet", sourceId: 1 });
      await vi.advanceTimersByTimeAsync(waitMs);
    },
    /** Hold, then confirm the requested scene and acknowledge its steering. */
    async advance() {
      await vi.advanceTimersByTimeAsync(GARDEN_RESCUE_LESSON.successHoldMs! + 500);
      const snapshot = runtime.snapshot();
      expect(snapshot.runtime?.phase).toBe("rendering");
      runtime.confirmRendered(snapshot.display);
      if (runtime.snapshot().runtime?.phase !== "complete") acknowledgeSteering();
      await vi.advanceTimersByTimeAsync(100);
    },
    async succeed(word: string, child = word) {
      await run.child(child);
      await run.tutor(`Yes, ${word}!`);
      await run.advance();
    },
    summary() {
      return summarizeGardenSession({ report: runtime.report(), gameEvents });
    },
  };
  return run;
}
