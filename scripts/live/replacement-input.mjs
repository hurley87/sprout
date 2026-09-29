/** Browser-only experiment helpers; never used by the production microphone. */
export function replacementMicrophone(context, mode) {
  if (mode !== "silent" && mode !== "continuous") throw new Error("Unknown experiment microphone mode");
  const destination = context.createMediaStreamDestination();
  let oscillator;
  let gain;
  if (mode === "continuous") {
    oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 440;
    gain = context.createGain();
    gain.gain.value = 0.001;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
  }
  return {
    stream: destination.stream,
    mode,
    frequencyHz: oscillator ? 440 : null,
    amplitude: gain ? 0.001 : 0,
    close() {
      oscillator?.stop();
      oscillator?.disconnect();
      gain?.disconnect();
      destination.stream.getTracks().forEach(track => track.stop());
      destination.disconnect();
    },
  };
}

/** Keep native RTCStats timestamps separate from performance.now observations. */
export async function outboundMicrophoneRtp(peer, label) {
  const sender = peer.getSenders().find(candidate => candidate.track?.kind === "audio");
  if (!sender) throw new Error("No audio RTCRtpSender for replacement");
  const report = await sender.getStats();
  const reports = [...report.values()]
    .filter(stat => stat.type === "outbound-rtp" && (stat.kind ?? stat.mediaType) === "audio")
    .map(stat => ({
      id: stat.id,
      timestamp: stat.timestamp,
      packetsSent: stat.packetsSent,
      bytesSent: stat.bytesSent,
    }));
  const sum = key =>
    reports.length && reports.every(stat => Number.isFinite(stat[key]))
      ? reports.reduce((total, stat) => total + stat[key], 0)
      : null;
  return { label, sampledAt: performance.now(), reports, packetsSent: sum("packetsSent"), bytesSent: sum("bytesSent") };
}

export function microphoneRtpDeltas(snapshots) {
  return snapshots.slice(1).map((after, index) => {
    const before = snapshots[index];
    const delta = key => (before[key] === null || after[key] === null ? null : after[key] - before[key]);
    return {
      from: before.label,
      to: after.label,
      elapsedMs: after.sampledAt - before.sampledAt,
      packetsSent: delta("packetsSent"),
      bytesSent: delta("bytesSent"),
    };
  });
}
