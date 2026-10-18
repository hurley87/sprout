import { expect, test } from "@playwright/test";

test("provider-free voice scene, captions, interruption, Stop/restart and page exit", async ({ page }) => {
  let connections = 0;
  let closed = 0;
  const sent: { type: string; [key: string]: unknown }[] = [];
  await page.route("**/api/experiments/grok-counting", route =>
    route.fulfill({ json: { value: "offline-test", expires_at: Date.now() / 1000 + 60 } }),
  );
  await page.routeWebSocket("wss://api.x.ai/**", socket => {
    connections++;
    socket.onClose(() => closed++);
    socket.onMessage(message => {
      const event = JSON.parse(String(message));
      sent.push(event);
      if (event.type === "session.update")
        socket.send(
          JSON.stringify({ type: "session.updated", session: { ...event.session, model: "offline-fixture" } }),
        );
      if (event.type === "response.create") {
        for (const fixture of [
          { type: "response.created", response: { id: "r1" } },
          { type: "conversation.item.input_audio_transcription.updated", item_id: "u1", transcript: "won" },
          { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "One duck." },
          { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Yes, one duck." },
          {
            type: "response.output_audio.delta",
            item_id: "a1",
            response_id: "r1",
            delta: Buffer.alloc(24000 * 2 * 4).toString("base64"),
          },
          { type: "response.output_audio.done" },
          { type: "response.done" },
        ])
          socket.send(JSON.stringify(fixture));
        // Barge-in is a fixture; this is not evidence of real model behavior.
        setTimeout(() => socket.send(JSON.stringify({ type: "input_audio_buffer.speech_started" })), 200);
      }
    });
    socket.send(JSON.stringify({ type: "session.created", session: { instructions: "" } }));
  });
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { grokTestTracks: tracks });
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto("/experiments/grok-counting");
  await expect(page.getByRole("img", { name: "1 duck to count" })).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("listening");
  await expect(page.getByText("Learner:")).toBeVisible();
  await expect(page.getByText("One duck.", { exact: false }).first()).toBeVisible();
  await expect.poll(() => sent.some(e => e.type === "input_audio_buffer.append")).toBe(true);
  await expect.poll(() => sent.some(e => e.type === "conversation.item.truncate")).toBe(true);
  await expect(page.getByRole("status")).toContainText("Audio: idle");
  await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("stopped");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect.poll(() => closed).toBe(1);
  expect(
    await page.evaluate(() =>
      (window as unknown as { grokTestTracks: MediaStreamTrack[] }).grokTestTracks.every(t => t.readyState === "ended"),
    ),
  ).toBe(true);
  const count = sent.length;
  await page.waitForTimeout(150);
  expect(sent).toHaveLength(count);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => connections).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(() => closed).toBe(2);
  await expect(page.getByRole("status")).toContainText("stopped");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("shows authorization errors and permits a new attempt", async ({ page }) => {
  await page.route("**/api/experiments/grok-counting", route =>
    route.fulfill({ status: 503, json: { error: "Configure the test voice key." } }),
  );
  await page.goto("/experiments/grok-counting");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Configure the test voice key.");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});

test("waits for matching configuration and reports unexpected microphone termination", async ({ page }) => {
  const sent: { type: string }[] = [];
  let acknowledge: (() => void) | undefined;
  let closed = false;
  await page.route("**/api/experiments/grok-counting", route =>
    route.fulfill({ json: { value: "offline-test", expires_at: Date.now() / 1000 + 60 } }),
  );
  await page.routeWebSocket("wss://api.x.ai/**", socket => {
    socket.onClose(() => {
      closed = true;
    });
    socket.onMessage(message => {
      const event = JSON.parse(String(message));
      sent.push(event);
      if (event.type === "session.update") {
        socket.send(
          JSON.stringify({ type: "session.updated", session: { ...event.session, instructions: "default" } }),
        );
        acknowledge = () => {
          socket.send(JSON.stringify({ type: "session.updated", session: event.session }));
          socket.send(JSON.stringify({ type: "session.updated", session: event.session }));
          socket.send(JSON.stringify({ type: "session.created" }));
        };
      }
    });
    socket.send(JSON.stringify({ type: "session.updated", session: { instructions: "default" } }));
    socket.send(JSON.stringify({ type: "session.created" }));
  });
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      Object.assign(window, { grokTestTracks: stream.getTracks() });
      return stream;
    };
  });
  await page.goto("/experiments/grok-counting");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => Boolean(acknowledge)).toBe(true);
  await expect(page.getByRole("status")).toContainText("connecting");
  await page.waitForTimeout(150); // Allow multiple microphone worklet batches while acknowledgment is pending.
  expect(sent.map(event => event.type)).toEqual(["session.update"]);
  acknowledge!();
  await expect(page.getByRole("status")).toContainText("listening");
  await expect.poll(() => sent.some(event => event.type === "input_audio_buffer.append")).toBe(true);
  expect(sent.filter(event => event.type === "response.create")).toHaveLength(1);
  expect(sent.filter(event => event.type === "conversation.item.create")).toHaveLength(1);
  expect(sent.filter(event => event.type === "session.update")).toHaveLength(1);
  // Simulate the browser's device-loss event; this is not a physical unplug/permission test.
  await page.evaluate(() => {
    const tracks = (window as unknown as { grokTestTracks: MediaStreamTrack[] }).grokTestTracks;
    tracks[0].stop();
    tracks[0].dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("microphone disconnected");
  await expect(page.getByRole("status")).toContainText("error");
  await expect.poll(() => closed).toBe(true);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});

test("wire tool proposal reaches the reducer adapter without secondary requests or scene progression", async ({
  page,
}) => {
  const requests: string[] = [];
  const sent: { type: string; item?: { type?: string; role?: string; output?: string } }[] = [];
  let emit: ((event: object) => void) | undefined;
  let token: string | undefined;
  page.on("request", request => {
    if (request.method() === "POST") requests.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/experiments/grok-counting", route =>
    route.fulfill({ json: { value: "offline-test", expires_at: Date.now() / 1000 + 60 } }),
  );
  await page.routeWebSocket("wss://api.x.ai/**", socket => {
    emit = event => socket.send(JSON.stringify(event));
    socket.onMessage(message => {
      const e = JSON.parse(String(message));
      sent.push(e);
      if (e.type === "session.update") {
        token = JSON.parse(e.session.instructions.match(/(\{"context_token".*?\})/)[1]).context_token;
        emit!({ type: "session.updated", session: e.session });
      }
    });
    emit({ type: "session.created" });
  });
  await page.goto("/experiments/grok-counting");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("listening");
  for (const event of [
    { type: "input_audio_buffer.speech_started", item_id: "u1" },
    { type: "input_audio_buffer.speech_stopped", item_id: "u1" },
    { type: "response.created", response: { id: "r1" } },
    { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "One duck." },
  ])
    emit!(event);
  await expect.poll(() => Boolean(token)).toBe(true);
  await expect(page.getByLabel("Tool proposal")).toContainText("Revision-bound answer: no");
  const call = {
    type: "response.function_call_arguments.done",
    response_id: "r1",
    call_id: "c1",
    name: "report_counting_answer",
    arguments: JSON.stringify({
      context_token: token,
      answer_outcome: "correct",
      support_state: "none",
      supporting_text: "One duck.",
    }),
  };
  emit!(call);
  await expect(page.getByLabel("Tool proposal")).toContainText("Validated: correct");
  await expect(page.getByLabel("Tool proposal")).toContainText("Revision-bound answer: no");
  emit!(call);
  emit!({ type: "response.done", response: { id: "r1", status: "completed" } });
  await expect.poll(() => sent.filter(e => e.type === "response.create").length).toBe(2);
  await expect(page.getByLabel("Tool proposal")).toContainText("Revision-bound answer: yes");
  expect(sent.filter(e => e.item?.type === "function_call_output")).toHaveLength(1);
  emit!({ type: "response.created", response: { id: "continuation" } });
  emit!({ type: "response.output_audio_transcript.delta", response_id: "continuation", item_id: "a2", delta: "Yes, " });
  emit!({
    type: "response.output_audio_transcript.done",
    response_id: "continuation",
    item_id: "a2",
    transcript: "Yes, one duck.",
  });
  await expect(page.getByLabel("Tool proposal")).toContainText("Learner answer recorded: yes");
  await expect(page.getByLabel("Tool proposal")).toContainText("Revision-bound answer: no");
  emit!({ type: "input_audio_buffer.speech_started", item_id: "u2" });
  await expect(page.getByLabel("Tool proposal")).toContainText("Learner answer recorded: no");
  expect(requests).toEqual(["/api/experiments/grok-counting"]);
  await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("rejected tool-only response recovers once with speech and no accepted evidence", async ({ page }) => {
  const sent: { type: string }[] = [];
  let emit!: (e: object) => void;
  let token = "";
  await page.route("**/api/experiments/grok-counting", route =>
    route.fulfill({ json: { value: "offline", expires_at: Date.now() / 1000 + 60 } }),
  );
  await page.routeWebSocket("wss://api.x.ai/**", socket => {
    emit = e => socket.send(JSON.stringify(e));
    socket.onMessage(message => {
      const e = JSON.parse(String(message));
      sent.push(e);
      if (e.type === "session.update") {
        token = JSON.parse(e.session.instructions.match(/(\{"context_token".*?\})/)[1]).context_token;
        emit({ type: "session.updated", session: e.session });
      }
    });
    emit({ type: "session.created" });
  });
  await page.goto("/experiments/grok-counting");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("listening");
  for (const e of [
    { type: "input_audio_buffer.speech_started", item_id: "u" },
    { type: "input_audio_buffer.speech_stopped", item_id: "u" },
    { type: "response.created", response: { id: "r" } },
    { type: "conversation.item.input_audio_transcription.completed", item_id: "u", transcript: "Two ducks." },
  ])
    emit(e);
  const call = {
    type: "response.function_call_arguments.done",
    response_id: "r",
    call_id: "bad",
    name: "report_counting_answer",
    arguments: JSON.stringify({
      context_token: token,
      answer_outcome: "correct",
      support_state: "none",
      supporting_text: "One duck.",
    }),
  };
  emit(call);
  emit(call);
  emit({ type: "response.done", response: { id: "r", status: "completed" } });
  await expect.poll(() => sent.filter(e => e.type === "response.create").length).toBe(2);
  emit({ type: "response.created", response: { id: "recovery" } });
  emit({
    type: "response.output_audio_transcript.done",
    response_id: "recovery",
    item_id: "a",
    transcript: "Can you try again?",
  });
  emit({
    type: "response.output_audio.delta",
    response_id: "recovery",
    item_id: "a",
    delta: Buffer.alloc(4800).toString("base64"),
  });
  emit({ type: "response.done", response: { id: "recovery", status: "completed" } });
  await expect(page.getByText("Can you try again?", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Tool proposal")).toContainText("Learner answer recorded: no");
  expect(sent.filter(e => e.type === "response.create")).toHaveLength(2);
  await expect(page.locator('[data-node-id="count-1-duck"]')).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("three authored scenes wait for real Web Audio drain, React render and matching new context before each question", async ({
  page,
}) => {
  const posts: string[] = [];
  const sent: { type: string; session?: { instructions: string }; item?: { type?: string } }[] = [];
  let emit!: (event: object) => void;
  let acknowledge!: () => void;
  let closed = false;
  page.on("request", request => {
    if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/experiments/grok-counting", route =>
    route.fulfill({ json: { value: "offline", expires_at: Date.now() / 1000 + 60 } }),
  );
  await page.routeWebSocket("wss://api.x.ai/**", socket => {
    emit = event => socket.send(JSON.stringify(event));
    socket.onClose(() => {
      closed = true;
    });
    socket.onMessage(message => {
      const event = JSON.parse(String(message));
      sent.push(event);
      if (event.type === "session.update") {
        acknowledge = () =>
          emit({
            type: "session.updated",
            session: {
              ...event.session,
              tools: event.session.tools.map(
                (tool: { type: string; name: string; description: string; parameters: unknown }) => {
                  const { type, ...definition } = tool;
                  return { type, function: definition };
                },
              ),
            },
          });
        if (sent.filter(e => e.type === "session.update").length === 1) acknowledge();
      }
    });
    emit({ type: "session.created" });
  });
  await page.goto("/experiments/grok-counting");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("listening");
  for (const [i, text, current, next] of [
    [1, "One duck.", "count-1-duck", "count-2-ducks"],
    [2, "Two ducks.", "count-2-ducks", "count-3-butterflies"],
    [3, "Three butterflies.", "count-3-butterflies", null],
  ] as const) {
    const config = sent.filter(e => e.type === "session.update").at(-1)!;
    const token = JSON.parse(config.session!.instructions.match(/(\{"context_token".*?\})/)![1]).context_token;
    emit({ type: "input_audio_buffer.speech_started", item_id: `u${i}` });
    emit({ type: "input_audio_buffer.speech_stopped", item_id: `u${i}` });
    emit({ type: "conversation.item.input_audio_transcription.completed", item_id: `u${i}`, transcript: text });
    emit({ type: "response.created", response: { id: `r${i}` } });
    const call = {
      type: "response.function_call_arguments.done",
      name: "report_counting_answer",
      response_id: `r${i}`,
      call_id: `c${i}`,
      arguments: JSON.stringify({
        context_token: token,
        supporting_text: text,
        answer_outcome: "correct",
        support_state: "none",
      }),
    };
    if (i === 2) emit(call);
    emit({
      type: "response.output_audio_transcript.done",
      response_id: `r${i}`,
      item_id: `a${i}`,
      transcript: `Yes, ${text.toLowerCase()}`,
    });
    emit({
      type: "response.output_audio.delta",
      response_id: `r${i}`,
      item_id: `a${i}`,
      delta: Buffer.alloc(48000).toString("base64"),
    });
    if (i !== 2) emit(call);
    emit(call);
    emit({ type: "response.done", response: { id: `r${i}`, status: "completed" } });
    await expect(page.getByRole("status")).toContainText("playing");
    await expect(page.locator(`[data-node-id="${current}"]`)).toBeVisible();
    expect(sent.filter(e => e.type === "session.update")).toHaveLength(i);
    const questions = sent.filter(e => e.type === "response.create").length;
    if (next) {
      await expect(page.locator(`[data-node-id="${next}"]`)).toBeVisible();
      await expect.poll(() => sent.filter(e => e.type === "session.update").length).toBe(i + 1);
      await expect(page.getByRole("status")).toContainText("connecting");
      expect(sent.filter(e => e.type === "response.create")).toHaveLength(questions);
      emit({ type: "session.updated", session: config.session }); // Obsolete echo cannot ask.
      await page.waitForTimeout(50);
      expect(sent.filter(e => e.type === "response.create")).toHaveLength(questions);
      acknowledge();
      acknowledge();
      await expect.poll(() => sent.filter(e => e.type === "response.create").length).toBe(questions + 1);
      await expect(page.getByRole("status")).toContainText("listening");
      emit(call); // Previous visit cannot establish a new observation.
      emit({
        type: "response.output_audio_transcript.done",
        response_id: `r${i}`,
        item_id: `old${i}`,
        transcript: "Stale question?",
      });
      await expect(page.getByText("Stale question?", { exact: false })).toHaveCount(0);
    } else {
      await expect(page.locator('[data-complete="true"]')).toContainText("Lesson complete");
      await expect(page.getByRole("status")).toContainText("complete · Audio: idle");
      await expect.poll(() => closed).toBe(true);
      expect(sent.filter(e => e.type === "response.create")).toHaveLength(questions);
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
    }
  }
  expect(posts).toEqual(["/api/experiments/grok-counting"]);
  expect(sent.filter(e => e.item?.type === "function_call_output")).toHaveLength(3); // duplicate and consumed stale IDs never get a second result
});
