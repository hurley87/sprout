import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { get, list } from "@vercel/blob";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const usage = "Usage: npm run sessions:pull -- [--env <production|preview|development> | --all] [--lesson <lessonId>]";

/** @param {string[]} args */
export function parseSessionArgs(args) {
  const { values } = parseArgs({
    args,
    options: {
      env: { type: "string" },
      lesson: { type: "string" },
      all: { type: "boolean" },
    },
  });
  const { env, lesson, all } = values;
  const environment = env ?? "production";

  if (!["production", "preview", "development"].includes(environment)) {
    throw new Error("--env must be production, preview, or development.");
  }
  if (all && env !== undefined) throw new Error("--all and --env cannot be combined.");
  if (lesson !== undefined && !/^[a-z0-9_-]+$/i.test(lesson)) {
    throw new Error("--lesson must be a valid lesson ID.");
  }

  const prefix = all ? "sessions/" : `sessions/${environment}/${lesson ? `${lesson}/` : ""}`;
  return { prefix, lesson: all ? lesson : undefined };
}

/**
 * @param {string} root
 * @param {string} pathname
 */
export function sessionLocalPath(root, pathname) {
  const parts = pathname.split("/");
  if (
    parts[0] !== "sessions" ||
    parts.length < 2 ||
    parts.some(part => !part || part === ".") ||
    pathname.includes("..") ||
    /[\\:\0]/.test(pathname)
  ) {
    throw new Error("Unsafe session pathname.");
  }

  const target = resolve(root, pathname);
  const fromOutput = relative(resolve(root, "sessions"), target);
  if (!fromOutput || fromOutput === ".." || fromOutput.startsWith(`..${sep}`) || isAbsolute(fromOutput)) {
    throw new Error("Unsafe session pathname.");
  }
  return target;
}

/** @param {string} pathname */
async function localEntry(pathname) {
  try {
    return await lstat(pathname);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/** @param {import("@vercel/blob").ListBlobResultBlob} blob */
async function downloadSession(blob) {
  const target = sessionLocalPath(repoRoot, blob.pathname);
  const directories = blob.pathname.split("/").slice(0, -1);
  let parent = repoRoot;
  for (const directory of directories) {
    parent = resolve(parent, directory);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (!(await lstat(parent)).isDirectory()) throw new Error("Unsafe local session directory.");
  }

  const existing = await localEntry(target);
  if (existing && !existing.isFile()) throw new Error("Local session path is not a regular file.");
  if (existing?.size === blob.size) return false;

  const result = await get(blob.pathname, { access: "private" });
  if (!result?.stream) throw new Error("Blob has no downloadable content.");

  const temp = resolve(parent, `.${randomUUID()}.tmp`);
  try {
    await pipeline(result.stream, createWriteStream(temp, { flags: "wx", mode: 0o600 }));
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  return true;
}

async function main() {
  let options;
  try {
    options = parseSessionArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage);
    return 1;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    console.error("BLOB_READ_WRITE_TOKEN is missing. Run `vercel env pull .env.local` and try again.");
    return 1;
  }

  const { prefix, lesson } = options;
  let downloaded = 0;
  let present = 0;
  let failed = false;
  let cursor;
  try {
    do {
      const page = await list({ prefix, cursor });
      for (const blob of page.blobs) {
        if (lesson && blob.pathname.split("/")[2] !== lesson) continue;
        try {
          if (await downloadSession(blob)) downloaded++;
          else present++;
        } catch (error) {
          failed = true;
          console.error(`Could not download ${JSON.stringify(blob.pathname)}: ${error.message}`);
        }
      }

      if (page.hasMore && (!page.cursor || page.cursor === cursor)) {
        throw new Error("Blob listing did not return a new pagination cursor.");
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    failed = true;
    console.error(`Could not list saved sessions: ${error.message}`);
  }

  console.log(`${downloaded} downloaded, ${present} already present. Output: ${resolve(repoRoot, "sessions")}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
