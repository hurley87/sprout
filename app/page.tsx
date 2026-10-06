import Lesson from "./lesson";
import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";

export default function Page() {
  return <Lesson lessonDefinition={COUNTING_LESSON} />;
}
