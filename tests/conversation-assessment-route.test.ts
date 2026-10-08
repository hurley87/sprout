import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/assess/route";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { assessmentQuestions } from "../lib/lesson-runtime/conversation-assessment";
import { JEV_MODEL } from "../lib/jev";
const visits = [
  {
    nodeId: "exographics",
    visitId: 4,
    transcript:
      "Tutor: What does it mean?\nChild: Visual marks represent information.\nTutor: Tell me more.\nChild: Math is a shared language for abstract ideas.",
  },
  {
    nodeId: "why-exographics",
    visitId: 5,
    transcript: "Child: Seeing those symbols also helps us reason about ideas.\nTutor: We can move on.",
  },
];
function request(value: unknown = { lessonId: lesson.id, visits }, host = "127.0.0.1:3000") {
  return new Request(`http://${host}/api/assess`, {
    method: "POST",
    headers: { host, origin: `http://${host}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("sends all ordered answers for cumulative assessment and returns uncertain scores without a locator requirement", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const answers = Object.fromEntries(
    Object.keys(assessmentQuestions(lesson)).map(id => [
      id,
      {
        type: "choice",
        choice: "demonstrated_independent",
        confidence: 0.6,
        probabilities: { not_yet: 0, partial: 0.4, demonstrated_independent: 0.6, demonstrated_prompted: 0 },
      },
    ]),
  );
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.method).toBe("POST");
    return Response.json({ model: JEV_MODEL, answers });
  });
  vi.stubGlobal("fetch", fetchMock);
  const response = await POST(request());
  expect(response.status).toBe(200);
  const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  expect(sent.state.conversation).toEqual(visits);
  expect(sent.questions["exographics:visual-symbols"].instructions).toContain("Do not require one learner utterance");
  const body = await response.json();
  expect(body.assessment.results["exographics:visual-symbols"].outcome).toBe("uncertain");
  expect(body.assessment.results["exographics:visual-symbols"].scores.probabilities.demonstrated_independent).toBe(0.6);
});
it.each([
  { lessonId: lesson.id, visits: [{ ...visits[0], nodeId: "unknown" }] },
  { lessonId: lesson.id, visits: [visits[0], visits[0]] },
  { lessonId: lesson.id, visits: [{ ...visits[0], transcript: "unlabelled text" }] },
])("rejects invalid visit data before contacting a provider", async value => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect((await POST(request(value))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps provider failure separate from conversation success", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  expect((await POST(request())).status).toBe(502);
  expect((await POST(request(undefined, "example.com"))).status).toBe(403);
});
