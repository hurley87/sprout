import type { Metadata } from "next";
import DinoLesson from "../dino-lesson";

export const metadata: Metadata = { title: "Dino Car Crunch" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DinoLesson debug={(await searchParams).debug === "1"} />;
}
