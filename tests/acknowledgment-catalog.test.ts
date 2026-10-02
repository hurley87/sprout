import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { ACKNOWLEDGMENTS, preloadAcknowledgments } from "../lib/acknowledgment-catalog";
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
  expect(urls.size).toBe(LAST_SCENE);
  for (const asset of ACKNOWLEDGMENTS) {
    expect(asset.render).toMatchObject({ model: "gpt-4o-mini-tts", voice: "marin", language: "en" });
    expect(asset.contentReview.transcript).toBe(asset.text);
    URL.revokeObjectURL(urls.get(asset.id)!);
  }
  expect(create).toHaveBeenCalledTimes(LAST_SCENE);
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
