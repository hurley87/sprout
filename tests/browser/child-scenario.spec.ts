import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installChildScenarios } from "../helpers/child-scenario";

async function localPeer(page: Page) {
  await page.addInitScript(`(() => {
    window.peers = [];
    window.peerContext = new AudioContext();
    document.addEventListener("click", () => { void window.peerContext.resume(); }, true);
    window.acceptOffer = async sdp => {
      const context = window.peerContext; await context.resume();
      const peer = new RTCPeerConnection();
      const tone = context.createOscillator(); const level = context.createGain(); level.gain.value = 0.2;
      const destination = context.createMediaStreamDestination();
      tone.connect(level); level.connect(destination); tone.start();
      const source = {peer, context, tone, level, destination}; window.peers.push(source); window.currentPeer = source;
      peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
      peer.ondatachannel = event => {
        source.channel = event.channel;
        source.channel.onopen = () => source.channel.send(JSON.stringify({type:'session.started'}));
        source.channel.onmessage = event => {
          const command = JSON.parse(event.data);
          if (command.type === 'session.instructions.append') source.channel.send(JSON.stringify({
            type:'session.instructions.appended',client_event_id:command.event_id,start_ms:0,end_ms:0
          }));
        };
      };
      await peer.setRemoteDescription({type:'offer',sdp});
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== 'complete') await new Promise(resolve => peer.addEventListener('icegatheringstatechange', () => { if(peer.iceGatheringState === 'complete') resolve(); }));
      return peer.localDescription.sdp;
    };
  })()`);
  await page.route("**/api/live", async route => {
    const sdp = await page.evaluate<string, string>(
      sdp => (window as unknown as { acceptOffer(sdp: string): Promise<string> }).acceptOffer(sdp),
      route.request().postDataJSON().sdp,
    );
    await route.fulfill({ json: { transport: { sdp } } });
  });
  await page.route("**/api/classify", route => route.fulfill({ json: { proposal: null } }));
}

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(`(async () => {
    for (const source of window.peers ?? []) {source.peer.close(); source.tone.stop(); source.destination.stream.getTracks().forEach(track => track.stop()); if (source.context.state !== "closed") await source.context.close();}
    await window.syntheticMicrophone?.dispose();
  })()`);
});

test("reactive child uses actual microphone and local tutor PCM; retains aligned artifacts before restart", async ({
  page,
}, info) => {
  const harness = await installChildScenarios(page, info);
  await localPeer(page);
  await page.goto("/");
  const first = await harness.run("local reactive audio", async child => {
    await child.parentStart();
    await child.waitForNode("count-1-duck");
    await child.waitForTutorOutputStart();
    const quietFrom = await child.checkpoint();
    await page.evaluate("window.currentPeer.level.gain.value = 0");
    await child.waitForEvent("output.activity", { from: quietFrom, detail: { state: "quiet" } });
    expect(await child.currentNode()).toBe("count-1-duck");
    await child.correctAnswer();
    await child.waitForEvent("microphone.speech_started");
    await child.waitForEvent("microphone.speech_stopped");
    // Local peer does not transcribe: observe the production block, never infer semantics.
    await child.waitForEvent("classifier.blocked", { detail: { reason: "missing_current_turn_child_transcript" } });
    await child.noise({ seed: 30, durationMs: 40 });
    await child.waitForEvent("microphone.activity_discarded");
    const pendingSpeech = child.sayFixture("counting");
    await expect.poll(async () => (await harness.microphone.state()).activeSources).toBe(1);
    await child.cancelAudio();
    expect(await pendingSpeech).toBe("cancelled");
    const resumedFrom = await child.checkpoint();
    const interruption = child.interrupt("Wait!", resumedFrom);
    await page.evaluate("window.currentPeer.level.gain.value = 0.2");
    expect(await interruption).toBe("ended");
    await child.staySilent(30);
    await child.requestStop();
    expect((await harness.observer.read())?.snapshot.status).toBe("live");
    const stopFrom = await child.checkpoint();
    await child.parentStop();
    const ended = await child.waitForSessionEnd();
    expect(ended.cursor.offset).toBeGreaterThan(stopFrom.after.offset);
  });
  expect(first.report?.status).toBe("ended");
  expect(first.companion.completeEvidence).toBe(true);
  expect(first.report?.events.some(event => event.type === "microphone.detector_window")).toBe(true);
  expect(first.companion.records.some(record => record.name === "sayFixture" && record.kind === "cancelled")).toBe(
    true,
  );
  expect(first.companion.records.some(record => record.name === "interrupt" && record.kind === "end")).toBe(true);
  expect(first.report?.events).toEqual((await harness.observer.report())?.events);
  const stamps = first.companion.records.filter(record => record.atMs !== null);
  expect(stamps.every(record => record.atMs! >= 0 && record.atMs! < 30_000)).toBe(true);
  expect(stamps.find(record => record.name === "parentStop" && record.kind === "start")!.atMs).toBeLessThanOrEqual(
    first.report!.events.find(event => event.type === "lesson.ended")!.atMs,
  );
  const originalEvents = structuredClone(first.report?.events);
  const second = await harness.run("restart", async child => {
    await child.parentStart();
    await child.waitForNode("count-1-duck");
    await child.parentStop();
    await child.waitForSessionEnd();
  });
  expect(second.report?.runtimeId).not.toBe(first.report?.runtimeId);
  expect(first.report?.events).toEqual(originalEvents);
  expect(info.attachments.filter(attachment => attachment.name.endsWith("report.json"))).toHaveLength(2);
  const saved = JSON.parse(
    await readFile(info.attachments.find(attachment => attachment.name.endsWith("report.json"))!.path!, "utf8"),
  );
  expect(saved).toEqual(first.report);
  await harness.dispose();
  expect((await harness.microphone.state()).disposed).toBe(true);
});

