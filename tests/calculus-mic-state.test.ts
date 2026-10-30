import { afterEach, expect, it, vi } from "vitest";
import { micState, type MicState, type MicStateInput } from "../components/calculus/mic-state";
import { createTutorSpeakingHold } from "../components/calculus/tutor-speaking-hold";

afterEach(() => vi.useRealTimers());

type Snapshot = NonNullable<MicStateInput["snapshot"]>;

function input(overrides: Partial<Snapshot> = {}): MicStateInput {
  return {
    live: true,
    snapshot: {
      status: "live",
      error: null,
      runtime: { phase: "active", childSpeaking: false, outputActivity: "quiet" },
      math: { checking: false, complete: false },
      ...overrides,
    },
  };
}

const cases: { input: MicStateInput; expected: MicState }[] = [
  {
    input: { snapshot: null, live: false },
    expected: {
      kind: "before",
      icon: "mic",
      look: "primary",
      pulse: false,
      spin: false,
      big: true,
      label: "Start practice",
      line: "Tap to start · 3 problems",
    },
  },
  {
    input: input({ status: "connecting", runtime: null }),
    expected: {
      kind: "connecting",
      icon: "mic",
      look: "quiet",
      pulse: false,
      spin: true,
      big: false,
      label: "End session",
      line: "Connecting…",
    },
  },
  {
    input: input({ runtime: { phase: "active", childSpeaking: false, outputActivity: "active" } }),
    expected: {
      kind: "tutor",
      icon: "wave",
      look: "quiet",
      pulse: false,
      spin: false,
      big: false,
      label: "End session",
      line: "Tutor is reading the problem",
    },
  },
  {
    input: input({ runtime: { phase: "active", childSpeaking: true, outputActivity: "quiet" } }),
    expected: {
      kind: "listening",
      icon: "mic",
      look: "primary",
      pulse: true,
      spin: false,
      big: false,
      label: "End session",
      line: "Listening…",
    },
  },
  {
    input: input({ math: { checking: true, complete: false } }),
    expected: {
      kind: "checking",
      icon: "mic",
      look: "quiet",
      pulse: false,
      spin: true,
      big: false,
      label: "End session",
      line: "Checking what you said…",
    },
  },
  {
    input: input(),
    expected: {
      kind: "your-turn",
      icon: "mic",
      look: "primary",
      pulse: false,
      spin: false,
      big: false,
      label: "End session",
      line: "Your turn",
    },
  },
  {
    input: input({ math: { checking: false, complete: true } }),
    expected: {
      kind: "complete",
      icon: "check",
      look: "ok",
      pulse: false,
      spin: false,
      big: false,
      label: "End session",
      line: "Next problem in a moment",
    },
  },
  {
    input: input({ status: "ended" }),
    expected: {
      kind: "ended",
      icon: "mic",
      look: "primary",
      pulse: false,
      spin: false,
      big: false,
      label: "Restart practice",
      line: "Session stopped. Your work so far is shown above.",
    },
  },
  {
    input: input({ error: "Permission denied" }),
    expected: {
      kind: "error",
      icon: "off",
      look: "look",
      pulse: false,
      spin: false,
      big: false,
      label: "Microphone blocked",
      line: "Microphone is blocked",
      action: "Allow microphone",
    },
  },
];

it.each(cases)("maps $expected.kind to its exact visuals and accessible copy", ({ input, expected }) => {
  expect(micState(input)).toEqual(expected);
});

it("prioritizes errors over ended and completed sessions", () => {
  expect(
    micState({
      ...input({ status: "ended", error: "Microphone blocked", math: { complete: true, checking: true } }),
      live: false,
    }).kind,
  ).toBe("error");
});

it.each([
  { ...input({ math: { complete: true, checking: true } }), live: false },
  input({ status: "ended", math: { complete: true, checking: true } }),
  input({ runtime: { phase: "stopped", childSpeaking: true, outputActivity: "active" } }),
])("prioritizes stopped sessions over stale live activity", value => {
  expect(micState(value).kind).toBe("ended");
});

it("prioritizes completion over checking and both speakers", () => {
  expect(
    micState(
      input({
        math: { complete: true, checking: true },
        runtime: { phase: "active", childSpeaking: true, outputActivity: "active" },
      }),
    ).kind,
  ).toBe("complete");
});

it("recognizes runtime completion even without math", () => {
  expect(
    micState(input({ math: undefined, runtime: { phase: "complete", childSpeaking: false, outputActivity: "quiet" } }))
      .kind,
  ).toBe("complete");
});

