import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesizeSpeech } from "./audio.mjs";

/** Serial speech synthesis and emission; no production events or transcripts are sent. */
export function createSimulatedChild({ page, synthesize = synthesizeSpeech }) {
  let queue = Promise.resolve();
  let closed = false;
  const controller = new AbortController();
  return {
    say(text) {
      if (typeof text !== "string" || !text.trim()) return Promise.reject(new Error("Speech must be nonempty text"));
      const task = queue.then(async () => {
        if (closed) throw new Error("Simulated child is closed");
        const dir = await mkdtemp(join(tmpdir(), "sprout-child-"));
        try {
          await page.evaluate(text => {
            window.__liveLog.push({ dir: "child", action: "synthesis-start", text, at: window.__liveNow() });
          }, text);
          const wav = join(dir, "speech.wav");
          await synthesize(text, wav, { signal: controller.signal });
          if (closed) throw new Error("Simulated child is closed");
          const bytes = Array.from(await readFile(wav));
          await page.evaluate(bytes => window.__liveMic.play(bytes), bytes);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      });
      queue = task.catch(() => {});
      return task;
    },
    async close() {
      closed = true;
      controller.abort();
      try {
        await page.evaluate(() => window.__liveMic?.close());
      } finally {
        await queue;
      }
    },
  };
}
