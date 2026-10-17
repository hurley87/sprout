import CatchingUnicornsDemo from "@/components/catching-unicorns-demo";

export default async function CatchingUnicornsDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const debug = (await searchParams).debug === "1";
  return <CatchingUnicornsDemo debug={debug} />;
}
