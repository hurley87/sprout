import { describe, expect, it } from "vitest";
import {
  latestChildColour,
  pickedColour,
  presentationColours,
  type SpokenColourOptions,
} from "../lib/lesson-runtime/spoken-colour";
import { WORDLESS_FRAGMENT_TRANSCRIPTS } from "./fixtures/wordless-child-fragments";

const aliases: Readonly<Record<string, string>> = { yellow: "gold", golden: "gold" };
const options: SpokenColourOptions = { answer: "purple", colours: ["gold", "pink", "purple"], aliases };
const read = (transcript: string, overrides: Partial<SpokenColourOptions> = {}) =>
  latestChildColour(transcript, { ...options, ...overrides });

describe("spoken colour reader", () => {
  it.each([
    ["purple", "purple", "purple"],
    ["the purple one!", "purple", "purple"],
    ["Purple.", "purple", "Purple"],
    ["PURPLE", "purple", "PURPLE"],
    ["It's the pink one", "pink", "pink"],
    ["gold", "gold", "gold"],
    ["yellow!", "gold", "yellow"],
    ["the golden one", "gold", "golden"],
    ["Yellow", "gold", "Yellow"],
  ])("reads %s", (speech, value, source) => {
    expect(read(`Tutor: Three!\nChild: ${speech}`)).toEqual({ status: "colour", value, source, owner: "child" });
  });

  it("matches whole words only", () => {
    expect(read("Child: pinkish purpleness").status).toBe("none");
    expect(read("Child: I read a book").status).toBe("none");
  });

  it("reads an off-screen colour as a (wrong) colour, not as nothing", () => {
    expect(read("Child: blue")).toMatchObject({ status: "colour", value: "blue", owner: "child" });
    expect(read("Child: the red one")).toMatchObject({ status: "colour", value: "red" });
  });

  it("reads yellow as itself when no alias maps it", () => {
    expect(read("Child: yellow", { aliases: {} })).toMatchObject({ status: "colour", value: "yellow" });
  });

  it.each([
    ["pink… no, purple", "purple"],
    ["pink, no wait, purple!", "purple"],
    ["purple, I mean pink", "pink"],
    ["not pink, purple", "purple"],
    ["not the pink one, the purple one", "purple"],
  ])("lets the last colour win in a self-correction: %s", (speech, value) => {
    expect(read(`Child: ${speech}`)).toMatchObject({ status: "colour", value });
  });

  it.each([
    ["pink or purple", "alternatives"],
    ["purple or yellow", "alternatives"],
    ["purple?", "question"],
    ["Is it the purple one?", "question"],
    ["the purple stocking?", "question"],
    ["not purple", "negated"],
    ["it's not the purple one", "negated"],
  ])("holds %s as ambiguous", (speech, reason) => {
    expect(read(`Child: ${speech}`)).toEqual({ status: "ambiguous", reason });
  });

  it.each([
    ["three", "three"],
    ["3", "3"],
    ["Three!", "Three"],
    ["it's three", "three"],
    ["um, two, three", "three"],
  ])("reads a number with no colour as number_only: %s", (speech, source) => {
    expect(read(`Tutor: Three!\nChild: ${speech}`)).toEqual({ status: "number_only", source });
  });

  it.each([
    ["that one", "that one"],
    ["This one!", "This one"],
    ["the one there", "the one"],
    ["that one has three", "that one"],
    ["over there", "over there"],
    ["it", "it"],
    ["him!", "him"],
  ])("reads pointing with no colour as deictic: %s", (speech, source) => {
    expect(read(`Child: ${speech}`)).toEqual({ status: "deictic", source });
  });

  it("reads speech with no colour, number or pointing as none", () => {
    expect(read("Child: um I don't know")).toEqual({ status: "none" });
    expect(read("Tutor: Three!")).toEqual({ status: "none" });
    expect(read("")).toEqual({ status: "none" });
  });

  it.each(WORDLESS_FRAGMENT_TRANSCRIPTS.map(transcript => transcript.replace(/\bseven\b/gi, "purple")))(
    "skips wordless child fragments: %#",
    transcript => {
      expect(read(transcript)).toMatchObject({ status: "colour", value: "purple" });
    },
  );

  it("still finds no answer when the only child turns are wordless", () => {
    expect(read("Tutor: Three!\nChild: .\nChild: …")).toEqual({ status: "none" });
  });

  it("reads the latest child attempt in a multi-turn transcript", () => {
    const transcript = `Tutor: Three!
Child: pink
Tutor: That one has two. We want three.
Child: purple`;
    expect(read(transcript)).toMatchObject({ status: "colour", value: "purple", owner: "child" });
    expect(read(`${transcript}\nTutor: Hmm?\nChild: that one`)).toEqual({ status: "deictic", source: "that one" });
    expect(read("Child: purple\nTutor: Which one?\nChild: three")).toEqual({ status: "number_only", source: "three" });
  });

  describe("ownership", () => {
    it("is the child's when the tutor never said the answer colour", () => {
      expect(read("Tutor: Three!\nChild: purple")).toMatchObject({ owner: "child" });
    });

    it("is an echo when the tutor said the answer colour first", () => {
      expect(read("Tutor: It's the purple one.\nChild: purple")).toMatchObject({ value: "purple", owner: "echo" });
      expect(read("Tutor: purple. Child: purple")).toMatchObject({ owner: "echo" });
      expect(read("Tutor: It's the purple one.\nChild: purple purple")).toMatchObject({ owner: "echo" });
    });

    it("is assisted on the second separate repeat of a disclosed answer", () => {
      const transcript =
        "Tutor: The purple one has three.\nChild: purple\nTutor: Say it again?\nChild: the purple one!";
      expect(read(transcript)).toMatchObject({ value: "purple", owner: "assisted" });
    });

    it("stays the child's when the child said it before the tutor confirmed it", () => {
      expect(read("Child: purple\nTutor: Yes, purple! Say it again?\nChild: purple")).toMatchObject({
        owner: "child",
      });
    });

    it("treats an alias the tutor said as disclosing the answer", () => {
      const gold = { answer: "gold" };
      expect(read("Tutor: The yellow one has three.\nChild: gold", gold)).toMatchObject({ owner: "echo" });
      expect(read("Tutor: Gold!\nChild: yellow", gold)).toMatchObject({ value: "gold", owner: "echo" });
    });

    it("ignores the tutor naming the child's wrong pick", () => {
      const transcript = `Tutor: Three!
Child: pink
Tutor: The pink one has two. We want three.
Child: purple`;
      expect(read(transcript)).toMatchObject({ value: "purple", owner: "child" });
      expect(read(`${transcript.replace(/purple$/, "pink")}`)).toMatchObject({ value: "pink", owner: "child" });
    });

    it("keeps a wrong colour the child's even when the tutor said it first", () => {
      expect(read("Tutor: Is it pink?\nChild: pink")).toMatchObject({ value: "pink", owner: "child" });
    });

    it("is always the child's without an expected answer", () => {
      expect(read("Tutor: purple\nChild: purple", { answer: undefined })).toMatchObject({ owner: "child" });
    });
  });
});

describe("picked colour helper", () => {
  const presentation = { answerKind: "colour", answer: "purple", colours: "gold,pink,purple", target: 3 };
  it("parses the presentation colours left to right", () => {
    expect(presentationColours(presentation)).toEqual(["gold", "pink", "purple"]);
    expect(presentationColours({ colours: " pink , purple " })).toEqual(["pink", "purple"]);
    expect(presentationColours({})).toEqual([]);
  });
  it("returns the on-screen colour the child picked, whoever said it first", () => {
    expect(pickedColour("Child: the pink one", presentation)).toBe("pink");
    expect(pickedColour("Child: yellow", presentation, aliases)).toBe("gold");
    expect(pickedColour("Tutor: purple\nChild: purple", presentation)).toBe("purple");
  });
  it("returns null when no single on-screen colour was named", () => {
    expect(pickedColour("Child: blue", presentation)).toBeNull();
    expect(pickedColour("Child: yellow", presentation)).toBeNull();
    expect(pickedColour("Child: pink or purple", presentation)).toBeNull();
    expect(pickedColour("Child: three", presentation)).toBeNull();
    expect(pickedColour("Child: that one", presentation)).toBeNull();
  });
});
