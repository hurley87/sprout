import { describe, expect, it } from "vitest";
import { countingScene } from "../app/counting-scenes";
import { COUNTING_LESSON, COUNTING_LESSON_GRAPH, COUNTING_NODE_IDS } from "../lib/lesson-runtime/counting-lesson";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";

const NUMBER_WORDS = ["one", "two", "three", "four"];

describe("authored counting adventure (static, not GPT-Live conversational quality)", () => {
  it.each(COUNTING_NODE_IDS)("%s brief never states its own total", id => {
    const node = COUNTING_LESSON_GRAPH[id];
    const total = new RegExp(`\\b(?:${NUMBER_WORDS[node.quantity - 1]}|${node.quantity})\\b`, "i");
    expect(node.tutorBrief).not.toMatch(total);
    expect(node.tutorBrief.length).toBeLessThanOrEqual(320);
    expect(node.tutorBrief.match(/\?/g)).toHaveLength(1);
    expect(node.tutorBrief).not.toMatch(/earlier|previous|before|same|again|still/i);
    expect(countingScene(node).objects).toHaveLength(node.quantity);
  });

  it("varies the task and story opening across scenes", () => {
    const openings = COUNTING_NODE_IDS.map(id => COUNTING_LESSON_GRAPH[id].tutorBrief.split(":")[0]);
    expect(openings).toEqual([
      "Meet the duck",
      "A friend arrives",
      "Butterfly garden",
      "Help the ducklings",
      "Flowers bloom",
      "Butterflies move",
    ]);
    const firstSentences = COUNTING_NODE_IDS.map(id => COUNTING_LESSON_GRAPH[id].tutorBrief.split(". ")[0]);
    expect(new Set(firstSentences).size).toBe(COUNTING_NODE_IDS.length);
  });

  it("invites pointing on the ducklings scene without claiming it was observed", () => {
    const brief = COUNTING_LESSON_GRAPH["count-3-ducklings"].tutorBrief;
    expect(brief).toContain("invite pointing to each duckling");
  });

  it("scaffolds the four-flower scene in small steps without rushing", () => {
    const brief = COUNTING_LESSON_GRAPH["count-4-flowers"].tutorBrief;
    expect(brief).toContain("Give extra time");
  });

  it("asks for a fresh recount of the moved butterflies without hinting it is unchanged", () => {
    const brief = COUNTING_LESSON_GRAPH["count-3-moved-butterflies"].tutorBrief;
    expect(brief).not.toMatch(/same|again|before|still/i);
  });

  it("keeps the start instruction recognisable and has Sprout speak first", () => {
    // Session instructions tell GPT-Live to stay quiet until "the application's start instruction".
    expect(COUNTING_LESSON.tutor.startInstruction).toContain("This is the application's start instruction");
    expect(COUNTING_LESSON.tutor.startInstruction).toContain("do not wait for the child to speak first");
  });

  it("avoids canned praise in authored counting instructions", () => {
    const text = JSON.stringify({
      tutor: COUNTING_LESSON.tutor,
      recovery: COUNTING_LESSON.recovery,
      briefs: COUNTING_NODE_IDS.map(id => COUNTING_LESSON_GRAPH[id].tutorBrief),
    });
    expect(text).not.toMatch(/good job|great job|that's right/i);
  });

  it.each(COUNTING_NODE_IDS)("projects only %s facts to the tutor, never edges or other scenes", id => {
    const context = JSON.stringify(currentNodeContext(COUNTING_LESSON, id));
    expect(context).not.toContain("onSuccess");
    for (const other of COUNTING_NODE_IDS.filter(other => other !== id)) {
      expect(context).not.toContain(`"${other}"`);
      expect(context).not.toContain(COUNTING_LESSON_GRAPH[other].sceneId);
    }
  });
});
