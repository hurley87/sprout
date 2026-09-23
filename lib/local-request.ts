const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// This unauthenticated prototype is deliberately restricted to loopback. Next
// normalizes request.url to "localhost", so the browser-sent Host header is
// checked instead; it also rejects DNS-rebound hostnames.
export function isLocalRequest(request: Request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !origin) return false;
  try {
    const hostUrl = new URL(`http://${host}`);
    const originUrl = new URL(origin);
    return LOOPBACK.has(hostUrl.hostname) && originUrl.protocol === "http:" && originUrl.host === hostUrl.host;
  } catch {
    return false;
  }
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; tooLarge: boolean };

/** Reads a JSON body, refusing to buffer more than `limit` bytes. */
export async function readJsonBody(request: Request, limit: number): Promise<JsonBody> {
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("missing body");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}
