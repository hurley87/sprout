"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import type { LessonStageProps } from "./lesson-screen";
import { DINO_ART, dinoCarSrc, TRUCK_CAR_WIDTH, TRUCK_SPOTS, type DinoCarColour } from "./dino-art";
import { DINO_FINALE, dinoScene } from "./dino-scenes";
import styles from "./dino-stage.module.css";

export function DinoStage({
  node,
  renderToken,
  sceneRef,
  motion = "idle",
}: Omit<LessonStageProps, "sceneRef" | "motion" | "snapshot"> &
  Partial<Pick<LessonStageProps, "sceneRef" | "motion">>) {
  const scene = node ? dinoScene(node) : DINO_FINALE;
  const rex = !node ? "full" : motion === "success" ? "chomp" : "hungry";
  // Load both lesson poses up front so the chomp never waits on (or flashes the loading overlay for) a new image.
  const rexPoses = node ? (["hungry", "chomp"] as const) : (["full"] as const);
  const background = node ? DINO_ART.background.road : DINO_ART.background.finale;
  const cars = [...scene.trucks.flat(), ...scene.loose, ...scene.arriving];
  const assets = [
    background,
    ...rexPoses.map(pose => DINO_ART.rex[pose]),
    ...(scene.trucks.length ? [DINO_ART.truck.src] : []),
    ...cars.map(dinoCarSrc),
  ];
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const pending = assets.some(src => !loaded.has(src));
  const unavailable = assets.some(src => failed.has(src));
  const events = (src: string) => ({
    onLoad: () => setLoaded(previous => new Set(previous).add(src)),
    onError: () => setFailed(previous => new Set(previous).add(src)),
  });
  const car = (
    colour: DinoCarColour,
    location: "truck" | "loose" | "arriving",
    index: number,
    style?: CSSProperties,
  ) => {
    const src = dinoCarSrc(colour);
    return (
      <div
        key={`${location}-${index}`}
        className={`${styles.car} ${location === "arriving" ? styles.arriving : ""}`}
        data-car
        data-colour={colour}
        data-in={location}
        data-eaten={motion === "success" ? "true" : undefined}
        style={style}
      >
        <Image src={src} alt="" width={DINO_ART.car.width} height={DINO_ART.car.height} preload {...events(src)} />
      </div>
    );
  };
  return (
    <div
      ref={sceneRef}
      className={styles.stage}
      role="img"
      aria-label={scene.label}
      aria-busy={pending}
      data-render-token={renderToken}
      data-node-id={node?.id ?? "complete"}
      data-scene-id={node?.presentation.sceneId ?? "complete"}
      data-motion={motion}
      data-rex={rex}
    >
      <div className={styles.background} aria-hidden="true">
        <Image
          src={background}
          alt=""
          width={DINO_ART.background.width}
          height={DINO_ART.background.height}
          preload
          {...events(background)}
        />
      </div>
      <div className={styles.layout} aria-hidden="true">
        <div className={styles.rex}>
          {rexPoses.map(pose => (
            <Image
              key={pose}
              src={DINO_ART.rex[pose]}
              alt=""
              width={DINO_ART.rex.width}
              height={DINO_ART.rex.height}
              preload
              data-pose={pose}
              data-shown={pose === rex || undefined}
              {...events(DINO_ART.rex[pose])}
            />
          ))}
        </div>
        <div className={styles.trucks}>
          {scene.trucks.map((truck, index) => (
            <div className={styles.truck} data-truck key={index}>
              <Image
                src={DINO_ART.truck.src}
                alt=""
                width={DINO_ART.truck.width}
                height={DINO_ART.truck.height}
                preload
                {...events(DINO_ART.truck.src)}
              />
              {truck.map((colour, spot) =>
                car(colour, "truck", spot, {
                  left: `${TRUCK_SPOTS[spot].x * 100}%`,
                  top: `${TRUCK_SPOTS[spot].bottom * 100}%`,
                  width: `${TRUCK_CAR_WIDTH * 100}%`,
                }),
              )}
            </div>
          ))}
        </div>
        <div className={styles.loose}>
          {scene.loose.map((colour, index) => car(colour, "loose", index))}
          {scene.arriving.map((colour, index) => car(colour, "arriving", index))}
        </div>
      </div>
      {!node && <p className={styles.complete}>Rex is full! Thanks for counting the cars.</p>}
      {(pending || unavailable) && (
        <div className={styles.loading} aria-hidden="true" data-artwork-state={unavailable ? "error" : "loading"}>
          {unavailable ? "The picture couldn’t load. Ask a grown-up to reload." : "Getting the picture ready…"}
        </div>
      )}
    </div>
  );
}
