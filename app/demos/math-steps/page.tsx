import type { Metadata } from "next";
import MathStepsDemo from "@/components/math-steps-demo";

export const metadata: Metadata = { title: "Sprout — math steps" };

export default async function MathStepsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MathStepsDemo debug={(await searchParams).debug === "1"} />;
}
