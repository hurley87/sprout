import type { Metadata } from "next";
import { cache } from "react";
import SnowflakeShowdownLesson from "../../snowflake-showdown-lesson";
import {
  SNOWFLAKE_SHOWDOWN_SEED_MAX,
  SNOWFLAKE_SHOWDOWN_SEED_MIN,
  isSnowflakeShowdownSeed,
} from "@/lib/lesson-runtime/snowflake-showdown-plan";

export const metadata: Metadata = { title: "Snowflake Showdown" };
const randomSeed = cache(
  () =>
    SNOWFLAKE_SHOWDOWN_SEED_MIN +
    Math.floor(Math.random() * (SNOWFLAKE_SHOWDOWN_SEED_MAX - SNOWFLAKE_SHOWDOWN_SEED_MIN + 1)),
);
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { seed: rawSeed, debug } = await searchParams;
  const requestedSeed = typeof rawSeed === "string" && /^\d+$/.test(rawSeed) ? Number(rawSeed) : undefined;
  const seed = isSnowflakeShowdownSeed(requestedSeed) ? requestedSeed : randomSeed();
  return <SnowflakeShowdownLesson key={seed} seed={seed} debug={debug === "1"} />;
}