test("intentional assertion failure retains original error, report, companion and merged timeline", async ({
  page,
}, info) => {
  const harness = await installChildScenarios(page, info);
  await page.route("**/api/live", route => route.fulfill({ status: 502, json: { error: "local failure" } }));
  await page.goto("/");
  const original = new Error("intentional assertion sentinel");
  await expect(
    harness.run("intentional failure", async child => {
      await child.parentStart();
      await child.waitForSessionEnd();
      await child.assert("wrong node expectation", async () => {
        throw original;
      });
    }),
  ).rejects.toBe(original);
  expect(info.attachments).toHaveLength(3);
  const companion = JSON.parse(
    await readFile(info.attachments.find(item => item.name.endsWith("harness.json"))!.path!, "utf8"),
  );
  expect(companion.failure).toBe(original.message);
  expect(companion.finalState.status).toBe("ended");
  expect(
    companion.records.some(
      (record: { name: string; kind: string }) => record.name === "assert" && record.kind === "failure",
    ),
  ).toBe(true);
  const timeline = await readFile(info.attachments.find(item => item.name.endsWith("timeline.txt"))!.path!, "utf8");
  expect(timeline).toContain("runtime lesson.ended");
  expect(timeline).toContain("intentional assertion sentinel");
});

test("page destruction marks incomplete evidence and cleanup failure without replacing assertion", async ({
  page,
}, info) => {
  const harness = await installChildScenarios(page, info);
  await page.route("**/api/live", route => route.fulfill({ status: 502, json: { error: "local failure" } }));
  await page.goto("/");
  const original = new Error("original failure before destruction");
  await expect(
    harness.run("destroyed page", async child => {
      await child.parentStart();
      await child.waitForSessionEnd();
      await page.close();
      throw original;
    }),
  ).rejects.toBe(original);
  const companion = JSON.parse(
    await readFile(info.attachments.find(item => item.name.endsWith("harness.json"))!.path!, "utf8"),
  );
  expect(companion.completeEvidence).toBe(false);
  expect(companion.failure).toBe(original.message);
  expect(companion.problems.join("\n")).toContain("incomplete production evidence");
  expect(companion.problems.join("\n")).toContain("cleanup");
});

test("attachment failure still collects companion evidence and preserves the original assertion", async ({
  page,
}, info) => {
  let rejectAttachment = true;
  const harness = await installChildScenarios(page, {
    outputPath: (...segments) => info.outputPath(...segments),
    attach: async (name, options) => {
      if (rejectAttachment) {
        rejectAttachment = false;
        throw new Error("attachment sentinel");
      }
      return info.attach(name, options);
    },
  });
  await page.route("**/api/live", route => route.fulfill({ status: 502, json: { error: "local failure" } }));
  await page.goto("/");
  const original = new Error("assertion remains primary");
  await expect(
    harness.run("attachment failure", async child => {
      await child.parentStart();
      await child.waitForSessionEnd();
      throw original;
    }),
  ).rejects.toBe(original);
  const companion = JSON.parse(
    await readFile(info.attachments.find(item => item.name.endsWith("harness.json"))!.path!, "utf8"),
  );
  expect(companion.failure).toBe(original.message);
  expect(companion.problems.join("\n")).toContain("attachment sentinel");
  expect(companion.completeEvidence).toBe(false);
  expect(info.attachments.some(item => item.name.endsWith("report.json-fallback"))).toBe(true);
});
