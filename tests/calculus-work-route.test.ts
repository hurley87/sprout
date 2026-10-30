import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/calculus-work/route";
import { EXTRACTION_LIMITS } from "../lib/calculus/work-extraction";

const input = () => ({
  problemId: "cubic-minus-linear",
  learnerTurns: [{ id: "learner_1", text: "four x becomes four" }],
  tutorTurns: [],
});
const request = (body: unknown = input(), headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/calculus-work", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const reply = (text: string) =>
  Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("returns the checked extraction without caching", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  const output = {
    steps: [{ stepId: "d-linear", expression: { op: "number", value: 4 }, quote: "becomes four" }],
    rule: null,
    final: null,
    unclear: null,
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(JSON.stringify(output))));
  vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValue(375);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    status: "ok",
    extraction: output,
    timing: { extractionMs: 275 },
  });
});

it("returns a timed 504 when the server budget expires during model extraction", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const transport = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", transport);
  const pending = POST(request());
  await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
  expect(timeout).toHaveBeenCalledWith(EXTRACTION_LIMITS.timeoutMs);
  controller.abort();
  const response = await pending;
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({ status: "timeout", timing: { extractionMs: expect.any(Number) } });
});

it("enforces local JSON requests and a valid body", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  expect((await POST(request(input(), { origin: "https://example.com" }))).status).toBe(403);
  expect((await POST(request(input(), { "content-type": "text/plain" }))).status).toBe(415);
  expect((await POST(request({ ...input(), problemId: "nope" }))).status).toBe(400);
});

it("reports a missing key and provider failures distinctly", async () => {
  expect(await (await POST(request())).json()).toEqual({ status: "unavailable" });
  vi.stubEnv("OPENAI_API_KEY", "secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
  const failed = await POST(request());
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ status: "provider-failure", timing: { extractionMs: expect.any(Number) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("not json")));
  expect(await (await POST(request())).json()).toEqual({
    status: "provider-failure",
    timing: { extractionMs: expect.any(Number) },
  });
});
