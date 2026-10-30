"use client";

import Image from "next/image";
import { useState, type Ref } from "react";
import { countingScene } from "./counting-scenes";
import styles from "./counting-stage.module.css";

export function CountingStage({
  node,
  renderToken,
  sceneRef,
}: {
  node: { id: string; sceneId: string; object: string; quantity: number } | null;
  renderToken?: string;
  sceneRef?: Ref<HTMLDivElement>;
}) {
  const scene = node ? countingScene(node) : null;
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const assets = scene
    ? [...(scene.flowerFree ? [] : [scene.background]), ...scene.objects.map(object => object.asset)]
    : [];
  const pending = assets.some(asset => !loaded.has(asset));
  const unavailable = assets.some(asset => failed.has(asset));
  const imageEvents = (asset: string) => ({
    onLoad: () => setLoaded(previous => new Set(previous).add(asset)),
    onError: () => setFailed(previous => new Set(previous).add(asset)),
  });

  return (
    <div
      ref={sceneRef}
      className={styles.stage}
      role="img"
      aria-label={
        node ? `${node.quantity} ${node.object}${node.quantity === 1 ? "" : "s"} to count` : "Lesson complete"
      }
      aria-busy={pending}
      data-render-token={renderToken}
      data-node-id={node?.id ?? "complete"}
      data-scene-id={node?.sceneId ?? "complete"}
    >
      {scene ? (
        <>
          <div
            className={`${styles.background} ${scene.flowerFree ? styles.meadow : ""}`}
            data-background={scene.background}
            data-flower-free={scene.flowerFree || undefined}
            aria-hidden="true"
          >
            {!scene.flowerFree && (
              <Image
                src={`/counting/${scene.background}.svg`}
                alt=""
                width={960}
                height={600}
                preload
                {...imageEvents(scene.background)}
              />
            )}
          </div>
          <div className={styles.objects} data-counting-objects aria-hidden="true">
            {scene.objects.map((object, index) => (
              <div
                key={`${node!.sceneId}:${index}`}
                className={styles.object}
                data-counting-object={scene.object}
                data-character={object.asset}
                style={{
                  left: `${object.x * 100}%`,
                  top: `${object.y * 100}%`,
                  width: `${object.width * 100}%`,
                  aspectRatio: object.asset === "flower" ? "280 / 320" : "1",
                  transform: `translate(-50%, -50%) scaleX(${object.flipped ? -1 : 1})`,
                }}
              >
                <Image
                  src={`/counting/${object.asset}.svg`}
                  alt=""
                  width={object.asset === "flower" ? 280 : 320}
                  height={320}
                  preload
                  {...imageEvents(object.asset)}
                />
              </div>
            ))}
          </div>
          {(pending || unavailable) && (
            <div className={styles.loading} aria-hidden="true" data-artwork-state={unavailable ? "error" : "loading"}>
              {unavailable ? "The picture couldn’t load. Ask a grown-up to reload." : "Getting the picture ready…"}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.background} data-background="garden" aria-hidden="true">
            <Image src="/counting/garden.svg" alt="" width={960} height={600} preload />
          </div>
          <p className={styles.complete}>Garden celebration! Thanks for counting with Sprout.</p>
        </>
      )}
    </div>
  );
}
