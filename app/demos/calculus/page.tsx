import type { Metadata } from "next";
import CalculusDemo from "@/components/calculus-demo";

export const metadata: Metadata = { title: "Sprout — calculus practice" };

export default async function CalculusDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CalculusDemo debug={(await searchParams).debug === "1"} />;
}
