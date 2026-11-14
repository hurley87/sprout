/** Dino Car Crunch artwork in public/dinos. Sizes are the files' pixel dimensions. */
export const DINO_ART = {
  rex: {
    hungry: "/dinos/rex-hungry.png",
    chomp: "/dinos/rex-chomp.png",
    full: "/dinos/rex-full.png",
    width: 600,
    height: 600,
  },
  car: { colours: ["red", "blue", "yellow"] as const, width: 400, height: 219 },
  truck: { src: "/dinos/carrier-truck.png", width: 900, height: 392 },
  background: { road: "/dinos/road.jpg", finale: "/dinos/car-park-empty.jpg", width: 1920, height: 1080 },
} as const;

export type DinoCarColour = (typeof DINO_ART.car.colours)[number];

export const dinoCarSrc = (colour: DinoCarColour) => `/dinos/car-${colour}.png`;

/**
 * The ten parking spots drawn on carrier-truck.png, as fractions of the truck image:
 * `x` is the car's centre, `bottom` is where its wheels rest and `width` is the car's width.
 * Top deck first, then bottom deck, each left (cab end) to right.
 */
const SPOT_X = [0.3506, 0.485, 0.62, 0.755, 0.8894] as const;
const DECK_BOTTOM = [0.2321, 0.6964] as const;
export const TRUCK_CAR_WIDTH = 0.1133;
export const TRUCK_SPOTS: readonly { readonly x: number; readonly bottom: number }[] = DECK_BOTTOM.flatMap(bottom =>
  SPOT_X.map(x => ({ x, bottom })),
);
