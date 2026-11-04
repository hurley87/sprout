import type { Metadata } from "next";
import MathStepsDemo from "@/components/math-steps-demo";
import { MATH_SCRIBE_DIFFERENCE_QUOTIENT_LESSON } from "@/lib/lesson-runtime/math-scribe-difference-quotient-lesson";

export const metadata: Metadata = { title: "Sprout — math steps" };

export default async function MathStepsDifferenceQuotientPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MathStepsDemo lesson={MATH_SCRIBE_DIFFERENCE_QUOTIENT_LESSON} debug={(await searchParams).debug === "1"} />;
}
