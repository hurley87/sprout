import { describe, expect, it } from "vitest";
import {
  TutorAudioGate,
  CLOSE_AFTER_QUIET_MS,
  OPEN_WAIT_MS,
  MAX_OPEN_MS,
} from "../lib/lesson-runtime/tutor-audio-gate";

describe("tutor audio gate", () => {
  it("starts open for the greeting and closes after sustained quiet", () => {
    const gate = new TutorAudioGate(0);
    expect(gate.audible(0)).toBe(true);
    gate.outputActivity("active", 50);
    gate.outputActivity("quiet", 100);
    expect(gate.audible(100 + CLOSE_AFTER_QUIET_MS - 1)).toBe(true);
    expect(gate.audible(100 + CLOSE_AFTER_QUIET_MS)).toBe(false);
    expect(gate.reason()).toBe("quiet");
    gate.instructionSent(2000);
    expect(gate.audible(2000)).toBe(true);
  });
  it("closes when output never starts", () => {
    const gate = new TutorAudioGate(0);
    expect(gate.audible(OPEN_WAIT_MS)).toBe(false);
    expect(gate.reason()).toBe("no_output");
  });
  it("enforces a maximum even for continuous audio", () => {
    const gate = new TutorAudioGate(0);
    gate.outputActivity("active", 1);
    expect(gate.audible(MAX_OPEN_MS)).toBe(false);
    expect(gate.reason()).toBe("max_open");
  });
  it("resets deadlines for each instruction", () => {
    const gate = new TutorAudioGate(0);
    gate.outputActivity("active", 1);
    gate.outputActivity("quiet", 2);
    gate.instructionSent(1000);
    expect(gate.audible(1000 + OPEN_WAIT_MS - 1)).toBe(true);
    expect(gate.audible(1000 + OPEN_WAIT_MS)).toBe(false);
    expect(gate.reason()).toBe("no_output");
  });
  it("does not count speech already playing at an instruction as its reply", () => {
    const gate = new TutorAudioGate(0);
    gate.outputActivity("active", 500);
    gate.instructionSent(1000);
    gate.outputActivity("quiet", 1500);
    // The earlier utterance ending must not start the close-after-quiet timer.
    expect(gate.audible(1500 + CLOSE_AFTER_QUIET_MS)).toBe(true);
    gate.outputActivity("active", 4000);
    gate.outputActivity("quiet", 6000);
    expect(gate.audible(6000 + CLOSE_AFTER_QUIET_MS - 1)).toBe(true);
    expect(gate.audible(6000 + CLOSE_AFTER_QUIET_MS)).toBe(false);
    expect(gate.reason()).toBe("quiet");
  });
  it("keeps a reply audible when earlier speech runs straight into it", () => {
    const gate = new TutorAudioGate(0);
    gate.outputActivity("active", 500);
    gate.instructionSent(1000);
    expect(gate.audible(1000 + OPEN_WAIT_MS + 500)).toBe(true);
    gate.outputActivity("quiet", 9000);
    expect(gate.audible(9000 + CLOSE_AFTER_QUIET_MS)).toBe(false);
    expect(gate.reason()).toBe("quiet");
  });
});
