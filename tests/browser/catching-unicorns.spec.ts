import {
  ASSESSMENT_VERSION,
  assessmentQuestions,
  normalizeAssessment,
} from "../../lib/lesson-runtime/conversation-assessment";
import { reviewReferences, type ReviewSnapshot } from "../../lib/lesson-runtime/review-evidence";
import type { ClientCommand } from "../../lib/events";
import { expect, test, type Page } from "@playwright/test";
import { transcriptMessages, substantiveLearnerText } from "../../lib/lesson-runtime/tutor-observation";
import { readFile } from "node:fs/promises";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import { CATCHING_UNICORNS_LESSON } from "../../lib/lesson-runtime/catching-unicorns-lesson";

type LocalPeer = {
  peer: RTCPeerConnection;
  tone: OscillatorNode;
  level: GainNode;
  destination: MediaStreamAudioDestinationNode;
  channel?: RTCDataChannel;
  commands: ClientCommand[];
};
type LocalSessionWindow = LessonObservationWindow & {
  peers: LocalPeer[];
  peerContext: AudioContext;
  currentPeer: LocalPeer;
  appPeerCloseCount: number;
  acceptOffer(sdp: string): Promise<string>;
  sendTranscript(type: "session.input_transcript.delta" | "session.output_transcript.delta", delta: string): void;
};

async function installLocalSession(page: Page) {
  await page.addInitScript(() => {
    const host = window as LessonObservationWindow;
    host.__SPROUT_OBSERVE_LESSON__ = true;
    const browser = window as unknown as LocalSessionWindow;
    browser.peers = [];
    browser.peerContext = new AudioContext();
    browser.appPeerCloseCount = 0;
    let transcriptTime = 10;
    const serverPeers = new WeakSet<RTCPeerConnection>();
    const nativeClose = RTCPeerConnection.prototype.close;
    RTCPeerConnection.prototype.close = function (this: RTCPeerConnection) {
      if (!serverPeers.has(this)) browser.appPeerCloseCount++;
      return nativeClose.call(this);
    };
    document.addEventListener(
      "click",
      () => {
        void browser.peerContext.resume();
      },
      true,
    );
    browser.acceptOffer = async (sdp: string) => {
      const context: AudioContext = browser.peerContext;
      await context.resume();
      const peer = new RTCPeerConnection();
      serverPeers.add(peer);
      const tone = context.createOscillator();
      const level = context.createGain();
      level.gain.value = 0;
      const destination = context.createMediaStreamDestination();
      tone.connect(level);
      level.connect(destination);
      tone.start();
      const source = {
        peer,
        tone,
        level,
        destination,
        channel: undefined as RTCDataChannel | undefined,
        commands: [] as ClientCommand[],
      };
      browser.peers.push(source);
      browser.currentPeer = source;
      peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
      peer.ondatachannel = event => {
        source.channel = event.channel;
        source.channel.onopen = () => source.channel!.send(JSON.stringify({ type: "session.started" }));
        source.channel.onmessage = message => {
          const command = JSON.parse(message.data);
          source.commands.push(command);
          if (command.type === "session.instructions.append") {
            // Catch scene-context expansion before a live provider rejects it.
            if (new TextEncoder().encode(command.content).length > 2000) {
              source.channel!.send(
                JSON.stringify({ type: "error", error: { code: "invalid_value", client_event_id: command.event_id } }),
              );
              return;
            }
            source.channel!.send(
              JSON.stringify({
                type: "session.instructions.appended",
                client_event_id: command.event_id,
                start_ms: 0,
                end_ms: 0,
              }),
            );
          }
        };
      };
      await peer.setRemoteDescription({ type: "offer", sdp });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>(resolve => {
          peer.addEventListener("icegatheringstatechange", () => {
            if (peer.iceGatheringState === "complete") resolve();
          });
        });
      return peer.localDescription!.sdp!;
    };
    browser.sendTranscript = (type, delta) => {
      const channel = browser.currentPeer.channel;
      if (!channel || channel.readyState !== "open") throw new Error("Local provider channel is not open");
      const start = transcriptTime;
      transcriptTime += 250;
      channel.send(JSON.stringify({ type, delta, start_ms: start, end_ms: transcriptTime }));
    };
  });
  await page.route("**/api/live", async route => {
    const sdp = await page.evaluate(
      value => (window as unknown as { acceptOffer(sdp: string): Promise<string> }).acceptOffer(value),
      route.request().postDataJSON().sdp,
    );
    await route.fulfill({ json: { transport: { sdp } } });
  });
  await page.route("**/api/classify", route => route.fulfill({ json: { proposal: null } }));
}

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

