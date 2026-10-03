import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { ConvexSessionRecorder } from "../lib/convex-session-recorder";
import { recordingOffsetSeconds } from "../lib/session-recorder";
import type { ObserverProposal } from "../lib/observation-contracts";
import { observationRecordFromSnapshot } from "../lib/observer-diagnostics";
import type { ReviewCommand, ReviewSnapshot } from "../lib/parent-review";
import { reviewPlaybackAtMs } from "../lib/parent-review";
import type { DiagnosticPage } from "../lib/parent-review-diagnostics";
import { sessionSpeechInterval } from "../lib/evidence-timing";
import { captureMocks, recordedBrowserEvidence } from "./helpers/recorded-browser-evidence";

const rpc = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn(), action: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = rpc.mutation;
    query = rpc.query;
    action = rpc.action;
  },
}));
import { POST as observe } from "../app/api/observer/retry/route";
import { POST as review } from "../app/api/parent-review/route";
import { POST as diagnostics } from "../app/api/parent-review/diagnostics/route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.values(rpc).forEach(mock => mock.mockReset());
});

function request(path: string, body: unknown, origin = "http://127.0.0.1:3000") {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** WebRTC, media bytes, authored displays, recognition and provider output are synthetic. Transport clocks,
 * recording queue/upload, routes, Convex functions, validation and review are production.
 * No provider/browser offset or acoustic alignment is supplied by this harness. */
async function recordedFlow() {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  rpc.mutation.mockImplementation(async (fn, args) => {
    const result = await t.mutation(fn, args);
    return getFunctionName(fn) === getFunctionName(api.sessions.generateUploadUrl)
      ? "https://synthetic-upload.invalid/audio"
      : result;
  });
  rpc.query.mockImplementation((fn, args) => t.query(fn, args));
  rpc.action.mockImplementation((fn, args) => t.action(fn, args));
  let proposals: unknown[] = [];
  let providerFailure = false;
  const inputs: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/live") return Response.json({ transport: { sdp: "answer" } });
    if (url === "https://synthetic-upload.invalid/audio") {
      expect(await (init!.body as Blob).text()).toBe("audio");
      return Response.json({ storageId: await t.run(ctx => ctx.storage.store(init!.body as Blob)) });
    }
    if (url === "/api/observer/retry") return observe(request(url, JSON.parse(String(init?.body))));
    if (url.includes("audio/transcriptions")) {
      expect(await ((init!.body as FormData).get("file") as Blob).text()).toBe("audio");
      return providerFailure ? new Response(null, { status: 503 }) : Response.json({ text: "Synthetic transcript" });
    }
    if (url.endsWith("/responses")) {
      inputs.push(JSON.parse(JSON.parse(String(init?.body)).input).canonicalSnapshot);
      return Response.json({ status: "completed", output_text: JSON.stringify({ proposals }) });
    }
    const saved = await t.query(api.sessions.getRecord, { sessionId });
    expect(new URL(url).pathname).toBe(new URL(saved!.recordingUrl!).pathname);
    const bytes = await t.run(async ctx => {
      const blob = await ctx.storage.get(saved!.session.recording!.storageId);
      return Array.from(new Uint8Array(await blob!.arrayBuffer()));
    });
    return new Response(new Uint8Array(bytes));
  });
  captureMocks();
  const recorder = new ConvexSessionRecorder();
  const lesson = await recordedBrowserEvidence(2000, { recorder, fetcher });
  await lesson.session.recordingSettled();
  expect(lesson.errors).toEqual([]);
  const sessionId = lesson.record.session._id as Id<"sessions">;
  const saved = () => t.query(api.sessions.getRecord, { sessionId });
  const read = async (): Promise<ReviewSnapshot> => {
    const result = await review(request("/api/parent-review", { operation: "get", sessionId }));
    expect(result.status).toBe(200);
    return result.json();
  };
  const write = (command: ReviewCommand) => review(request("/api/parent-review", command));
  const gate = () => t.query(internal.parent_review.forPlanning, { sessionIds: [sessionId] });
  const run = () => t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
  const retry = () => observe(request("/api/observer/retry", { sessionId }));
  const rows = async (attemptIndex = -1) => {
    const attempt = (await read()).diagnostics!.attempts.at(attemptIndex)!;
    const page: DiagnosticPage = await (
      await diagnostics(
        request("/api/parent-review/diagnostics", {
          sessionId,
          snapshotId: attempt.snapshotId,
          numItems: 50,
          cursor: null,
        }),
      )
    ).json();
    expect(page.sessionId).toBe(sessionId);
    expect(page.isDone).toBe(true);
    return page.page;
  };
  const proposal = async (text: string, total: number, index = 0): Promise<ObserverProposal> => {
    const record = await saved();
    const response = record!.events.filter(e => e.evidence?.type === "utterance" && e.evidence.text === text)[index];
    if (response?.evidence?.type !== "utterance") throw new Error(`Missing response ${text}`);
    const responseSceneId = response.evidence.responseScene?.sceneId;
    const scene = record!.events.find(
      e => e.evidence?.type === "scene_displayed" && e.evidence.sceneId === responseSceneId,
    )!;
    return {
      kind: "observer_proposal",
      proposalId: `synthetic-${text}-${index}`,
      sessionId,
      exchangeAtMs: response.atMs,
      observation: {
        behavior: "quantity_identification",
        outcome: "correct",
        speakerAttribution: "child_or_nearby_speaker",
        statedTotal: total,
        targetQuantity: total,
        countSequenceObserved: false,
        description: "Synthetic provider claims mastery and independent counting.",
        support: { status: "not_established", kinds: [], sourceEventIds: [] },
        uncertaintyReasons: [],
      },
      sources: [
        { eventId: scene._id, role: "scene" },
        { eventId: response._id, role: "response" },
      ],
    };
  };
  const finish = async () => {
    lesson.session.end("parent_stop");
    await lesson.session.recordingSettled();
    expect(lesson.errors).toEqual([]);
    expect((await saved())!.session).toMatchObject({
      state: "ended",
      recordStatus: "complete",
      recording: { startOffsetMs: 0, mimeType: "audio/webm;codecs=opus" },
    });
  };
  return {
    ...lesson,
    t,
    sessionId,
    recorder,
    saved,
    read,
    write,
    gate,
    run,
    retry,
    rows,
    proposal,
    finish,
    inputs,
    fetcher,
    output: (batch: unknown[]) => {
      proposals = batch;
    },
    failProvider: (fail: boolean) => {
      providerFailure = fail;
    },
  };
}

