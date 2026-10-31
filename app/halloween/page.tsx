import type { Metadata } from "next";
import Lesson from "../lesson";
import { HALLOWEEN_THEME } from "../halloween-theme";

export const metadata: Metadata = { title: "Halloween Counting Adventure" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Lesson theme={HALLOWEEN_THEME} debug={(await searchParams).debug === "1"} />;
}
