import type { Metadata } from "next";
import IceCreamLesson from "../ice-cream-lesson";

export const metadata: Metadata = { title: "Evie's Ice Cream Shop" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <IceCreamLesson debug={(await searchParams).debug === "1"} />;
}
