import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/math-action/route";

const input = () => ({
  identity: {
    runtimeId: "r1",
    problemId: "cubic-minus-linear",
    visitId: "v1",
    transcriptRevision: 1,
    baseBoardRevision: 0,
  },
  learnerTurns: [{ id: "u1", text: "Help me" }],
  tutorContext: [],
  board: [],
  latestUndoableStepId: null,
});
const request = (body: unknown = input(), headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/math-action", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const reply = () =>
  Response.json({
    status: "completed",
    model: "gpt-6-luna",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ actions: [{ kind: "help", sources: [{ turnId: "u1", quote: "Help me" }] }] }),
          },
        ],
      },
    ],
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("local math-action endpoint", () => {
  it("serves isolated review-required proposals without caching", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret");
    const transport = vi.fn().mockResolvedValue(reply());
    vi.stubGlobal("fetch", transport);
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      disposition: "help",
      review: "required",
      batch: { identity: input().identity },
    });
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each<Record<string, string>>([{ origin: "http://evil.test" }, { host: "evil.test" }, { origin: "" }])(
    "rejects nonlocal requests before I/O",
    async headers => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      expect((await POST(request(input(), headers))).status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rejects content types, unknown problems, extra keys, invalid JSON and oversized bodies", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(request(input(), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ ...input(), extra: true }))).status).toBe(400);
    expect((await POST(request({ ...input(), identity: { ...input().identity, problemId: "other" } }))).status).toBe(
      400,
    );
    expect((await POST(request({ text: "x".repeat(65536) }))).status).toBe(413);
    const r = request();
    expect((await POST(new Request(r, { body: "{" }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports missing credentials without making a request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ disposition: "unavailable", batch: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sanitizes provider errors and invalid output", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret raw body")));
    let r = await POST(request());
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          status: "completed",
          model: "gpt-6-luna",
          output: [{ type: "message", content: [{ type: "output_text", text: '{"actions":[]}' }] }],
        }),
      ),
    );
    r = await POST(request());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ disposition: "malformed", batch: null });
  });
  it("honors cancellation before I/O and while reading a stalled body", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const c = new AbortController();
    c.abort();
    expect((await POST(new Request(request(), { signal: c.signal }))).status).toBe(499);
    const c2 = new AbortController();
    const cancel = vi.fn();
    const r = new Request("http://localhost:3000/api/math-action", {
      method: "POST",
      headers: request().headers,
      body: new ReadableStream({ cancel }),
      signal: c2.signal,
      duplex: "half",
    } as RequestInit);
    const pending = POST(r);
    c2.abort();
    expect((await pending).status).toBe(499);
    expect(cancel).toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("discards a cancelled provider call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret");
    const c = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        c.abort();
        return reply();
      }),
    );
    const r = await POST(new Request(request(), { signal: c.signal }));
    expect(r.status).toBe(499);
    expect(await r.json()).toEqual({ disposition: "cancelled", batch: null });
  });
});

it("times out a stalled request body without provider I/O", async () => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const cancelled = vi.fn();
  const r = new Request("http://localhost:3000/api/math-action", {
    method: "POST",
    headers: request().headers,
    body: new ReadableStream({ cancel: cancelled }),
    duplex: "half",
  } as RequestInit);
  const pending = POST(r);
  deadline.abort();
  const result = await pending;
  expect(result.status).toBe(504);
  expect(await result.json()).toEqual({ disposition: "timeout", batch: null });
  expect(cancelled).toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
