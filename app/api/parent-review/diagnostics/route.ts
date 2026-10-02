import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { isLocalRequest, readJsonBody } from "../../../../lib/local-request";
import { diagnosticPage, validDiagnosticRequest } from "../../../../lib/parent-review-diagnostics";

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ error: "Local requests only." }, { status: 403 });
  const body = await readJsonBody(request, 16_384);
  if (!body.ok || !validDiagnosticRequest(body.value))
    return Response.json({ error: "Invalid diagnostic request." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const capability = process.env.OBSERVER_SERVER_CAPABILITY;
  if (!url || !capability)
    return Response.json({ error: "Review server configuration is unavailable." }, { status: 503 });
  try {
    const input = body.value;
    const result = await new ConvexHttpClient(url).action(api.parent_review_action.readDiagnostics, {
      capability,
      sessionId: input.sessionId as Id<"sessions">,
      snapshotId: input.snapshotId as Id<"observerDiagnosticAttempts">,
      paginationOpts: { numItems: input.numItems, cursor: input.cursor },
    });
    if (typeof result !== "string" || new TextEncoder().encode(result).length > 2_000_000) throw new Error();
    return Response.json(diagnosticPage(JSON.parse(result), input), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Diagnostics could not be loaded. Refresh to try again." }, { status: 409 });
  }
}
