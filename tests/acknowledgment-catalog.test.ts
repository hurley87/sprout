import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ACKNOWLEDGMENTS,
  ACKNOWLEDGMENT_VARIANTS,
  acknowledgmentFor,
  preloadAcknowledgments,
} from "../lib/acknowledgment-catalog";
import { SCENES, LAST_SCENE } from "../lib/lesson";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("pins exactly one reviewed finite English Marin clip per advancing scene and finalizes bounded PCM WAV bytes", async () => {
  expect(ACKNOWLEDGMENTS.map(a => a.sceneId)).toEqual(SCENES.slice(0, LAST_SCENE).map(s => s.id));
  const create = vi.spyOn(URL, "createObjectURL");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) => new Response(await readFile(`public${url}`), { headers: { "Content-Type": "audio/wav" } }),
    ),
  );
  const urls = await preloadAcknowledgments(new AbortController().signal);
  expect(urls.size).toBe(LAST_SCENE * 2);
  for (const asset of ACKNOWLEDGMENTS) {
    expect(asset.render).toMatchObject({ model: "gpt-4o-mini-tts", voice: "marin", language: "en" });
    expect(asset.contentReview.transcript).toBe(asset.text);
    URL.revokeObjectURL(urls.get(asset.id)!);
  }
  for (const asset of ACKNOWLEDGMENT_VARIANTS) {
    expect(asset.render).toMatchObject({ model: "gpt-4o-mini-tts", voice: "marin", language: "en" });
    expect(asset.contentReview.transcript.replace(/[^a-z0-9]/gi, "").toLowerCase()).toBe(
      asset.text.replace(/[^a-z0-9]/gi, "").toLowerCase(),
    );
    const bytes = await readFile(`public${asset.url}`);
    const wav = new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect([
      wav.getUint32(0),
      wav.getUint32(8),
      wav.getUint16(20, true),
      wav.getUint16(22, true),
      wav.getUint32(24, true),
    ]).toEqual([0x52494646, 0x57415645, 1, 1, 24000]);
    URL.revokeObjectURL(urls.get(asset.id)!);
  }
  expect(create).toHaveBeenCalledTimes(LAST_SCENE * 2);
});

it("varies the actual finite asset by answer identity and keeps retries on the same reviewed choice", () => {
  for (let sceneIndex = 0; sceneIndex < LAST_SCENE; sceneIndex++) {
    const seen = new Set([
      acknowledgmentFor(sceneIndex, "lesson-trial-a").id,
      acknowledgmentFor(sceneIndex, "lesson-trial-b").id,
    ]);
    expect(seen.size).toBe(2);
    expect(acknowledgmentFor(sceneIndex, "lesson-trial-a")).toBe(acknowledgmentFor(sceneIndex, "lesson-trial-a"));
  }
});
it("rejects missing or substituted catalog bytes before startup and revokes partial preloads", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  let count = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      ++count === 1 ? new Response(await readFile(`public${url}`)) : new Response(new Uint8Array([1, 2, 3])),
    ),
  );
  await expect(preloadAcknowledgments(new AbortController().signal)).rejects.toThrow();
  expect(revoke).toHaveBeenCalledOnce();
});
it("does not fetch after startup cancellation", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const abort = new AbortController();
  abort.abort();
  await expect(preloadAcknowledgments(abort.signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
