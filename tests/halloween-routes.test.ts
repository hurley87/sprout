import { afterEach, expect, it, vi } from "vitest";
import { POST as live } from "../app/api/live/route";
import { POST as classify } from "../app/api/classify/route";
import { COUNTING_HALLOWEEN_NODE_IDS } from "../lib/lesson-runtime/counting-halloween-lesson";

const request = (route: string, body: object) =>
  new Request(`http://localhost:3000/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(body),
  });

afterEach(() => vi.unstubAllEnvs());

it("allows Halloween live sessions but rejects unknown lessons", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  expect((await live(request("live", { lessonId: "counting-halloween", sdp: "v=0" }))).status).toBe(503);
  expect((await live(request("live", { lessonId: "unknown", sdp: "v=0" }))).status).toBe(400);
});

it("allows every Halloween node and rejects unknown or mismatched nodes", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  const input = { lessonId: "counting-halloween", nodeId: "", transcript: "Child: hello", transcriptRevision: 1 };
  for (const nodeId of COUNTING_HALLOWEEN_NODE_IDS)
    expect((await classify(request("classify", { ...input, nodeId }))).status).toBe(503);
  for (const fields of [
    { lessonId: "unknown", nodeId: COUNTING_HALLOWEEN_NODE_IDS[0] },
    { nodeId: "count-1-duck" },
    { nodeId: "unknown" },
  ])
    expect((await classify(request("classify", { ...input, ...fields }))).status).toBe(400);
});
