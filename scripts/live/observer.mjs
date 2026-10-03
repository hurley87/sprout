// Mirrors lib/transcript.ts UTTERANCE_GAP_MS; a parity test guards against drift.
// Kept local so this plain-Node harness does not load production TypeScript imports.
export const SPROUT_UTTERANCE_GAP_MS = 2500;

/** Deterministic projection. `at` uses the browser clock; provider times stay separate. */
export class LiveEventJournal {
  constructor({ quietMs = SPROUT_UTTERANCE_GAP_MS } = {}) {
    if (!Number.isFinite(quietMs) || quietMs <= 0) throw new Error("quietMs must be positive");
    this.quietMs = quietMs;
    this.events = [];
    this.scene = null;
    this.turn = null;
  }

  emit(kind, data) {
    this.events.push({ ...data, kind, cursor: this.events.length + 1 });
  }

  endTurn(at, reason) {
    this.emit("turn-end", { ...this.turn, at, reason });
    this.turn = null;
  }

  // Conservative transcript-based approximation, NOT physical remote audio completion.
  // Once published, an end cannot be undone by an arbitrarily late provider packet.
  flush(now) {
    if (this.turn && now - this.turn.lastAt >= this.quietMs) {
      this.endTurn(this.turn.lastAt + this.quietMs, "quiet-fallback");
    }
  }

  ingest(entries, now) {
    for (const event of entries) {
      if (event.dir === "in" && event.type === "session.output_transcript.delta") {
        this.emit("sprout-transcript-fragment", { at: event.at, text: event.delta, event });
        const hasTiming =
          Number.isFinite(event.start_ms) &&
          Number.isFinite(event.end_ms) &&
          event.start_ms >= 0 &&
          event.end_ms >= event.start_ms;
        if (this.turn) {
          if (hasTiming && this.turn.providerEndMs !== null) {
            // Provider timing takes precedence over uneven delivery in this batch.
            if (event.start_ms - this.turn.providerEndMs > SPROUT_UTTERANCE_GAP_MS) {
              this.endTurn(event.at, "provider-gap");
            }
          } else {
            // Missing/malformed provider timestamps use the conservative arrival fallback.
            this.flush(event.at);
          }
        }
        if (!this.turn) {
          this.turn = { startedAt: event.at, lastAt: event.at, providerStartMs: null, providerEndMs: null, event };
          this.emit("turn-start", { at: event.at, event });
        }
        if (hasTiming) {
          this.turn.providerStartMs ??= event.start_ms;
          this.turn.providerEndMs = Math.max(this.turn.providerEndMs ?? event.end_ms, event.end_ms);
        }
        this.turn.lastAt = event.at;
      } else if (event.dir === "in" && event.type === "session.input_transcript.delta") {
        this.emit("child-transcript", { at: event.at, text: event.delta, event });
      } else if (event.dir === "child" && event.action === "playback-start") {
        this.emit("playback-start", { at: event.at, event });
      } else if (event.dir === "scene") {
        const from = this.scene;
        this.scene = event.scene;
        if (from !== this.scene) this.emit("scene", { from, to: this.scene, at: event.at, event });
      } else if (
        (event.dir === "in" && event.type === "session.closed") ||
        (event.dir === "ui" && event.live === false)
      ) {
        this.emit("session-end", { at: event.at, event });
      }
    }
    this.flush(now);
  }
}

/**
 * Each wait kind consumes its own retained event stream, starting at the instrumentation log origin.
 * checkpoint() provides a shared boundary before an action. Explicit `after` waits
 * can replay a boundary; default waits consume matches exactly once per kind.
 * Turn-end is a conservative transcript-based approximation, not proof that remote
 * audio playback has physically completed. quietMs defaults to the 2500ms utterance
 * gap; valid provider timing defines grouping, with arrival quiet as the fallback.
 */
export function createLiveObserver(page, { quietMs = SPROUT_UTTERANCE_GAP_MS, timeoutMs = 30000, pollMs = 50 } = {}) {
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new Error("pollMs must be positive");
  const journal = new LiveEventJournal({ quietMs });
  const cursors = new Map();
  let offset = 0;
  let recent = [];
  let refreshing;
  async function refresh() {
    // Share a read when concurrent waiters poll; never ingest the same entries twice.
    if (!refreshing) {
      refreshing = (async () => {
        const snapshot = await page.evaluate(
          start => ({
            entries: (window.__liveLog ?? []).slice(start),
            now: window.__liveNow(),
          }),
          offset,
        );
        offset += snapshot.entries.length;
        recent = [...recent, ...snapshot.entries].slice(-8);
        journal.ingest(snapshot.entries, snapshot.now);
      })().finally(() => {
        refreshing = null;
      });
    }
    await refreshing;
  }

  async function wait(kind, predicate, options = {}) {
    const duration = options.timeoutMs ?? timeoutMs;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("timeoutMs must be positive");
    const after = options.after ?? cursors.get(kind) ?? 0;
    if (!Number.isInteger(after) || after < 0) throw new Error("after must be a checkpoint cursor");
    const description = options.description ?? kind;
    let timer;
    let expired = false;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(
          new Error(
            `Timed out waiting for ${description} after ${duration}ms; current scene: ${journal.scene}; recent live log: ${JSON.stringify(recent)}`,
          ),
        );
      }, duration);
    });
    try {
      return await Promise.race([
        (async () => {
          while (!expired) {
            await refresh();
            if (expired) return;
            const boundary = options.after === undefined ? Math.max(after, cursors.get(kind) ?? 0) : after;
            const match = journal.events.find(
              event => event.cursor > boundary && event.kind === kind && predicate(event),
            );
            if (match) {
              cursors.set(kind, Math.max(cursors.get(kind) ?? 0, match.cursor));
              return match;
            }
            await new Promise(resolve => setTimeout(resolve, pollMs));
          }
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async snapshot() {
      await refresh();
      return { scene: journal.scene, cursor: journal.events.length, events: structuredClone(journal.events) };
    },
    async currentScene() {
      await refresh();
      return journal.scene;
    },
    async checkpoint() {
      await refresh();
      return journal.events.length;
    },
    waitForSproutTurnStart: options => wait("turn-start", () => true, options),
    waitForSproutTurnEnd: options => wait("turn-end", () => true, options),
    waitForScene: (scene, options) =>
      wait("scene", event => event.to === scene, { description: `scene ${scene}`, ...options }),
    waitForSceneAdvance: options => wait("scene", event => event.from !== null && event.to !== null, options),
    waitForChildTranscript: options => wait("child-transcript", () => true, options),
    waitForSessionEnd: options => wait("session-end", () => true, options),
  };
}
