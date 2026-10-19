import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const scenario of [
  "before drain",
  "after drain",
  "missing audio",
  "stop",
  "corrected",
  "changed tutor",
  "timeout",
  "abstain",
] as const) {
  test(`Jev acknowledgment: ${scenario}`, async ({ page }) => {
    let emit!: (event: object) => void;
    let token = "";
    const sent: { type: string; response?: { instructions?: string } }[] = [];
    const requests: { body: { requestId: string }; fulfill: (positive?: boolean) => Promise<void> }[] = [];
    await page.route("**/api/experiments/grok-counting", route =>
      route.fulfill({ json: { value: "offline", expires_at: Date.now() / 1000 + 60 } }),
    );
    await page.route("**/api/experiments/grok-counting/acknowledgment", async route => {
      const body = route.request().postDataJSON();
      requests.push({
        body,
        fulfill: async (positive = true) => {
          await route
            .fulfill({
              json: {
                requestId: body.requestId,
                outcome: positive ? "acknowledging" : "abstain",
                reason: positive ? "confirmed" : "low-confidence",
                modelValidated: true,
              },
            })
            .catch(() => {});
        },
      });
    });
    await page.routeWebSocket("wss://api.x.ai/**", socket => {
      emit = event => socket.send(JSON.stringify(event));
      socket.onMessage(message => {
        const event = JSON.parse(String(message));
        sent.push(event);
        if (event.type === "session.update") {
          token = JSON.parse(event.session.instructions.match(/(\{"context_token".*?\})/)[1]).context_token;
          emit({ type: "session.updated", session: event.session });
        }
      });
      emit({ type: "session.created" });
    });
    if (scenario === "timeout" || scenario === "abstain") await page.clock.install();
    await page.goto("/experiments/grok-counting?mode=grok-jev");
    await expect(page.getByText("Active acknowledgment mode: grok-jev")).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("listening");
    emit({ type: "input_audio_buffer.speech_started", item_id: "learner" });
    emit({ type: "input_audio_buffer.speech_stopped", item_id: "learner" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "learner",
      transcript: "One duck.",
    });
    emit({ type: "response.created", response: { id: "answer" } });
    emit({
      type: "response.function_call_arguments.done",
      response_id: "answer",
      call_id: "call",
      name: "report_counting_answer",
      arguments: JSON.stringify({
        context_token: token,
        answer_outcome: "correct",
        support_state: "none",
        supporting_text: "One duck.",
      }),
    });
    const final = (text = "One duck. That's right!") =>
      emit({
        type: "response.output_audio_transcript.done",
        response_id: "answer",
        item_id: "tutor",
        transcript: text,
      });
    final();
    final();
    await expect.poll(() => requests.length).toBe(1);
    if (scenario !== "missing audio")
      emit({
        type: "response.output_audio.delta",
        response_id: "answer",
        item_id: "tutor",
        delta: Buffer.alloc(scenario === "before drain" ? 96000 : 4800).toString("base64"),
      });
    emit({ type: "response.done", response: { id: "answer", status: "completed" } });
    await expect(page.getByLabel("Tool proposal")).toContainText("Learner answer recorded: yes");
    if (scenario === "before drain") {
      await requests[0].fulfill();
      await expect(page.getByRole("status")).toContainText("Audio: playing");
      await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
    } else {
      await expect(page.getByRole("status")).toContainText("Audio: idle");
      await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
      if (scenario === "stop") await page.getByRole("button", { name: "Stop", exact: true }).click();
      if (scenario === "corrected")
        emit({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "learner",
          transcript: "Two ducks.",
        });
      if (scenario === "changed tutor") {
        final("Exactly! There is one duck.");
        await expect.poll(() => requests.length).toBe(2);
        await requests[0].fulfill();
        await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
        await requests[1].fulfill();
      } else if (scenario === "timeout") {
        await page.clock.fastForward(5000);
      } else await requests[0].fulfill(scenario !== "abstain");
    }
    if (["before drain", "after drain", "changed tutor"].includes(scenario)) {
      await expect(page.locator('[data-node-id="count-2-ducks"]')).toBeVisible();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
    } else if (scenario === "timeout" || scenario === "abstain") {
      // The pending request did not consume recovery; failure uses the same single continuation.
      await page.clock.fastForward(3000);
      await expect.poll(() => sent.filter(e => e.type === "response.create").length).toBe(2);
      expect(sent.filter(e => e.type === "response.create").at(-1)?.response?.instructions).toContain(
        "Do not ask the learner to repeat",
      );
      await page.getByRole("button", { name: "Stop", exact: true }).click();
    } else {
      await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
      if (scenario !== "stop") await page.getByRole("button", { name: "Stop", exact: true }).click();
    }
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, "utf8"));
    expect(report.acknowledgmentMode).toBe("grok-jev");
    expect(report.classifierModel).toBe("jev-1.14.0");
    expect(report.decisionTimeline).toContainEqual(expect.objectContaining({ type: "classification.requested" }));
    expect(JSON.stringify(report.decisionTimeline)).not.toMatch(
      /One duck|That's right|context_token|requestId|offline/,
    );
    if (scenario === "missing audio")
      expect(report.decisionTimeline.some((entry: { type: string }) => entry.type === "render.requested")).toBe(false);
    if (scenario === "timeout")
      expect(report.decisionTimeline).toContainEqual(
        expect.objectContaining({ type: "classification.completed", reason: "timeout" }),
      );
  });
}
