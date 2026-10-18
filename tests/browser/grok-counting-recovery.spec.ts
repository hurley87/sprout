import { expect, test } from "@playwright/test";

for (const outcome of ["recognized", "abstain", "missing audio", "budget consumed"] as const) {
  test(`accepted answer recovery with real audio drain: ${outcome}`, async ({ page }) => {
    const sent: { type: string; response?: { instructions?: string } }[] = [];
    let emit!: (event: object) => void;
    let token = "";
    await page.route("**/api/experiments/grok-counting", route =>
      route.fulfill({ json: { value: "offline", expires_at: Date.now() / 1000 + 60 } }),
    );
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
    await page.goto("/experiments/grok-counting");
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
    const speak = (id: string, transcript: string, audio = true) => {
      emit({ type: "response.output_audio_transcript.done", response_id: id, item_id: `audio-${id}`, transcript });
      if (audio)
        emit({
          type: "response.output_audio.delta",
          response_id: id,
          item_id: `audio-${id}`,
          delta: Buffer.alloc(4800).toString("base64"),
        });
      emit({ type: "response.done", response: { id, status: "completed" } });
    };
    let response = "answer";
    if (outcome === "budget consumed") {
      emit({ type: "response.done", response: { id: response, status: "completed" } });
      await expect.poll(() => sent.filter(e => e.type === "response.create").length).toBe(2);
      response = "ack";
      emit({ type: "response.created", response: { id: response } });
    }
    speak(response, "One duck. That's right!");
    await expect(page.getByLabel("Tool proposal")).toContainText("Learner answer recorded: yes");
    await expect(page.getByRole("status")).toContainText("Audio: idle");
    await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
    if (outcome !== "budget consumed") {
      await expect.poll(() => sent.filter(e => e.type === "response.create").length).toBe(2);
      expect(sent.filter(e => e.type === "response.create").at(-1)?.response?.instructions).toContain(
        "Do not ask the learner to repeat",
      );
      emit({ type: "response.created", response: { id: "recovery" } });
      speak(
        "recovery",
        outcome === "abstain" ? "One duck. That's right!" : "Yes, one duck.",
        outcome !== "missing audio",
      );
    }
    if (outcome === "recognized") {
      await expect(page.locator('[data-node-id="count-2-ducks"]')).toBeVisible();
    } else {
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        outcome === "missing audio"
          ? "Tutor confirmation audio could not be verified"
          : "Tutor confirmation could not be verified",
      );
      await expect(page.getByLabel("Tool proposal")).toContainText("Learner answer recorded: yes");
      await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
      await expect(page.getByText("No usable counting report", { exact: false })).toHaveCount(0);
      expect(sent.filter(e => e.type === "response.create")).toHaveLength(2);
    }
    if (outcome === "recognized") await page.getByRole("button", { name: "Stop", exact: true }).click();
    else await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  });
}
