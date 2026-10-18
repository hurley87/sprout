import { isLocalRequest, readJsonBody } from "@/lib/local-request";

export const runtime = "nodejs";
const json = (body: object, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ error: "Open Sprout in its local browser window." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Expected a JSON request." }, 415);
  const body = await readJsonBody(request, 256);
  if (!body.ok) return json({ error: "Invalid session request." }, body.tooLarge ? 413 : 400);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value) || Object.keys(body.value).length)
    return json({ error: "Session request must be an empty object." }, 400);
  if (!process.env.XAI_API_KEY) return json({ error: "Set XAI_API_KEY on this computer and restart Sprout." }, 503);
  try {
    const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { seconds: 60 } }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      cache: "no-store",
    });
    if (!response.ok)
      return json({ error: "xAI could not authorize voice. Check the key and voice model access." }, 502);
    const result = await response.json();
    if (
      typeof result.value !== "string" ||
      !result.value ||
      !Number.isFinite(result.expires_at) ||
      result.expires_at <= Date.now() / 1000
    )
      throw new Error("Invalid credential response");
    // Allowlist the ephemeral credential only. Never forward or log provider bodies.
    return json({ value: result.value, expires_at: result.expires_at }, 201);
  } catch {
    return json({ error: "The voice authorization request failed. Please try again." }, 502);
  }
}
