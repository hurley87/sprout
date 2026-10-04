/** Closed endpoint codes only; never export response text or exception messages. */
export const CLASSIFIER_ENDPOINT_CODES = [
  "local_request_rejected",
  "invalid_request",
  "unconfigured",
  "timeout",
  "cancelled",
  "internal_error",
] as const;

export function parseClassifierEndpointCode(body: unknown) {
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  return CLASSIFIER_ENDPOINT_CODES.find(code => code === body.code) ?? null;
}
