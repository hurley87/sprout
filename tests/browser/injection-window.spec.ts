import { test, expect } from "@playwright/test";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";
import { attemptWindowInjection } from "../helpers/injection-window";
import { createLessonRuntime } from "../helpers/counting-runtime";
import type { LessonObservation } from "../../lib/lesson-runtime/lesson-runtime";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";

test("atomic window check serializes in Chromium, starts real preloaded audio, and rejects old output", async ({
  page,
}) => {
  const microphone = await installSyntheticMicrophone(page);
  await page.goto("/");
  // This is a plumbing test with a mock report, not a live scenario or injected app authority.
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.textContent = "Unlock test audio";
    document.body.append(button);
  });
  await page.getByRole("button", { name: "Unlock test audio" }).click();
  await microphone.loadSpeech("uh");
  const state = {
    ...createLessonRuntime("local-window"),
    nodeId: "count-3-butterflies" as const,
    visitId: 3,
    childTurnId: 1,
    hasChildTranscript: true,
    outputActivity: "active" as const,
  };
  const observation = {
    nowMs: 100,
    cursor: { runtimeId: state.runtimeId, offset: 3 },
    snapshot: {
      status: "live",
      runtime: state,
      awaitingSteering: false,
      error: null,
      transcript: "",
      diagnostics: [],
      display: { nodeId: state.nodeId, sceneId: "butterfly-garden", token: "mock-window" },
    },
    events: [
      {
        type: "transcript.snapshot",
        atMs: 10,
        transcriptSpeaker: "child",
        detail: { transcript: "Child: Uh, I think, uh, three." },
      },
      { type: "runtime.event.child.turn.ended", atMs: 20 },
      { type: "output.activity", atMs: 30, detail: { state: "active" } },
    ].map(e => ({
      ...e,
      timestamp: "offline",
      transcriptRevision: 0,
      transcriptSpeaker: "unknown",
      detail: null,
      ...e,
      runtimeId: state.runtimeId,
      visitId: 3,
      nodeId: state.nodeId,
      childTurnId: 1,
    })),
  } as LessonObservation;
  await page.evaluate(value => {
    let clock = value.nowMs;
    Object.defineProperty(window, "sproutLessonObservation", {
      configurable: true,
      value: {
        read: () => structuredClone({ ...value, nowMs: ++clock }),
        report: () => null,
      },
    });
  }, observation);
  const request = {
    from: {
      after: { runtimeId: state.runtimeId, offset: 0 },
      scope: { runtimeId: state.runtimeId, visitId: 3, nodeId: state.nodeId, childTurnId: 0 },
    },
    timing: "during-output" as const,
    audio: { fixture: "uh" as const },
  };
  try {
    const landed = (await page.evaluate(attemptWindowInjection, request))!;
    expect(landed.atMs).toBe(101);
    expect(landed.afterStartMs).toBe(102);
    expect((await microphone.state()).activeSources).toBe(1);
    expect(await microphone.waitForPlayback(landed.playback.id)).toBe("ended");
    await page.evaluate(() => {
      const host = window as LessonObservationWindow;
      const previous = host.sproutLessonObservation!.read()!;
      Object.defineProperty(window, "sproutLessonObservation", {
        configurable: true,
        value: {
          read: () => ({
            ...previous,
            snapshot: { ...previous.snapshot, runtime: { ...previous.snapshot.runtime!, outputActivity: "quiet" } },
          }),
        },
      });
    });
    expect(await page.evaluate(attemptWindowInjection, request)).toBeNull();
    expect((await microphone.state()).activeSources).toBe(0);
    // The live provider can interleave learner and tutor fragments and omit hesitation.
    const fragmented =
      "Child: Three\nTutor: Yes\nChild: ! There are\nTutor: , three\nChild: three butterflies\nTutor: butterflies.";
    const late = {
      ...observation,
      snapshot: { ...observation.snapshot, runtime: { ...state, outputActivity: "quiet" as const } },
      events: [
        { ...observation.events[0], detail: { transcript: fragmented } },
        ...observation.events.slice(1),
        {
          ...observation.events[0],
          atMs: 40,
          transcriptSpeaker: "tutor" as const,
          detail: { transcript: fragmented },
        },
        { ...observation.events[2], atMs: 50, detail: { state: "quiet" } },
        {
          ...observation.events[0],
          atMs: 60,
          type: "tutor_stabilization.scheduled",
          detail: { delayMs: 200 },
        },
      ],
    };
    late.cursor = { ...late.cursor, offset: late.events.length };
    await page.evaluate(value => {
      let clock = value.nowMs;
      Object.defineProperty(window, "sproutLessonObservation", {
        configurable: true,
        value: { read: () => structuredClone({ ...value, nowMs: ++clock }) },
      });
    }, late);
    const confirmation = (await page.evaluate(attemptWindowInjection, {
      ...request,
      timing: "confirmation-quiet" as const,
    }))!;
    expect(confirmation).not.toBeNull();
    expect((await microphone.state()).activeSources).toBe(1);
    expect(await microphone.waitForPlayback(confirmation.playback.id)).toBe("ended");
  } finally {
    await microphone.dispose();
  }
});

test("Albert and Samantha hesitant answers use the same checksum-verified browser microphone path", async ({
  page,
}) => {
  const microphone = await installSyntheticMicrophone(page);
  await page.goto("/");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.textContent = "Unlock fixture comparison";
    document.body.append(button);
  });
  await page.getByRole("button", { name: "Unlock fixture comparison" }).click();
  try {
    for (const [name, duration] of [
      ["hesitant-three", 3.019708],
      ["hesitant-three-samantha", 3.706458],
    ] as const) {
      expect(await microphone.loadSpeech(name)).toBeCloseTo(duration, 3);
      const playback = await microphone.playSpeech(name);
      expect(playback.durationSeconds).toBeCloseTo(duration, 3);
      expect((await microphone.state()).activeSources).toBe(1);
      expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
      expect((await microphone.state()).activeSources).toBe(0);
    }
  } finally {
    await microphone.dispose();
  }
});