function uncertain(p: ObserverProposal): ObserverProposal {
  return {
    ...p,
    observation: {
      behavior: "uncertain_exchange",
      outcome: "uncertain",
      speakerAttribution: "child_or_nearby_speaker",
      countSequenceObserved: false,
      description: "Uncertain synthetic exchange.",
      support: { status: "not_established", kinds: [], sourceEventIds: [] },
      uncertaintyReasons: ["missing_scene_context", "conflicting_context", "unclear_speech"],
    },
  };
}

async function next(f: Awaited<ReturnType<typeof recordedFlow>>, text: string, offset: number, scene: number) {
  await vi.advanceTimersByTimeAsync(1000);
  f.say(text, offset);
  await f.flush();
  f.session.displayed(scene);
  await f.session.recordingSettled();
}

it("joins butterflies after strawberries display through transport, persistence, diagnostics, correction and planning", async () => {
  const f = await recordedFlow();
  await next(f, "One", 1000, 1);
  await next(f, "Two", 6000, 2);
  await vi.advanceTimersByTimeAsync(1000);
  f.say("Three", 9500);
  await vi.advanceTimersByTimeAsync(2000);
  expect((await f.saved())!.events.some(e => e.evidence?.type === "utterance" && e.evidence.text === "Three")).toBe(
    false,
  );
  f.session.displayed(3);
  await f.flush();
  await f.finish();
  const original = await f.saved();
  const batch = await Promise.all([f.proposal("One", 1), f.proposal("Two", 2), f.proposal("Three", 3)]);
  const response = original!.events.find(e => e.evidence?.type === "utterance" && e.evidence.text === "Three")!;
  const butterfly = original!.events.find(
    e => e.evidence?.type === "scene_displayed" && e.evidence.sceneId === "butterfly-garden",
  )!;
  const strawberry = original!.events.find(
    e => e.evidence?.type === "scene_displayed" && e.evidence.sceneId === "picnic",
  )!;
  expect(strawberry.atMs).toBeLessThan(response.atMs);
  expect(response.evidence).toMatchObject({
    recognition: "no_ambiguity_detected",
    transcriptFragments: [{ key: "transcript_3", textStart: 0, textEnd: 5 }],
    providerTiming: { sourceId: 1, startMs: 9500 },
    responseScene: { sceneId: "butterfly-garden", displayedAtMs: butterfly.atMs, status: "stable" },
    sessionTiming: { provenance: "source_timeline_bound", sourceId: 1, startMs: 7500, endMs: 8100 },
  });
  f.output(batch);
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  await f.run();
  const before = await f.read();
  expect(before.status, JSON.stringify({ diagnostics: before.diagnostics, rows: await f.rows() })).toBe("ready");
  expect(before.diagnostics!.attempts[0].summary).toMatchObject({
    responseCount: 3,
    absentResponseCount: 0,
    rejectedProposalCount: 0,
  });
  expect(await f.rows()).toContainEqual(
    expect.objectContaining({
      kind: "response",
      eventId: response._id,
      fragmentKeys: ["transcript_3"],
      coverage: "returned",
      trustedTiming: true,
    }),
  );
  const input = observationRecordFromSnapshot(f.inputs[0]);
  expect(input.events.map(e => e._id)).toEqual(original!.events.map(e => e._id));
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  const scope = { sessionId: f.sessionId, analysisId: before.analysisId! };
  for (const [i, decision] of ["accepted", "rejected", "corrected"].entries()) {
    const row = before.proposals[i];
    const result = await f.write({
      operation: "decide",
      ...scope,
      proposalRowId: row.id,
      decision: {
        kind: "parent_decision",
        proposalId: row.proposal.proposalId,
        decision: decision as "accepted" | "rejected" | "corrected",
        ...(decision === "rejected" ? { rejectionReason: "Synthetic parent attribution mismatch" } : {}),
        ...(decision === "corrected"
          ? {
              correction: { ...row.proposal.observation, description: "Parent corrected interpretation." },
              parentContext: {
                provenance: "parent_review" as const,
                note: "I helped with this response.",
                assistance: ["parent_reported_assistance" as const],
              },
            }
          : {}),
      },
    });
    expect(result.status).toBe(200);
  }
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  expect((await f.write({ operation: "complete", ...scope, repairLevel: "light_correction" })).status).toBe(200);
  const plan = await f.gate();
  expect(plan.blocked).toBe(false);
  expect(plan.evidence).toHaveLength(2);
  expect(plan.evidence.map(e => e.observation.targetQuantity)).toEqual([1, 3]);
  expect(plan.evidence[1]).toMatchObject({
    interpretationProvenance: "parent_review",
    parentContext: { provenance: "parent_review" },
    observation: { support: { status: "not_established" } },
  });
  expect(plan.evidence[0].observation.description).not.toMatch(/mastery|independent counting/);
  const after = await f.read();
  expect(after.proposals).toEqual(before.proposals);
  expect(after.diagnostics).toEqual(before.diagnostics);
  expect((await f.saved())!.events).toEqual(original!.events);
  const anchor = reviewPlaybackAtMs(before.proposals[2].proposal, before.sources);
  expect(anchor).toBe(7500);
  const recovered = await f.recorder.getRecord(f.sessionId);
  expect(recordingOffsetSeconds(anchor, recovered!.recording!)).toBe(7.5);
  expect(f.fetcher.mock.calls.filter(([url]) => url === "/api/live")).toHaveLength(1);
});

