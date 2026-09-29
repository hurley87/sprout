/**
 * Executable reference contract for issue #36, NOT a production transport API.
 * Commit 2 must run these scenarios against its real handoff implementation.
 * Readiness, application permission and source authority are independent facts;
 * transcript/media quiet and steering acknowledgments establish none of them.
 */
export type SourcePort = {
  block(blocked: boolean): void;
  stop(): void;
};

export class ResponseSourceContract {
  readonly trace: string[] = [];
  private sources = new Map<string, { port: SourcePort; ready: boolean; retired: boolean }>();
  private authority?: string;
  private pending?: string;
  private identity?: string;
  private permitted = false;
  private childActive = false;
  private ended = false;
  private recovery?: ReturnType<typeof setTimeout>;

  add(epoch: string, port: SourcePort) {
    if (this.sources.has(epoch)) throw new Error("Epochs must be unique");
    port.block(true);
    this.sources.set(epoch, { port, ready: false, retired: this.ended });
    if (this.ended) port.stop();
  }

  ready(epoch: string) {
    const source = this.sources.get(epoch);
    if (!source || source.retired || this.ended) return;
    source.ready = true;
    this.trace.push(`ready:${epoch}`);
    // Becoming ready alone never changes authority or permission.
  }

  begin(epoch: string, identity: string, budgetMs: number, onExpired: () => void) {
    if (this.ended) return;
    if (this.pending && this.pending !== epoch && this.pending !== this.authority) this.retire(this.pending);
    this.pending = epoch;
    this.identity = identity;
    this.permitted = false;
    this.sync();
    // Revisions and retries share the first response's recovery budget.
    this.recovery ??= setTimeout(() => {
      this.end();
      onExpired();
    }, budgetMs);
  }

  activate(epoch: string) {
    const replacement = this.sources.get(epoch);
    if (this.ended || epoch !== this.pending || !replacement?.ready || replacement.retired) return false;
    if (this.authority && this.authority !== epoch) this.retire(this.authority);
    this.authority = epoch;
    this.trace.push(`authority:${epoch}`);
    this.sync();
    return true;
  }

  retire(epoch: string) {
    const source = this.sources.get(epoch);
    if (!source || source.retired) return;
    source.retired = true; // Invalidate callbacks before teardown can call back.
    source.port.block(true);
    source.port.stop();
    this.trace.push(`retired:${epoch}`);
  }

  permit(identity: string) {
    if (this.ended || identity !== this.identity) return;
    this.permitted = true;
    this.sync();
  }

  block() {
    this.permitted = false;
    this.sync();
  }

  child(active: boolean) {
    this.childActive = active;
    this.sync();
  }

  eligible(epoch: string) {
    const source = this.sources.get(epoch);
    return Boolean(
      !this.ended &&
      source?.ready &&
      !source.retired &&
      this.authority === epoch &&
      this.pending === epoch &&
      this.permitted &&
      !this.childActive,
    );
  }

  accept(epoch: string, callback: () => void) {
    if (!this.ended && this.authority === epoch && !this.sources.get(epoch)?.retired) callback();
  }

  fail(epoch: string) {
    if (epoch === this.pending) this.retire(epoch);
    // Keep the response budget alive; never fall back to the stale authority.
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.recovery);
    for (const epoch of this.sources.keys()) this.retire(epoch);
  }

  private sync() {
    for (const [epoch, source] of this.sources) source.port.block(!this.eligible(epoch));
    if (this.authority && this.eligible(this.authority)) {
      clearTimeout(this.recovery);
      this.recovery = undefined;
      this.trace.push(`permitted:${this.authority}`);
    }
  }
}
