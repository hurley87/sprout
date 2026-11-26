import type { Metadata } from "next";
import { cache } from "react";
import ChristmasTreeLesson from "../../christmas-tree-lesson";
import {
  CHRISTMAS_TREE_SEED_MAX,
  CHRISTMAS_TREE_SEED_MIN,
  isChristmasTreeSeed,
} from "@/lib/lesson-runtime/christmas-tree-arrangement";

export const metadata: Metadata = { title: "Christmas Tree Counting" };

const randomSeed = cache(
  () => CHRISTMAS_TREE_SEED_MIN + Math.floor(Math.random() * (CHRISTMAS_TREE_SEED_MAX - CHRISTMAS_TREE_SEED_MIN + 1)),
);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Reading searchParams makes this a request-time page, including when the query is empty.
  const { seed: rawSeed, debug } = await searchParams;
  const requestedSeed = typeof rawSeed === "string" && /^\d+$/.test(rawSeed) ? Number(rawSeed) : undefined;
  const seed = isChristmasTreeSeed(requestedSeed) ? requestedSeed : randomSeed();

  return <ChristmasTreeLesson key={seed} seed={seed} debug={debug === "1"} />;
}