it.each(["impossible", "delayed_crossing", "competing_display", "missing_source", "mixed_sources"] as const)(
  "rejects concrete %s material, preserves diagnostic reasons and accepts only uncertain review",
  async mode => {
    const f = await recordedFlow();
    await vi.advanceTimersByTimeAsync(1000);
    if (mode === "competing_display" || mode === "delayed_crossing") {
      await f.recorder.append("competing", mode === "competing_display" ? 100 : 700, {
        type: "scene_displayed",
        sceneId: "other-display",
        targetQuantity: 2,
        items: [{ emoji: "🦆", label: "duck" }],
        arrangement: "row",
      });
    }
    if (mode === "missing_source" || mode === "mixed_sources") {
      f.session.receive({
        type: "transcript",
        speaker: "child",
        delta: "One",
        startMs: 1000,
        endMs: 1100,
        ...(mode === "mixed_sources" ? { sourceId: 1 } : {}),
      });
      if (mode === "mixed_sources")
        f.session.receive({
          type: "transcript",
          speaker: "child",
          delta: " no, One",
          startMs: 1200,
          endMs: 1300,
          sourceId: 2,
        });
    } else f.say("One", mode === "impossible" ? 50000 : 1000);
    await f.flush();
    await f.finish();
    const text = mode === "mixed_sources" ? " no, One" : "One";
    const p = await f.proposal(text, 1);
    f.output([p]);
    const original = (await f.saved())!.events;
    await f.run();
    const failed = await f.read();
    expect(failed).toMatchObject({ status: "failed", proposals: [], decisions: [] });
    expect(failed.diagnostics!.attempts[0].summary).toMatchObject({ rejectedProposalCount: 1, outputState: "usable" });
    expect(await f.rows()).toContainEqual(
      expect.objectContaining({
        kind: "proposal",
        status: "rejected",
        issueCount: expect.any(Number),
        issues: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringMatching(/trustworthy|uniquely displayed|unconfirmed/) }),
        ]),
      }),
    );
    expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
    f.output([uncertain(p)]);
    await f.retry();
    await f.run();
    const ready = await f.read();
    expect(ready.status).toBe("ready");
    expect(ready.diagnostics!.attempts[0]).toEqual(failed.diagnostics!.attempts[0]);
    const scope = { sessionId: f.sessionId, analysisId: ready.analysisId! };
    // Parent interpretation authority cannot manufacture missing scene/time facts.
    expect(
      (
        await f.write({
          operation: "decide",
          ...scope,
          proposalRowId: ready.proposals[0].id,
          decision: {
            kind: "parent_decision",
            proposalId: p.proposalId,
            decision: "corrected",
            correction: p.observation,
            parentContext: { provenance: "parent_review", note: "I heard the answer." },
          },
        })
      ).status,
    ).toBe(409);
    expect((await f.write({ operation: "acceptAll", ...scope })).status).toBe(200);
    const plan = await f.gate();
    expect(plan.blocked).toBe(false);
    expect(plan.evidence[0].observation).toMatchObject({ behavior: "uncertain_exchange", outcome: "uncertain" });
    expect(plan.evidence[0].observation).not.toHaveProperty("targetQuantity");
    expect((await f.saved())!.events).toEqual(original);
  },
);

