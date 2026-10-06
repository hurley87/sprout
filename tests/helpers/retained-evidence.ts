import { mkdir, readdir, writeFile, open, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

// No automatic deletion. Refuse new reservations at capacity; Playwright attachments still survive that run.
export const RETENTION_LIMIT = 100;
export const ATTEMPT_BYTE_LIMIT = 8 * 1024 * 1024;
export const defaultRetentionRoot = () => path.join(process.cwd(), ".sprout-evidence");
export function retainedLocation(root: string, identity: { attemptId: string; runtimeId: string | null }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(identity.attemptId)) throw new Error("Invalid local attempt identity");
  const runtime = identity.runtimeId?.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) ?? "runtime-unknown";
  const directory = path.join(path.resolve(root), `${identity.attemptId}-${runtime}`);
  return { directory, index: path.join(directory, "index.json"), ...identity };
}
export async function retainAttempt(
  root: string,
  identity: { attemptId: string; runtimeId: string | null; scenario: string },
  artifacts: Record<string, string>,
  outputDir?: string,
) {
  root = path.resolve(root);
  if (outputDir) {
    const relative = path.relative(path.resolve(outputDir), root);
    if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
      throw new Error("Retention root must be outside Playwright outputDir");
  }
  const bytes = Object.values(artifacts).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  if (bytes > ATTEMPT_BYTE_LIMIT) throw new Error("Retention attempt exceeds 8 MiB; no existing artifacts removed");
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, ".reservation-lock");
  const lock = await open(lockPath, "wx");
  let directory: string;
  try {
    if ((await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).length >= RETENTION_LIMIT)
      throw new Error("Retention capacity reached (100 attempts); archive manually; no existing artifacts removed");
    directory = retainedLocation(root, identity).directory;
    await mkdir(directory); // Exclusive reservation. Never reuse an existing identity.
  } finally {
    await lock.close();
    await rm(lockPath);
  }
  const index = {
    version: 1,
    ...identity,
    createdAt: new Date().toISOString(),
    bytes,
    files: Object.keys(artifacts),
    limit: { attempts: RETENTION_LIMIT, bytesPerAttempt: ATTEMPT_BYTE_LIMIT },
  };
  await writeFile(path.join(directory, "index.json"), JSON.stringify(index, null, 2), { flag: "wx" });
  for (const [name, value] of Object.entries(artifacts)) {
    if (path.basename(name) !== name) throw new Error("Artifact must be a basename");
    await writeFile(path.join(directory, name), value, { flag: "wx" });
  }
  await writeFile(path.join(directory, "complete.json"), JSON.stringify({ attemptId: identity.attemptId }), {
    flag: "wx",
  });
  return {
    directory,
    index: path.join(directory, "index.json"),
    attemptId: identity.attemptId,
    runtimeId: identity.runtimeId,
  };
}
export const newAttemptId = () => randomUUID();
