import { test, expect, type Page } from "@playwright/test";
import { COUNTING_LESSON_GRAPH } from "../../lib/lesson-runtime/counting-lesson";
import { installLessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

const viewports = [
  { width: 320, height: 740 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];

async function expectLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const stage = page.locator("[data-scene-id]");
  const bounds = (await stage.boundingBox())!;
  for (const object of await stage.locator("[data-counting-object]").all()) {
    const box = (await object.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  for (const control of await page.getByRole("main").getByRole("button").all()) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

test("first scene keeps exact count, layers, identity and responsive geometry", async ({ page }) => {
  await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeFocused();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectLayout(page);
  }
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await observer.read())?.snapshot.status).toBe("live");

  try {
    const node = COUNTING_LESSON_GRAPH["count-1-duck"];
    const stage = page.locator(`[data-node-id="${node.id}"]`);
    await expect(stage).toBeVisible();
    await expect(stage).toHaveAttribute("aria-busy", "false");
    await expect(stage.locator("[data-counting-object]")).toHaveCount(node.quantity);
    await expect(stage.locator(`[data-counting-object="${node.object}"]`)).toHaveCount(node.quantity);
    await expect(stage.locator(":scope > [data-background]")).toHaveCount(1);
    await expect(stage.locator(":scope > [data-counting-objects] > [data-counting-object]")).toHaveCount(node.quantity);
    await expect(stage).not.toContainText(/\d|one|two|three/i);
    expect(
      await stage
        .locator("img")
        .evaluateAll(images =>
          images.every(image => image.getAttribute("alt") === "" && (image as HTMLImageElement).naturalWidth > 0),
        ),
    ).toBe(true);
    await expect.poll(async () => (await observer.read())?.snapshot.runtime?.phase).toBe("active");
    await expect(stage).toHaveAttribute("data-render-token", (await observer.read())!.snapshot.display.token);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectLayout(page);
    }
    expect(
      await stage.locator("[data-counting-object]").evaluateAll(objects =>
        objects.every(object => {
          const style = getComputedStyle(object);
          return style.animationName === "none" && style.transitionDuration === "0s";
        }),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("We’ve stopped for now");
  } finally {
    await page.evaluate(() => {
      for (const source of (window as unknown as LocalSessionWindow).peers) {
        source.peer.close();
        source.tone.stop();
      }
      void (window as unknown as LocalSessionWindow).peerContext.close();
    });
  }
});

test("slow and failed artwork has a stable stage and an explicit recovery message", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route("**/counting/duck.svg", async route => {
    await held;
    await route.fulfill({ status: 404, body: "" });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const stage = page.locator("[data-scene-id]");
  await expect(stage.locator('[data-artwork-state="loading"]')).toHaveText("Getting the picture ready…");
  const before = await stage.boundingBox();
  await expectLayout(page);
  release();
  await expect(stage.locator('[data-artwork-state="error"]')).toContainText("Ask a grown-up to reload");
  expect(await stage.boundingBox()).toEqual(before);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
});