it.each(["omitted", "rejected", "empty", "provider_failure"] as const)(
  "distinguishes %s output against the original recorded attempt and keeps retries immutable",
  async mode => {
    const f = await recordedFlow();
    await next(f, "One", 1000, 1);
    await next(f, "Two", 6000, 2);
    await f.finish();
    const one = await f.proposal("One", 1);
    const two = await f.proposal("Two", 2);
    f.output(
      mode === "empty"
        ? []
        : mode === "rejected"
          ? [one, { ...two, observation: { ...two.observation, statedTotal: 1 } }]
          : [one],
    );
    f.failProvider(mode === "provider_failure");
    await f.run();
    const first = await f.read();
    expect(first.status).toBe(mode === "rejected" || mode === "provider_failure" ? "failed" : "ready");
    const attempt = first.diagnostics!.attempts[0];
    expect(attempt.summary).toMatchObject({
      outputState: mode === "provider_failure" ? "unavailable" : "usable",
      absentResponseCount: mode === "provider_failure" ? null : mode === "empty" ? 2 : mode === "omitted" ? 1 : 0,
      rejectedProposalCount: mode === "rejected" ? 1 : 0,
      failureStage: mode === "provider_failure" ? "transcription" : mode === "rejected" ? "provider_validation" : null,
    });
    const rows = await f.rows();
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "response",
        eventId: two.sources.flatMap(s => (s.role === "response" && "eventId" in s ? [s.eventId] : []))[0],
        coverage: mode === "provider_failure" ? "unknown" : mode === "rejected" ? "returned" : "absent",
        omissionCause: mode === "omitted" || mode === "empty" ? "unknown" : null,
        rejectedCount: mode === "rejected" ? 1 : 0,
      }),
    );
    expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
    const stored = await f.t.run(ctx => ctx.db.get(attempt.snapshotId as Id<"observerDiagnosticAttempts">));
    const oldSnapshot = stored!.inputSnapshot;
    if (first.status === "failed") {
      f.failProvider(false);
      f.output([one, two]);
      await f.retry();
      await f.run();
      const ready = await f.read();
      expect(ready.status).toBe("ready");
      expect(ready.diagnostics!.attempts[0]).toEqual(attempt);
      expect(await f.rows(0)).toEqual(rows);
      expect(
        (await f.t.run(ctx => ctx.db.get(attempt.snapshotId as Id<"observerDiagnosticAttempts">)))!.inputSnapshot,
      ).toBe(oldSnapshot);
      expect(ready.diagnostics!.attempts[1].attempt).toBe(2);
    }
    const ready = await f.read();
    const scope = { sessionId: f.sessionId, analysisId: ready.analysisId! };
    if (mode === "empty") {
      expect((await f.write({ operation: "complete", ...scope, repairLevel: "verified" })).status).toBe(409);
      expect(
        (await f.write({ operation: "complete", ...scope, repairLevel: "verified", acknowledgeEmpty: true })).status,
      ).toBe(200);
    } else expect((await f.write({ operation: "acceptAll", ...scope })).status).toBe(200);
    expect((await f.gate()).evidence).toHaveLength(mode === "empty" ? 0 : mode === "omitted" ? 1 : 2);
  },
);

