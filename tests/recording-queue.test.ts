import { expect, it, vi } from "vitest";
import { RecordingQueue } from "../lib/session-recorder";
it("queue cannot finalize ahead of a slow append and continues after reported failures", async () => {
  const writes: string[] = [];
  const report = vi.fn();
  const queue = new RecordingQueue(report);
  let release!: () => void;
  queue.enqueue(
    "append",
    () =>
      new Promise<void>(resolve => {
        release = () => {
          writes.push("append");
          resolve();
        };
      }),
  );
  queue.enqueue("failure", async () => {
    throw new Error("offline");
  });
  queue.enqueue("finalize", async () => {
    writes.push("finalize");
  });
  await Promise.resolve();
  expect(writes).toEqual([]);
  release();
  await queue.drain();
  expect(writes).toEqual(["append", "finalize"]);
  expect(report).toHaveBeenCalledWith("failure", expect.any(Error));
});