test("direct Catching Unicorns route renders hidden concepts and fits a narrow screen", async ({ page }) => {
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
  await expect(page.getByText("Explain it in your own words.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Lesson scenes" }).locator('[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByLabel("Scene 1 of 9", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversation so far" })).not.toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("Biological memory: memory held within a biological mind.");
  expect(body).not.toContain("Non-biological memory: a representation kept outside biological memory.");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
  const download = await downloadPromise;
  const exportText = await readFile((await download.path())!, "utf8");
  const diagnostics = JSON.parse(exportText);
  expect(diagnostics.runtimeId).toBe(firstRuntimeId);
  expect(diagnostics.status).toBe("ended");
  expect(diagnostics.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "lesson.ended" })]));
  expect(exportText).not.toMatch(/OPENAI_API_KEY|TYPESAFE_API_KEY|authorization|access_token|"sdp"/i);
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

test("session startup failure ends and releases the microphone so a fresh attempt is possible", async ({ page }) => {
  const microphone = await installSyntheticMicrophone(page);
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
  await expect(page.getByRole("button", { name: "Download diagnostics", exact: true })).toBeEnabled();
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
    .toBe(1);
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole("status")).toHaveText("ended");
});

test("Catching Unicorns reveals accepted evidence through the real lesson runtime and exports safe recap context", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);

  await page.route("**/api/assess", route => {
    const input = route.request().postDataJSON();
    const snapshot = { ...input.owner, visits: input.visits };
    return route.fulfill({
      json: {
        assessment: normalizeAssessment(
          {
            version: ASSESSMENT_VERSION,
            answers: Object.fromEntries(
              Object.entries(assessmentQuestions(CATCHING_UNICORNS_LESSON, snapshot)).map(([key, question]) => [
                key,
                key.includes(":evidence_")
                  ? {
                      type: "choice",
                      choice: "none",
                      confidence: 1,
                      probabilities: Object.fromEntries(
                        Object.keys(question.criteria).map(id => [id, id === "none" ? 1 : 0]),
                      ),
                    }
                  : key.endsWith(":understanding")
                    ? {
                        type: "choice",
                        choice: "partial",
                        confidence: 0.6,
                        probabilities: { not_yet: 0.1, partial: 0.6, demonstrated: 0.3 },
                      }
                    : {
                        type: "choice",
                        choice: "unclear",
                        confidence: 1,
                        probabilities: { independent: 0, prompted: 0, unclear: 1 },
                      },
              ]),
            ),
          },
          CATCHING_UNICORNS_LESSON,
          snapshot,
        ),
      },
    });
  });

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
                : body.nodeId === "why-exographics" &&
                    id === "reification" &&
                    !body.transcript.includes("inspect, remember, and discover")
                  ? "partial"
                  : body.nodeId === "why-exographics" &&
                      id === "memory-extension" &&
                      !body.transcript.includes("inspect, remember, and discover")
                    ? "not_yet"
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

  await page.goto("/demos/catching-unicorns");
  await microphone.loadSpeech("answer-three");
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect(page.getByRole("status")).toHaveText("live");
  await expect(page.getByText("Biological memory: memory held within a biological mind.", { exact: true })).toHaveCount(
    0,
  );

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
  await expect(page.getByText("Biological memory: memory held within a biological mind.", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  holdSecondResponse();
  await waitForScene("exogram");
  const learned = page.getByRole("region", { name: "Learned so far", exact: true });
  await expect(learned.locator("summary", { hasText: /^Engram$/ })).toBeVisible();
  await expect(learned.locator("summary", { hasText: /^Exogram$/ })).toHaveCount(0);
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
  await expect(page.locator('[data-scene="compare"]')).toContainText("Durable");
  await page.screenshot({ path: testInfo.outputPath("comparison-explained.png") });
  await expect(page.locator('[data-scene="compare"]').getByText("Shareable", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-scene="compare"]').getByText("Revisable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await speakThenTutor(
    "The first is internal; the external record can last, be shared, and be revised.",
    "Those are the stated differences.",
  );
  await waitForScene("exographics");
  await expect(learned.locator("summary", { hasText: /^Engram$/ })).toHaveCount(1);
  await expect(learned.locator("summary", { hasText: /^Exogram$/ })).toHaveCount(1);
  await expect(learned.locator("summary", { hasText: /^Durable$/ })).toBeVisible();
  expect(await questionStyle()).toEqual(initialQuestionStyle);
  await page.screenshot({ path: testInfo.outputPath("exographics-question.png") });

  await speakThenTutor(
    "Meaningful shared symbols can show abstract ideas in maps and equations.",
    "A map can do that too.",
  );
  await expectEvidence("exographics:visual-symbols", { status: "demonstrated", understanding: "prompted" });
  await waitForScene("why-exographics");
  await page.screenshot({ path: testInfo.outputPath("addition-question-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[aria-label="Arithmetic example"]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("addition-question-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await speakThenTutor(
    "Paper helps me inspect the marks and keep a longer chain in mind.",
    "What else can that make possible?",
  );
  await expect(page.locator('[data-scene="why-exographics"]')).toContainText("Partly explained");
  await expect(page.locator('[data-scene="why-exographics"]')).toContainText("Not yet demonstrated");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await speakThenTutor(
    "External symbols help us inspect, remember, and discover ideas.",
    "That explains all three purposes.",
  );
  await waitForScene("techno-literate-culture");

  await speakThenTutor(
    "Most people need basic literacy, a few discover ideas, institutions coordinate strangers, and education develops knowledge.",
    "That covers the framework.",
  );
  await waitForScene("caf-application");
  await speakThenTutor(
    "My conclusion: yes, with qualifications, because training and coordination support several framework characteristics.",
    "That is a defensible case when tied to evidence.",
  );
  await expectEvidence("caf-application:caf-defensible-conclusion", {
    status: "demonstrated",
    understanding: "independent",
  });
  await waitForScene("synthesis");
  await speakThenTutor(
    "External representations support reasoning, discovery, and shared knowledge.",
    "Those connections bring the ideas together.",
  );
  await waitForScene("recap");

  const recap = page.locator('[data-scene="recap"]');
  await expect(recap.getByRole("heading", { name: "What you explained well" })).toBeVisible();
  // Instructional ranking now selects reasoning strengths; prompted definitions remain in provenance.
  await expect(recap).toContainText(
    "You explained how external representations reduce what you need to hold in memory as you reason.",
  );
  await expect(recap).toContainText(
    "You explained how symbols make abstract ideas visible for inspection or manipulation.",
  );
  await expect(recap).toContainText("Try this without a cue");
  await expect(recap).toContainText("live demonstrated (prompted)");
  await expect(recap.getByRole("heading", { name: "One next step" })).toBeVisible();
  await expect(recap.getByRole("heading", { name: "Your next exercise" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation assessment" })).toHaveCount(0);
  await expect(recap).not.toContainText(/extended cognition/i);
  // The scene can paint before its two-frame confirmation appends tutor context.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as LessonObservationWindow)
          .sproutLessonObservation!.read()!
          .events.some(event => event.type === "gpt_live.steering_append" && event.nodeId === "recap"),
      ),
    )
    .toBe(true);
  const shared = await page.evaluate(() => {
    const observation = (window as LessonObservationWindow).sproutLessonObservation!.read()!;
    const summary = observation.snapshot.summary!;
    const steering = observation.events.find(
      event => event.type === "gpt_live.steering_append" && event.nodeId === "recap",
    )!;
    const content = (steering.detail as { content: string }).content;
    return { summary, feedback: JSON.parse(content.split("\n")[1]) };
  });
  expect(shared.feedback.exercise).toBe(shared.summary.exercise);
  expect(shared.feedback.improvement).toBe(shared.summary.improvement.text);
  await expect(recap).toContainText(shared.summary.exercise);
  await page.screenshot({ path: testInfo.outputPath("recap-desktop.png"), fullPage: true });
  await testInfo.attach("shared-session-recap", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await recap.getByText("Evidence and review details", { exact: true }).click();
  await expect(recap).toContainText("Transfer/application reasoning");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("recap-mobile-evidence.png"), fullPage: true });
  await recap.getByText("Evidence and review details", { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("recap-mobile.png"), fullPage: true });
  const closesBeforeFinish = await page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount);
  await page.getByRole("button", { name: "Finish discussion", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("ended");
  await expect(
    page.getByText("Discussion ended. Your recap and evidence remain available until you start again."),
  ).toBeVisible();
  await expect(recap).toContainText(shared.summary.exercise);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount))
    .toBeGreaterThan(closesBeforeFinish);
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
    .toBe(1);
  await recap.getByText("Evidence and review details", { exact: true }).click();
  await expect(recap.getByText("Transfer/application reasoning", { exact: false }).first()).toBeVisible();
  await page.getByText("Session details", { exact: true }).click();
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
  expect(exported.revealContext["why-exographics"]).toEqual(["reification", "memory-extension", "discovery"]);
  expect(exportText).not.toMatch(/OPENAI_API_KEY|TYPESAFE_API_KEY|authorization|access_token|"sdp"/i);
});

// Real route, React rendering, runtime, snapshot ownership, reference validation,
// selection, WebRTC data channel and teardown. Tutor speech/transcripts, live
// classifier decisions and assessment choices are controlled provider boundaries.
// Receiving matching context proves delivery, not that a voice model speaks it.
test("multi-reply grounded feedback preserves live evidence and isolates a late review after restart", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const pending: { snapshot: ReviewSnapshot; release: () => void }[] = [];
  await page.route("**/api/assess", async route => {
    const input = route.request().postDataJSON();
    const snapshot: ReviewSnapshot = { ...input.owner, visits: input.visits };
    await new Promise<void>(release => pending.push({ snapshot, release }));
    const references = reviewReferences(snapshot.visits);
    const answers = Object.fromEntries(
      Object.entries(assessmentQuestions(CATCHING_UNICORNS_LESSON, snapshot)).map(([key, question]) => {
        const concept = key.split(":")[1];
        const source = {
          "engram-biological": "engram",
          "exogram-non-biological": "exogram",
          "memory-extension": "why-exographics",
        }[concept];
        const selected = references.filter(ref => ref.nodeId === source && !ref.text.includes("Next question"));
        const slot = /:evidence_(\d)$/.exec(key);
        const label = slot
          ? (selected[Number(slot[1])]?.id ?? "none")
          : key.endsWith(":assistance")
            ? "unclear"
            : selected.length
              ? "demonstrated"
              : "partial";
        return [
          key,
          {
            type: "choice",
            choice: label,
            confidence: 1,
            probabilities: Object.fromEntries(Object.keys(question.criteria).map(id => [id, id === label ? 1 : 0])),
          },
        ];
      }),
    );
    // Unobserved topics abstain rather than manufacturing negative evidence.
    for (const [key, value] of Object.entries(answers)) {
      if (key.endsWith(":understanding") && value.choice === "partial") {
        value.confidence = 0.6;
        value.probabilities = { partial: 0.6, demonstrated: 0.3, not_yet: 0.1 };
      }
    }
    await route.fulfill({
      json: {
        assessment: normalizeAssessment({ version: ASSESSMENT_VERSION, answers }, CATCHING_UNICORNS_LESSON, snapshot),
      },
    });
  });
  // Match the recorded fixture's tentative partial observation; confident
  // partial evidence intentionally remains a conflict in existing reconciliation tests.
  await page.route("**/api/classify", async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        proposal:
          body.nodeId === "exogram"
            ? {
                nodeId: body.nodeId,
                transcriptRevision: body.transcriptRevision,
                childActivity: "unknown",
                answerOutcome: "unclear",
                supportState: "none",
                tutorState: "clarifying",
                conceptObservations: [
                  { criterionId: "exogram-non-biological", observation: "partial_uncertain", childMessageIndex: 1 },
                ],
              }
            : body.nodeId === "why-exographics" && body.transcript.includes("middle steps")
              ? {
                  nodeId: body.nodeId,
                  transcriptRevision: body.transcriptRevision,
                  childActivity: "unknown",
                  answerOutcome: "unclear",
                  supportState: "none",
                  tutorState: "clarifying",
                  conceptObservations: [
                    { criterionId: "memory-extension", observation: "demonstrated_independent", childMessageIndex: 1 },
                  ],
                }
              : null,
      },
    });
  });
  const observe = () => page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation!.read()!);
  const send = async (speaker: "Child" | "Tutor", text: string) => {
    const playback = speaker === "Child" ? await microphone.playSpeech("answer-three") : undefined;
    if (playback) await expect.poll(async () => (await observe()).snapshot.runtime?.childSpeaking).toBe(true);
    if (speaker === "Tutor") {
      await page.evaluate(() => {
        (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
      });
      await expect.poll(async () => (await observe()).snapshot.runtime?.outputActivity).toBe("active");
    }
    await page.evaluate(
      ({ speaker, text }) => {
        (window as unknown as LocalSessionWindow).sendTranscript(
          speaker === "Child" ? "session.input_transcript.delta" : "session.output_transcript.delta",
          text,
        );
      },
      { speaker, text },
    );
    await expect.poll(async () => (await observe()).snapshot.transcript).toContain(text);
    if (speaker === "Tutor") {
      await page.evaluate(() => {
        (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
      });
      await expect.poll(async () => (await observe()).snapshot.runtime?.outputActivity).toBe("quiet");
    }
    if (playback) {
      await microphone.waitForPlayback(playback.id);
      await expect.poll(async () => (await observe()).snapshot.runtime?.childSpeaking).toBe(false);
    }
  };
  const ready = async (scene: string) => {
    await expect(page.locator(`[data-scene="${scene}"]`)).toBeVisible();
    await expect
      .poll(async () => {
        const state = (await observe()).snapshot;
        return !state.awaitingSteering && state.runtime?.outputActivity === "quiet";
      })
      .toBe(true);
  };
  const next = async (scene: string) => {
    await expect
      .poll(async () => {
        const observation = await observe();
        const state = observation.snapshot.runtime;
        return (
          state?.quietSinceMs !== null &&
          state?.quietSinceMs !== undefined &&
          observation.nowMs - state.quietSinceMs >= state.quietDrainMs
        );
      })
      .toBe(true);
    await send("Child", "Next question, then");
    await ready(scene);
    if (scene !== "recap") await send("Tutor", "What would you like to discuss here?");
  };
  await page.goto("/demos/catching-unicorns");
  await microphone.loadSpeech("answer-three");
  await page.getByRole("button", { name: "Start discussion", exact: true }).click();
  await ready("engram");
  await send("Tutor", "What is an engram?");
  await send("Child", "An engram is memory stored inside my brain.");
  await send("Tutor", "Thank you for explaining that.");
  await next("exogram");
  await send("Tutor", "What is an exogram?");
  await send("Child", "Information stored outside the brain.");
  await send("Tutor", "Could you give an example of what you mean?");
  await expect
    .poll(async () => (await observe()).snapshot.runtime?.conceptEvidence["exogram:exogram-non-biological"]?.status)
    .toBe("partial");
  await send("Child", "Words written down on a page can keep that information.");
  await send("Tutor", "Thank you for that example.");
  await next("compare");
  await next("exographics");
  await next("why-exographics");
  await send("Tutor", "What changes when you can write down the steps?");
  await send(
    "Child",
    "I can write down the middle steps and reason with them without holding everything in short term memory.",
  );
  await send("Tutor", "Thanks for explaining how that changes your reasoning.");
  await expect
    .poll(async () => (await observe()).snapshot.runtime?.conceptEvidence["why-exographics:memory-extension"]?.status)
    .toBe("demonstrated");
  await next("techno-literate-culture");
  await next("caf-application");
  await next("synthesis");
  await next("recap");
  await expect.poll(() => pending.length).toBe(1);
  const before = (await observe()).snapshot;
  expect(before.summary?.reviewStatus).toBe("pending");
  expect(before.summary?.improvement.conceptId).toBe("exogram-non-biological");
  const recap = page.locator('[data-scene="recap"]');
  await expect(recap).toContainText(before.summary!.notice);
  const exportSession = async () => {
    const details = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: /^Session details$/ }) })
      .first();
    if ((await details.getAttribute("open")) === null) await page.getByText("Session details", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export session", exact: true }).click();
    const text = await readFile((await (await downloadPromise).path())!, "utf8");
    expect(text).not.toMatch(/OPENAI_API_KEY|TYPESAFE_API_KEY|authorization|access_token|"sdp"/i);
    return JSON.parse(text);
  };
  const beforeExport = await exportSession();
  expect(beforeExport.revealContext["why-exographics"]).toContain("memory-extension");
  expect(beforeExport.revealContext.exogram).toEqual([]);
  const live = structuredClone(before.runtime);
  expect(live?.conceptEvidence["why-exographics:memory-extension"]?.understanding).toBe("independent");
  const beforeCommands = await page.evaluate(
    () => (window as unknown as LocalSessionWindow).currentPeer.commands.length,
  );
  pending[0].release();
  await expect.poll(async () => (await observe()).snapshot.summary?.reviewStatus).toBe("complete");
  const after = (await observe()).snapshot;
  expect(after.runtime).toEqual(live); // includes mastery and navigation
  const afterExport = await exportSession();
  expect(afterExport.revealContext).toEqual(beforeExport.revealContext);
  expect(afterExport.acceptedEvidence).toEqual(beforeExport.acceptedEvidence);
  expect(afterExport.lesson).toEqual(beforeExport.lesson);
  const exogram = after.summary!.concepts.find(c => c.id === "exogram-non-biological")!;
  expect(exogram.evidence).toBe("recorded");
  expect(exogram.attribution).toBe("unclear");
  const reconciled = exogram.records.find(r => r.key === "exogram:exogram-non-biological")!;
  expect(reconciled.live).toMatchObject({ status: "partial", tentative: true });
  expect(reconciled.reconciliation).toBe("later-clarification");
  expect(reconciled.reviewQuotes.map(q => q.text)).toEqual([
    "Information stored outside the brain.",
    "Words written down on a page can keep that information.",
  ]);
  expect(after.summary!.strengths.map(s => s.conceptId)).toEqual(["memory-extension", "engram-biological"]);
  expect(after.summary!.improvement.conceptId).toBe("discovery");
  await expect(recap).toContainText(after.summary!.exercise);
  for (const strength of after.summary!.strengths) await expect(recap).toContainText(strength.text);
  await recap.getByText("Evidence and review details", { exact: true }).click();
  for (const quote of reconciled.reviewQuotes) await expect(recap).toContainText(quote.text);
  await expect
    .poll(async () => (await observe()).events.filter(e => e.type === "gpt_live.summary_append").length)
    .toBe(1);
  const command = await page.evaluate(() =>
    (window as unknown as LocalSessionWindow).currentPeer.commands
      .filter(c => c.type === "session.instructions.append")
      .at(-1),
  );
  expect(command?.type).toBe("session.instructions.append");
  if (command?.type !== "session.instructions.append") throw new Error("Missing received tutor feedback");
  const feedback = JSON.parse(command.content.split("\n")[1]);
  expect(feedback).toMatchObject({
    strengths: after.summary!.strengths.map(s => s.text),
    improvement: after.summary!.improvement.text,
    exercise: after.summary!.exercise,
    notice: after.summary!.notice,
  });
  expect(command.content).toContain("do not initiate an extra turn");
  expect(
    await page.evaluate(
      index => (window as unknown as LocalSessionWindow).currentPeer.commands.slice(index),
      beforeCommands,
    ),
  ).toEqual([command]);
  await testInfo.attach("grounded-feedback", {
    body: JSON.stringify({ snapshot: pending[0].snapshot, summary: after.summary, feedback }, null, 2),
    contentType: "application/json",
  });

  // A recap follow-up makes stop launch a new review; leave it pending across restart.
  await send("Child", "What should I study next?");
  await expect.poll(async () => (await observe()).snapshot.transcript).toContain("What should I study next?");
  await page.getByRole("button", { name: "Finish discussion", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("ended");
  await expect.poll(() => pending.length).toBe(2);
  const closedCommands = await page.evaluate(() => (window as unknown as LocalSessionWindow).peers[0].commands.length);
  await page.getByRole("button", { name: "Start new discussion", exact: true }).click();
  await ready("engram");
  const fresh = await observe();
  expect(fresh.cursor.runtimeId).not.toBe(before.runtime!.runtimeId);
  expect(fresh.snapshot.assessment?.status).toBe("idle");
  expect(fresh.snapshot.summary).toBeUndefined();
  const lateResponse = page.waitForResponse(response => response.url().endsWith("/api/assess"));
  pending[1].release();
  await (await lateResponse).finished();
  // Wait for response handling, not an arbitrary timeout; the detached old runtime
  // may finish its export review, but cannot write into either live transport.
  await expect.poll(async () => (await observe()).snapshot.assessment?.status).toBe("idle");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect((await observe()).snapshot.runtime?.conceptEvidence).toEqual({});
  expect(await page.evaluate(() => (window as unknown as LocalSessionWindow).peers[0].commands.length)).toBe(
    closedCommands,
  );
  expect(
    await page.evaluate(() =>
      (window as unknown as LocalSessionWindow).peers[1].commands.some(
        c => c.type === "session.instructions.append" && c.event_id.includes(":summary:"),
      ),
    ),
  ).toBe(false);
});
