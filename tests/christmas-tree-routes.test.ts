import { afterEach, expect, it, vi } from "vitest";
import ChristmasTreeLesson from "../app/christmas-tree-lesson";
import Page, { metadata } from "../app/scenes/christmas-tree/page";

afterEach(() => vi.restoreAllMocks());

const loadPage = (query: Record<string, string | string[] | undefined>) =>
  Page({ searchParams: Promise.resolve(query) });

it.each(["0", "42", "99"])("passes the valid seed %s to the lesson", async seed => {
  const random = vi.spyOn(Math, "random");
  const element = await loadPage({ seed });
  expect(element.type).toBe(ChristmasTreeLesson);
  expect(element.props).toEqual({ seed: Number(seed), debug: false });
  expect(random).not.toHaveBeenCalled();
  expect(metadata.title).toBe("Christmas Tree Counting");
});

it.each([undefined, "", " ", "-1", "100", "1.5", "0x42", "1e1", "pine", ["0", "1"]])(
  "chooses a new valid seed for %j",
  async seed => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    expect((await loadPage({ seed })).props.seed).toBe(0);
    expect((await loadPage({ seed })).props.seed).toBe(99);
  },
);

it("passes debug through only for debug=1", async () => {
  expect((await loadPage({ seed: "1", debug: "1" })).props).toEqual({ seed: 1, debug: true });
  expect((await loadPage({ seed: "1", debug: ["1", "0"] })).props.debug).toBe(false);
  expect((await loadPage({ seed: "1", debug: "0" })).props.debug).toBe(false);
});
