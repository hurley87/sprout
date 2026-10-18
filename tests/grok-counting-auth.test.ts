import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/experiments/grok-counting/route";
const request = (body = "{}", headers = {}) =>
  new Request("http://127.0.0.1:3000/api/experiments/grok-counting", {
    method: "POST",
    body,
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each([
  ["{}", { origin: "https://evil.example" }, 403],
  ["{}", { host: "evil.example" }, 403],
  ["{}", { origin: "" }, 403],
  ["{}", { "content-type": "text/plain" }, 415],
  ["invalid", {}, 400],
  ["[]", {}, 400],
  ["null", {}, 400],
  ['{"model":"arbitrary"}', {}, 400],
  [" ".repeat(257), {}, 413],
] as const)("rejects invalid authentication boundary requests", async (body, headers, status) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request(body, headers))).status).toBe(status);
  expect(fetch).not.toHaveBeenCalled();
});
it("reports missing key without calling the provider", async () => {
  vi.stubEnv("XAI_API_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request())).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});
it("returns only a short-lived credential with no caching", async () => {
  vi.stubEnv("XAI_API_KEY", "server-test-secret");
  const expires_at = Math.floor(Date.now() / 1000) + 60;
  const fetch = vi.fn(async () => Response.json({ value: "ephemeral-test", expires_at, private: "do-not-forward" }));
  vi.stubGlobal("fetch", fetch);
  const result = await POST(request());
  expect(result.status).toBe(201);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toEqual({ value: "ephemeral-test", expires_at });
  expect(fetch.mock.calls[0]).toMatchObject([
    "https://api.x.ai/v1/realtime/client_secrets",
    {
      headers: { Authorization: "Bearer server-test-secret" },
      body: JSON.stringify({ expires_after: { seconds: 60 } }),
    },
  ]);
});
it.each([
  Response.json({ error: "sensitive-provider-body" }, { status: 401 }),
  Response.json({ value: "expired", expires_at: 1 }),
  Response.json({ value: "invalid" }),
])("sanitizes unsuccessful or malformed provider responses", async response => {
  vi.stubEnv("XAI_API_KEY", "server-test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
  const result = await POST(request());
  expect(result.status).toBe(502);
  expect(await result.text()).not.toMatch(/sensitive-provider-body|server-test-secret|expired/);
});
it("sanitizes network errors", async () => {
  vi.stubEnv("XAI_API_KEY", "server-test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("private");
    }),
  );
  expect((await POST(request())).status).toBe(502);
});
