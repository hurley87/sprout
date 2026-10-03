/** Records data-channel events, displayed scenes, and UI activity. */
export function recordLiveTraffic() {
  const log = [];
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  window.__liveLog = log;
  window.__liveNow = at;
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      channel.addEventListener("message", ({ data }) => {
        try {
          log.push({ at: at(), dir: "in", ...JSON.parse(data) });
        } catch {
          /* not JSON */
        }
      });
      const send = channel.send.bind(channel);
      channel.send = raw => {
        log.push({ at: at(), dir: "out", ...JSON.parse(raw) });
        send(raw);
      };
      return channel;
    }
  };
  let wasLive = false;
  new MutationObserver(() => {
    const live = [...document.querySelectorAll("button")].some(button => button.textContent?.trim() === "End lesson");
    if (live !== wasLive) {
      log.push({ at: at(), dir: "ui", live });
      wasLive = live;
    }
    const scene = document.querySelector("[data-scene]")?.getAttribute("data-scene") ?? null;
    if (log.findLast(e => e.dir === "scene")?.scene !== scene) log.push({ at: at(), dir: "scene", scene });
  }).observe(document, { subtree: true, childList: true, attributes: true });
}
