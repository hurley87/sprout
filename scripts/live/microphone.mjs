/** Playwright init script: only this test page receives a synthetic microphone. */
export function installSyntheticMicrophone() {
  const media = navigator.mediaDevices;
  const original = media.getUserMedia.bind(media);
  const context = new AudioContext({ sampleRate: 48000 });
  const destination = context.createMediaStreamDestination();
  // Keep the graph rendering silence between utterances; never connect to speakers.
  const silence = context.createConstantSource();
  silence.offset.value = 0;
  silence.connect(destination);
  silence.start();
  let closed = false;
  let active;
  let queue = Promise.resolve();
  const record = (action, extra = {}) => {
    window.__liveLog?.push({ dir: "child", action, at: window.__liveNow(), ...extra });
  };
  media.getUserMedia = async constraints => {
    if (!constraints?.audio) return original(constraints);
    if (closed) throw new Error("Synthetic microphone is closed");
    if (constraints.video) throw new Error("Synthetic microphone supports audio-only capture");
    await context.resume();
    if (context.state !== "running") throw new Error("Synthetic microphone AudioContext did not start");
    return destination.stream;
  };
  window.__liveMic = {
    play(bytes) {
      const task = queue.then(async () => {
        if (closed) throw new Error("Synthetic microphone is closed");
        await context.resume();
        if (closed || context.state !== "running" || destination.stream.getAudioTracks()[0].readyState !== "live")
          throw new Error("Synthetic microphone is unavailable");
        const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
        if (closed) throw new Error("Synthetic microphone is closed");
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        await new Promise((resolve, reject) => {
          const finish = error => {
            source.onended = null;
            source.disconnect();
            active = null;
            if (error) reject(error);
            else resolve();
          };
          active = () => {
            source.stop();
            finish(new Error("Synthetic microphone closed during playback"));
          };
          source.onended = () => {
            record("playback-end");
            finish();
          };
          record("playback-start", {
            durationMs: buffer.duration * 1000,
            trackId: destination.stream.getAudioTracks()[0].id,
          });
          source.start();
        });
      });
      queue = task.catch(() => {});
      return task;
    },
    async close() {
      if (closed) return;
      closed = true;
      media.getUserMedia = original;
      active?.();
      silence.stop();
      silence.disconnect();
      destination.stream.getTracks().forEach(track => track.stop());
      destination.disconnect();
      await context.close();
      await queue;
    },
  };
}

export async function setupSyntheticMicrophone(page) {
  await page.addInitScript(installSyntheticMicrophone);
  return () => page.evaluate(() => window.__liveMic?.close());
}
