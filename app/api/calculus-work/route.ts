import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import {
  EXTRACTION_LIMITS,
  createResponsesWorkProvider,
  extractWork,
  parseWorkExtractionInput,
  type WorkExtractionResult,
} from "@/lib/calculus/work-extraction";

export const runtime = "nodejs";
const STATUS: Record<WorkExtractionResult["status"], number> = {
  ok: 200,
  timeout: 504,
  cancelled: 499,
  "provider-failure": 502,
  malformed: 502,
  unavailable: 503,
};
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ status: "malformed" }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return json({ status: "malformed" }, 415);
  // Bound body reading as well as provider I/O, including a stalled local client.
  const timeout = AbortSignal.timeout(EXTRACTION_LIMITS.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);
  if (signal.aborted) return json({ status: "cancelled" }, STATUS.cancelled);
  const body = await readJsonBody(
    { body: request.body?.pipeThrough(new TransformStream(), { signal }) } as Request,
    EXTRACTION_LIMITS.bytes,
  );
  if (!body || signal.aborted) {
    const status = timeout.aborted ? "timeout" : "cancelled";
    return json({ status }, STATUS[status]);
  }
  if (!body.ok) return json({ status: "malformed" }, body.tooLarge ? 413 : 400);
  let input;
  try {
    input = parseWorkExtractionInput(body.value);
  } catch {
    return json({ status: "malformed" }, 400);
  }
  if (!process.env.OPENAI_API_KEY) return json({ status: "unavailable" }, STATUS.unavailable);
  const result = await extractWork(input, createResponsesWorkProvider(process.env.OPENAI_API_KEY), { signal });
  const final = timeout.aborted ? { status: "timeout" as const } : result;
  return json(final, STATUS[final.status]);
}
