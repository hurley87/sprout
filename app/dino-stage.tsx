"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { LessonStageProps } from "./lesson-screen";
import { DINO_ART, dinoCarSrc, TRUCK_CAR_WIDTH, TRUCK_SPOTS, type DinoCarColour } from "./dino-art";
import { DINO_FINALE, dinoScene } from "./dino-scenes";
import type { createDinoSfx } from "./dino-sfx";
import styles from "./dino-stage.module.css";

export function DinoStage({
  node,
  renderToken,
  sceneRef,
  motion = "idle",
  snapshot,
  playEffect,
  sfx,
}: Omit<LessonStageProps, "sceneRef" | "motion" | "snapshot"> &
  Partial<Pick<LessonStageProps, "sceneRef" | "motion" | "snapshot">> & { sfx?: ReturnType<typeof createDinoSfx> }) {
  const scene = node ? dinoScene(node) : DINO_FINALE;
  const [chomp, setChomp] = useState<{ token: string | undefined; phase: "eating" | "done" }>();
  const started = useRef(new Set<string>());
  const arrivals = useRef(new Set<string>());
  const finale = useRef(new Set<string>());
  const phase = chomp && chomp.token === renderToken ? chomp.phase : "idle";
  const quiet = snapshot?.runtime?.outputActivity === "quiet";
  const runtimePhase = snapshot?.runtime?.phase;
  const ended = snapshot?.status === "ended";
  const [finaleSound, setFinaleSound] = useState<"played" | "skipped">();
  useEffect(() => {
    if (!sfx || !playEffect) return;
    if (!node && motion === "celebrate") {
      const key = renderToken ?? "finale";
      if (finale.current.has(key) || (!ended && !(runtimePhase === "complete" && quiet))) return;
      finale.current.add(key);
      // Completing the lesson stops the session, which closes the microphone and the tutor's audio, so once
      // it has ended there is nothing for the mic-safe window to protect (and the runtime would refuse it).
      setFinaleSound(sfx.play("success", ended ? () => true : playEffect) ? "played" : "skipped");
      return;
    }
    if (!renderToken || !quiet) return;
    // The runtime refuses effects while a scene is still rendering, so wait until it is active.
    if (node && runtimePhase === "active" && !arrivals.current.has(renderToken)) {
      // One attempt per visit: if the gate refuses (e.g. the tutor already started), skip rather than rumble late.
      arrivals.current.add(renderToken);
      if (node.id === "warm-up") sfx.play("horn", playEffect);
      else if (scene.trucks.length) sfx.play("truck-rumble", playEffect);
    }
  }, [renderToken, node, motion, sfx, playEffect, scene.trucks.length, quiet, runtimePhase, ended]);
  useEffect(() => {
    if (!node || !renderToken || motion !== "success" || !quiet || started.current.has(renderToken)) return;
    started.current.add(renderToken);
    sfx?.play("crunch", playEffect ?? (() => false));
    setChomp({ token: renderToken, phase: "eating" });
  }, [node, renderToken, motion, quiet, sfx, playEffect]);
  useEffect(() => {
    if (phase !== "eating") return;
    const timer = setTimeout(() => setChomp({ token: renderToken, phase: "done" }), 1500);
    return () => clearTimeout(timer);
  }, [phase, renderToken]);
  const rex = !node ? "full" : phase === "eating" ? "chomp" : "hungry";
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
        data-eaten={phase !== "idle" ? "true" : undefined}
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
      data-chomp={phase}
      data-finale-sound={node ? undefined : finaleSound}
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
        <div className={styles.trucks} key={`trucks-${renderToken}`}>
          {scene.trucks.map((truck, index) => (
            <div
              className={styles.truck}
              data-truck
              data-eaten={phase !== "idle" ? "true" : undefined}
              key={index}
              style={{ "--stagger": `${index * 70}ms` } as CSSProperties}
            >
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
        <div className={styles.loose} key={`loose-${renderToken}`}>
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
