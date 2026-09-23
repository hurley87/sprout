import Lesson from "./lesson";

export default async function Home({ searchParams }: { searchParams: Promise<{ debug?: string }> }) {
  const { debug } = await searchParams;
  return <Lesson debug={process.env.NODE_ENV === "development" && debug === "1"} />;
}
