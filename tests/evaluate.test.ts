import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/evaluate/route";
import { ANSWER_QUESTION, ANSWER_QUESTION_ID, MAX_UTTERANCE_CHARS, fetchEvaluateAnswer } from "../lib/answer";
import { JEV_MODEL, answerState } from "../lib/jev";
import { SCENES, sceneAt } from "../lib/lesson";

const request = (body: unknown, origin = "http://localhost:3000", host = "localhost:3000") =>
  new Request("http://localhost:3000/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin, host },
    body: JSON.stringify(body),
  });
const answered = (noul: unknown, model = "jev-1.13.0") =>
  vi.fn(async () => Response.json({ model, answers: { [ANSWER_QUESTION_ID]: { type: "noul", noul } } }));
const ask = { sceneIndex: 0, utterance: "One!" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local answer evaluation endpoint", () => {
  it("rejects anything but the local browser window before spending a call", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request(ask, "https://other.test"))).status).toBe(403);
    expect((await POST(request(ask, "http://127.0.0.1:3000"))).status).toBe(403);
    const wrongType = new Request("http://localhost:3000/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "text/plain", origin: "http://localhost:3000", host: "localhost:3000" },
      body: "{}",
    });
    expect((await POST(wrongType)).status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { sceneIndex: 0 },
    { sceneIndex: -1, utterance: "One!" },
    { sceneIndex: SCENES.length, utterance: "One!" },
    { sceneIndex: 1.5, utterance: "One!" },
    { sceneIndex: "0", utterance: "One!" },
    { sceneIndex: 0, utterance: "   " },
    { sceneIndex: 0, utterance: 4 },
    { sceneIndex: 0, utterance: "x".repeat(MAX_UTTERANCE_CHARS + 1) },
  ])("rejects out-of-range input %j", async body => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("limits request size", async () => {
    expect((await POST(request({ sceneIndex: 0, utterance: "x".repeat(5000) }))).status).toBe(413);
  });
  it("explains missing setup without reaching the provider", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const response = await POST(request(ask));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("TYPESAFE_API_KEY");
  });
  it("asks the pinned model one Noul question about the displayed scene", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetch = answered(0.93);
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request({ sceneIndex: 2, utterance: "  One, two, three!  " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ probability: 0.93, model: "jev-1.13.0" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-test-key");
    expect(JSON.parse(init.body as string)).toEqual({
      model: JEV_MODEL,
      state: answerState(sceneAt(2), "One, two, three!"),
      questions: { [ANSWER_QUESTION_ID]: ANSWER_QUESTION },
    });
  });
  it("sends only the displayed scene and the recent utterance", () => {
    const state = answerState(sceneAt(2), "One, two, three!");
    expect(state).toEqual({
      displayed: { object: "butterflies", quantity: 3, description: "3 butterflies" },
      learnerUtterance: "One, two, three!",
    });
  });
  it.each([undefined, null, "0.9", 1.4, -0.1, Number.NaN])(
    "refuses an unusable probability %j rather than guessing",
    async noul => {
      vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
      vi.stubGlobal("fetch", answered(noul));
      expect((await POST(request(ask))).status).toBe(502);
    },
  );
  it("does not leak provider errors or retry a paid call", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetch = vi.fn(async () => new Response("sensitive provider detail", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request(ask));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("sensitive");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("treats an unreachable provider as no answer", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect((await POST(request(ask))).status).toBe(502);
  });
});

describe("browser side of the evaluation seam", () => {
  const signal = () => new AbortController().signal;
  it("reports a usable probability with its latency", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ probability: 0.91, model: "jev-1.13.0" })),
    );
    const result = await fetchEvaluateAnswer(ask, signal());
    expect(result).toMatchObject({ status: "evaluated", probability: 0.91, model: "jev-1.13.0" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it.each([
    ["an error status", vi.fn(async () => Response.json({ error: "no" }, { status: 502 })), "http_502"],
    ["an unreadable body", vi.fn(async () => Response.json({ probability: "high" })), "unreadable_answer"],
    ["a failed request", vi.fn().mockRejectedValue(new Error("offline")), "request_failed"],
  ])("treats %s as no answer rather than a wrong one", async (_name, fetch, reason) => {
    vi.stubGlobal("fetch", fetch);
    expect(await fetchEvaluateAnswer(ask, signal())).toMatchObject({ status: "unavailable", reason });
  });
  it("stops waiting when the lesson cancels the question", async () => {
    const cancel = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }),
    );
    const pending = fetchEvaluateAnswer(ask, cancel.signal);
    cancel.abort();
    expect(await pending).toMatchObject({ status: "unavailable", reason: "cancelled" });
  });
});
