import { isLocalRequest } from "./local-request";

/**
 * Family passcode access for a hosted Sprout. Locally (loopback) nothing changes. Elsewhere, entering the
 * server-configured SPROUT_PASSCODE sets a signed, HttpOnly cookie; API routes then accept only same-origin
 * requests that carry it. With no passcode configured, remote access stays closed.
 */
export const ACCESS_COOKIE = "sprout_access";
export const ACCESS_MAX_AGE_S = 30 * 24 * 60 * 60;
const MIN_PASSCODE_LENGTH = 6;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const encoder = new TextEncoder();

/** The configured passcode, or undefined when unset or too short to be safe. */
export function configuredPasscode(value = process.env.SPROUT_PASSCODE): string | undefined {
  const passcode = value?.trim();
  return passcode && passcode.length >= MIN_PASSCODE_LENGTH ? passcode : undefined;
}

async function sign(passcode: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return btoa(String.fromCharCode(...signature))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Equal-length comparison without an early exit, so a mismatch's position is not observable. */
function same(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Compare via HMAC digests so the comparison time does not depend on the passcode's characters. */
export async function passcodeMatches(input: string, passcode: string): Promise<boolean> {
  return same(await sign(passcode, `passcode:${input.trim()}`), await sign(passcode, `passcode:${passcode}`));
}

/** `<expiry seconds>.<signature>`; signed with the passcode, so changing the passcode signs everyone out. */
export async function createAccessToken(passcode: string, nowMs = Date.now()): Promise<string> {
  const expiry = Math.floor(nowMs / 1000) + ACCESS_MAX_AGE_S;
  return `${expiry}.${await sign(passcode, `access:${expiry}`)}`;
}

export async function verifyAccessToken(
  token: string | undefined,
  passcode: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const match = token?.match(/^(\d{1,12})\.([\w-]{43})$/);
  if (!match || Number(match[1]) * 1000 <= nowMs) return false;
  return same(match[2], await sign(passcode, `access:${match[1]}`));
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** Page requests carry no Origin header; locally only the Host is checked. */
export function isLoopbackHost(request: Request) {
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return LOOPBACK.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** A browser request from this site's own HTTPS page (blocks cross-site use of the cookie). */
export function isSameSecureOrigin(request: Request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !origin) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === "https:" && originUrl.host === host;
  } catch {
    return false;
  }
}

export async function hasAccessCookie(request: Request, passcode = configuredPasscode()): Promise<boolean> {
  return !!passcode && (await verifyAccessToken(readCookie(request, ACCESS_COOKIE), passcode));
}

/** API guard: the local browser window as before, or a same-origin request with a valid access cookie. */
export async function isAllowedRequest(request: Request): Promise<boolean> {
  if (isLocalRequest(request)) return true;
  return isSameSecureOrigin(request) && (await hasAccessCookie(request));
}

/** A same-site path to return to after unlocking; anything else falls back to the home page. */
export function safeNextPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])[^\s]*$/.test(value) && !value.startsWith("/api/") ? value : "/";
}