it("keeps unmapped provider timing uncertain across persistence and review", async () => {
  const f = await recordedFlow();
  // Synthetic mismatched clocks: transcript receipt never maps provider offsets.
  await f.recorder.append("synthetic-butterflies", 16590, {
    type: "scene_displayed",
    sceneId: "butterfly-garden",
    targetQuantity: 3,
    items: [{ emoji: "🦋", label: "butterfly" }],
    arrangement: "row",
  });
  await f.recorder.append("synthetic-strawberries", 43640, {
    type: "scene_displayed",
    sceneId: "picnic",
    targetQuantity: 3,
    items: [{ emoji: "🍓", label: "strawberry" }],
    arrangement: "row",
  });
  await f.recorder.append("synthetic-three", 45575, {
    type: "utterance",
    text: "Three",
    speaker: "child_or_nearby_speaker",
    state: "finalized",
    startMs: 50600,
    endMs: 50800,
    providerTiming: { clock: "provider", startMs: 50600, endMs: 50800, sourceId: 1 },
    firstObservedAtMs: 43075,
    lastObservedAtMs: 43075,
    recognition: "no_ambiguity_detected",
    transcriptFragments: [{ key: "synthetic-fragment", textStart: 0, textEnd: 5 }],
    responseScene: {
      provenance: "application_transcript_context",
      sceneId: "butterfly-garden",
      displayedAtMs: 16590,
      status: "stable",
    },
  });
  await vi.advanceTimersByTimeAsync(46000);
  await f.finish();
  const original = (await f.saved())!.events;
  const p = await f.proposal("Three", 3);
  f.output([p]);
  await f.run();
  expect(await f.read()).toMatchObject({ status: "failed", proposals: [] });
  expect(await f.rows()).toContainEqual(
    expect.objectContaining({
      kind: "response",
      coverage: "returned",
      trustedTiming: false,
      fragmentKeys: ["synthetic-fragment"],
      rejectedCount: 1,
    }),
  );
  expect(await f.rows()).toContainEqual(
    expect.objectContaining({
      kind: "proposal",
      status: "rejected",
      issues: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("trustworthy speech") }),
      ]),
    }),
  );
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  f.output([uncertain(p)]);
  await f.retry();
  await f.run();
  const ready = await f.read();
  expect(ready.status).toBe("ready");
  const scope = { sessionId: f.sessionId, analysisId: ready.analysisId! };
  expect(
    (
      await f.write({
        operation: "decide",
        ...scope,
        proposalRowId: ready.proposals[0].id,
        decision: {
          kind: "parent_decision",
          proposalId: p.proposalId,
          decision: "corrected",
          correction: p.observation,
          parentContext: { provenance: "parent_review", note: "I heard three for butterflies." },
        },
      })
    ).status,
  ).toBe(409);
  expect((await f.write({ operation: "acceptAll", ...scope })).status).toBe(200);
  const plan = await f.gate();
  expect(plan.evidence[0].observation).toMatchObject({ behavior: "uncertain_exchange", outcome: "uncertain" });
  expect(plan.evidence[0].observation).not.toHaveProperty("targetQuantity");
  expect(reviewPlaybackAtMs(p, ready.sources)).toBe(43075);
  const recovered = await f.recorder.getRecord(f.sessionId);
  expect(recordingOffsetSeconds(43075, recovered!.recording!)).toBe(43.075);
  const response = original.find(e => e.eventKey === "synthetic-three")!.evidence;
  expect(sessionSpeechInterval(response)).toBeUndefined();
  expect((await f.saved())!.events).toEqual(original);
});

