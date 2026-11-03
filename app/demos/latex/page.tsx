import type { Metadata } from "next";
import LatexDemo from "@/components/latex-demo";

export const metadata: Metadata = { title: "Sprout — step checker" };

export default function LatexDemoPage() {
  return <LatexDemo />;
}
