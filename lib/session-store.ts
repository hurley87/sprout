export function sessionSavingEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SPROUT_SAVE_SESSIONS === "1";
}

export function sessionBlobPath({
  env = process.env,
  lessonId,
  runtimeId,
  now,
}: {
  env?: Record<string, string | undefined>;
  lessonId: string;
  runtimeId: string;
  now: Date;
}) {
  const deployment = env.VERCEL_ENV;
  const environment = deployment === "production" || deployment === "preview" ? deployment : "development";
  if (!lessonId || !runtimeId || /[^a-z0-9_-]/i.test(lessonId) || /[^a-z0-9_-]/i.test(runtimeId))
    throw new Error("Invalid session path segment.");

  const [date, time] = now.toISOString().split("T");
  const clock = time.slice(0, 8).replaceAll(":", "-");
  return `sessions/${environment}/${lessonId}/${date}/${clock}-${runtimeId}.json`;
}
