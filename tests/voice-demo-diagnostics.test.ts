import { describe, expect, it } from "vitest";
import { scrubSecrets } from "../components/voice-demo/diagnostics";

describe("shared voice diagnostic export boundary", () => {
  it("scrubs sensitive keys recursively without changing the lesson's payload", () => {
    const payload = {
      lesson: { id: "example", sceneId: "question-1" },
      acceptedEvidence: { explanation: { status: "demonstrated" } },
      transcript: "Learner: My explanation.",
      events: [{ detail: { count: 1, authorization: "private", nested: [{ api_key: "private", ok: true }] } }],
    };
    const before = structuredClone(payload);
    expect(scrubSecrets(payload)).toEqual({
      ...payload,
      events: [{ detail: { count: 1, nested: [{ ok: true }] } }],
    });
    expect(payload).toEqual(before);
  });

  it.each([
    "secret",
    "credential",
    "Authorization",
    "apiKey",
    "api_key",
    "sdp",
    "rawBody",
    "provider_body",
    "accessToken",
  ])("removes %s fields from arbitrary lesson diagnostics", key => {
    expect(scrubSecrets({ diagnostics: [{ [key]: "private", atMs: 0 }], error: null })).toEqual({
      diagnostics: [{ atMs: 0 }],
      error: null,
    });
  });
});
