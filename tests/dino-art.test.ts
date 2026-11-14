import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DINO_ART, TRUCK_CAR_WIDTH, TRUCK_SPOTS, dinoCarSrc } from "../app/dino-art";

const file = (src: string) => `public${src}`;
const pngSize = (src: string) => {
  const bytes = readFileSync(file(src));
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: bytes[25] === 6 };
};

describe("dino car crunch artwork", () => {
  it("ships every sprite at its recorded size with a transparent background", () => {
    const { rex, car, truck } = DINO_ART;
    for (const src of [rex.hungry, rex.chomp, rex.full])
      expect(pngSize(src)).toEqual({ width: rex.width, height: rex.height, alpha: true });
    for (const colour of car.colours)
      expect(pngSize(dinoCarSrc(colour))).toEqual({ width: car.width, height: car.height, alpha: true });
    expect(pngSize(truck.src)).toEqual({ width: truck.width, height: truck.height, alpha: true });
  });

  it("ships both backgrounds as JPEGs", () => {
    for (const src of [DINO_ART.background.road, DINO_ART.background.finale]) {
      expect(existsSync(file(src))).toBe(true);
      expect([...readFileSync(file(src)).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    }
  });

  it("records ten truck spots in two decks of five that do not overlap", () => {
    expect(TRUCK_SPOTS).toHaveLength(10);
    const decks = [TRUCK_SPOTS.slice(0, 5), TRUCK_SPOTS.slice(5)];
    expect(decks[0][0].bottom).toBeLessThan(decks[1][0].bottom);
    for (const deck of decks) {
      expect(new Set(deck.map(spot => spot.bottom)).size).toBe(1);
      for (const [index, spot] of deck.entries()) {
        expect(spot.x - TRUCK_CAR_WIDTH / 2).toBeGreaterThan(0);
        expect(spot.x + TRUCK_CAR_WIDTH / 2).toBeLessThan(1);
        if (index > 0) expect(spot.x - deck[index - 1].x).toBeGreaterThan(TRUCK_CAR_WIDTH);
      }
    }
    const carHeight = (TRUCK_CAR_WIDTH * DINO_ART.truck.width * DINO_ART.car.height) / DINO_ART.car.width;
    expect(decks[0][0].bottom * DINO_ART.truck.height - carHeight).toBeGreaterThan(0);
  });
});
