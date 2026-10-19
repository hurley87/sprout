import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function download(page: Page) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
  return JSON.parse(await readFile((await (await event).path())!, "utf8"));
}
for (const mode of ["grok-only", "grok-jev"] as const) {
  test(`all three scenes use real feedback drain, including Two ducks with low-confidence Jev: ${mode}`, async ({
    page,
  }) => {
    let emit!: (event: object) => void;
    let token = "";
    const requests: { nodeId: string }[] = [];
    await page.route("**/api/experiments/grok-counting", route =>
      route.fulfill({ json: { value: "offline", expires_at: Date.now() / 1000 + 60 } }),
    );
    await page.route("**/api/experiments/grok-counting/acknowledgment", route => {
      const body = route.request().postDataJSON();
      requests.push(body);
      return route.fulfill({
        json: {
          requestId: body.requestId,
          outcome: body.nodeId === "count-1-duck" ? "acknowledging" : "abstain",
          reason: body.nodeId === "count-1-duck" ? "confirmed" : "low-confidence",
          modelValidated: true,
        },
      });
    });
    await page.routeWebSocket("wss://api.x.ai/**", socket => {
      emit = event => socket.send(JSON.stringify(event));
      socket.onMessage(message => {
        const event = JSON.parse(String(message));
        if (event.type === "session.update") {
          token = JSON.parse(event.session.instructions.match(/(\{"context_token".*?\})/)[1]).context_token;
          emit({ type: "session.updated", session: event.session });
        }
      });
      emit({ type: "session.created" });
    });
    await page.goto(`/experiments/grok-counting?mode=${mode}`);
    await expect(page.getByText(`Active mode: ${mode}`, { exact: true })).toBeVisible();
    if (mode === "grok-jev")
      await expect(
        page.getByText("Grok progression with Jev acknowledgment diagnostics.", { exact: false }),
      ).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    for (const [index, node, learner, tutor, next] of [
      [1, "count-1-duck", "One", "One duck. You got it!", "count-2-ducks"],
      [2, "count-2-ducks", "Two", "Two ducks.", "count-3-butterflies"],
      [3, "count-3-butterflies", "Three", "Great counting!", null],
    ] as const) {
      await expect(page.getByRole("status")).toContainText("listening");
      emit({ type: "input_audio_buffer.speech_started", item_id: `u${index}` });
      emit({ type: "input_audio_buffer.speech_stopped", item_id: `u${index}` });
      emit({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: `u${index}`,
        transcript: learner,
      });
      emit({ type: "response.created", response: { id: `r${index}` } });
      emit({
        type: "response.function_call_arguments.done",
        call_id: `c${index}`,
        response_id: `r${index}`,
        name: "report_counting_answer",
        arguments: JSON.stringify({
          context_token: token,
          answer_outcome: "correct",
          support_state: "none",
          supporting_text: learner,
        }),
      });
      const final = {
        type: "response.output_audio_transcript.done",
        response_id: `r${index}`,
        item_id: `t${index}`,
        transcript: tutor,
      };
      emit(final);
      emit(final);
      emit({
        type: "response.output_audio.delta",
        response_id: `r${index}`,
        item_id: `t${index}`,
        delta: Buffer.alloc(48000).toString("base64"),
      });
      emit({ type: "response.done", response: { id: `r${index}`, status: "completed" } });
      await expect(page.getByRole("status")).toContainText("Audio: playing");
      await expect(page.locator(`[data-node-id="${node}"]`)).toBeVisible();
      if (next) await expect(page.locator(`[data-node-id="${next}"]`)).toBeVisible();
      else await expect(page.getByRole("status")).toContainText("complete");
    }
    const report = await download(page);
    expect(report).toMatchObject({
      acknowledgmentMode: mode,
      progressionPolicy: "validated-answer-feedback",
      jevRole: "diagnostic-only",
      complete: true,
    });
    const timeline = report.decisionTimeline as {
      type: string;
      reason: string;
      state: { acknowledgmentObserved: boolean };
    }[];
    for (const type of ["learner.answer.accepted", "tutor.feedback.completed", "render.confirmed"])
      expect(timeline.filter(e => e.type === type)).toHaveLength(3);
    expect(timeline.some(e => e.type === "classification.applied" || e.state.acknowledgmentObserved)).toBe(false);
    expect(timeline.some(e => e.type.startsWith("recovery."))).toBe(false);
    expect(requests).toHaveLength(mode === "grok-jev" ? 3 : 0);
    if (mode === "grok-jev")
      expect(timeline).toContainEqual(
        expect.objectContaining({ type: "classification.completed", reason: "low-confidence" }),
      );
    expect(JSON.stringify(timeline)).not.toMatch(/One duck|Two ducks|context_token|requestId|offline/);
  });
}
for (const outcome of ["timeout", "provider-error", "late"] as const) {
  test(`Jev diagnostics never block feedback progression: ${outcome}`, async ({ page }) => {
    let emit!: (event: object) => void;
    let token = "";
    let release!: () => Promise<void>;
    let requests = 0;
    await page.route("**/api/experiments/grok-counting", route =>
      route.fulfill({ json: { value: "offline", expires_at: Date.now() / 1000 + 60 } }),
    );
    await page.route("**/api/experiments/grok-counting/acknowledgment", async route => {
      const body = route.request().postDataJSON();
      requests++;
      release = async () => {
        await route
          .fulfill({
            json: { requestId: body.requestId, outcome: "acknowledging", reason: "confirmed", modelValidated: true },
          })
          .catch(() => {});
      };
      if (outcome === "provider-error") await route.fulfill({ status: 503, json: { error: "unavailable" } });
      if (outcome === "timeout")
        await route.fulfill({
          json: { requestId: body.requestId, outcome: "abstain", reason: "timeout", modelValidated: false },
        });
    });
    await page.routeWebSocket("wss://api.x.ai/**", socket => {
      emit = event => socket.send(JSON.stringify(event));
      socket.onMessage(message => {
        const event = JSON.parse(String(message));
        if (event.type === "session.update") {
          token = JSON.parse(event.session.instructions.match(/(\{"context_token".*?\})/)[1]).context_token;
          emit({ type: "session.updated", session: event.session });
        }
      });
      emit({ type: "session.created" });
    });
    await page.goto("/experiments/grok-counting?mode=grok-jev");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("listening");
    emit({ type: "input_audio_buffer.speech_started", item_id: "u" });
    emit({ type: "input_audio_buffer.speech_stopped", item_id: "u" });
    emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u", transcript: "One" });
    emit({ type: "response.created", response: { id: "r" } });
    emit({
      type: "response.function_call_arguments.done",
      call_id: "c",
      response_id: "r",
      name: "report_counting_answer",
      arguments: JSON.stringify({
        context_token: token,
        answer_outcome: "correct",
        support_state: "none",
        supporting_text: "One",
      }),
    });
    emit({
      type: "response.output_audio_transcript.done",
      response_id: "r",
      item_id: "t",
      transcript: "One duck. You got it!",
    });
    await expect.poll(() => requests).toBe(1);
    emit({
      type: "response.output_audio.delta",
      response_id: "r",
      item_id: "t",
      delta: Buffer.alloc(48000).toString("base64"),
    });
    emit({ type: "response.done", response: { id: "r", status: "completed" } });
    await expect(page.locator('[data-node-id="count-2-ducks"]')).toBeVisible();
    if (outcome === "late") await release();
    await expect(page.locator('[data-node-id="count-2-ducks"]')).toBeVisible();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const report = await download(page);
    expect(report.decisionTimeline.filter((e: { type: string }) => e.type === "render.confirmed")).toHaveLength(1);
    expect(report.decisionTimeline.some((e: { type: string }) => e.type.startsWith("recovery."))).toBe(false);
    if (outcome === "timeout")
      expect(report.decisionTimeline).toContainEqual(
        expect.objectContaining({ type: "classification.completed", reason: "timeout" }),
      );
    if (outcome === "late")
      expect(report.decisionTimeline).toContainEqual(
        expect.objectContaining({ type: "classification.cancelled", reason: "scene-transition" }),
      );
  });
}
