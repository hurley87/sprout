import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { isLocalRequest, readJsonBody } from "../../../lib/local-request";
import { validReviewCommand } from "../../../lib/parent-review";

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ error: "Local requests only." }, { status: 403 });
  const body = await readJsonBody(request, 16_384);
  if (!body.ok || !validReviewCommand(body.value))
    return Response.json({ error: "Invalid review request." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const capability = process.env.OBSERVER_SERVER_CAPABILITY;
  if (!url || !capability)
    return Response.json({ error: "Review server configuration is unavailable." }, { status: 503 });
  try {
    const result = await new ConvexHttpClient(url).action(api.parent_review_action.request, {
      capability,
      command: JSON.stringify(body.value),
    });
    return Response.json(body.value.operation === "get" ? JSON.parse(result) : { saved: result === "saved" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Review request could not be confirmed. Refresh saved state before retrying." },
      { status: 409 },
    );
  }
}
