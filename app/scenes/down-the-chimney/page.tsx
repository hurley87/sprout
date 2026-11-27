import type { Metadata } from "next";
import { cache } from "react";
import DownTheChimneyLesson from "../../down-the-chimney-lesson";
import {
  DOWN_THE_CHIMNEY_SEED_MIN,
  DOWN_THE_CHIMNEY_SEED_MAX,
  isDownTheChimneySeed,
} from "@/lib/lesson-runtime/down-the-chimney-plan";

export const metadata: Metadata = { title: "Down the Chimney" };
const randomSeed = cache(
  () =>
    DOWN_THE_CHIMNEY_SEED_MIN + Math.floor(Math.random() * (DOWN_THE_CHIMNEY_SEED_MAX - DOWN_THE_CHIMNEY_SEED_MIN + 1)),
);
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { seed: rawSeed, debug } = await searchParams;
  const requestedSeed = typeof rawSeed === "string" && /^\d+$/.test(rawSeed) ? Number(rawSeed) : undefined;
  const seed = isDownTheChimneySeed(requestedSeed) ? requestedSeed : randomSeed();
  return <DownTheChimneyLesson key={seed} seed={seed} debug={debug === "1"} />;
}
