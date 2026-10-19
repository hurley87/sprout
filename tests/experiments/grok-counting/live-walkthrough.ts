import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { installSyntheticMicrophone } from "../../helpers/synthetic-microphone";
import manifest from "../../fixtures/speech/manifest.json";
import { summarizeGrokWalkthrough } from "../../../lib/experiments/grok-counting/walkthrough-evidence";
import type { DecisionEntry } from "../../../lib/experiments/grok-counting/proposals";

test("one bounded real-provider authored counting walkthrough; zero paid retries", async ({ page }) => {
  const mode = process.env.GROK_BENCHMARK_MODE!;
  const startedAt = new Date().toISOString();
  const origin = performance.now();
  const wire: {
    receivedAtMs: number;
    type: string;
    text?: string;
    model?: string;
    status?: string;
    outcome?: string;
    support?: string;
  }[] = [];
  let generatedResponses = 0;
  let requestedResponses = 0;
  let settledQuestions = 0;
  let questionPending = false;
  let question: { id: string; finalText: boolean; audio: boolean } | undefined;
  page.on("websocket", socket => {
    if (!socket.url().startsWith("wss://api.x.ai/")) return;
    socket.on("framesent", frame => {
      try {
        const event = JSON.parse(String(frame.payload));
        if (event.type === "response.create") {
          requestedResponses++;
          if (requestedResponses === 1 || event.response?.instructions?.includes("exact new scene is rendered"))
            questionPending = true;
        }
      } catch {}
    });
    socket.on("framereceived", frame => {
      try {
        const event = JSON.parse(String(frame.payload));
        if (event.type === "response.created" && questionPending) {
          questionPending = false;
          question = { id: event.response.id, finalText: false, audio: false };
        }
        if (question && event.response_id === question.id) {
          if (
            ["response.output_audio_transcript.done", "response.audio_transcript.done"].includes(event.type) &&
            event.transcript?.trim()
          )
            question.finalText = true;
          if (["response.output_audio.delta", "response.audio.delta"].includes(event.type)) question.audio = true;
        }
        if (event.type === "response.done" && question && event.response?.id === question.id) {
          if (event.response.status === "completed" && question.finalText && question.audio) settledQuestions++;
          question = undefined;
        }
        if (
          ![
            "session.created",
            "session.updated",
            "input_audio_buffer.speech_started",
            "input_audio_buffer.speech_stopped",
            "conversation.item.input_audio_transcription.completed",
            "response.created",
            "response.function_call_arguments.done",
            "response.output_audio_transcript.done",
            "response.audio_transcript.done",
            "response.done",
            "error",
          ].includes(event.type)
        )
          return;
        const entry: (typeof wire)[number] = { receivedAtMs: Math.round(performance.now() - origin), type: event.type };
        if (["session.created", "session.updated"].includes(event.type) && typeof event.session?.model === "string")
          entry.model = event.session.model.slice(0, 80);
        if (typeof event.transcript === "string") entry.text = event.transcript.slice(0, 2000);
        if (typeof event.response?.status === "string") entry.status = event.response.status.slice(0, 40);
        if (event.type === "response.done") generatedResponses++;
        if (event.type === "response.function_call_arguments.done") {
          const args = JSON.parse(event.arguments);
          if (["none", "correct", "incorrect", "unclear"].includes(args.answer_outcome))
            entry.outcome = args.answer_outcome;
          if (["none", "needs_help"].includes(args.support_state)) entry.support = args.support_state;
        }
        if (wire.length < 512) wire.push(entry);
      } catch {
        /* Never retain raw provider frames, including unreadable bodies. */
      }
    });
  });
  const microphone = await installSyntheticMicrophone(page);
  const fixtures: {
    nodeId: string;
    name: "answer-one" | "answer-two" | "answer-three";
    sha256: string;
    text: string;
    browserPerformanceMs?: number;
  }[] = [
    {
      nodeId: "count-1-duck",
      name: "answer-one",
      sha256: manifest.fixtures["answer-one"].sha256,
      text: manifest.fixtures["answer-one"].text,
    },
    {
      nodeId: "count-2-ducks",
      name: "answer-two",
      sha256: manifest.fixtures["answer-two"].sha256,
      text: manifest.fixtures["answer-two"].text,
    },
    {
      nodeId: "count-3-butterflies",
      name: "answer-three",
      sha256: manifest.fixtures["answer-three"].sha256,
      text: manifest.fixtures["answer-three"].text,
    },
  ];
  let stage = "opening";
  let outcome = "blocked";
  let blocker: string | null = null;
  let sessionExport: {
    decisionTimeline?: DecisionEntry[];
    complete?: boolean;
    error?: string;
    [key: string]: unknown;
  } | null = null;
  const played: string[] = [];
  try {
    await page.goto(`/experiments/grok-counting?mode=${mode}`);
    for (const fixture of fixtures) await microphone.loadSpeech(fixture.name);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect
      .poll(
        async () =>
          settledQuestions >= 1 && (await page.getByRole("status").textContent())?.includes("listening · Audio: idle"),
        { timeout: 30_000 },
      )
      .toBe(true);
    for (let index = 0; index < fixtures.length; index++) {
      const fixture = fixtures[index];
      stage = fixture.nodeId;
      await expect(page.locator(`[data-node-id="${fixture.nodeId}"]`)).toBeVisible();
      const baseline = generatedResponses;
      const playback = await microphone.playSpeech(fixture.name);
      played.push(fixture.name);
      fixture.browserPerformanceMs = await page.evaluate(() => performance.now());
      await microphone.waitForPlayback(playback.id);
      const nextNode = fixtures[index + 1]?.nodeId;
      await expect
        .poll(
          async () => {
            if (await page.getByRole("main").getByRole("alert").count()) return "terminal";
            if (
              nextNode
                ? await page.locator(`[data-node-id="${nextNode}"]`).isVisible()
                : await page.locator('[data-complete="true"]').isVisible()
            )
              return "advanced";
            // A rejected actual report is a genuine blocker; no new learner attempt is permitted.
            if (
              generatedResponses > baseline &&
              (await page.getByLabel("Tool proposal").textContent())?.includes("Rejected:") &&
              (await page.getByRole("status").textContent())?.includes("Audio: idle")
            )
              return "report-rejected";
            return "waiting";
          },
          { timeout: 30_000 },
        )
        .not.toBe("waiting");
      const advanced = nextNode
        ? await page.locator(`[data-node-id="${nextNode}"]`).isVisible()
        : await page.locator('[data-complete="true"]').isVisible();
      if (!advanced) {
        blocker = "provider-or-application-blocker";
        break;
      }
      if (nextNode)
        await expect
          .poll(
            async () =>
              settledQuestions >= index + 2 &&
              (await page.getByRole("status").textContent())?.includes("listening · Audio: idle"),
            {
              timeout: 20_000,
            },
          )
          .toBe(true);
      else outcome = "completed";
    }
  } catch {
    blocker = `bounded-wait-or-setup-failed:${stage}`;
  } finally {
    try {
      const stop = page.getByRole("button", { name: "Stop", exact: true });
      if (await stop.isEnabled()) await stop.click();
      const downloaded = page.waitForEvent("download", { timeout: 5000 });
      await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
      sessionExport = JSON.parse(await readFile((await (await downloaded).path())!, "utf8"));
    } catch {
      blocker ??= "diagnostic-export-unavailable";
    }
    await microphone.dispose().catch(() => {});
    const sourceFiles = [
      "lib/experiments/grok-counting/proposals.ts",
      "lib/experiments/grok-counting/transport.ts",
      "lib/experiments/grok-counting/jev-acknowledgment.ts",
      "lib/experiments/grok-counting/acknowledgment.ts",
      "lib/experiments/grok-counting/expected-answer.ts",
      "tests/experiments/grok-counting/live-walkthrough.ts",
    ];
    const hashes = Object.fromEntries(
      await Promise.all(
        sourceFiles.map(async file => [
          file,
          createHash("sha256")
            .update(await readFile(file))
            .digest("hex"),
        ]),
      ),
    );
    const report = {
      version: 1,
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceParent: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceSHA256: hashes,
      status: outcome,
      blocker,
      blockedStage: outcome === "completed" ? null : stage,
      providerSessions: wire.some(entry => entry.type === "session.created") ? 1 : 0,
      generatedResponses,
      jevHttpRequests:
        sessionExport?.decisionTimeline?.filter(entry => entry.type === "classification.requested").length ?? 0,
      learnerAttempts: played.length,
      paidRetries: 0,
      requestedResponses,
      fixtures: fixtures.map(fixture => ({ ...fixture, executed: played.includes(fixture.name) })),
      timingDefinitions: {
        timeline: "Application timeline milliseconds since adapter creation; deltas use this clock only.",
        wire: "Local Node receipt milliseconds since harness start; separate clock, includes callback scheduling.",
        classification: "HTTP classification round trip, including local endpoint and Jev time.",
        audio:
          "First scheduled PCM and natural local Web Audio drain; not measured physical/audible latency. No human listened.",
        render: "Exact React render confirmation event, not screenshot/physical display latency.",
      },
      scenes: summarizeGrokWalkthrough(sessionExport?.decisionTimeline ?? []),
      wireEvents: wire,
      sessionExport,
      usageAndBilling: null,
      limitations:
        "One synthetic adult voice fixture attempt per reached scene, one session, no paid retries. No route mocks, transcript/tool injection, classifier overrides or reducer transitions. Automatic application recovery, if present, is included in this one session. Unreached scenes are not evaluated.",
    };
    await mkdir(dirname(process.env.GROK_BENCHMARK_OUT!), { recursive: true });
    await writeFile(process.env.GROK_BENCHMARK_OUT!, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  }
  expect(outcome, `Recorded blocker: ${blocker ?? sessionExport?.error ?? stage}`).toBe("completed");
});
