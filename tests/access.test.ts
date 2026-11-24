import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_S,
  configuredPasscode,
  createAccessToken,
  isAllowedRequest,
  passcodeMatches,
  safeNextPath,
  verifyAccessToken,
} from "../lib/access";
import { POST as unlock } from "../app/api/unlock/route";
import { POST as live } from "../app/api/live/route";
import { POST as classify } from "../app/api/classify/route";
import { POST as assess } from "../app/api/assess/route";
import { POST as mathScribe } from "../app/api/math-scribe/route";
import { POST as calculusWork } from "../app/api/calculus-work/route";
import { proxy } from "../proxy";

const PASSCODE = "rex-loves-cars";
const HOST = "sprout.example.com";
const NOW = Date.UTC(2026, 10, 23);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const apiRequest = (
  path: string,
  { origin = `https://${HOST}`, host = HOST, cookie }: { origin?: string; host?: string; cookie?: string } = {},
) =>
  new Request(`https://${HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin,
      host,
      ...(cookie ? { cookie: `theme=dark; ${ACCESS_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify({ sdp: "v=0\r\n", lessonId: "dino-car-crunch" }),
  });

const form = (fields: Record<string, string>, origin = `https://${HOST}`) =>
  new Request(`https://${HOST}/api/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", origin, host: HOST },
    body: new URLSearchParams(fields).toString(),
  });

describe("access tokens", () => {
  it("accepts its own unexpired token and rejects tampering, expiry and other passcodes", async () => {
    const token = await createAccessToken(PASSCODE, NOW);
    expect(await verifyAccessToken(token, PASSCODE, NOW)).toBe(true);
    expect(await verifyAccessToken(token, PASSCODE, NOW + ACCESS_MAX_AGE_S * 1000)).toBe(false);
    expect(await verifyAccessToken(token, "another-passcode", NOW)).toBe(false);
    const [expiry, signature] = token.split(".");
    expect(await verifyAccessToken(`${Number(expiry) + 999}.${signature}`, PASSCODE, NOW)).toBe(false);
    expect(await verifyAccessToken(`${expiry}.${signature.slice(0, -1)}A`, PASSCODE, NOW)).toBe(false);
    for (const junk of [undefined, "", "abc", `${expiry}.`, `.${signature}`])
      expect(await verifyAccessToken(junk, PASSCODE, NOW)).toBe(false);
  });
  it("matches the passcode exactly, ignoring surrounding spaces", async () => {
    expect(await passcodeMatches(` ${PASSCODE} `, PASSCODE)).toBe(true);
    expect(await passcodeMatches("rex-loves-car", PASSCODE)).toBe(false);
    expect(await passcodeMatches("", PASSCODE)).toBe(false);
  });
  it("requires a passcode of at least six characters", () => {
    expect(configuredPasscode(undefined)).toBeUndefined();
    expect(configuredPasscode(" 12345 ")).toBeUndefined();
    expect(configuredPasscode(" 123456 ")).toBe("123456");
  });
  it.each([
    ["/dinos?debug=1", "/dinos?debug=1"],
    ["/", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["/api/live", "/"],
    ["dinos", "/"],
    [undefined, "/"],
  ])("returns only to same-site pages: %j", (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });
});

describe("hosted API access", () => {
  it("keeps remote access closed without a configured passcode, even with a cookie", async () => {
    vi.stubEnv("SPROUT_PASSCODE", "");
    const cookie = await createAccessToken(PASSCODE);
    expect(await isAllowedRequest(apiRequest("/api/live", { cookie }))).toBe(false);
  });
  it("allows same-origin HTTPS requests with a valid cookie and nothing else", async () => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    const cookie = await createAccessToken(PASSCODE);
    expect(await isAllowedRequest(apiRequest("/api/live", { cookie }))).toBe(true);
    expect(await isAllowedRequest(apiRequest("/api/live"))).toBe(false);
    expect(await isAllowedRequest(apiRequest("/api/live", { cookie: await createAccessToken("old-passcode") }))).toBe(
      false,
    );
    expect(await isAllowedRequest(apiRequest("/api/live", { cookie, origin: "https://evil.example" }))).toBe(false);
    expect(await isAllowedRequest(apiRequest("/api/live", { cookie, origin: `http://${HOST}` }))).toBe(false);
  });
  it("still allows the local browser window without a passcode", async () => {
    vi.stubEnv("SPROUT_PASSCODE", "");
    expect(
      await isAllowedRequest(apiRequest("/api/live", { origin: "http://localhost:3000", host: "localhost:3000" })),
    ).toBe(true);
  });
  it.each([
    ["live", live],
    ["classify", classify],
    ["assess", assess],
    ["math-scribe", mathScribe],
    ["calculus-work", calculusWork],
  ] as const)("/api/%s refuses remote requests without the cookie before calling a provider", async (_name, route) => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await route(apiRequest("/api/x"))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("lets an unlocked remote request through the live route's guard", async () => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await live(apiRequest("/api/live", { cookie: await createAccessToken(PASSCODE) }));
    // 503 means it passed access and stopped at the missing provider key.
    expect(response.status).toBe(503);
  });
});

describe("unlock", () => {
  it("sets a secure, HttpOnly cookie and returns to the requested page", async () => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    const response = await unlock(form({ passcode: PASSCODE, next: "/dinos?debug=1" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dinos?debug=1");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^${ACCESS_COOKIE}=\\d+\\.[\\w-]{43}; Path=/; Max-Age=${ACCESS_MAX_AGE_S};`));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    const token = cookie.split(";")[0].split("=")[1];
    expect(await verifyAccessToken(token, PASSCODE)).toBe(true);
  });
  it("rejects a wrong passcode without a cookie", async () => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    const started = performance.now();
    const response = await unlock(form({ passcode: "guess", next: "/dinos" }));
    expect(performance.now() - started).toBeGreaterThanOrEqual(550);
    expect(response.headers.get("location")).toBe("/unlock?error=wrong&next=%2Fdinos");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("explains a missing passcode setting and never redirects off-site", async () => {
    vi.stubEnv("SPROUT_PASSCODE", "");
    const response = await unlock(form({ passcode: "anything", next: "//evil.example" }));
    expect(response.headers.get("location")).toBe("/unlock?error=unconfigured&next=%2F");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("refuses cross-site form posts", async () => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    const response = await unlock(form({ passcode: PASSCODE }, "https://evil.example"));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("page proxy", () => {
  const page = (url: string, cookie?: string) =>
    new NextRequest(url, {
      headers: { host: new URL(url).host, ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}) },
    });

  it("sends locked visitors to the passcode page and remembers where they were going", async () => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    const response = await proxy(page(`https://${HOST}/dinos?debug=1`));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/unlock");
    expect(location.searchParams.get("next")).toBe("/dinos?debug=1");
  });
  it("lets unlocked visitors and the local window through", async () => {
    vi.stubEnv("SPROUT_PASSCODE", PASSCODE);
    expect(
      (await proxy(page(`https://${HOST}/dinos`, await createAccessToken(PASSCODE)))).headers.get("location"),
    ).toBeNull();
    expect((await proxy(page("http://localhost:3000/dinos"))).headers.get("location")).toBeNull();
  });
});
