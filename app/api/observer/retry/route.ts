import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { isLocalRequest, readJsonBody } from "../../../../lib/local-request";

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ error: "Local requests only." }, { status: 403 });
  const body = await readJsonBody(request, 2048);
  if (
    !body.ok ||
    !body.value ||
    typeof body.value !== "object" ||
    typeof (body.value as { sessionId?: unknown }).sessionId !== "string"
  )
    return Response.json({ error: "Invalid request." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const capability = process.env.OBSERVER_SERVER_CAPABILITY;
  if (!url || !capability)
    return Response.json({ error: "Observer server configuration is unavailable." }, { status: 503 });
  try {
    const client = new ConvexHttpClient(url);
    const status = await client.action(api.observer_action.requestAnalysis, {
      sessionId: (body.value as { sessionId: string }).sessionId as never,
      capability,
    });
    return Response.json({ status });
  } catch {
    return Response.json({ error: "Observer retry could not be scheduled." }, { status: 409 });
  }
}
