import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const { backendAction } = vi.hoisted(() => ({ backendAction: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = backendAction;
  },
}));

import { POST } from "../app/api/observer/retry/route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  backendAction.mockReset();
});

function request(sessionId: string, host = "127.0.0.1:3000") {
  return new Request(`http://${host}/api/observer/retry`, {
    method: "POST",
    headers: { host, origin: `http://${host}`, "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

it("requires the loopback route and backend capability, then idempotently starts saved-record analysis", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-provider-key");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const { sessionId, storageId } = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["synthetic recording"]));
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "pending",
      createdAt: 1,
      endedAt: 2,
      endingReason: "parent_stop",
      nextEventOrder: 0,
    });
    return { sessionId, storageId };
  });
  await t.mutation(api.sessions.attachRecording, {
    sessionId,
    storageId,
    mimeType: "audio/webm",
    startOffsetMs: 0,
    durationMs: 1000,
  });

  const providerFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("audio/transcriptions")) return Response.json({ text: "synthetic speech" });
    if (url.endsWith("/responses")) return Response.json({ status: "completed", output_text: '{"proposals":[]}' });
    return new Response(new Blob(["synthetic audio"], { type: "audio/webm" }), { status: 200 });
  });
  vi.stubGlobal("fetch", providerFetch);

  // Direct attachment is intentionally persistence-only; public RPC calls cannot supply a valid capability.
  vi.useFakeTimers();
  await t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
  expect(providerFetch).not.toHaveBeenCalled();
  expect(await t.query(api.observer.get, { sessionId })).toBeNull();
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "");
  await expect(
    t.action(api.observer_action.requestAnalysis, { sessionId, capability: "synthetic-capability" }),
  ).rejects.toThrow("authorization failed");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  await expect(t.action(api.observer_action.requestAnalysis, { sessionId, capability: "wrong" })).rejects.toThrow(
    "authorization failed",
  );
  expect(providerFetch).not.toHaveBeenCalled();

  backendAction.mockImplementation((fn, args) => t.action(fn, args));
  expect((await POST(request(sessionId, "observer.example:3000"))).status).toBe(403);
  expect(backendAction).not.toHaveBeenCalled();
  const scheduled = await POST(request(sessionId));
  expect(scheduled.status).toBe(200);
  expect(await scheduled.json()).toEqual({ status: "scheduled" });

  await t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
  vi.useRealTimers();
  expect(providerFetch).toHaveBeenCalledTimes(3);
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({ status: "ready", proposals: [] });

  const duplicate = await POST(request(sessionId));
  expect(await duplicate.json()).toEqual({ status: "ready" });
  expect(providerFetch).toHaveBeenCalledTimes(3);
});

it("fails closed when the server capability is not configured", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "");
  const response = await POST(request("session-id"));
  expect(response.status).toBe(503);
  expect(backendAction).not.toHaveBeenCalled();
});

it("keeps pending or unassembled records ineligible even after trusted authorization", async () => {
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const sessionId = await t.run(ctx =>
    ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "pending",
      createdAt: 1,
      endedAt: 2,
      endingReason: "parent_stop",
      nextEventOrder: 0,
    }),
  );
  const providerFetch = vi.fn();
  vi.stubGlobal("fetch", providerFetch);

  await expect(
    t.action(api.observer_action.requestAnalysis, { sessionId, capability: "synthetic-capability" }),
  ).rejects.toThrow("assembled saved recording");
  expect(providerFetch).not.toHaveBeenCalled();
  expect(await t.query(api.observer.get, { sessionId })).toBeNull();
});
