import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { INTERPRETATION_LIMITS, parseMathInterpretationInput } from "@/lib/calculus/math-interpretation-contract";
import { createResponsesMathProvider, interpretMath } from "@/lib/calculus/math-interpreter";

export const runtime = "nodejs";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ disposition: "malformed", batch: null }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return json({ disposition: "malformed", batch: null }, 415);
  // Bound body reading as well as provider I/O, including a stalled local client.
  const timeout = AbortSignal.timeout(INTERPRETATION_LIMITS.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);
  if (signal.aborted) return json({ disposition: "cancelled", batch: null }, 499);
  const body = await readJsonBody(
    { body: request.body?.pipeThrough(new TransformStream(), { signal }) } as Request,
    INTERPRETATION_LIMITS.bytes,
  );
  if (!body || signal.aborted)
    return json({ disposition: timeout.aborted ? "timeout" : "cancelled", batch: null }, timeout.aborted ? 504 : 499);
  if (!body.ok) return json({ disposition: "malformed", batch: null }, body.tooLarge ? 413 : 400);
  let input;
  try {
    input = parseMathInterpretationInput(body.value);
  } catch {
    return json({ disposition: "malformed", batch: null }, 400);
  }
  if (!process.env.OPENAI_API_KEY) return json({ disposition: "unavailable", batch: null }, 503);
  const result = await interpretMath(input, createResponsesMathProvider(process.env.OPENAI_API_KEY), { signal });
  const disposition = timeout.aborted ? "timeout" : result.disposition;
  return json(
    timeout.aborted ? { disposition, batch: null } : result,
    disposition === "timeout"
      ? 504
      : disposition === "cancelled"
        ? 499
        : disposition === "provider-failure"
          ? 502
          : disposition === "malformed"
            ? 502
            : 200,
  );
}
