import { expect, test } from "@playwright/test";
import { transcriptMessages, substantiveLearnerText } from "../../lib/lesson-runtime/tutor-observation";
import { readFile } from "node:fs/promises";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import { evidenceRecap } from "../../lib/lesson-runtime/evidence-recap";
import { CATCHING_UNICORNS_LESSON } from "../../lib/lesson-runtime/catching-unicorns-lesson";

import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(`(async () => {
    for (const source of window.peers ?? []) {
      source.peer.close(); source.tone.stop(); source.destination.stream.getTracks().forEach(track => track.stop());
    }
    if (window.peerContext && window.peerContext.state !== "closed") await window.peerContext.close();
    await window.syntheticMicrophone?.dispose();
  })()`);
});

test("default presentation has four steps, essential controls and no debug UI at narrow widths", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/live", route => {
    requests.push(route.request().url());
    return route.fulfill({ status: 502, json: { error: "Unexpected automatic session start" } });
  });
  await page.route("**/api/classify", route => {
    requests.push(route.request().url());
    return route.fulfill({ json: { proposal: null } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demos/catching-unicorns");
  await expect(page.getByRole("heading", { name: "Catching Unicorns", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is an engram?", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start discussion", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download diagnostics", exact: true })).toHaveCount(0);
  await expect(page.getByText("Explain it in your own words.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
  const progress = page.getByRole("progressbar", { name: "Discussion progress" });
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(progress).toHaveAttribute("aria-valuemax", "4");
  await expect(progress.locator(":scope > div")).toHaveCount(4);
  await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start discussion" })).toBeInViewport();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Start discussion" })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("initial-mobile.png") });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.getByRole("button", { name: "Start discussion" })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Conversation so far" })).not.toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("Biological memory: memory held within a biological mind.");
  expect(body).not.toContain("Non-biological memory: a representation kept outside biological memory.");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("only debug=1 enables the diagnostic view", async ({ page }) => {
  for (const suffix of ["?debug=0", "?debug=true", "?debug=1&debug=0"]) {
    await page.goto(`/demos/catching-unicorns${suffix}`);
    await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
  }
  await page.goto("/demos/catching-unicorns?debug=1");
  await page.getByText("Session details", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Conversation so far" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export session" })).toBeDisabled();
  await page.goto("/demos/catching-unicorns");
  await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
});

test("shared runtime starts, holds unresolved scenes, stops, restarts, and cleans up on navigation", async ({
  page,
}) => {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  await page.goto("/demos/catching-unicorns");
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect(page.getByRole("status")).toHaveText("live");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.awaitingSteering,
      ),
    )
    .toBe(false);
  await page.evaluate(() => {
    (window as unknown as { currentPeer: { level: GainNode } }).currentPeer.level.gain.value = 0;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.outputActivity,
      ),
    )
    .toBe("quiet");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const observation = (window as LessonObservationWindow).sproutLessonObservation?.read();
        if (!observation) return false;
        const state = observation.snapshot.runtime;
        if (!state || state.quietSinceMs === null) return false;
        return observation.nowMs - state.quietSinceMs >= state.quietDrainMs;
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-scene="engram"]')).toBeVisible();

  const firstRuntimeId = await page.evaluate(
    () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.cursor.runtimeId,
  );
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("status")).toHaveText("ended");
  const retained = await page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation?.report());
  expect(retained?.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "lesson.ended" })]));
  await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download diagnostics", exact: true })).toBeEnabled();
  // The harness keeps its silent source track alive; the session's cloned capture tracks must end.
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
    .toBe(1);

  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect(page.getByRole("status")).toHaveText("live");
  const secondRuntimeId = await page.evaluate(
    () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.cursor.runtimeId,
  );
  expect(secondRuntimeId).not.toBe(firstRuntimeId);
  await expect(page.getByRole("button", { name: "Download diagnostics", exact: true })).toHaveCount(0);
  const closesBeforePagehide = await page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(page.getByRole("status")).toHaveText("ended");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount))
    .toBeGreaterThan(closesBeforePagehide);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sprout", exact: true })).toBeVisible();
});

