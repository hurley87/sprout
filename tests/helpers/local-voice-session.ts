import type { Page } from "@playwright/test";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";

type LocalPeer = {
  peer: RTCPeerConnection;
  tone: OscillatorNode;
  level: GainNode;
  destination: MediaStreamAudioDestinationNode;
  channel?: RTCDataChannel;
};
export type LocalSessionWindow = LessonObservationWindow & {
  peers: LocalPeer[];
  peerContext: AudioContext;
  currentPeer: LocalPeer;
  appPeerCloseCount: number;
  steeringContents: string[];
  holdSupportAck?: boolean;
  acceptOffer(sdp: string): Promise<string>;
  sendTranscript(type: "session.input_transcript.delta" | "session.output_transcript.delta", delta: string): void;
};

export async function installLocalSession(page: Page) {
  await page.addInitScript(() => {
    const host = window as LessonObservationWindow;
    host.__SPROUT_OBSERVE_LESSON__ = true;
    const browser = window as unknown as LocalSessionWindow;
    browser.peers = [];
    browser.peerContext = new AudioContext();
    browser.appPeerCloseCount = 0;
    browser.steeringContents = [];
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
          if (command.type === "session.instructions.append") {
            browser.steeringContents.push(command.content);
            // Catch scene-context expansion before a live provider rejects it.
            if (new TextEncoder().encode(command.content).length > 2000) {
              source.channel!.send(
                JSON.stringify({ type: "error", error: { code: "invalid_value", client_event_id: command.event_id } }),
              );
              return;
            }
            if (browser.holdSupportAck && command.event_id.includes(":support:")) return;
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
  await page.route("**/api/assess", route =>
    route.fulfill({ status: 503, json: { error: "Fixture assessment unavailable" } }),
  );
}
