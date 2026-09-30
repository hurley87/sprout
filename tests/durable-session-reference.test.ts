import { expect, it } from "vitest";
import {
  LATEST_SESSION_REFERENCE_KEY,
  readLatestSessionReference,
  saveLatestSessionReference,
} from "../lib/durable-session-reference";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(LATEST_SESSION_REFERENCE_KEY, initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

it("distinguishes absent, valid, and malformed saved references", () => {
  expect(readLatestSessionReference(storage())).toEqual({ status: "missing" });
  expect(readLatestSessionReference(storage("session_123-abc"))).toEqual({
    status: "available",
    ref: "session_123-abc",
  });
  expect(readLatestSessionReference(storage("not a session id"))).toEqual({ status: "invalid" });
  expect(readLatestSessionReference(storage("x".repeat(129)))).toEqual({ status: "invalid" });
});

it("persists only a bounded session reference and contains storage failures", () => {
  const target = storage();
  expect(saveLatestSessionReference(target, "session-123")).toBe(true);
  expect(target.values.get(LATEST_SESSION_REFERENCE_KEY)).toBe("session-123");
  expect(saveLatestSessionReference(target, { transcript: "private" })).toBe(false);
  expect(
    saveLatestSessionReference(
      {
        setItem: () => {
          throw new Error("blocked");
        },
      },
      "session-123",
    ),
  ).toBe(false);
  expect(
    readLatestSessionReference({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
  ).toEqual({ status: "invalid" });
});
