import { test, expect, type Page } from "@playwright/test";
import { observationFixtures } from "../fixtures/observation-contracts";
import type { ReviewCommand, ReviewSnapshot } from "../../lib/parent-review";
import type { ParentDecision } from "../../lib/observation-contracts";

function snapshot(count = 1): ReviewSnapshot {
  const f = structuredClone(observationFixtures[0]);
  f.proposal!.sessionId = "saved-session";
  const response = f.record.events.find(event => event._id === "sessionEvents_synthetic_answer_1")!;
  response.atMs = 20000; // Speech was flushed/saved well after it finished.
  if (response.evidence?.type === "utterance") {
    response.evidence.startMs = 12000;
    response.evidence.endMs = 14000;
  }
  f.proposal!.exchangeAtMs = response.atMs;
  return {
    sessionId: "saved-session",
    analysisId: "analysis-saved",
    status: "ready",
    qualification: "Known incomplete record: some evidence may be missing.",
    sources: f.record.events.map((e, i) => ({ id: e._id, eventKey: `key-${i}`, atMs: e.atMs, evidence: e.evidence! })),
    proposals: Array.from({ length: count }, (_, i) => ({
      id: `row-${i}`,
      proposal: { ...f.proposal!, proposalId: `p${i}` },
    })),
    decisions: [],
    review: null,
  };
}
async function harness(page: Page, initial = snapshot()) {
  let current = initial;
  const writes: ReviewCommand[] = [];
  let failWrite = false;
  let failRead = false;
  let delayWrite: Promise<void> | null = null;
  let delayRead: Promise<void> | null = null;
  const unexpected: string[] = [];
  await page.route("**/api/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/api/parent-review")) {
      const command = route.request().postDataJSON() as ReviewCommand;
      if (command.operation === "get") {
        const captured = structuredClone(current);
        if (delayRead) await delayRead;
        return route.fulfill({
          status: failRead ? 409 : 200,
          json: failRead ? { error: "private error must not display" } : captured,
        });
      }
      writes.push(command);
      if (delayWrite) await delayWrite;
      if (command.operation === "decide") {
        if (!current.decisions.some(row => row.proposalRowId === command.proposalRowId))
          current.decisions.push({
            proposalRowId: command.proposalRowId,
            decision: { ...command.decision, reviewedAt: 100 } as ParentDecision,
          });
      } else {
        if (command.operation === "acceptAll")
          current.decisions = current.proposals.map(row => ({
            proposalRowId: row.id,
            decision: {
              kind: "parent_decision",
              proposalId: row.proposal.proposalId,
              decision: "accepted",
              reviewedAt: 100,
            },
          }));
        current.review = {
          repairLevel: command.repairLevel ?? "verified",
          ...(command.note ? { note: command.note } : {}),
          emptyAcknowledged: Boolean(command.acknowledgeEmpty),
          completedAt: 100,
        };
      }
      const fail = failWrite;
      failWrite = false;
      return route.fulfill({
        status: fail ? 409 : 200,
        json: fail ? { error: "private error must not display" } : { saved: true },
      });
    }
    if (url.endsWith("/api/query")) {
      const id = route.request().postDataJSON().args[0].sessionId;
      return route.fulfill({
        json: {
          status: "success",
          value: {
            session: {
              _id: id,
              state: "ended",
              recordStatus: "incomplete",
              createdAt: 1,
              recording: { storageId: "synthetic", mimeType: "audio/wav", startOffsetMs: 2000, durationMs: 30000 },
            },
            events: current.sources.map((source, order) => ({ ...source, order })),
            recordingUrl: "https://synthetic-audio.invalid/saved.wav",
          },
        },
      });
    }
    if (url.endsWith("/api/observer/retry")) {
      current.status = "pending";
      return route.fulfill({ json: { status: "scheduled" } });
    }
    unexpected.push(url);
    return route.abort();
  });
  const wav = Buffer.alloc(44 + 8000 * 30 * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await page.route("https://synthetic-audio.invalid/**", route => {
    const range = route
      .request()
      .headers()
      ["range"]?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : wav.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "audio/wav",
      headers: {
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` } : {}),
      },
      body: wav.subarray(start, end + 1),
    });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("sprout.latest-session-reference.v1"))
      localStorage.setItem("sprout.latest-session-reference.v1", "saved-session");
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Parent observation review" });
  await expect(panel).toBeVisible();
  return {
    panel,
    writes,
    unexpected,
    setCurrent: (value: ReviewSnapshot) => {
      current = value;
    },
    getCurrent: () => current,
    failNextWrite: () => {
      failWrite = true;
    },
    failReads: (value: boolean) => {
      failRead = value;
    },
    delayWrites: (value: Promise<void> | null) => {
      delayWrite = value;
    },
    delayReads: (value: Promise<void> | null) => {
      delayRead = value;
    },
  };
}

test("inspects canonical sources, seeks with start offset and accepts unchanged after reload", async ({ page }) => {
  const h = await harness(page);
  await expect(h.panel.getByText("Observer analysis: ready")).toBeVisible();
  await expect(h.panel.getByText(/Known incomplete/)).toBeVisible();
  const article = h.panel.getByRole("article");
  await expect(article.getByText(/Behavior: quantity identification/)).toBeVisible();
  await article.getByText("Supporting canonical exchange").click();
  await expect(article.getByText(/Event key key-1/)).toBeVisible();
  await expect(article.getByText(/Three/)).toBeVisible();
  await expect(article.getByText(/Scene actually displayed/)).toBeVisible();
  const audio = page.getByLabel("Full-session recording");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState)).toBe(4);
  await article.getByRole("button", { name: "Play exchange" }).click();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(10);
  const position = await audio.evaluate((a: HTMLAudioElement) => {
    a.pause();
    return a.currentTime;
  });
  expect(position).toBeGreaterThanOrEqual(10);
  expect(position).toBeLessThan(11);
  await expect(article.getByText("Exchange: 20000 ms from session start")).toBeVisible();
  // Ordinary event inspection still seeks to the flush event, applying the offset once.
  await page.getByRole("button", { name: "Play from here" }).nth(1).click();
  const eventPosition = await audio.evaluate((a: HTMLAudioElement) => {
    a.pause();
    return a.currentTime;
  });
  expect(eventPosition).toBeGreaterThanOrEqual(18);
  expect(eventPosition).toBeLessThan(19);
  await article.getByRole("button", { name: "Accept unchanged", exact: true }).click();
  await expect(article.getByText("Saved parent decision: accepted")).toBeVisible();
  await expect(article.getByRole("button", { name: "Light correction" })).toHaveCount(0);
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText(/Review complete · verified/)).toBeVisible();
  await page.reload();
  await expect(h.panel.getByText(/Review complete · verified/)).toBeVisible();
  await expect(h.panel.getByText("Original Observer proposal · p0")).toBeVisible();
  expect(h.unexpected).toEqual([]);
});

for (const missing of ["speech bounds", "response source"] as const)
  test(`exchange playback falls back to event time without ${missing}`, async ({ page }) => {
    const state = snapshot();
    const response = state.sources.find(source => source.evidence.type === "utterance")!;
    if (missing === "speech bounds" && response.evidence.type === "utterance") {
      delete response.evidence.startMs;
      delete response.evidence.endMs;
    } else {
      state.sources = state.sources.filter(source => source.id !== response.id);
    }
    const original = structuredClone(state.proposals);
    const h = await harness(page, state);
    const audio = page.getByLabel("Full-session recording");
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState)).toBe(4);
    await h.panel.getByRole("button", { name: "Play exchange" }).click();
    const position = await audio.evaluate((a: HTMLAudioElement) => {
      a.pause();
      return a.currentTime;
    });
    expect(position).toBeGreaterThanOrEqual(18);
    expect(position).toBeLessThan(19);
    expect(h.getCurrent().proposals).toEqual(original);
    expect(h.writes).toEqual([]);
    expect(h.unexpected).toEqual([]);
  });

test("accept-all is one explicit write and survives reload", async ({ page }) => {
  const h = await harness(page, snapshot(2));
  await h.panel.getByRole("button", { name: "Accept all unchanged and finish" }).click();
  await expect(h.panel.getByText(/Review complete · verified/)).toBeVisible();
  expect(h.writes.map(x => x.operation)).toEqual(["acceptAll"]);
  await page.reload();
  await expect(h.panel.getByText("Saved parent decision: accepted")).toHaveCount(2);
  expect(h.unexpected).toEqual([]);
});

test("saves assistance/pointing correction, rejection and mixed review with note while retaining originals", async ({
  page,
}) => {
  const h = await harness(page, snapshot(3));
  const articles = h.panel.getByRole("article");
  await articles.nth(0).getByRole("button", { name: "Accept unchanged", exact: true }).click();
  await expect(articles.nth(0).getByText("Saved parent decision: accepted")).toBeVisible();
  await articles.nth(1).getByRole("button", { name: "Light correction" }).click();
  await articles.nth(1).getByLabel("Corrected observation").fill("Identified the total after my help.");
  await articles.nth(1).getByLabel("I provided assistance").check();
  await articles.nth(1).getByLabel("I observed pointing or touch-counting").check();
  await articles.nth(1).getByLabel("Parent explanation").fill("I helped and watched her point.");
  await articles.nth(1).getByRole("button", { name: "Save correction" }).click();
  await expect(articles.nth(1).getByText("Saved parent decision: corrected")).toBeVisible();
  const command = h.writes[1];
  expect(command.operation).toBe("decide");
  if (command.operation === "decide") {
    expect(command.decision.parentContext).toMatchObject({
      assistance: ["parent_reported_assistance"],
      pointingOrTouchCounting: true,
    });
    expect(command.decision.correction?.support).toEqual(snapshot().proposals[0].proposal.observation.support);
  }
  await expect(h.panel.getByRole("button", { name: "Accept all unchanged and finish" })).toBeDisabled();
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toBeDisabled();
  await articles.nth(2).getByRole("button", { name: "Reject proposal" }).click();
  await articles.nth(2).getByLabel("Rejection reason").fill("That was the parent speaking.");
  await articles.nth(2).getByRole("button", { name: "Save rejection" }).click();
  await expect(articles.nth(2).getByText("Saved parent decision: rejected")).toBeVisible();
  await h.panel.getByLabel("Parent repair level").selectOption("light_correction");
  await h.panel.getByLabel("Optional review note").fill("One correction and one rejection.");
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText(/Review complete · light correction/)).toBeVisible();
  await page.reload();
  await expect(h.panel.getByText("Original Observer proposal · p1")).toBeVisible();
  await expect(h.panel.getByText("Identified the total after my help.")).toBeVisible();
  await expect(h.panel.getByText(/Reason: That was the parent/)).toBeVisible();
  await expect(h.panel.getByText(/Review note: One correction/)).toBeVisible();
  expect(h.unexpected).toEqual([]);
});

test("empty READY needs explicit acknowledgment and never writes decisions", async ({ page }) => {
  const h = await harness(page, snapshot(0));
  await expect(h.panel.getByText(/READY summary: no usable observations/)).toBeVisible();
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toBeDisabled();
  await h.panel.getByLabel("I acknowledge this empty READY summary").check();
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText("Empty summary explicitly acknowledged.")).toBeVisible();
  expect(h.writes).toEqual([
    {
      operation: "complete",
      sessionId: "saved-session",
      analysisId: "analysis-saved",
      repairLevel: "verified",
      acknowledgeEmpty: true,
    },
  ]);
});

for (const status of ["not_started", "pending", "running", "failed"] as const)
  test(`${status} is distinct from empty READY; explicit retry refreshes saved state`, async ({ page }) => {
    const initial = { ...snapshot(0), status, analysisId: status === "not_started" ? null : "analysis-saved" };
    const h = await harness(page, initial);
    await expect(h.panel.getByText(`Observer analysis: ${status.replaceAll("_", " ")}`)).toBeVisible();
    await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toHaveCount(0);
    await expect(h.panel.getByLabel("I acknowledge this empty READY summary")).toHaveCount(0);
    await h.panel.getByRole("button", { name: "Retry Observer analysis" }).click();
    await expect(h.panel.getByText("Observer analysis: pending")).toBeVisible();
    expect(h.writes).toEqual([]);
    expect(h.unexpected).toEqual([]);
  });

test("uncertain writes refresh persistence, prevent duplicate clicks and retry identical payload", async ({ page }) => {
  const h = await harness(page);
  let release!: () => void;
  h.delayWrites(
    new Promise<void>(resolve => {
      release = resolve;
    }),
  );
  h.failNextWrite();
  h.failReads(true);
  const accept = h.panel.getByRole("button", { name: "Accept unchanged", exact: true });
  await accept.click();
  await expect(accept).toBeDisabled();
  expect(h.writes).toHaveLength(1);
  release();
  h.delayWrites(null);
  await expect(h.panel.getByRole("alert")).toContainText("Save and refresh could not be confirmed");
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toBeDisabled();
  await expect(accept).toBeDisabled();
  h.failReads(false);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByText("Saved parent decision: accepted")).toBeVisible();
  await h.panel.getByRole("button", { name: "Retry identical save" }).click();
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
  expect(h.writes).toHaveLength(2);
  expect(h.writes[1]).toEqual(h.writes[0]);
  expect(h.getCurrent().decisions).toHaveLength(1);
  await expect(h.panel.getByText("private error", { exact: false })).toHaveCount(0);
});

test("read failure recovers; a wrong-session read cannot enable decisions", async ({ page }) => {
  const h = await harness(page);
  h.failReads(true);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByRole("alert")).toContainText("could not be refreshed");
  h.failReads(false);
  h.setCurrent({ ...snapshot(), sessionId: "wrong-session" });
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByRole("alert")).toContainText("could not be refreshed");
  h.setCurrent(snapshot());
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByRole("alert")).toHaveCount(0);
  expect(h.writes).toEqual([]);
});

test("late read from previous inspection does not replace recovered session identity", async ({ page }) => {
  const h = await harness(page);
  let release!: () => void;
  h.delayReads(
    new Promise<void>(resolve => {
      release = resolve;
    }),
  );
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  h.setCurrent({ ...snapshot(0), sessionId: "new-session", analysisId: "new-analysis" });
  await page.evaluate(() => localStorage.setItem("sprout.latest-session-reference.v1", "new-session"));
  h.delayReads(null);
  await page.reload();
  await expect(h.panel.getByText(/READY summary: no usable observations/)).toBeVisible();
  release();
  await expect(h.panel.getByText("Original Observer proposal · p0")).toHaveCount(0);
  await h.panel.getByLabel("I acknowledge this empty READY summary").check();
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  expect(h.writes[0].sessionId).toBe("new-session");
});

test("missing scene timing stays uncertain through parent correction", async ({ page }) => {
  const state = snapshot();
  state.proposals[0].proposal.observation = {
    behavior: "uncertain_exchange",
    outcome: "uncertain",
    speakerAttribution: "unknown",
    countSequenceObserved: false,
    description: "Timing unclear.",
    support: { status: "not_established", kinds: [], sourceEventIds: [] },
    uncertaintyReasons: ["missing_scene_context"],
  };
  const h = await harness(page, state);
  await h.panel.getByRole("button", { name: "Light correction" }).click();
  await expect(h.panel.getByLabel("Observed behavior")).toBeDisabled();
  await h.panel.getByLabel("Parent explanation").fill("I can identify the speaker, but not the scene timing.");
  await h.panel.getByLabel("Speaker interpretation").selectOption("child_or_nearby_speaker");
  await h.panel.getByRole("button", { name: "Save correction" }).click();
  await expect(h.panel.getByText("Saved parent decision: corrected")).toBeVisible();
  const command = h.writes[0];
  if (command.operation === "decide")
    expect(command.decision.correction).toMatchObject({
      behavior: "uncertain_exchange",
      uncertaintyReasons: ["missing_scene_context"],
      speakerAttribution: "child_or_nearby_speaker",
    });
});

test("spoken counting and recorded help remain distinct from a correct total alone", async ({ page }) => {
  const state = snapshot();
  const source = structuredClone(observationFixtures[2]);
  source.proposal!.sessionId = state.sessionId;
  state.proposals[0].proposal = { ...source.proposal!, proposalId: "p0" };
  state.sources = source.record.events.map((event, i) => ({
    id: event._id,
    eventKey: `key-${i}`,
    atMs: event.atMs,
    evidence: event.evidence!,
  }));
  const h = await harness(page, state);
  await expect(h.panel.getByRole("article").getByText(/Behavior: counting aloud with total/)).toBeVisible();
  await expect(h.panel.getByText(/Spoken count sequence: Observed/)).toBeVisible();
  await expect(h.panel.getByText(/Recorded support: recorded · hint, counting together/)).toBeVisible();
  await h.panel.getByText("Supporting canonical exchange").click();
  await expect(h.panel.getByText(/Try starting with one; count with me/)).toBeVisible();
  expect(h.writes).toEqual([]);
});

test("initial read and Observer retry failures remain safe and recover explicitly", async ({ page }) => {
  const h = await harness(page, { ...snapshot(0), status: "failed" });
  h.failReads(true);
  await page.reload();
  await expect(h.panel.getByRole("alert")).toContainText("Saved review could not be loaded");
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toHaveCount(0);
  h.failReads(false);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByText("Observer analysis: failed")).toBeVisible();
  await page.route("**/api/observer/retry", route =>
    route.fulfill({ status: 409, json: { error: "private provider diagnostic" } }),
  );
  await h.panel.getByRole("button", { name: "Retry Observer analysis" }).click();
  await expect(h.panel.getByRole("alert")).toContainText("Observer retry could not be confirmed");
  await expect(h.panel.getByText(/private provider diagnostic/)).toHaveCount(0);
  await page.unroute("**/api/observer/retry");
  await h.panel.getByRole("button", { name: "Retry Observer analysis" }).click();
  await expect(h.panel.getByText("Observer analysis: pending")).toBeVisible();
  expect(h.writes).toEqual([]);
});
