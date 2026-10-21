import Mae386Demo from "@/components/mae386-demo";

export default async function Mae386DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return <Mae386Demo debug={(await searchParams).debug === "1"} />;
}
