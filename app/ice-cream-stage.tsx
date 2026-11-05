"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import type { LessonStageProps } from "./lesson-screen";
import { ICE_CREAM_FINALE, iceCreamScene, type IceCreamObject, type ScoopColour } from "./ice-cream-scenes";
import styles from "./ice-cream-stage.module.css";

const descriptions: Record<ScoopColour, string> = {
  pink: "pink strawberry scoop",
  yellow: "yellow lemon scoop",
  chocolate: "chocolate chip scoop",
};

export function IceCreamStage({
  node,
  renderToken,
  sceneRef,
  motion = "idle",
}: Omit<LessonStageProps, "sceneRef" | "motion"> & Partial<Pick<LessonStageProps, "sceneRef" | "motion">>) {
  const scene = node ? iceCreamScene(node) : null;
  const landing =
    node?.presentation.answerKind === "order_step" && motion === "success"
      ? (node.presentation.answer as ScoopColour)
      : null;
  const objects: readonly IceCreamObject[] = landing
    ? [
        ...scene!.objects,
        { asset: `scoop-${landing}`, x: 0.5, y: landing === "pink" ? 0.51 : 0.3, width: 0.27, placed: true },
      ]
    : (scene?.objects ?? ICE_CREAM_FINALE);
  const background = node ? "shop-counter" : "shop-finale";
  const assets = [background, ...objects.map(object => object.asset)];
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const pending = assets.some(asset => !loaded.has(asset));
  const unavailable = assets.some(asset => failed.has(asset));
  const events = (asset: string) => ({
    onLoad: () => setLoaded(previous => new Set(previous).add(asset)),
    onError: () => setFailed(previous => new Set(previous).add(asset)),
  });
  return (
    <div
      ref={sceneRef}
      className={styles.stage}
      role="img"
      aria-label={scene?.label ?? "Finished ice cream orders on the shop counter"}
      aria-busy={pending}
      data-render-token={renderToken}
      data-node-id={node?.id ?? "complete"}
      data-scene-id={node?.presentation.sceneId ?? "complete"}
      data-motion={motion}
      data-answer-kind={node?.presentation.answerKind}
    >
      <div className={styles.background} aria-hidden="true">
        <Image src={`/ice-cream/${background}.svg`} alt="" width={1600} height={900} preload {...events(background)} />
      </div>
      <div className={styles.objects} aria-hidden="true">
        {objects.map((object, index) => {
          const colour = object.asset.startsWith("scoop-") ? (object.asset.slice(6) as ScoopColour) : null;
          const isLanding = !!landing && index === objects.length - 1;
          return (
            <div
              key={`${object.asset}-${index}`}
              className={`${styles.object} ${object.tub ? styles.tub : ""} ${isLanding ? styles.landing : ""}`}
              data-scoop={colour ?? undefined}
              data-placed={object.placed || undefined}
              data-tub={object.tub || undefined}
              data-landing={isLanding || undefined}
              aria-label={colour ? descriptions[colour] : undefined}
              style={
                {
                  left: `${object.x * 100}%`,
                  top: `${object.y * 100}%`,
                  width: `${object.width * 100}%`,
                } as CSSProperties
              }
            >
              <Image
                src={`/ice-cream/${object.asset}.svg`}
                alt=""
                width={320}
                height={320}
                preload
                {...events(object.asset)}
              />
            </div>
          );
        })}
      </div>
      {!node && <p className={styles.complete}>Every order is done. Great work, little helper!</p>}
      {(pending || unavailable) && (
        <div className={styles.loading} aria-hidden="true" data-artwork-state={unavailable ? "error" : "loading"}>
          {unavailable ? "The picture couldn’t load. Ask a grown-up to reload." : "Getting the picture ready…"}
        </div>
      )}
    </div>
  );
}