// Hold only the app's frame callbacks; dispatchEvent avoids Playwright's actionability frames.
for (const field of ["renderToken", "nodeId", "sceneId"] as const) {
  test(`shared voice shell requires the exact rendered ${field} before opening media`, async ({ page }) => {
    const microphone = await installSyntheticMicrophone(page);
    await installLocalSession(page);
    await page.goto("/demos/catching-unicorns");
    // Wait for mount effects (including Strict Mode's cleanup/remount) before bypassing actionability.
    await expect
      .poll(() => page.evaluate(() => Boolean((window as LessonObservationWindow).sproutLessonObservation)))
      .toBe(true);
    await page.evaluate(() => {
      const host = window as typeof window & { flushVoiceFrame?: () => number; restoreVoiceFrames?: () => void };
      const request = window.requestAnimationFrame;
      const cancel = window.cancelAnimationFrame;
      let nextId = 0;
      const pending = new Map<number, FrameRequestCallback>();
      window.requestAnimationFrame = callback => {
        pending.set(++nextId, callback);
        return nextId;
      };
      window.cancelAnimationFrame = id => {
        pending.delete(id);
      };
      host.flushVoiceFrame = () => {
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach(callback => callback(performance.now()));
        return callbacks.length;
      };
      host.restoreVoiceFrames = () => {
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        pending.clear();
      };
    });
    await page.getByRole("button", { name: "Start discussion" }).dispatchEvent("click");
    await expect(page.getByRole("status")).toHaveText("prepared");
    const firstFrame = await page.evaluate(() =>
      (window as typeof window & { flushVoiceFrame: () => number }).flushVoiceFrame(),
    );
    expect(firstFrame).toBe(1);
    // The first frame cannot open media or confirm a render.
    expect((await microphone.state()).requests).toBe(0);
    const original = await page.locator("[data-render-token]").evaluate((element, field) => {
      const data = (element as HTMLElement).dataset;
      const original = data[field]!;
      data[field] = "stale-render";
      return original;
    }, field);
    const secondFrame = await page.evaluate(() =>
      (window as typeof window & { flushVoiceFrame: () => number }).flushVoiceFrame(),
    );
    expect(secondFrame).toBe(1);
    const held = await page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation?.read());
    expect(held?.snapshot.status).toBe("prepared");
    expect(held?.events.some(event => event.type === "render.confirmed")).toBe(false);
    expect((await microphone.state()).requests).toBe(0);

    // Restore the externally mutated DOM; unchanged node/scene props are not rewritten by React.
    await page.locator("[data-render-token]").evaluate(
      (element, { field, original }) => {
        (element as HTMLElement).dataset[field] = original;
      },
      { field, original },
    );
    await page.getByRole("button", { name: "Stop", exact: true }).dispatchEvent("click");
    await expect(page.getByRole("status")).toHaveText("ended");
    await page.evaluate(() => (window as typeof window & { restoreVoiceFrames: () => void }).restoreVoiceFrames());
    await page.getByRole("button", { name: "Start discussion" }).click();
    await expect(page.getByRole("status")).toHaveText("live");
    const confirmed = await page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation?.read());
    expect(confirmed?.events.some(event => event.type === "render.confirmed")).toBe(true);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
  });
}

test("shared voice shell releases media when the page becomes hidden", async ({ page }) => {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  await page.goto("/demos/catching-unicorns");
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect(page.getByRole("status")).toHaveText("live");
  const closes = await page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("status")).toHaveText("ended");
  const ended = await page.evaluate(() =>
    (window as LessonObservationWindow).sproutLessonObservation
      ?.report()
      ?.events.find(event => event.type === "lesson.ended"),
  );
  expect(ended?.detail).toMatchObject({ reason: "page_hidden" });
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
    .toBe(1);
  expect(await page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount)).toBeGreaterThan(
    closes,
  );
});

