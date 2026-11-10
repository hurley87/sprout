import type { Metadata } from "next";
import Lesson from "../../lesson";
import { GARDEN_RESCUE_THEME } from "../../garden-rescue-theme";

export const metadata: Metadata = { title: "Garden Rescue" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Lesson theme={GARDEN_RESCUE_THEME} debug={(await searchParams).debug === "1"} />;
}
