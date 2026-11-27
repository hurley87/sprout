import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as live } from "../app/api/live/route";
import { POST as classify } from "../app/api/classify/route";
import { POST as assess } from "../app/api/assess/route";
import { POST as sessions } from "../app/api/sessions/route";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";
import {
  DOWN_THE_CHIMNEY_LESSON_PREFIX,
  DOWN_THE_CHIMNEY_NODE_IDS,
  downTheChimneyLesson,
  downTheChimneyLessonId,
  parseDownTheChimneyLessonId,
} from "../lib/lesson-runtime/down-the-chimney-lesson";
import { downTheChimneyPlan } from "../lib/lesson-runtime/down-the-chimney-plan";
import { lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";

describe("Down the Chimney lesson", () => {
  it("round-trips, validates and resolves all seeded definitions and their plan", () => {
    for (let seed = 0; seed < 100; seed++) {
      const id = downTheChimneyLessonId(seed);
      const lesson = downTheChimneyLesson(seed);
      expect(parseDownTheChimneyLessonId(id)).toBe(seed);
      expect(resolveLessonDefinition(id)).toBe(lesson);
      expect(downTheChimneyLesson(seed)).toBe(lesson);
      expect(validateLessonDefinition(lesson)).toBe(lesson);
      expect(lessonNodeOrder(lesson)).toEqual([...DOWN_THE_CHIMNEY_NODE_IDS]);
      expect(acceptsLearnerAnswerIndependently(lesson)).toBe(true);
      for (const [index, round] of downTheChimneyPlan(seed).rounds.entries()) {
        expect(lesson.nodes[DOWN_THE_CHIMNEY_NODE_IDS[index]].presentation).toEqual({
          sceneId: "down-the-chimney",
          answerKind: "count",
          answer: round.count,
          quantity: round.count,
          object: "present",
          objects: "presents",
          round: round.round,
          step: round.step,
        });
      }
    }
  });
  it.each(["-0", "00", "07", "100", " 1", "+1", "1.0", "", "1 ", "1e0"])("rejects noncanonical suffix %j", suffix => {
    const id = DOWN_THE_CHIMNEY_LESSON_PREFIX + suffix;
    expect(parseDownTheChimneyLessonId(id)).toBeNull();
    expect(resolveLessonDefinition(id)).toBeNull();
    expect(acceptsLearnerAnswerIndependently({ ...downTheChimneyLesson(0), id })).toBe(false);
  });
  it("rejects invalid seeds and non-string IDs", () => {
    expect(parseDownTheChimneyLessonId(1)).toBeNull();
    for (const seed of [-1, 100, 1.5, NaN, Infinity]) expect(() => downTheChimneyLesson(seed)).toThrow(RangeError);
  });
  it("sets count-along and recovery options and provides private, quiet guidance", () => {
    const lesson = downTheChimneyLesson(0);
    expect(lesson).toMatchObject({
      countAlong: true,
      trackDifficulties: true,
      answerAcceptance: "learner_evidence",
      spokenNumberCheck: true,
      addressLearnerByName: true,
      transitionQuietMs: 1500,
      successHoldMs: 5000,
    });
    expect(lesson).not.toHaveProperty("silenceNudges");
    expect(lesson).not.toHaveProperty("replyNudge");
    const copy = Object.values(lesson.tutor).join(" ");
    expect(copy).toContain("first round only");
    expect(copy).toContain("During the drops stay completely silent");
    expect(copy).toContain("stop before the last number");
    expect(copy).toContain("Never say too high or too low");
    expect(copy).toContain("final number of her finished count");
    expect(copy).not.toMatch(/\b(?:one|two|three|four|five) presents\b/i);
  });
});

const request = (route: string, body: object) =>
  new Request(`http://localhost:3000/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllEnvs());
it("allowlists valid lesson IDs for live, classify and sessions and rejects noncanonical IDs", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubEnv("SPROUT_SAVE_SESSIONS", "");
  const lessonId = downTheChimneyLessonId(42);
  const invalidId = `${DOWN_THE_CHIMNEY_LESSON_PREFIX}07`;
  expect((await live(request("live", { lessonId, sdp: "v=0" }))).status).toBe(503);
  expect((await live(request("live", { lessonId: invalidId, sdp: "v=0" }))).status).toBe(400);
  for (const nodeId of DOWN_THE_CHIMNEY_NODE_IDS) {
    const body = { lessonId, nodeId, transcript: "Child: hello", transcriptRevision: 1 };
    expect((await classify(request("classify", body))).status).toBe(503);
    expect((await classify(request("classify", { ...body, lessonId: invalidId }))).status).toBe(400);
  }
  const body = { lessonId, runtimeId: "3f0c7a58-6c6b-4c08-a863-4c37fbf85129", report: {} };
  expect((await sessions(request("sessions", body))).status).toBe(204);
  expect((await sessions(request("sessions", { ...body, lessonId: invalidId }))).status).toBe(400);
});
it("assessment rejects counting lessons under its conversation-first contract", async () => {
  const visits = [{ nodeId: "chimney-1", visitId: 1, transcript: "Child: one" }];
  expect((await assess(request("assess", { lessonId: downTheChimneyLessonId(42), visits }))).status).toBe(400);
  expect((await assess(request("assess", { lessonId: `${DOWN_THE_CHIMNEY_LESSON_PREFIX}07`, visits }))).status).toBe(
    400,
  );
});
