import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/assess/route";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { ASSESSMENT_VERSION, assessmentQuestions } from "../lib/lesson-runtime/conversation-assessment";
import { JEV_MODEL } from "../lib/jev";
const owner = { runtimeId: "route-test", generation: 1 };
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
function request(value: unknown = { lessonId: lesson.id, visits, owner }, host = "127.0.0.1:3000") {
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
it("sends all ordered answers for cumulative assessment and returns uncertain scores with bounded structured locator choices", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const answers = Object.fromEntries(
    Object.entries(assessmentQuestions(lesson, { ...owner, visits })).map(([id, question]) => [
      id,
      id.includes(":evidence_")
        ? {
            type: "choice",
            choice: "none",
            confidence: 1,
            probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === "none" ? 1 : 0])),
          }
        : id.endsWith(":understanding")
          ? {
              type: "choice",
              choice: "demonstrated",
              confidence: 0.6,
              probabilities: { not_yet: 0, partial: 0.4, demonstrated: 0.6 },
            }
          : {
              type: "choice",
              choice: "unclear",
              confidence: 1,
              probabilities: { independent: 0, prompted: 0, unclear: 1 },
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
  expect(sent.questions["exographics:visual-symbols:understanding"].instructions).toContain(
    "Do not require one learner utterance",
  );
  const body = await response.json();
  expect(body.assessment.version).toBe(ASSESSMENT_VERSION);
  expect(body.assessment.results["exographics:visual-symbols"].assistance.outcome).toBe("unclear");
  expect(body.assessment.results["exographics:visual-symbols"].understanding.outcome).toBe("uncertain");
  expect(body.assessment.results["exographics:visual-symbols"].understanding.scores.probabilities.demonstrated).toBe(
    0.6,
  );
});
it.each([
  { lessonId: lesson.id, visits: [{ ...visits[0], nodeId: "unknown" }] },
  { lessonId: lesson.id, visits: [visits[0], visits[0]] },
  { lessonId: lesson.id, visits: [{ ...visits[0], transcript: "unlabelled text" }] },
])("rejects invalid visit data before contacting a provider", async value => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect((await POST(request({ ...value, owner }))).status).toBe(400);
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
it.each([{ model: "wrong", answers: {} }, { model: JEV_MODEL, answers: {} }, null])(
  "reports invalid provider/model results as unavailable: %j",
  async result => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(result)),
    );
    expect((await POST(request())).status).toBe(502);
  },
);

it("rejects oversized reference sets without truncation or a provider call", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const large = [
    {
      nodeId: "engram",
      visitId: 1,
      transcript: Array.from({ length: 65 }, (_, i) => `Tutor: Question ${i}\nChild: Explanation ${i}`).join("\n"),
    },
  ];
  expect((await POST(request({ lessonId: lesson.id, visits: large, owner }))).status).toBe(422);
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([undefined, { runtimeId: "foreign", generation: 0 }, { runtimeId: "test", generation: 1, extra: "untrusted" }])(
  "requires closed valid snapshot ownership %j",
  invalidOwner => {
    return POST(request({ lessonId: lesson.id, visits, owner: invalidOwner })).then(response =>
      expect(response.status).toBe(400),
    );
  },
);
