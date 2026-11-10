import type { Metadata } from "next";
import GardenRescueLesson from "../../garden-rescue-lesson";

export const metadata: Metadata = { title: "Garden Rescue" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <GardenRescueLesson debug={(await searchParams).debug === "1"} />;
}
