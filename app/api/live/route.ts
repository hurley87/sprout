import { LIVE_CONFIG } from "@/lib/lesson";
import { isLocalRequest, readJsonBody } from "@/lib/local-request";

export const runtime = "nodejs";
const LIMIT = 65_536;
const json = (body: object, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ error: "Start Sprout from its local browser window." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Invalid session request." }, 415);
  const body = await readJsonBody(request, LIMIT);
  if (!body.ok)
    return json(
      { error: body.tooLarge ? "Session request is too large." : "Invalid session request." },
      body.tooLarge ? 413 : 400,
    );
  const sdp = (body.value as { sdp?: unknown } | null)?.sdp;
  if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > LIMIT)
    return json({ error: "Invalid microphone connection offer." }, 400);
  if (!process.env.OPENAI_API_KEY)
    return json(
      {
        error:
          "Sprout needs OPENAI_API_KEY configured on this computer. Ask the parent to set it up and restart the server.",
      },
      503,
    );
  try {
    const response = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: LIVE_CONFIG, transport: { type: "webrtc", sdp } }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) {
      // Provider bodies can contain sensitive context; never send or log them.
      return json(
        {
          error:
            response.status === 401 || response.status === 403
              ? "OpenAI could not authorize GPT-Live-1. Ask the parent to check the API key and model access."
              : "Sprout could not connect to the voice service. Please try a new lesson later.",
        },
        502,
      );
    }
    const result = await response.json();
    if (typeof result.session?.id !== "string" || typeof result.transport?.sdp !== "string")
      throw new Error("Invalid response");
    return json({ session: { id: result.session.id }, transport: { type: "webrtc", sdp: result.transport.sdp } }, 201);
  } catch {
    return json(
      { error: "The voice connection did not finish. Please try a new lesson when the connection is available." },
      502,
    );
  }
}
