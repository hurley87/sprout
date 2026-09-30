import type { DurableSessionRef } from "./session-recorder";

export const LATEST_SESSION_REFERENCE_KEY = "sprout.latest-session-reference.v1";

export type LatestSessionReference =
  { status: "missing" } | { status: "invalid" } | { status: "available"; ref: DurableSessionRef };

export function isDurableSessionReference(value: unknown): value is DurableSessionRef {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function readLatestSessionReference(storage: Pick<Storage, "getItem">): LatestSessionReference {
  let value: string | null;
  try {
    value = storage.getItem(LATEST_SESSION_REFERENCE_KEY);
  } catch {
    return { status: "invalid" };
  }
  if (value === null) return { status: "missing" };
  return isDurableSessionReference(value) ? { status: "available", ref: value } : { status: "invalid" };
}

export function saveLatestSessionReference(storage: Pick<Storage, "setItem">, value: unknown): boolean {
  if (!isDurableSessionReference(value)) return false;
  try {
    storage.setItem(LATEST_SESSION_REFERENCE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserSessionReference(): LatestSessionReference {
  try {
    return readLatestSessionReference(window.localStorage);
  } catch {
    return { status: "invalid" };
  }
}

export function saveBrowserSessionReference(value: unknown): boolean {
  try {
    return saveLatestSessionReference(window.localStorage, value);
  } catch {
    return false;
  }
}