it.each(["event_before", "event_inside", "recording_before", "recording_tied", "generated"] as const)(
  "validates %s assistance against the whole response bound through publication",
  async mode => {
    const f = await recordedFlow();
    const supportId = await f.t.mutation(api.sessions.appendEvent, {
      sessionId: f.sessionId,
      eventKey: "synthetic-parent-help",
      atMs: mode === "event_before" ? 99 : 101,
      evidence: { type: "support", source: "parent", mode: "spoken", description: "Count them." },
    });
    f.connection.channel.onmessage?.({
      data: JSON.stringify({
        type: "session.output_transcript.delta",
        delta: "Suggested counting help",
        start_ms: 0,
        end_ms: 100,
      }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    f.say("One", 1000);
    await f.flush();
    await f.finish();
    const p = await f.proposal("One", 1);
    if (mode.startsWith("event")) {
      p.observation.support = { status: "recorded", kinds: ["hint"], sourceEventIds: [supportId] };
      p.sources.push({ role: "support", eventId: supportId });
    } else if (mode.startsWith("recording")) {
      const end = mode === "recording_before" ? 99 : 100;
      p.observation.support = {
        status: "recorded",
        kinds: ["hint"],
        sourceEventIds: [],
        recordingSourceIds: ["synthetic-audio-help"],
      };
      p.sources.push({
        role: "recording_support",
        sourceId: "synthetic-audio-help",
        provenance: "recording_review",
        sessionId: f.sessionId,
        recordingId: `${f.sessionId}:recording`,
        recordingStartMs: 0,
        recordingEndMs: end,
        sessionStartMs: 0,
        sessionEndMs: end,
      });
    } else {
      const generated = (await f.saved())!.events.find(e => e.timeline?.type === "sprout_generated_utterance")!;
      expect(generated).toBeDefined();
      p.observation.support = { status: "recorded", kinds: ["hint"], sourceEventIds: [generated._id] };
      p.sources.push({ role: "support", eventId: generated._id });
    }
    f.output([p]);
    await f.run();
    const view = await f.read();
    const valid = mode === "event_before" || mode === "recording_before";
    expect(view.status).toBe(valid ? "ready" : "failed");
    if (valid) {
      expect(
        (await f.write({ operation: "acceptAll", sessionId: f.sessionId, analysisId: view.analysisId! })).status,
      ).toBe(200);
      expect((await f.gate()).evidence[0].observation.support.status).toBe("recorded");
    } else {
      expect(await f.rows()).toContainEqual(
        expect.objectContaining({
          kind: "proposal",
          status: "rejected",
          issues: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringMatching(/before|canonical support|learner evidence/) }),
          ]),
        }),
      );
      expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
    }
  },
);

