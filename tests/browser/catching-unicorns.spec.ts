import { expect, test, type Page } from "@playwright/test";
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
      const source = { peer, tone, level, destination, channel: undefined as RTCDataChannel | undefined };
      browser.peers.push(source);
      browser.currentPeer = source;
      peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
      peer.ondatachannel = event => {
        source.channel = event.channel;
        source.channel.onopen = () => source.channel!.send(JSON.stringify({ type: "session.started" }));
        source.channel.onmessage = message => {
          const command = JSON.parse(message.data);
          if (command.type === "session.instructions.append")
            source.channel!.send(
              JSON.stringify({
                type: "session.instructions.appended",
                client_event_id: command.event_id,
                start_ms: 0,
                end_ms: 0,
              }),
            );
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
  await expect(page.getByRole("heading", { name: "Engram", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start discussion", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Lesson scene" }).getByText("Not yet demonstrated", { exact: true }),
  ).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("Biological memory: memory held within a biological mind.");
  expect(body).not.toContain("Non-biological memory: a representation kept outside biological memory.");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("shared runtime starts, skips only after quiet drain, stops, restarts, and cleans up on navigation", async ({
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
  await page.getByRole("button", { name: "Skip scene" }).click();
  await expect(page.locator('[data-scene="exogram"]')).toBeVisible();
  await expect(page.getByText("Definition not yet revealed", { exact: true })).toBeVisible();
  await expect(page.getByText("Non-biological memory: a representation kept outside biological memory.")).toHaveCount(
    0,
  );

  const firstRuntimeId = await page.evaluate(
    () => (window as LessonObservationWindow).sproutLessonObservation?.read()?.cursor.runtimeId,
  );
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("status")).toHaveText("ended");
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
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
    .toBe(1);
  await page.getByRole("button", { name: "Start discussion" }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole("status")).toHaveText("ended");
});

test("Catching Unicorns reveals accepted evidence through the real lesson runtime and exports safe recap context", async ({
  page,
}) => {
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
  let holdReadyRevision = false;
  let releaseReadyRevision!: () => void;
  const readyRevisionGate = new Promise<void>(resolve => (releaseReadyRevision = resolve));
  let readyRevisionSeen!: () => void;
  const readyRevisionRequest = new Promise<void>(resolve => (readyRevisionSeen = resolve));
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
    if (holdReadyRevision) {
      readyRevisionSeen();
      await readyRevisionGate;
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
                : body.nodeId === "why-exographics" && id === "reification"
                  ? "partial"
                  : body.nodeId === "why-exographics" && id === "memory-extension"
                    ? "not_yet"
                    : "demonstrated_independent";
      return { criterionId: id, observation };
    });
    await route.fulfill({
      json: {
        proposal: {
          nodeId: body.nodeId,
          transcriptRevision: body.transcriptRevision,
          childActivity: "unknown",
          answerOutcome: "correct",
          supportState: "none",
          tutorState: "acknowledging",
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
  const waitForContinue = async () => expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
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
  const continueTo = async (sceneId: string) => {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
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
  // The old response cannot reveal or enable Continue; only fresh validation can.
  await speakThenTutor(
    "Memory exists in a biological mind, unlike an external note.",
    "Tell me a little more about where that memory exists.",
  );
  await firstRequest;
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).sendTranscript(
      "session.output_transcript.delta",
      "Where does that memory exist, and how is a note different?",
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
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  holdSecondResponse();
  await expect(page.locator('[data-scene="engram"]')).toContainText(
    "Biological memory: memory held within a biological mind.",
  );
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();

  // Keep the revealed definition visible until the learner explicitly continues.
  await expect(page.locator('[data-scene="engram"]')).toContainText(
    "Biological memory: memory held within a biological mind.",
  );
  holdReadyRevision = true;
  await sendWire("session.output_transcript.delta", "Can you add anything else about that distinction?");
  await readyRevisionRequest;
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await expect(page.locator('[data-scene="engram"]')).toContainText(
    "Biological memory: memory held within a biological mind.",
  );
  holdReadyRevision = false;
  releaseReadyRevision();
  await waitForContinue();
  await continueTo("exogram");
  await expect(page.getByRole("region", { name: "Previously demonstrated concept" })).toContainText(
    "Biological memory: memory held within a biological mind.",
  );
  await expect(
    page.getByText("Non-biological memory: a representation kept outside biological memory.", { exact: true }),
  ).toHaveCount(0);
  await speakThenTutor(
    "A record outside biological memory, such as a diagram on paper.",
    "That is an external record.",
  );
  await expectEvidence("exogram:exogram-non-biological", { status: "demonstrated", understanding: "prompted" });
  await waitForContinue();
  await continueTo("compare");

  await speakThenTutor(
    "An external record can persist beyond the moment of thinking.",
    "That explains one difference.",
  );
  await expect(page.locator('[data-scene="compare"]')).toContainText("Durable");
  await expect(page.locator('[data-scene="compare"]').getByText("Shareable", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-scene="compare"]').getByText("Revisable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await speakThenTutor(
    "The first is internal; the external record can last, be shared, and be revised.",
    "Those are the stated differences.",
  );
  await expect(page.locator('[data-scene="compare"]')).toContainText("Durable");
  await expect(page.locator('[data-scene="compare"]')).toContainText("Shareable");
  await expect(page.locator('[data-scene="compare"]')).toContainText("Revisable");
  await waitForContinue();
  await continueTo("exographics");

  await speakThenTutor(
    "Meaningful shared symbols can show abstract ideas in maps and equations.",
    "A map can do that too.",
  );
  await expectEvidence("exographics:visual-symbols", { status: "demonstrated", understanding: "prompted" });
  await waitForContinue();
  await continueTo("why-exographics");
  await speakThenTutor(
    "Paper helps me inspect the marks and keep a longer chain in mind.",
    "What else can that make possible?",
  );
  await expect(page.locator('[data-scene="why-exographics"]')).toContainText("Partly explained");
  await expect(page.locator('[data-scene="why-exographics"]')).toContainText("Not yet demonstrated");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Skip scene", exact: true }).click();
  await expect(page.locator('[data-scene="techno-literate-culture"]')).toBeVisible();

  await speakThenTutor(
    "Most people need basic literacy, a few discover ideas, institutions coordinate strangers, and education develops knowledge.",
    "That covers the framework.",
  );
  await waitForContinue();
  await continueTo("caf-application");
  await speakThenTutor(
    "My conclusion: yes, with qualifications, because training and coordination support several framework characteristics.",
    "That is a defensible case when tied to evidence.",
  );
  await expectEvidence("caf-application:caf-defensible-conclusion", {
    status: "demonstrated",
    understanding: "independent",
  });
  await waitForContinue();
  await speakThenTutor(
    "I would say no: the framework suggests training and coordination, but we need broader literacy evidence.",
    "That is a qualified conclusion tied to evidence.",
  );
  await expectEvidence("caf-application:caf-defensible-conclusion", {
    status: "demonstrated",
    understanding: "independent",
  });
  await waitForContinue();
  await continueTo("synthesis");
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
  });
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
  await expect
    .poll(() =>
      page.evaluate(() => {
        const observation = (window as LessonObservationWindow).sproutLessonObservation?.read();
        const state = observation?.snapshot.runtime;
        return Boolean(
          observation &&
          state &&
          state.quietSinceMs !== null &&
          observation.nowMs - state.quietSinceMs >= state.quietDrainMs,
        );
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Skip scene", exact: true }).click();
  await expect(page.locator('[data-scene="recap"]')).toBeVisible();

  await expect(page.locator('[data-scene="recap"]')).toContainText("Demonstrated independently");
  await expect(page.locator('[data-scene="recap"]')).toContainText("Demonstrated after a prompt");
  await expect(page.locator('[data-scene="recap"]')).toContainText("Partly explained");
  await expect(page.locator('[data-scene="recap"]')).toContainText("Still unresolved or skipped");
  const recapGroup = (heading: string) =>
    page
      .locator('[data-scene="recap"] section')
      .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
  await expect(recapGroup("Demonstrated independently").getByText("Engram", { exact: true })).toBeVisible();
  await expect(recapGroup("Demonstrated after a prompt").getByText("Exogram", { exact: true })).toBeVisible();
  await expect(recapGroup("Partly explained").locator("li")).toHaveCount(1);
  await expect(recapGroup("Still unresolved or skipped")).toContainText("partial evidence");
  await expect(recapGroup("Still unresolved or skipped")).toContainText("one unresolved item");
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
  expect(exported.revealContext["why-exographics"]).toEqual(["discovery"]);
  expect(exportText).not.toMatch(/OPENAI_API_KEY|TYPESAFE_API_KEY|authorization|access_token|"sdp"/i);
});
