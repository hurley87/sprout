import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/math-scribe/route";
import { SCRIBE_LIMITS } from "../lib/math-scribe/interpretation";

const input = {
  workingLatex: "x",
  baseLatex: "x",
  pendingStatus: "none",
  learnerTurns: [{ id: "l", text: "yes" }],
  tutorTurns: [],
};
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/math-scribe", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("checks local requests, content, size, and configuration", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  expect((await POST(request(input, { origin: "https://example.com" }))).status).toBe(403);
  expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
  expect((await POST(request({ ...input, learnerTurns: [] }))).status).toBe(400);
  expect((await POST(request({ ...input, padding: "x".repeat(SCRIBE_LIMITS.bytes) }))).status).toBe(413);
  expect((await POST(request())).status).toBe(503);
});
it("returns validated output and reports provider errors", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: '{"interpretations":[]}' }] }],
      }),
    ),
  );
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    status: "ok",
    interpretations: [],
    timing: { extractionMs: expect.any(Number) },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
  expect((await POST(request())).status).toBe(502);
});
it("times out stalled providers", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  const pending = POST(request());
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  controller.abort();
  expect((await pending).status).toBe(504);
});