it("prioritizes checking over both speakers", () => {
  expect(
    micState(
      input({
        math: { complete: false, checking: true },
        runtime: { phase: "active", childSpeaking: true, outputActivity: "active" },
      }),
    ).kind,
  ).toBe("checking");
});

it("prioritizes learner speech over tutor audio", () => {
  expect(micState(input({ runtime: { phase: "active", childSpeaking: true, outputActivity: "active" } })).kind).toBe(
    "listening",
  );
});

it.each(["quiet", "unavailable"] as const)("does not mistake %s audio for tutor speech", outputActivity => {
  expect(micState(input({ runtime: { phase: "active", childSpeaking: false, outputActivity } })).kind).toBe(
    "your-turn",
  );
});

it.each([input({ status: "prepared", runtime: null }), input({ runtime: null })])(
  "shows connection setup until a live runtime exists",
  value => {
    expect(micState(value).kind).toBe("connecting");
  },
);

it("does not show reconnecting during problem rendering", () => {
  expect(
    micState(input({ runtime: { phase: "rendering", childSpeaking: false, outputActivity: "active" } })).kind,
  ).toBe("tutor");
});

it.each(["Microphone unavailable", "Permission denied", "NotAllowedError", "Access DENIED"])(
  "uses microphone recovery copy for %s",
  error => {
    expect(micState(input({ error }))).toMatchObject({
      kind: "error",
      label: "Microphone blocked",
      action: "Allow microphone",
    });
  },
);

it.each(["Connection lost", "Session request failed", "Service unavailable"])(
  "preserves non-permission errors with generic recovery: %s",
  error => {
    expect(micState(input({ error }))).toEqual({
      kind: "error",
      icon: "off",
      look: "look",
      pulse: false,
      spin: false,
      big: false,
      label: "Try again",
      line: "Something went wrong",
      action: "Try again",
    });
  },
);

it("does not mutate or share mutable state with callers", () => {
  const value = input();
  const original = structuredClone(value);
  micState(value).line = "Changed by caller";
  expect(value).toEqual(original);
  expect(micState(value).line).toBe("Your turn");
});

it("holds tutor visuals across quick quiet gaps and releases after 600 ms of continuous quiet", () => {
  vi.useFakeTimers();
  let tutorSpeaking = false;
  const hold = createTutorSpeakingHold(value => {
    tutorSpeaking = value;
  });
  const quiet = input();
  const visual = () => micState({ ...quiet, tutorSpeaking });

  expect(visual().kind).toBe("your-turn");
  hold.update("tutor");
  for (const gapMs of [50, 100, 500, 599]) {
    hold.update("your-turn");
    vi.advanceTimersByTime(gapMs);
    expect(visual()).toMatchObject({ kind: "tutor", label: "End session", pulse: false });
    hold.update("tutor");
  }
  hold.update("your-turn");
  vi.advanceTimersByTime(599);
  expect(visual().kind).toBe("tutor");
  vi.advanceTimersByTime(1);
  expect(visual().kind).toBe("your-turn");
  hold.cancel();
});

it.each([
  input({ math: { checking: true, complete: false } }),
  input({ math: { checking: false, complete: true } }),
  input({ error: "Connection lost" }),
  input({ status: "ended" }),
  input({ runtime: { phase: "stopped", childSpeaking: false, outputActivity: "quiet" } }),
  input({ runtime: { phase: "active", childSpeaking: true, outputActivity: "quiet" } }),
  input({ status: "connecting", runtime: null }),
  { snapshot: null, live: false },
])("does not delay higher-priority transitions or retain the hold afterward", value => {
  vi.useFakeTimers();
  let tutorSpeaking = false;
  const hold = createTutorSpeakingHold(value => {
    tutorSpeaking = value;
  });
  hold.update("tutor");
  hold.update("your-turn");
  const expected = micState(value);
  expect(micState({ ...value, tutorSpeaking })).toEqual(expected);
  hold.update(expected.kind);
  expect(tutorSpeaking).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  hold.update("your-turn");
  expect(tutorSpeaking).toBe(false);
});

it("cancels the quiet timer on cleanup", () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const hold = createTutorSpeakingHold(onChange);
  hold.update("tutor");
  hold.update("your-turn");
  onChange.mockClear();
  hold.cancel();
  vi.advanceTimersByTime(1000);
  expect(onChange).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
