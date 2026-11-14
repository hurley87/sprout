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
  ])("reads %s", (speech, value) => {
    expect(latestChildNumber(`Child: ${speech}`, { answer: 23 })).toMatchObject({
      status: "number",
      value,
      owner: "child",
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
  it("recognizes a tutor answer before the continuation", () => {
    expect(latestChildNumber(real.replace("Tutor: Yes,", "Tutor: Yes, fifty-six!"), { answer: 56 })).toMatchObject({
      status: "number",
      value: 56,
      owner: "echo",
    });
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
