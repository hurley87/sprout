import type { Metadata } from "next";
import MathStepsDemo from "@/components/math-steps-demo";
import { MATH_SCRIBE_RECIPROCAL_LESSON } from "@/lib/lesson-runtime/math-scribe-reciprocal-lesson";

export const metadata: Metadata = { title: "Sprout — math steps" };

export default async function MathStepsReciprocalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MathStepsDemo lesson={MATH_SCRIBE_RECIPROCAL_LESSON} debug={(await searchParams).debug === "1"} />;
}
