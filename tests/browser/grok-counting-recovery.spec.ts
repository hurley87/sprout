import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
    const report = JSON.parse(await readFile((await (await downloadEvent).path())!, "utf8"));
    expect(report.version).toBe(1);
    expect(report.transcripts).toContainEqual({ speaker: "Learner", text: "One duck.", final: true });
    const timeline = report.decisionTimeline as { type: string; reason: string; state: { learnerAccepted: boolean } }[];
    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "proposal.validated", reason: "correct" }),
        expect.objectContaining({
          type: "learner.answer.accepted",
          state: expect.objectContaining({ learnerAccepted: true }),
        }),
        expect.objectContaining({ type: "acknowledgment.evaluated", reason: "abstained" }),
        expect.objectContaining({ type: "audio.drained" }),
        expect.objectContaining({ type: "continuation.requested" }),
      ]),
    );
    if (outcome === "recognized") {
      expect(timeline.some(e => e.type === "transition.eligible")).toBe(true);
      expect(timeline.some(e => e.type === "render.confirmed")).toBe(true);
    } else {
      expect(timeline.some(e => e.type === "render.requested")).toBe(false);
      expect(timeline).toContainEqual(
        expect.objectContaining({
          type: "lesson.failed",
          reason: outcome === "missing audio" ? "missing-acknowledgment-audio" : "missing-acknowledgment",
        }),
      );
      expect(report.learnerAnswerAccepted).toBe(true);
    }
    expect(timeline.length).toBeLessThanOrEqual(256);
    expect(report.decisionTimelineDropped).toBe(0);
    expect(JSON.stringify(timeline)).not.toMatch(
      /One duck|That's right|context_token|supporting_text|audio-answer|audio-recovery|"call"/,
    );
  });
}

for (const fault of ["never starts", "never completes"]) {
  test(`exports a terminal continuation watchdog failure: ${fault}`, async ({ page }) => {
    let emit!: (event: object) => void;
    let token = "";
    let requests = 0;
    await page.route("**/api/experiments/grok-counting", route =>
      route.fulfill({ json: { value: "offline", expires_at: Date.now() / 1000 + 60 } }),
    );
    await page.routeWebSocket("wss://api.x.ai/**", socket => {
      emit = event => socket.send(JSON.stringify(event));
      socket.onMessage(message => {
        const event = JSON.parse(String(message));
        if (event.type === "response.create") requests++;
        if (event.type === "session.update") {
          token = JSON.parse(event.session.instructions.match(/(\{"context_token".*?\})/)[1]).context_token;
          emit({ type: "session.updated", session: event.session });
        }
      });
      emit({ type: "session.created" });
    });
    await page.clock.install();
    await page.goto("/experiments/grok-counting");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("listening");
    emit({ type: "input_audio_buffer.speech_started", item_id: "learner-private" });
    emit({ type: "input_audio_buffer.speech_stopped", item_id: "learner-private" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "learner-private",
      transcript: "One duck.",
    });
    emit({ type: "response.created", response: { id: "answer-private" } });
    emit({
      type: "response.function_call_arguments.done",
      response_id: "answer-private",
      call_id: "call-private",
      name: "report_counting_answer",
      arguments: JSON.stringify({
        context_token: token,
        supporting_text: "One duck.",
        answer_outcome: "correct",
        support_state: "none",
      }),
    });
    emit({ type: "response.done", response: { id: "answer-private", status: "completed" } });
    await expect.poll(() => requests).toBe(2);
    if (fault === "never completes") {
      emit({ type: "response.created", response: { id: "continuation-private" } });
      emit({
        type: "response.output_audio_transcript.done",
        response_id: "continuation-private",
        item_id: "tutor-private",
        transcript: "Yes, one duck.",
      });
      await expect(page.getByText("Yes, one duck.", { exact: false })).toBeVisible();
    }
    await page.clock.fastForward(fault === "never starts" ? 15000 : 60000);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      fault === "never starts" ? "did not start" : "did not complete",
    );
    await expect(page.getByLabel("Tool proposal")).toContainText("Learner answer recorded: yes");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
    const report = JSON.parse(await readFile((await (await downloadEvent).path())!, "utf8"));
    expect(report.decisionTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "learner.answer.accepted" }),
        expect.objectContaining({
          type: "continuation.timed-out",
          reason: fault === "never starts" ? "continuation-never-started" : "continuation-incomplete",
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toMatch(/-private|context_token|offline|supporting_text/);
    await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
    expect(requests).toBe(2);
  });
}