test("session startup failure ends and releases the microphone so a fresh attempt is possible", async ({ page }) => {
  const microphone = await installSyntheticMicrophone(page);
  await page.setViewportSize({ width: 320, height: 568 });
  let requests = 0;
  await page.route("**/api/live", route => {
    requests++;
    return route.fulfill({ status: 502, json: { error: "Local fixture connection failure" } });
  });
  await page.route("**/api/classify", route => route.fulfill({ json: { proposal: null } }));
  await page.goto("/demos/catching-unicorns");
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect(page.locator("span[role=alert]")).toContainText("Could not start GPT-Live");
  await expect(page.getByRole("status")).toHaveText("ended");
  await expect(page.getByRole("button", { name: "Start discussion" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start discussion" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Download diagnostics", exact: true })).toBeEnabled();
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
    .toBe(1);
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole("status")).toHaveText("ended");
});

for (const debug of [false, true]) {
  test(`Catching Unicorns commits four-question progress and retains recap (${debug ? "debug" : "default"})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const microphone = await installSyntheticMicrophone(page);
    await installLocalSession(page);

    let holdFirstResponse!: () => void;
    const firstResponseGate = new Promise<void>(resolve => (holdFirstResponse = resolve));
    let firstRequestSeen!: () => void;
    const firstRequest = new Promise<void>(resolve => (firstRequestSeen = resolve));
    let holdSecondResponse!: () => void;
    const secondResponseGate = new Promise<void>(resolve => (holdSecondResponse = resolve));
    let secondRequestSeen!: () => void;
    const secondRequest = new Promise<void>(resolve => (secondRequestSeen = resolve));
    let requestCount = 0;
    await page.route("**/api/classify", async route => {
      const body = route.request().postDataJSON() as { nodeId: string; transcriptRevision: number; transcript: string };
      const requestIndex = requestCount++;
      if (requestIndex === 0) {
        firstRequestSeen();
        await firstResponseGate;
      } else if (requestIndex === 1) {
        secondRequestSeen();
        await secondResponseGate;
      }
      const concepts = CATCHING_UNICORNS_LESSON.nodes[body.nodeId]?.concepts ?? [];
      const observations = concepts.map(({ id }) => {
        const observation =
          body.nodeId === "engram"
            ? "demonstrated_independent"
            : body.nodeId === "compare" &&
                ["exogram-shareability", "exogram-revisability"].includes(id) &&
                !body.transcript.includes("be shared, and be revised")
              ? "not_yet"
              : body.nodeId === "exogram" && id === "exogram-non-biological"
                ? "demonstrated_prompted"
                : body.nodeId === "exographics" && id === "visual-symbols"
                  ? "demonstrated_prompted"
                  : "demonstrated_independent";
        return {
          criterionId: id,
          observation,
          childMessageIndex: transcriptMessages(body.transcript)!.findLastIndex(
            message => message.speaker === "Child" && substantiveLearnerText(message.text),
          ),
        };
      });
      await route.fulfill({
        json: {
          proposal: {
            nodeId: body.nodeId,
            transcriptRevision: body.transcriptRevision,
            childActivity: "unknown",
            answerOutcome: "correct",
            supportState: "none",
            tutorState: transcriptMessages(body.transcript)
              ?.findLast(message => message.speaker === "Tutor")
              ?.text.includes("?")
              ? "clarifying"
              : "acknowledging",
            conceptObservations: observations,
          },
        },
      });
    });

    await page.goto(`/demos/catching-unicorns${debug ? "?debug=1" : ""}`);
    await microphone.loadSpeech("answer-three");
    await page.getByRole("button", { name: "Start discussion" }).click();
    await expect(page.getByRole("status")).toHaveText("live");
    await expect(
      page.getByText("Biological memory: memory held within a biological mind.", { exact: true }),
    ).toHaveCount(0);

    const sendWire = (type: "session.input_transcript.delta" | "session.output_transcript.delta", text: string) =>
      page.evaluate(({ type, text }) => (window as unknown as LocalSessionWindow).sendTranscript(type, text), {
        type,
        text,
      });
    const speakThenTutor = async (answer: string, response: string) => {
      const playback = await microphone.playSpeech("answer-three");
      await expect
        .poll(() => page.evaluate(() => (window as unknown as LocalSessionWindow).currentPeer.channel?.readyState))
        .toBe("open");
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.childSpeaking,
          ),
        )
        .toBe(true);
      await sendWire("session.input_transcript.delta", answer);
      await microphone.waitForPlayback(playback.id);
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.childSpeaking,
          ),
        )
        .toBe(false);
      await page.evaluate(() => {
        (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
      });
      await sendWire("session.output_transcript.delta", response);
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.outputActivity,
          ),
        )
        .toBe("active");
      await page.evaluate(() => {
        (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.outputActivity,
          ),
        )
        .toBe("quiet");
    };
    const expectEvidence = async (key: string, expected: { status: string; understanding: string | null }) => {
      await expect
        .poll(() =>
          page.evaluate(evidenceKey => {
            const observation = (window as LessonObservationWindow).sproutLessonObservation?.read();
            const evidence = observation?.snapshot.runtime?.conceptEvidence[evidenceKey];
            return evidence ? { status: evidence.status, understanding: evidence.understanding } : null;
          }, key),
        )
        .toEqual(expected);
    };
    const questionStyle = () =>
      page
        .locator("[data-scene] h2")
        .first()
        .evaluate(element => {
          const style = getComputedStyle(element);
          return {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            color: style.color,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
          };
        });
    const initialQuestionStyle = await questionStyle();
    const expectProgress = async (number: number) => {
      const progress = page.getByRole("progressbar");
      await expect(progress).toHaveAttribute("aria-valuenow", String(number - 1));
      await expect(progress).toHaveAttribute("aria-valuemax", "4");
      await expect(progress.locator(":scope > div")).toHaveCount(4);
      await expect(progress).toHaveAttribute("aria-valuetext", `Question ${number} of 4`);
      await expect(progress.locator('[data-state="completed"]')).toHaveCount(number - 1);
      await expect(progress.locator('[data-state="active"]')).toHaveCount(1);
      await expect(progress.locator('[data-state="upcoming"]')).toHaveCount(4 - number);
      await expect(page.getByText(`${number} of 4`, { exact: true })).toBeVisible();
    };
    await expectProgress(1);
    const waitForScene = async (sceneId: string) => {
      await expect(page.locator(`[data-scene="${sceneId}"]`)).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.awaitingSteering,
          ),
        )
        .toBe(false);
    };

    // Hold the child-only classifier response, then add a newer tutor revision.
    // The old response cannot reveal or advance; only fresh validation can.
    await speakThenTutor(
      "Memory exists in a biological mind, unlike an external note.",
      "Tell me a little more about where that memory exists.",
    );
    await firstRequest;
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).sendTranscript(
        "session.output_transcript.delta",
        "Yes, that explanation is sufficient.",
      );
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const observation = (window as LessonObservationWindow).sproutLessonObservation?.read();
          return observation?.events.some(
            event => event.type === "transcript.snapshot" && event.transcriptSpeaker === "tutor",
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const events = (window as LessonObservationWindow).sproutLessonObservation?.read()?.events ?? [];
          return events.some(
            event =>
              event.type === "classifier.cancelled" &&
              (event.detail as Record<string, unknown> | null)?.reason === "newer_transcript_snapshot",
          );
        }),
      )
      .toBe(true);
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.outputActivity,
        ),
      )
      .toBe("quiet");
    holdFirstResponse();
    await secondRequest;
    await expect(
      page.getByText("Biological memory: memory held within a biological mind.", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expectProgress(1);
    holdSecondResponse();
    await waitForScene("exogram");
    await expectProgress(2);
    await expect(page.getByRole("region", { name: "Learned so far", exact: true })).toHaveCount(0);
    expect(await questionStyle()).toEqual(initialQuestionStyle);
    await page.screenshot({ path: testInfo.outputPath("exogram-question.png") });
    await expectEvidence("engram:engram-biological", { status: "demonstrated", understanding: "independent" });
    await expect(page.getByRole("heading", { name: "What is an exogram?", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Non-biological memory: a representation kept outside biological memory.", { exact: true }),
    ).toHaveCount(0);
    await speakThenTutor(
      "A record outside biological memory, such as a diagram on paper.",
      "That is an external record.",
    );
    await expectEvidence("exogram:exogram-non-biological", { status: "demonstrated", understanding: "prompted" });
    await waitForScene("compare");
    await expectProgress(3);
    await page.screenshot({ path: testInfo.outputPath("comparison-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("comparison-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await speakThenTutor(
      "An external record can persist beyond the moment of thinking.",
      "That explains one difference. What else differs?",
    );
    await expectEvidence("compare:exogram-durability", { status: "demonstrated", understanding: "independent" });
    await expectProgress(3);
    await expect(page.locator('[data-scene="compare"]')).not.toContainText("Durable");
    if (debug) {
      await page.getByText("Session details", { exact: true }).click();
      await expect(page.getByText("Durable", { exact: true })).toBeVisible();
      await page.getByText("Session details", { exact: true }).click();
    }
    await page.screenshot({ path: testInfo.outputPath("comparison-explained.png") });
    await expect(page.locator('[data-scene="compare"]').getByText("Shareable", { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-scene="compare"]').getByText("Revisable", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await speakThenTutor(
      "The first is internal; the external record can last, be shared, and be revised.",
      "Those are the stated differences.",
    );
    await waitForScene("exographics");
    await expectProgress(4);
    expect(await questionStyle()).toEqual(initialQuestionStyle);
    await page.screenshot({ path: testInfo.outputPath("exographics-question.png") });

    await speakThenTutor(
      "Meaningful shared symbols can show abstract ideas in maps and equations.",
      "A map can do that too.",
    );
    await expectEvidence("exographics:visual-symbols", { status: "demonstrated", understanding: "prompted" });
    await waitForScene("recap");
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Recap");
    await expect(page.locator('[data-state="completed"]')).toHaveCount(4);
    await expect(page.locator('[data-state="active"]')).toHaveCount(0);
    expect(
      await page.locator('[data-scene="recap"] p').evaluate(element => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(22);
    await expect(page.getByRole("region", { name: "Conversation assessment" })).toHaveCount(debug ? 1 : 0);

    const recapState = await page.evaluate(
      () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime,
    );
    const closeText = evidenceRecap(CATCHING_UNICORNS_LESSON, recapState);
    await expect(page.locator('[data-scene="recap"] p')).toHaveText(closeText);
    const appends = await page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents);
    expect(appends).toHaveLength(5);
    expect(appends.at(-1)).toContain(JSON.stringify(closeText));
    await expect(page.locator('[data-scene="recap"]')).toContainText("You independently explained engrams");
    await expect(page.locator('[data-scene="recap"]')).toContainText("After a prompt, you explained exograms");
    await expect(page.locator('[data-scene="recap"]')).not.toContainText(/extended cognition|unresolved/i);
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
    });
    // A pause after only the beginning of the close must not end the session.
    const split = closeText.indexOf(". ") + 2;
    await sendWire("session.output_transcript.delta", closeText.slice(0, split));
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
    });
    await page.waitForTimeout(1800);
    await expect(page.getByRole("status")).toHaveText("live");
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
    });
    await sendWire("session.output_transcript.delta", closeText.slice(split));
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.outputActivity,
        ),
      )
      .toBe("active");
    await expect(page.getByRole("status")).toHaveText("live");
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
    });
    await expect(page.getByRole("status")).toHaveText("Session complete");
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Session complete");
    await expect(page.locator('[data-state="completed"]')).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restart discussion" })).toBeEnabled();
    await expect(page.locator('[data-scene="recap"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("completed-recap.png") });
    await expect
      .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
      .toBe(1);
    if (!debug) {
      await page.setViewportSize({ width: 320, height: 568 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("completed-recap-mobile.png") });
      await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
      const download = await downloadPromise;
      const exportText = await readFile((await download.path())!, "utf8");
      const exported = JSON.parse(exportText);
      expect(exported.lesson).toEqual({ id: "catching-unicorns", sceneId: "recap" });
      expect(exported.acceptedEvidence).toHaveProperty("engram:engram-biological");
      expect(exportText).not.toMatch(/OPENAI_API_KEY|TYPESAFE_API_KEY|authorization|access_token|"sdp"/i);
      await page.getByRole("button", { name: "Restart discussion" }).click();
      await expect(page.locator('[data-scene="engram"]')).toBeVisible();
      await expectProgress(1);
      return;
    }
    await page.getByText("Session details", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Conversation so far" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current evidence" })).toBeVisible();
    await page.getByText("Session diagnostics", { exact: true }).click();
    await expect(page.locator("summary").filter({ hasText: /lesson.ended/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("debug-mobile.png"), fullPage: true });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export session", exact: true }).click();
    const download = await downloadPromise;
    const exportText = await readFile((await download.path())!, "utf8");
    const exported = JSON.parse(exportText) as {
      lesson: { id: string; sceneId: string };
      acceptedEvidence: Record<string, { status: string }>;
      revealContext: Record<string, string[]>;
    };
    expect(exported.lesson).toEqual({ id: "catching-unicorns", sceneId: "recap" });
    expect(exported.acceptedEvidence).toHaveProperty("engram:engram-biological");
    expect(exported.revealContext.engram).toContain("engram-biological");
    expect(Object.keys(exported.revealContext)).toEqual(["engram", "exogram", "compare", "exographics", "recap"]);
    expect(exportText).not.toMatch(/OPENAI_API_KEY|TYPESAFE_API_KEY|authorization|access_token|"sdp"/i);
  });
}

test("don't-know can move on through four skipped questions without evidence or another exercise", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demos/catching-unicorns");
  await microphone.loadSpeech("answer-three");
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect(page.getByRole("status")).toHaveText("live");
  const say = async (text: string) => {
    const playback = await microphone.playSpeech("answer-three");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.childSpeaking,
        ),
      )
      .toBe(true);
    await page.evaluate(
      text => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", text),
      text,
    );
    await microphone.waitForPlayback(playback.id);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.childSpeaking,
        ),
      )
      .toBe(false);
  };
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.awaitingSteering,
      ),
    )
    .toBe(false);
  await say("I don't know.");
  await expect(page.locator('[data-scene="engram"]')).toBeVisible();
  // Controlled tutor clarification, never manufactured as learner evidence.
  await page.evaluate(() =>
    (window as unknown as LocalSessionWindow).sendTranscript(
      "session.output_transcript.delta",
      "Would you like a clarification?",
    ),
  );
  for (const [index, next] of ["exogram", "compare", "exographics", "recap"].entries()) {
    await say(index === 0 ? "I don't know. Next." : "Next");
    await expect(page.locator(`[data-scene="${next}"]`)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.awaitingSteering,
        ),
      )
      .toBe(false);
  }
  const state = await page.evaluate(
    () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime,
  );
  expect(state?.conceptEvidence).toEqual({});
  const text = evidenceRecap(CATCHING_UNICORNS_LESSON, state);
  await expect(page.locator('[data-scene="recap"] p')).toHaveText(text);
  expect(text).not.toMatch(/you.*explained/i);
  await page.evaluate(text => {
    const browser = window as unknown as LocalSessionWindow;
    browser.currentPeer.level.gain.value = 0.15;
    browser.sendTranscript("session.output_transcript.delta", text);
  }, text);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot.runtime?.outputActivity,
      ),
    )
    .toBe("active");
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await expect(page.getByRole("status")).toHaveText("Session complete");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  const appends = await page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents);
  expect(appends).toHaveLength(5);
  expect(appends.at(-1)).toContain(JSON.stringify(text));
  await expect.poll(async () => (await microphone.state()).trackStates.filter(s => s === "live").length).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("all-skipped-recap-mobile.png") });
});
