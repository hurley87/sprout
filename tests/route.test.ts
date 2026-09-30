import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/live/route";
import { LIVE_CONFIG, replacementSessionInput } from "../lib/lesson";

const request = (body: unknown = { sdp: "v=0\r\n" }, origin = "http://localhost:3000", host = "localhost:3000") =>
  new Request("http://localhost:3000/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin, host },
    body: JSON.stringify(body),
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("local Live session endpoint", () => {
  it("rejects foreign origins before calling the provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request({}, "https://other.test"))).status).toBe(403);
    expect((await POST(request({}, "http://localhost:4000"))).status).toBe(403);
    expect((await POST(request({}, "http://127.0.0.1:3000"))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects public hosting and DNS-rebound hosts even with a matching origin", async () => {
    const req = new Request("https://sprout.example/api/live", {
      method: "POST",
      headers: { origin: "https://sprout.example", host: "sprout.example" },
    });
    expect((await POST(req)).status).toBe(403);
    // Next reports request.url as localhost regardless of the Host header.
    expect((await POST(request({}, "http://rebind.test:3000", "rebind.test:3000"))).status).toBe(403);
    expect((await POST(request({}, "http://localhost:3000", ""))).status).toBe(403);
  });
  it.each([
    ["127.0.0.1:3100", "http://127.0.0.1:3100"],
    ["localhost:3000", "http://localhost:3000"],
    ["[::1]:3000", "http://[::1]:3000"],
  ])("accepts the loopback address the page was served from (%s)", async (host, origin) => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await POST(request(undefined, origin, host))).status).toBe(503);
  });
  it.each([null, {}, { sdp: 2 }, { sdp: "junk" }])("rejects invalid input %j", async body => {
    expect((await POST(request(body))).status).toBe(400);
  });
  it("limits request size including bodies with no content-length", async () => {
    expect((await POST(request({ sdp: "v=0" + "x".repeat(70_000) }))).status).toBe(413);
  });
  it("explains missing setup without sending credentials to the browser", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("OPENAI_API_KEY");
  });
  it("uses exactly GPT-Live-1 with client delegation and returns only SDP/session ID", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    const fetch = vi.fn(async () =>
      Response.json({ session: { id: "live_test", private: "omit" }, transport: { sdp: "answer" }, secret: "omit" }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      session: { id: "live_test" },
      transport: { type: "webrtc", sdp: "answer" },
    });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://api.openai.com/v1/live/sessions");
    expect(JSON.parse(calls[0][1].body as string).session).toEqual(LIVE_CONFIG);
    expect(LIVE_CONFIG.delegation).toEqual({ type: "client" });
  });
  it("does not leak provider errors or retry paid creation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    const fetch = vi.fn(async () => new Response("sensitive provider detail", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("sensitive");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("handles network and malformed success failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect((await POST(request())).status).toBe(502);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    expect((await POST(request())).status).toBe(502);
  });
});

const seed = { sceneIndex: 2, evaluatedSceneIndex: 1, decision: "ADVANCE" as const, childUtterance: "Two" };
it.each(["ADVANCE", "STAY", "UNAVAILABLE"] as const)(
  "seeds %s with only canonical config plus generated history",
  async decision => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    const fetch = vi.fn(async () => Response.json({ session: { id: "B" }, transport: { sdp: "answer" } }));
    vi.stubGlobal("fetch", fetch);
    const replacement = { ...seed, decision, evaluatedSceneIndex: decision === "ADVANCE" ? 1 : 2 };
    expect((await POST(request({ sdp: "v=0", replacement }))).status).toBe(201);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      session: { ...LIVE_CONFIG, input: replacementSessionInput(replacement) },
      transport: { type: "webrtc", sdp: "v=0" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  },
);
it.each(["instructions", "model", "voice", "session", "input", "audio", "delegation", "store"])(
  "rejects arbitrary %s at both request and seed boundaries",
  async key => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request({ sdp: "v=0", [key]: "injected" }))).status).toBe(400);
    expect((await POST(request({ sdp: "v=0", replacement: seed, [key]: "injected" }))).status).toBe(400);
    expect((await POST(request({ sdp: "v=0", replacement: { ...seed, [key]: "injected" } }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each([
  null,
  {},
  [],
  { ...seed, sceneIndex: -1 },
  { ...seed, sceneIndex: 999 },
  { ...seed, sceneIndex: 1.5 },
  { ...seed, sceneIndex: "2" },
  { ...seed, sceneIndex: 0 },
  { ...seed, evaluatedSceneIndex: 2 },
  { ...seed, decision: "RIGHT" },
  { ...seed, childUtterance: 1 },
  { ...seed, childUtterance: " " },
  { ...seed, childUtterance: "x".repeat(1001) },
  { ...seed, childUtterance: "Two\u0000" },
])("rejects invalid seed %j before billing", async replacement => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request({ sdp: "v=0", replacement }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
