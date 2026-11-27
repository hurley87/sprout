import type { Metadata } from "next";
import { cache } from "react";
import WhichStockingLesson from "../../which-stocking-lesson";
import {
  WHICH_STOCKING_SEED_MIN,
  WHICH_STOCKING_SEED_MAX,
  isWhichStockingSeed,
} from "@/lib/lesson-runtime/which-stocking-plan";

export const metadata: Metadata = { title: "Which Stocking?" };
const randomSeed = cache(
  () => WHICH_STOCKING_SEED_MIN + Math.floor(Math.random() * (WHICH_STOCKING_SEED_MAX - WHICH_STOCKING_SEED_MIN + 1)),
);
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { seed: rawSeed, debug } = await searchParams;
  const requestedSeed = typeof rawSeed === "string" && /^\d+$/.test(rawSeed) ? Number(rawSeed) : undefined;
  const seed = isWhichStockingSeed(requestedSeed) ? requestedSeed : randomSeed();
  return <WhichStockingLesson key={seed} seed={seed} debug={debug === "1"} />;
}
