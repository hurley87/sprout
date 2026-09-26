import type { EndReason } from "./session";

export type Evidence =
  | {
      type: "utterance";
      speaker: "child_or_nearby_speaker" | "sprout";
      text: string;
      startMs: number;
      endMs: number;
      state: "finalized" | "interrupted";
    }
  | {
      type: "scene_displayed";
      sceneId: string;
      targetQuantity: number;
      items: { emoji: string; label: string }[];
      arrangement: string;
    }
  | {
      type: "support";
      source: "sprout" | "parent" | "other";
      mode: "spoken" | "displayed" | "other";
      description: string;
    };

/** Application evidence only; never accepts diagnostic/provider payloads. */
export interface SessionRecorder {
  create(): Promise<void>;
  activate(): Promise<void>;
  append(eventKey: string, atMs: number, evidence: Evidence): Promise<void>;
  markIncomplete(): Promise<void>;
  finalize(reason: EndReason, recordIncomplete?: boolean): Promise<void>;
}

/** Failed writes are reported; subsequent writes (especially finalization) still run. */
export class RecordingQueue {
  private tail = Promise.resolve();
  private created = false;
  private recordIncomplete = false;
  get incomplete() {
    return this.recordIncomplete;
  }
  constructor(
    private report: (operation: string, error: unknown) => void,
    private markIncomplete?: () => Promise<void>,
  ) {}
  enqueue(operation: string, write: () => Promise<void>) {
    this.tail = this.tail.then(async () => {
      try {
        await write();
        if (operation === "create") this.created = true;
      } catch (error) {
        this.report(operation, error);
        if (!this.created) return;
        this.recordIncomplete = true;
        // Recovery is awaited inside this queue slot, before subsequent writes.
        try {
          await this.markIncomplete?.();
        } catch (markerError) {
          this.report("markIncomplete", markerError);
        }
      }
    });
  }
  drain() {
    return this.tail;
  }
}
