import Lesson from "./lesson";
import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Lesson lessonDefinition={COUNTING_LESSON} debug={(await searchParams).debug === "1"} />;
}
