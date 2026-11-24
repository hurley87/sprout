import { describe, expect, it } from "vitest";
import { latestChildNumber, parseSpokenNumbers } from "../lib/lesson-runtime/spoken-number";

const real = `Tutor: Here comes Rex, hungry! Big car-carrier trucks are carrying ten cars each, and some loose ones rolled up too. How many cars does Rex get to eat altogether?
Child: Fifty-five
Tutor: Let's count from the trucks: fifty... fifty-one... fifty-two
Tutor: ...
Child: Fifty-three, fifty-four, fifty-five, fifty
Tutor: Yes,
Child: -six
Tutor: fifty-six cars. Rex is ready to chomp them.`;

describe("spoken number reader", () => {
  it.each([
    ["twenty-three", 23],
    ["twenty and three", 23],
    ["twenty… three", 23],
    ["twenty... three", 23],
    ["thirteen", 13],
    ["three", 3],
    ["twenty", 20],
    ["thirty-two", 32],
    ["23", 23],
    ["twenty, twenty-one, twenty-two, twenty-three", 23],
    ["twenty-three… no, twenty-four", 24],
    ["Twenty, one, two, three", 23],
    ["ten, twenty, one, two, three", 23],
    ["twenty… one, two, three", 23],
    ["twenty-one, two, three", 23],
    ["twenty, 1, 2, 3", 23],
  ])("reads %s", (speech, value) => {
    expect(latestChildNumber(`Child: ${speech}`, { answer: 23 })).toMatchObject({
      status: "number",
      value,
      owner: "child",
    });
  });
  it.each([
    ["fifty, six", 6],
    ["twenty, two, three", 3],
    ["twenty, one, three", 3],
    ["twenty, one, two, ten", 10],
    ["one, two, three, four, five", 5],
  ])("only joins ones that count on one at a time: %s", (speech, value) => {
    expect(latestChildNumber(`Child: ${speech}`)).toMatchObject({ status: "number", value });
  });
  it("reads counting on from the tens after a hint (live session)", () => {
    const live = `Tutor: Take a peek at the big trucks. Each one holds ten cars. Say twenty, then keep counting for the loose cars.
Child: Twenty, one, two, three
Tutor: You got it, twenty-three cars! Rex can't wait to chomp them.`;
    expect(latestChildNumber(live, { answer: 23 })).toMatchObject({
      status: "number",
      value: 23,
      owner: "child",
      source: "Twenty, one, two, three",
    });
  });
  it.each(["firty-five", "fordy-two"])("does not guess %s", speech => {
    expect(latestChildNumber(`Child: ${speech}`).status).toBe("none");
  });
  it("flags malformed teen compounds", () => {
    expect(latestChildNumber("Child: thirteen-five")).toEqual({ status: "malformed" });
    expect(parseSpokenNumbers("thirteen-five")).toEqual([{ kind: "malformed", source: "thirteen-five" }]);
  });
  it("returns ordered mentions", () => {
    expect(parseSpokenNumbers("THREE, twenty-three and 99").map(n => n.kind === "number" && n.value)).toEqual([
      3, 23, 99,
    ]);
  });
  it.each(["twenty-three?", "twenty-three or thirty-two"])("holds unresolved %s", speech => {
    expect(latestChildNumber(`Child: ${speech}`).status).toBe("ambiguous");
  });
  it("joins the real split answer without treating later tutor confirmation as an echo", () => {
    expect(latestChildNumber(real, { answer: 56 })).toMatchObject({ status: "number", value: 56, owner: "child" });
  });
  it("keeps a split answer the tutor talked over as the child's (they started it first)", () => {
    expect(latestChildNumber(real.replace("Tutor: Yes,", "Tutor: Yes, fifty-six!"), { answer: 56 })).toMatchObject({
      status: "number",
      value: 56,
      owner: "child",
    });
  });
  it("keeps later repeats as the child's once the child has said the answer first", () => {
    expect(
      latestChildNumber("Child: fifty-six\nTutor: Yes, fifty-six cars! Say it again?\nChild: fifty-six", {
        answer: 56,
      }),
    ).toMatchObject({ value: 56, owner: "child" });
  });
  it("still treats a number the tutor said before any child attempt as an echo", () => {
    expect(latestChildNumber("Tutor: It's fifty-six.\nChild: fifty-six", { answer: 56 })).toMatchObject({
      value: 56,
      owner: "echo",
    });
    expect(
      latestChildNumber("Tutor: Fifty-six?\nChild: fifty-five\nTutor: Try again\nChild: fifty-six", { answer: 56 }),
    ).toMatchObject({ value: 56, owner: "echo" });
  });
  it("marks the second separate repeat of a disclosed answer as assisted", () => {
    const disclosed = "Tutor: It's fifty-six.\nChild: fifty-six\nTutor: Can you say that again?\nChild: fifty… six";
    expect(latestChildNumber(disclosed, { answer: 56 })).toMatchObject({ value: 56, owner: "assisted" });
    expect(latestChildNumber("Tutor: It's fifty-six.\nChild: fifty-six fifty-six", { answer: 56 })).toMatchObject({
      owner: "echo",
    });
  });
  it("reads the live split answer the tutor talked over as the child's (session a25c1317)", () => {
    const live = `Tutor: from the trucks. Fifty, fifty-one, fifty-two, fifty-three, fifty-four, fifty-five...
Child: fifty
Tutor: Yes! Fifty-six
Child: -six
Tutor: cars. Rex can't wait to chomp them. Mm-hmm. I didn't catch that—can you say it again?
Child: fifty
Tutor: Yes,
Child: -six
Tutor: fifty-six cars. Rex can't wait to chomp them.`;
    expect(latestChildNumber(live, { answer: 56 })).toMatchObject({ value: 56, owner: "child" });
  });
  it("recognizes an inline tutor echo", () => {
    expect(latestChildNumber("Tutor: fifty-six. Child: fifty-six", { answer: 56 })).toMatchObject({
      status: "number",
      value: 56,
      owner: "echo",
    });
  });
  it("uses the last child turn", () => {
    expect(latestChildNumber("Child: Fifty-five\nTutor: Okay\nChild: fifty-six")).toMatchObject({
      status: "number",
      value: 56,
    });
  });
  it("ignores tutor-only transcripts", () => {
    expect(latestChildNumber("Tutor: twenty-three")).toEqual({ status: "none" });
  });
});
