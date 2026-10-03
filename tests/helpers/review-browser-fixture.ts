import { build } from "vite";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

let html: Promise<string> | undefined;

/** Mount the retained inspector independently of whichever live lesson owns /. */
export async function installReviewFixture(page: Page) {
  html ??= (async () => {
    const entry = `${process.cwd()}/tests/helpers/review-browser-fixture-entry.tsx`;
    const result = await build({
      configFile: false,
      logLevel: "error",
      resolve: { alias: { "@": process.cwd() } },
      define: {
        "process.env.NODE_ENV": JSON.stringify("development"),
        "process.env.NEXT_PUBLIC_CONVEX_URL": JSON.stringify("https://synthetic.convex.cloud"),
      },
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ["iife"], name: "ReviewFixture" },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap(output => ("output" in output ? output.output : []))
      .filter(output => output.type === "chunk")
      .map(output => output.code)
      .join("\n");
    const css = (await readFile("app/globals.css", "utf8"))
      .replace(/@import[^;]+;/g, "")
      .replace(/@theme inline\s*\{[^}]*\}/g, "");
    return `<meta charset="utf-8"><style>${css}</style><main id="root"></main><script>${code.replaceAll("</script", "<\\/script")}</script>`;
  })();
  await page.route("**/review-fixture", async route => route.fulfill({ contentType: "text/html", body: await html! }));
}
