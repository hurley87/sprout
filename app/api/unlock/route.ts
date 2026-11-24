import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_S,
  configuredPasscode,
  createAccessToken,
  isSameSecureOrigin,
  passcodeMatches,
  safeNextPath,
} from "@/lib/access";
import { isLocalRequest } from "@/lib/local-request";

export const runtime = "nodejs";
const LIMIT = 2_048;
const FAILURE_DELAY_MS = 600;

const redirect = (location: string, cookie?: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) },
  });

/** The passcode form posts here; success sets the signed access cookie and returns to the requested page. */
export async function POST(request: Request) {
  const secure = isSameSecureOrigin(request);
  if (!secure && !isLocalRequest(request)) return new Response(null, { status: 403 });
  const text = await request.text().catch(() => "");
  const form = new URLSearchParams(text.length <= LIMIT ? text : "");
  const next = safeNextPath(form.get("next"));
  const passcode = configuredPasscode();
  if (!passcode) return redirect(`/unlock?error=unconfigured&next=${encodeURIComponent(next)}`);
  if (!(await passcodeMatches(form.get("passcode") ?? "", passcode))) {
    // Slow guessing a little; there is no shared store for per-client rate limits.
    await new Promise(resolve => setTimeout(resolve, FAILURE_DELAY_MS));
    return redirect(`/unlock?error=wrong&next=${encodeURIComponent(next)}`);
  }
  const token = await createAccessToken(passcode);
  return redirect(
    next,
    `${ACCESS_COOKIE}=${token}; Path=/; Max-Age=${ACCESS_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
}
