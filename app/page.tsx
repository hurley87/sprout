import Lesson from "./lesson";
import { GARDEN_THEME } from "./counting-themes";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Lesson theme={GARDEN_THEME} debug={(await searchParams).debug === "1"} />;
}
