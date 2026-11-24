import { put } from "@vercel/blob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/sessions/route";
import { ACCESS_COOKIE, createAccessToken } from "../lib/access";
import { sessionBlobPath, sessionSavingEnabled } from "../lib/session-store";

vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

const passcode = "sprout-test-passcode";
const origin = "https://sprout.example.com";
const input = {
  lessonId: "dino-car-crunch",
  runtimeId: "3f0c7a58-6c6b-4c08-a863-4c37fbf85129",
  report: { events: [{ kind: "lesson-started" }] },
};
const now = new Date("2026-11-23T23:04:05.678-05:00");
const request = (body = JSON.stringify(input), headers: Record<string, string> = {}) =>
  new Request(`${headers.origin ?? "http://localhost:3000"}/api/sessions`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    body,
  });

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.stubEnv("SPROUT_SAVE_SESSIONS", undefined);
    vi.stubEnv("SPROUT_PASSCODE", passcode);
  });

  afterEach(() => {
    vi.mocked(put).mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("rejects a remote request without the access cookie", async () => {
    const response = await POST(request(undefined, { host: "sprout.example.com", origin }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Use the local Sprout window, or enter the family passcode.",
      code: "local_request_rejected",
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("requires JSON content type", async () => {
    const response = await POST(request(undefined, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  it.each([
    ["malformed JSON", "{"],
    ["a non-object body", "null"],
    ["a missing report", JSON.stringify({ lessonId: input.lessonId, runtimeId: input.runtimeId })],
    ["an unknown lesson", JSON.stringify({ ...input, lessonId: "unknown" })],
    ["a runtime ID with a slash", JSON.stringify({ ...input, runtimeId: "runtime/id" })],
    ["a runtime ID with dots", JSON.stringify({ ...input, runtimeId: ".." })],
    ["an array report", JSON.stringify({ ...input, report: [] })],
    ["a null report", JSON.stringify({ ...input, report: null })],
    ["extra keys", JSON.stringify({ ...input, extra: true })],
  ])("rejects %s", async (_description, body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a JSON body over 4,000,000 bytes", async () => {
    const response = await POST(request(JSON.stringify({ ...input, report: { text: "é".repeat(2_000_000) } })));
    expect(response.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns an empty response when saving is disabled", async () => {
    const response = await POST(request());
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(put).not.toHaveBeenCalled();
  });

  it("saves only the report to private Blob for an unlocked hosted request", async () => {
    vi.stubEnv("SPROUT_SAVE_SESSIONS", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.setSystemTime(now);
    const cookie = `${ACCESS_COOKIE}=${await createAccessToken(passcode)}`;
    const response = await POST(
      request(undefined, {
        host: "sprout.example.com",
        origin,
        cookie,
        "content-type": "application/json; charset=utf-8",
      }),
    );
    const pathname = `sessions/preview/${input.lessonId}/2026-11-24/04-04-05-${input.runtimeId}.json`;

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ saved: true, pathname });
    expect(put).toHaveBeenCalledExactlyOnceWith(pathname, JSON.stringify(input.report, null, 2), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  });

  it("returns a generic storage error when Blob rejects the upload", async () => {
    vi.stubEnv("SPROUT_SAVE_SESSIONS", "1");
    vi.mocked(put).mockRejectedValueOnce(new Error(JSON.stringify(input.report)));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Could not save the session.", code: "storage_failed" });
    expect(log).toHaveBeenCalledExactlyOnceWith("Could not save the Sprout session to Blob.");
  });
});

describe("session store helpers", () => {
  it("enables saving only for the exact configured value", () => {
    expect(sessionSavingEnabled({ SPROUT_SAVE_SESSIONS: "1" })).toBe(true);
    expect(sessionSavingEnabled({ SPROUT_SAVE_SESSIONS: "true" })).toBe(false);
    expect(sessionSavingEnabled({})).toBe(false);
  });

  it.each([
    ["production", "production"],
    ["preview", "preview"],
    ["development", "development"],
    ["../unknown", "development"],
    [undefined, "development"],
  ])("formats the UTC pathname for VERCEL_ENV=%s", (deployment, expected) => {
    const env = { VERCEL_ENV: deployment };
    const { lessonId, runtimeId } = input;
    expect(sessionBlobPath({ env, lessonId, runtimeId, now })).toBe(
      `sessions/${expected}/${lessonId}/2026-11-24/04-04-05-${runtimeId}.json`,
    );
  });

  it("rejects unsafe path segments", () => {
    const env = {};
    expect(() => sessionBlobPath({ env, lessonId: "../lesson", runtimeId: input.runtimeId, now })).toThrow();
    expect(() => sessionBlobPath({ env, lessonId: input.lessonId, runtimeId: "runtime/id", now })).toThrow();
  });
});