it("enforces review-reader capability and local route boundaries for actual persisted attempt diagnostics", async () => {
  const f = await recordedFlow();
  await next(f, "One", 1000, 1);
  await f.finish();
  f.output([await f.proposal("One", 1)]);
  await f.run();
  const view = await f.read();
  const snapshotId = view.diagnostics!.attempts[0].snapshotId;
  const command = { operation: "get", sessionId: f.sessionId };
  await expect(
    f.t.action(api.parent_review_action.request, { capability: "wrong", command: JSON.stringify(command) }),
  ).rejects.toThrow("authorization failed");
  await expect(
    f.t.action(api.parent_review_action.readDiagnostics, {
      capability: "wrong",
      sessionId: f.sessionId,
      snapshotId: snapshotId as Id<"observerDiagnosticAttempts">,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  ).rejects.toThrow("authorization failed");
  expect((await review(request("/api/parent-review", command, "https://elsewhere.invalid"))).status).toBe(403);
  expect(
    (
      await diagnostics(
        request(
          "/api/parent-review/diagnostics",
          { sessionId: f.sessionId, snapshotId, cursor: null, numItems: 50 },
          "https://elsewhere.invalid",
        ),
      )
    ).status,
  ).toBe(403);
  expect(JSON.stringify(view)).not.toMatch(/synthetic-capability|inputSnapshot|synthetic-key/);
  expect(await f.rows()).toHaveLength(2);
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
});

it("exposes immutable legacy proposals as reject-only through the authorized review bridge and completes with no evidence", async () => {
  const f = await recordedFlow();
  await f.finish();
  await f.run();
  // Initialize an independent pre-timing fixture; do not downgrade, repair or
  // rewrite any previously saved record, proposal, snapshot or decision.
  const legacy = await f.t.run(async ctx => {
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "complete",
      createdAt: 1,
      nextEventOrder: 2,
    });
    const scene = {
      type: "scene_displayed" as const,
      sceneId: "butterfly-garden",
      targetQuantity: 3,
      items: [{ emoji: "🦋", label: "butterfly" }],
      arrangement: "row",
    };
    const speech = {
      type: "utterance" as const,
      speaker: "child_or_nearby_speaker" as const,
      text: "Three",
      state: "finalized" as const,
      startMs: 50600,
      endMs: 50800,
      firstObservedAtMs: 43075,
    };
    const sceneId = await ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey: "legacy-butterflies",
      order: 0,
      atMs: 16590,
      evidence: scene,
    });
    const responseId = await ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey: "legacy-three",
      order: 1,
      atMs: 45575,
      evidence: speech,
    });
    const events = [await ctx.db.get(sceneId), await ctx.db.get(responseId)];
    const inputSnapshot = JSON.stringify({
      sessionId,
      state: "ended",
      recordStatus: "complete",
      recording: null,
      events: events.map(e => ({
        _id: e!._id,
        order: e!.order,
        atMs: e!.atMs,
        evidence: e!.evidence ?? null,
        timeline: e!.timeline ?? null,
      })),
    });
    const analysisId = await ctx.db.insert("observerAnalyses", {
      sessionId,
      status: "ready",
      attempt: 1,
      inputSnapshot,
    });
    const proposal: ObserverProposal = {
      kind: "observer_proposal",
      proposalId: "legacy-three",
      sessionId,
      exchangeAtMs: 45575,
      observation: {
        behavior: "quantity_identification",
        outcome: "correct",
        speakerAttribution: "child_or_nearby_speaker",
        statedTotal: 3,
        targetQuantity: 3,
        countSequenceObserved: false,
        description: "Historical correct total.",
        support: { status: "not_established", kinds: [], sourceEventIds: [] },
        uncertaintyReasons: [],
      },
      sources: [
        { eventId: sceneId, role: "scene" },
        { eventId: responseId, role: "response" },
      ],
    };
    const proposalRowId = await ctx.db.insert("observerProposals", { sessionId, analysisId, ordinal: 0, proposal });
    return { sessionId, analysisId, proposalRowId, inputSnapshot, events, proposal };
  });
  const read = async (): Promise<ReviewSnapshot> =>
    (await review(request("/api/parent-review", { operation: "get", sessionId: legacy.sessionId }))).json();
  const before = await read();
  expect(before).toMatchObject({
    status: "ready",
    proposals: [{ resolution: "reject_only" }],
    diagnostics: { availability: "legacy_unavailable", attempts: [], missingAttempts: [1] },
  });
  const scope = { sessionId: legacy.sessionId, analysisId: legacy.analysisId };
  expect((await f.write({ operation: "acceptAll", ...scope })).status).toBe(409);
  expect(
    (
      await f.write({
        operation: "decide",
        ...scope,
        proposalRowId: legacy.proposalRowId,
        decision: {
          kind: "parent_decision",
          proposalId: legacy.proposal.proposalId,
          decision: "corrected",
          correction: uncertain(legacy.proposal).observation,
          parentContext: { provenance: "parent_review", note: "I heard the answer." },
        },
      })
    ).status,
  ).toBe(409);
  expect(await f.t.query(internal.parent_review.forPlanning, { sessionIds: [legacy.sessionId] })).toMatchObject({
    blocked: true,
    evidence: [],
  });
  expect(
    (
      await f.write({
        operation: "decide",
        ...scope,
        proposalRowId: legacy.proposalRowId,
        decision: {
          kind: "parent_decision",
          proposalId: legacy.proposal.proposalId,
          decision: "rejected",
          rejectionReason: "Speech timing is unverified.",
        },
      })
    ).status,
  ).toBe(200);
  expect((await f.write({ operation: "complete", ...scope, repairLevel: "light_correction" })).status).toBe(200);
  expect(await f.t.query(internal.parent_review.forPlanning, { sessionIds: [legacy.sessionId] })).toEqual({
    blocked: false,
    reason: null,
    evidence: [],
  });
  const after = await read();
  expect(after.proposals).toEqual(before.proposals);
  expect(after.sources).toEqual(before.sources);
  expect(after.diagnostics).toEqual(before.diagnostics);
  expect((await f.t.run(ctx => ctx.db.get(legacy.analysisId)))!.inputSnapshot).toBe(legacy.inputSnapshot);
  expect((await f.t.query(api.sessions.getRecord, { sessionId: legacy.sessionId }))!.events).toEqual(legacy.events);
  expect(
    await f.t.run(ctx =>
      ctx.db
        .query("reviewedEvidence")
        .withIndex("by_analysis", q => q.eq("analysisId", legacy.analysisId))
        .take(10),
    ),
  ).toEqual([]);
});
