import { NextResponse, type NextRequest } from "next/server";
import { hasAccessCookie, isLoopbackHost } from "@/lib/access";

/**
 * Sends visitors of a hosted Sprout to the family passcode page until they have unlocked it. This is only the
 * page redirect; each API route enforces access itself (lib/access.ts), so skipping this proxy grants nothing.
 */
export async function proxy(request: NextRequest) {
  if (isLoopbackHost(request) || (await hasAccessCookie(request))) return NextResponse.next();
  const unlock = request.nextUrl.clone();
  unlock.pathname = "/unlock";
  unlock.search = "";
  unlock.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(unlock, 307);
}

export const config = {
  // Pages only: not API routes (they answer 403 themselves), the passcode page, Next assets or public files.
  matcher: ["/((?!api/|unlock|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|wav|ico)$).*)"],
};
