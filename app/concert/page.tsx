import type { Metadata } from "next";
import Lesson from "../lesson";
import { CONCERT_THEME } from "../concert-theme";

export const metadata: Metadata = { title: "Sparkle Tour Counting Adventure" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Lesson theme={CONCERT_THEME} debug={(await searchParams).debug === "1"} />;
}
