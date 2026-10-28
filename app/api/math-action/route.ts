import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import {
  INTERPRETATION_LIMITS,
  parseMathInterpretationInput,
  type MathInterpretationResult,
} from "@/lib/calculus/math-interpretation-contract";
import { createResponsesMathProvider, interpretMath } from "@/lib/calculus/math-interpreter";

export const runtime = "nodejs";
const STATUS: Partial<Record<MathInterpretationResult["disposition"], number>> = {
  timeout: 504,
  cancelled: 499,
  "provider-failure": 502,
  malformed: 502,
  unavailable: 503,
};
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ disposition: "malformed", batch: null }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return json({ disposition: "malformed", batch: null }, 415);
  // Bound body reading as well as provider I/O, including a stalled local client.
  const timeout = AbortSignal.timeout(INTERPRETATION_LIMITS.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);
  if (signal.aborted) return json({ disposition: "cancelled", batch: null }, STATUS.cancelled);
  const body = await readJsonBody(
    { body: request.body?.pipeThrough(new TransformStream(), { signal }) } as Request,
    INTERPRETATION_LIMITS.bytes,
  );
  if (!body || signal.aborted) {
    const disposition = timeout.aborted ? "timeout" : "cancelled";
    return json({ disposition, batch: null }, STATUS[disposition]);
  }
  if (!body.ok) return json({ disposition: "malformed", batch: null }, body.tooLarge ? 413 : 400);
  let input;
  try {
    input = parseMathInterpretationInput(body.value);
  } catch {
    return json({ disposition: "malformed", batch: null }, 400);
  }
  if (!process.env.OPENAI_API_KEY) return json({ disposition: "unavailable", batch: null }, STATUS.unavailable);
  const result = await interpretMath(input, createResponsesMathProvider(process.env.OPENAI_API_KEY), { signal });
  const disposition = timeout.aborted ? "timeout" : result.disposition;
  return json(timeout.aborted ? { disposition, batch: null } : result, STATUS[disposition] ?? 200);
}
