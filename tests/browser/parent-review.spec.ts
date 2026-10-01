import { test, expect, type Page } from "@playwright/test";
import { observationFixtures } from "../fixtures/observation-contracts";
import type { ReviewCommand, ReviewSnapshot } from "../../lib/parent-review";
import type { ParentDecision } from "../../lib/observation-contracts";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
])
  test(`synthetic review presentation at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const h = await harness(page, snapshot(), false);
    await expect(h.panel.getByRole("button", { name: "Looks right" })).toBeVisible();
    await h.panel.screenshot({ path: testInfo.outputPath(`check-in-${viewport.width}.png`) });
    await expandReview(page, h.panel);
    const article = h.panel.getByRole("article");
    await article.getByText("Check this exchange").click();
    await expect(article.getByText(/Scene actually displayed/)).toBeVisible();
    await expect(article.getByRole("button", { name: "Play exchange" })).toBeVisible();
    await article.getByRole("button", { name: "Edit details" }).click();
    await expect(article.getByLabel("I provided assistance")).toBeVisible();
    await expect(article.getByLabel("I observed pointing or touch-counting")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await h.panel.screenshot({ path: testInfo.outputPath(`review-${viewport.width}.png`) });
    expect(h.writes).toEqual([]);
    expect(h.unexpected).toEqual([]);
  });

function snapshot(count = 1): ReviewSnapshot {
  const f = structuredClone(observationFixtures[0]);
  f.proposal!.sessionId = "saved-session";
  const response = f.record.events.find(event => event._id === "sessionEvents_synthetic_answer_1")!;
  response.atMs = 20000; // Speech was flushed/saved well after it finished.
  if (response.evidence?.type === "utterance") {
    response.evidence.startMs = 12000;
    response.evidence.endMs = 14000;
    response.evidence.sessionTiming = { clock: "session", provenance: "mapped_provider", startMs: 12000, endMs: 14000 };
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
async function harness(page: Page, initial = snapshot(), expand = true) {
  let current = initial;
  const writes: ReviewCommand[] = [];
  let failWrite = false;
  let persistFailedWrite = true;
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
      const fail = failWrite;
      failWrite = false;
      let conflict = false;
      if (!fail || persistFailedWrite) {
        if (command.operation === "decide") {
          const prior = current.decisions.find(row => row.proposalRowId === command.proposalRowId);
          if (prior) {
            const { reviewedAt, ...input } = prior.decision;
            void reviewedAt;
            conflict = JSON.stringify(input) !== JSON.stringify(command.decision);
          } else if (current.review) conflict = true;
          else
            current.decisions.push({
              proposalRowId: command.proposalRowId,
              decision: { ...command.decision, reviewedAt: 100 } as ParentDecision,
            });
        } else {
          const empty = current.proposals.length === 0;
          const incompatible = current.decisions.some(row => row.decision.decision !== "accepted");
          conflict =
            (empty && command.acknowledgeEmpty !== true) ||
            (!empty && command.acknowledgeEmpty === true) ||
            ((command.operation === "acceptAll" || command.repairLevel === "verified") && incompatible) ||
            (command.operation === "complete" &&
              current.proposals.some(row => !current.decisions.some(decision => decision.proposalRowId === row.id)));
          const nextReview = {
            repairLevel: command.repairLevel ?? "verified",
            ...(command.note ? { note: command.note } : {}),
            emptyAcknowledged: empty,
            completedAt: 100,
          };
          if (current.review)
            conflict ||=
              current.review.repairLevel !== nextReview.repairLevel ||
              current.review.note !== nextReview.note ||
              current.review.emptyAcknowledged !== empty;
          if (!conflict) {
            if (command.operation === "acceptAll")
              for (const row of current.proposals)
                if (!current.decisions.some(decision => decision.proposalRowId === row.id))
                  current.decisions.push({
                    proposalRowId: row.id,
                    decision: {
                      kind: "parent_decision",
                      proposalId: row.proposal.proposalId,
                      decision: "accepted",
                      reviewedAt: 100,
                    },
                  });
            current.review ??= nextReview;
          }
        }
      }
      return route.fulfill({
        status: fail || conflict ? 409 : 200,
        json: fail || conflict ? { error: "private error must not display" } : { saved: true },
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
  if (expand && initial.status === "ready") await expandReview(page, panel);
  return {
    panel,
    writes,
    unexpected,
    setCurrent: (value: ReviewSnapshot) => {
      current = value;
    },
    getCurrent: () => current,
    failNextWrite: (persist = true) => {
      failWrite = true;
      persistFailedWrite = persist;
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

async function expandReview(page: Page, panel: ReturnType<Page["getByRole"]>) {
  await panel.locator(".individual-review > summary").click();
  for (const detail of await panel.getByText("Original proposal details", { exact: true }).all()) await detail.click();
  await page.getByText("Check the recording", { exact: true }).click();
  await page.getByText("Developer inspection", { exact: true }).click();
}

test("inspects canonical sources, seeks with start offset and accepts unchanged after reload", async ({ page }) => {
  const h = await harness(page);
  await expect(h.panel.getByText("Today’s observations")).toBeVisible();
  await expect(h.panel.getByText(/Known incomplete/)).toBeVisible();
  const article = h.panel.getByRole("article");
  await expect(article.getByText(/Behavior: quantity identification/)).toBeVisible();
  await article.getByText("Check this exchange").click();
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
  await expect(article.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText(/Review complete · How much you changed: Nothing/)).toBeVisible();
  await page.reload();
  await expect(h.panel.getByText(/Review complete · How much you changed: Nothing/)).toBeVisible();
  await expandReview(page, h.panel);
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
      delete response.evidence.sessionTiming;
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
  await h.panel.getByRole("button", { name: "Looks right" }).click();
  await expect(h.panel.getByText(/Review complete · How much you changed: Nothing/)).toBeVisible();
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
  await articles.nth(1).getByRole("button", { name: "Edit details" }).click();
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
  await expect(h.panel.getByRole("button", { name: "Looks right" })).toBeDisabled();
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toBeDisabled();
  await articles.nth(2).getByRole("button", { name: "Reject proposal" }).click();
  await articles.nth(2).getByLabel("Rejection reason").fill("That was the parent speaking.");
  await articles.nth(2).getByRole("button", { name: "Save rejection" }).click();
  await expect(articles.nth(2).getByText("Saved parent decision: rejected")).toBeVisible();
  await h.panel.getByLabel("How much did you need to correct Sprout’s observations?").selectOption("light_correction");
  await h.panel.getByLabel("How did the lesson go? (optional)").fill("One correction and one rejection.");
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText(/Review complete · How much you changed: A little/)).toBeVisible();
  await page.reload();
  await expandReview(page, h.panel);
  await expect(h.panel.getByText("Original Observer proposal · p1")).toBeVisible();
  await expect(h.panel.getByText("Identified the total after my help.", { exact: true })).toBeVisible();
  await expect(h.panel.getByText(/Reason: That was the parent/)).toBeVisible();
  await expect(h.panel.getByText(/Lesson feedback: One correction/)).toBeVisible();
  expect(h.unexpected).toEqual([]);
});

test("empty READY needs explicit acknowledgment and never writes decisions", async ({ page }) => {
  const h = await harness(page, snapshot(0));
  await expect(h.panel.getByText(/No usable observations were found/)).toBeVisible();
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toBeDisabled();
  await h.panel.getByLabel("I checked this summary with no observations").check();
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
    await expect(
      h.panel.getByText(
        {
          not_started: "Observations have not been prepared yet.",
          pending: "Waiting to prepare observations…",
          running: "Preparing observations…",
          failed: "Observations could not be prepared.",
        }[status],
      ),
    ).toBeVisible();
    await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toHaveCount(0);
    await expect(h.panel.getByLabel("I checked this summary with no observations")).toHaveCount(0);
    await h.panel.getByRole("button", { name: "Retry Observer analysis" }).click();
    await expect(h.panel.getByText("Waiting to prepare observations…")).toBeVisible();
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
  h.failNextWrite(false);
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
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toBeEnabled();
  await expect(accept).toBeDisabled();
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
  await expect(h.panel.getByText(/No usable observations were found/)).toBeVisible();
  release();
  await expect(h.panel.getByText("Original Observer proposal · p0")).toHaveCount(0);
  await h.panel.getByLabel("I checked this summary with no observations").check();
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
  await h.panel.getByRole("button", { name: "Edit details" }).click();
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
  await h.panel.getByText("Check this exchange").click();
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
  await expect(h.panel.getByText("Observations could not be prepared.")).toBeVisible();
  await page.route("**/api/observer/retry", route =>
    route.fulfill({ status: 409, json: { error: "private provider diagnostic" } }),
  );
  await h.panel.getByRole("button", { name: "Retry Observer analysis" }).click();
  await expect(h.panel.getByRole("alert")).toContainText("Observer retry could not be confirmed");
  await expect(h.panel.getByText(/private provider diagnostic/)).toHaveCount(0);
  await page.unroute("**/api/observer/retry");
  await h.panel.getByRole("button", { name: "Retry Observer analysis" }).click();
  await expect(h.panel.getByText("Waiting to prepare observations…")).toBeVisible();
  expect(h.writes).toEqual([]);
});

test("stale rejection conflicts with saved acceptance and recovers into completion without retry", async ({ page }) => {
  const initial = snapshot();
  const originals = structuredClone(initial.proposals);
  const h = await harness(page, initial);
  await h.panel.getByRole("button", { name: "Reject proposal" }).click();
  await h.panel.getByLabel("Rejection reason").fill("Stale rejection");
  const persisted = snapshot();
  persisted.decisions = [
    {
      proposalRowId: "row-0",
      decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted", reviewedAt: 50 },
    },
  ];
  h.setCurrent(persisted);
  h.failNextWrite();
  await h.panel.getByRole("button", { name: "Save rejection" }).click();
  await expect(h.panel.getByRole("alert")).toContainText("Save conflict");
  await expect(h.panel.getByText("Saved parent decision: accepted")).toBeVisible();
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toBeEnabled();
  expect(h.getCurrent().decisions).toEqual(persisted.decisions);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText(/Review complete · How much you changed: Nothing/)).toBeVisible();
  expect(h.writes.map(command => command.operation)).toEqual(["decide", "complete"]);
  expect(h.getCurrent().proposals).toEqual(originals);
});

for (const readFailure of [false, true])
  test(`lost response with persisted decision resolves without duplicate RPC (failed refresh: ${readFailure})`, async ({
    page,
  }) => {
    const h = await harness(page);
    h.failNextWrite();
    h.failReads(readFailure);
    await h.panel.getByRole("button", { name: "Accept unchanged", exact: true }).click();
    if (readFailure) {
      await expect(h.panel.getByRole("alert")).toContainText("Save and refresh");
      await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toBeDisabled();
      h.failReads(false);
      await h.panel.getByRole("button", { name: "Refresh review" }).click();
    }
    await expect(h.panel.getByText("Saved parent decision: accepted")).toBeVisible();
    await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
    await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toBeEnabled();
    expect(h.writes).toHaveLength(1);
  });

test("successful write followed by failed read reconciles on manual refresh", async ({ page }) => {
  const h = await harness(page);
  h.failReads(true);
  await h.panel.getByRole("button", { name: "Accept unchanged", exact: true }).click();
  await expect(h.panel.getByRole("alert")).toContainText("Save and refresh");
  h.failReads(false);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toBeEnabled();
  expect(h.writes).toHaveLength(1);
});

for (const operation of ["complete", "acceptAll"] as const)
  test(`conflicting ${operation} retains saved completion note and repair level`, async ({ page }) => {
    const initial = snapshot();
    initial.decisions = [
      {
        proposalRowId: "row-0",
        decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted", reviewedAt: 12 },
      },
    ];
    const h = await harness(page, initial);
    await expect(h.panel.getByText("Saved parent decision: accepted")).toBeVisible();
    await h.panel.getByLabel("How did the lesson go? (optional)").fill("Attempted note");
    const persisted = structuredClone(initial);
    persisted.review = {
      repairLevel: "light_correction",
      note: "Other tab's note",
      emptyAcknowledged: false,
      completedAt: 20,
    };
    h.setCurrent(persisted);
    await h.panel
      .getByRole("button", {
        name: operation === "complete" ? "Finish review" : "Looks right",
        exact: true,
      })
      .click();
    await expect(h.panel.getByRole("alert")).toContainText("Save conflict");
    await expect(h.panel.getByText(/Review complete · How much you changed: A little/)).toBeVisible();
    await expect(h.panel.getByText("Lesson feedback: Other tab's note")).toBeVisible();
    await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
    expect(h.getCurrent().review).toEqual(persisted.review);
    expect(h.writes).toHaveLength(1);
  });

for (const decision of ["corrected", "rejected"] as const)
  test(`accept-all conflict preserves stored ${decision} and permits remaining decisions and completion`, async ({
    page,
  }) => {
    const h = await harness(page, snapshot(2));
    const persisted = snapshot(2);
    const originals = structuredClone(persisted.proposals);
    persisted.decisions = [
      {
        proposalRowId: "row-0",
        decision: {
          kind: "parent_decision",
          proposalId: "p0",
          decision,
          reviewedAt: 30,
          ...(decision === "rejected"
            ? { rejectionReason: "Other tab rejected" }
            : {
                correction: { ...persisted.proposals[0].proposal.observation, description: "Other tab corrected" },
                parentContext: { provenance: "parent_review", note: "Other parent context" },
              }),
        },
      },
    ];
    const stored = structuredClone(persisted.decisions);
    h.setCurrent(persisted);
    await h.panel.getByRole("button", { name: "Looks right" }).click();
    await expect(h.panel.getByRole("alert")).toContainText("Save conflict");
    await expect(h.panel.getByText(`Saved parent decision: ${decision}`)).toBeVisible();
    await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
    await h.panel.getByRole("article").nth(1).getByRole("button", { name: "Accept unchanged", exact: true }).click();
    await h.panel
      .getByLabel("How much did you need to correct Sprout’s observations?")
      .selectOption("substantial_repair");
    await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
    await expect(h.panel.getByText(/Review complete · How much you changed: A lot/)).toBeVisible();
    expect(h.getCurrent().decisions[0]).toEqual(stored[0]);
    expect(h.getCurrent().proposals).toEqual(originals);
  });

test("partial accept-all without completion keeps exact note locked until identical retry", async ({ page }) => {
  const h = await harness(page, snapshot(2));
  await h.panel.getByLabel("How did the lesson go? (optional)").fill("Original bulk note");
  const partial = snapshot(2);
  partial.decisions = [
    {
      proposalRowId: "row-0",
      decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted", reviewedAt: 50 },
    },
  ];
  h.setCurrent(partial);
  h.failNextWrite(false);
  await h.panel.getByRole("button", { name: "Looks right" }).click();
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toBeEnabled();
  await expect(h.panel.getByRole("button", { name: "Accept unchanged", exact: true })).toBeDisabled();
  await expect(h.panel.getByLabel("How did the lesson go? (optional)")).toBeDisabled();
  h.failReads(true);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toBeDisabled();
  h.failReads(false);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await h.panel.getByRole("button", { name: "Retry identical save" }).click();
  await expect(h.panel.getByText(/Review complete · How much you changed: Nothing/)).toBeVisible();
  expect(h.writes[1]).toEqual(h.writes[0]);
  expect(h.getCurrent().decisions[0].decision.reviewedAt).toBe(50);
});

test("lost empty completion response resolves stored acknowledgment and note", async ({ page }) => {
  const h = await harness(page, snapshot(0));
  await h.panel.getByLabel("I checked this summary with no observations").check();
  await h.panel.getByLabel("How did the lesson go? (optional)").fill("Empty checked");
  h.failNextWrite();
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText("Empty summary explicitly acknowledged.")).toBeVisible();
  await expect(h.panel.getByText("Lesson feedback: Empty checked")).toBeVisible();
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
  expect(h.writes).toHaveLength(1);
});

for (const operation of ["complete", "acceptAll"] as const)
  test(`lost ${operation} response resolves full saved completion without another write`, async ({ page }) => {
    const initial = snapshot();
    if (operation === "complete")
      initial.decisions = [
        {
          proposalRowId: "row-0",
          decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted", reviewedAt: 4 },
        },
      ];
    const h = await harness(page, initial);
    await expect(h.panel.getByText("Today’s observations")).toBeVisible();
    await h.panel.getByLabel("How did the lesson go? (optional)").fill("Original completion");
    h.failNextWrite();
    await h.panel
      .getByRole("button", {
        name: operation === "complete" ? "Finish review" : "Looks right",
        exact: true,
      })
      .click();
    await expect(h.panel.getByText("Lesson feedback: Original completion")).toBeVisible();
    await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
    await expect(h.panel.getByRole("alert")).toHaveCount(0);
    expect(h.writes).toHaveLength(1);
  });

test("changed analysis cannot authorize an uncertain retry or a competing decision", async ({ page }) => {
  const h = await harness(page);
  h.failNextWrite(false);
  h.failReads(true);
  await h.panel.getByRole("button", { name: "Accept unchanged", exact: true }).click();
  await expect(h.panel.getByRole("alert")).toContainText("Save and refresh");
  h.setCurrent({ ...snapshot(), analysisId: "different-analysis" });
  h.failReads(false);
  await h.panel.getByRole("button", { name: "Refresh review" }).click();
  await expect(h.panel.getByRole("alert")).toContainText("original analysis");
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toBeDisabled();
  await expect(h.panel.getByRole("button", { name: "Accept unchanged", exact: true })).toBeDisabled();
  expect(h.writes).toHaveLength(1);
});

test("late failed write from an unmounted panel cannot lock a new inspection", async ({ page }) => {
  const h = await harness(page);
  let release!: () => void;
  h.delayWrites(
    new Promise<void>(resolve => {
      release = resolve;
    }),
  );
  h.failNextWrite(false);
  await h.panel.getByRole("button", { name: "Accept unchanged", exact: true }).click();
  await expect(h.panel.getByRole("button", { name: "Accept unchanged", exact: true })).toBeDisabled();
  h.setCurrent({ ...snapshot(0), sessionId: "new-session", analysisId: "new-analysis" });
  await page.evaluate(() => localStorage.setItem("sprout.latest-session-reference.v1", "new-session"));
  await page.reload();
  await expect(h.panel.getByText(/No usable observations were found/)).toBeVisible();
  release();
  h.delayWrites(null);
  await h.panel.getByLabel("I checked this summary with no observations").check();
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText(/Review complete · How much you changed: Nothing/)).toBeVisible();
  expect(h.writes[1].sessionId).toBe("new-session");
  await expect(h.panel.getByRole("button", { name: "Retry identical save" })).toHaveCount(0);
});

test("raw model narrative stays inspectable and is never prefilled as a parent correction", async ({ page }) => {
  const initial = snapshot();
  const unsupported = "The child mastered counting and independently touch-counted every object.";
  initial.proposals[0].proposal.observation.description = unsupported;
  const originals = structuredClone(initial.proposals);
  const h = await harness(page, initial, false);
  const displayed = "The displayed quantity 3 was identified correctly.";
  await expect(h.panel.locator(".review-summary").getByText(displayed, { exact: true })).toBeVisible();
  await expect(h.panel.getByText(unsupported, { exact: true })).not.toBeVisible();
  await h.panel.getByRole("button", { name: "Make a correction", exact: true }).click();
  const article = h.panel.getByRole("article");
  await article.getByText("Original proposal details", { exact: true }).click();
  await expect(article.getByText(unsupported, { exact: true })).toBeVisible();
  await article.getByRole("button", { name: "I helped", exact: true }).click();
  await expect(article.getByLabel("Corrected observation")).toHaveValue(displayed);
  await article.getByRole("button", { name: "Save correction", exact: true }).click();
  const command = h.writes[0];
  expect(command.operation).toBe("decide");
  if (command.operation === "decide") {
    expect(command.decision.correction?.description).toBe(displayed);
    expect(command.decision.parentContext?.assistance).toEqual(["parent_reported_assistance"]);
  }
  expect(h.getCurrent().proposals).toEqual(originals);
  expect(h.unexpected).toEqual([]);
});

test("daily check-in hides technical detail, offers correction choices and persists lesson feedback", async ({
  page,
}) => {
  const h = await harness(page, snapshot(2), false);
  await expect(h.panel.getByRole("heading", { name: "Today’s observations" })).toBeVisible();
  await expect(h.panel.getByText("Original Observer proposal · p0")).not.toBeVisible();
  await expect(page.getByLabel("Full-session recording")).not.toBeVisible();
  await h.panel.getByRole("button", { name: "Make a correction", exact: true }).click();
  const first = h.panel.getByRole("article").first();
  await expect(first.getByRole("button", { name: "The observation is inaccurate", exact: true })).toBeVisible();
  await expect(first.getByRole("button", { name: "Add context", exact: true })).toBeVisible();
  await first.getByRole("button", { name: "I helped", exact: true }).click();
  await expect(first.getByLabel("I provided assistance")).toBeChecked();
  await first.getByRole("button", { name: "Save correction", exact: true }).click();
  const second = h.panel.getByRole("article").nth(1);
  await second.getByRole("button", { name: "The speaker was someone else", exact: true }).click();
  await expect(second.getByLabel("Rejection reason")).toHaveValue("The speaker was someone else.");
  await second.getByRole("button", { name: "Save rejection", exact: true }).click();
  await h.panel.getByLabel("How much did you need to correct Sprout’s observations?").selectOption("light_correction");
  await h.panel.getByLabel("How did the lesson go? (optional)").fill("A short, happy lesson.");
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await page.reload();
  await expect(h.panel.getByText("Lesson feedback: A short, happy lesson.")).toBeVisible();
  await expect(h.panel.getByText(/How much you changed: A little/)).toBeVisible();
  expect(h.writes.map(command => command.operation)).toEqual(["decide", "decide", "complete"]);
  expect(h.unexpected).toEqual([]);
});

test("legacy timing review exposes rejection and completion instead of analysis retry", async ({ page }) => {
  const initial = snapshot(2);
  initial.proposals[0].resolution = "reject_only";
  initial.qualification =
    "Saved proposals have unverified speech timing. Reject undecided affected proposals to exclude them, then finish review.";
  const originals = structuredClone(initial.proposals);
  const h = await harness(page, initial, false);
  await expect(h.panel.getByRole("button", { name: "Looks right", exact: true })).toBeDisabled();
  await expect(h.panel.getByRole("button", { name: "Retry Observer analysis", exact: true })).toHaveCount(0);
  await expect(
    h.panel.locator(".review-summary").getByText("Saved observation has unverified speech timing."),
  ).toBeVisible();
  await h.panel.getByRole("button", { name: "Review individually", exact: true }).click();
  const legacy = h.panel.getByRole("article").first();
  await expect(legacy.getByRole("button", { name: "Accept unchanged", exact: true })).toBeDisabled();
  for (const name of ["Edit details", "I helped", "Add context", "The observation is inaccurate"])
    await expect(legacy.getByRole("button", { name, exact: true })).toBeDisabled();
  await legacy.getByRole("button", { name: "Reject proposal", exact: true }).click();
  await legacy.getByLabel("Rejection reason").fill("Speech timing cannot be verified.");
  await legacy.getByRole("button", { name: "Save rejection", exact: true }).click();
  await expect(legacy.getByText("Saved parent decision: rejected")).toBeVisible();
  await h.panel.getByRole("article").nth(1).getByRole("button", { name: "Accept unchanged", exact: true }).click();
  await h.panel.getByLabel("How much did you need to correct Sprout’s observations?").selectOption("light_correction");
  await h.panel.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(h.panel.getByText(/Review complete/)).toBeVisible();
  await page.reload();
  await expect(h.panel.getByText(/Review complete/)).toBeVisible();
  await expect(h.panel.getByRole("button", { name: "Retry Observer analysis", exact: true })).toHaveCount(0);
  expect(h.getCurrent().proposals).toEqual(originals);
  expect(h.writes.map(command => command.operation)).toEqual(["decide", "decide", "complete"]);
  expect(h.unexpected).toEqual([]);
});

test("completed historical acceptance stays final and shows unsupported timing without retry", async ({ page }) => {
  const initial = snapshot();
  initial.proposals[0].resolution = "reject_only";
  initial.qualification =
    "Historical decisions remain final; previously endorsed invalid evidence still blocks planning.";
  initial.decisions = [
    {
      proposalRowId: "row-0",
      decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted", reviewedAt: 1 },
    },
  ];
  initial.review = { repairLevel: "verified", emptyAcknowledged: false, completedAt: 2 };
  const before = structuredClone(initial);
  const h = await harness(page, initial);
  await expect(h.panel.getByText("Saved parent decision: accepted")).toBeVisible();
  await expect(
    h.panel.locator(".review-summary").getByText("Saved observation has unverified speech timing."),
  ).toBeVisible();
  await expect(h.panel.getByText(/previously endorsed invalid evidence still blocks planning/)).toBeVisible();
  await expect(h.panel.getByRole("button", { name: "Reject proposal", exact: true })).toHaveCount(0);
  await expect(h.panel.getByRole("button", { name: "Finish review", exact: true })).toHaveCount(0);
  await expect(h.panel.getByRole("button", { name: "Retry Observer analysis", exact: true })).toHaveCount(0);
  expect(h.writes).toEqual([]);
  expect(h.getCurrent()).toEqual(before);
});
