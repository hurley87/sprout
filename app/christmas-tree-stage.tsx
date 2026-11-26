"use client";

import Image from "next/image";
import { useMemo, useState, type CSSProperties } from "react";
import { christmasTreeArrangement, type ChristmasTreeKind } from "@/lib/lesson-runtime/christmas-tree-arrangement";
import { CHRISTMAS_TREE_NAMES, CHRISTMAS_TREE_NODE_IDS } from "@/lib/lesson-runtime/christmas-tree-lesson";
import {
  CHRISTMAS_TREE_FIXED,
  CHRISTMAS_TREE_ICONS,
  christmasTreePlacements,
  type ChristmasTreePlacement,
} from "./christmas-tree-scene";
import type { LessonStageProps } from "./lesson-screen";
import styles from "./christmas-tree-stage.module.css";

const sceneLabel =
  "A decorated Christmas tree in a living room with baubles, candy canes, gingerbread men and presents";
const finaleLabel = "The decorated Christmas tree with a shining star and a snowy living room window";
const background = "living-room";
const snow = "snow";

function artPath(asset: string) {
  return `/christmas-tree/${asset}.svg`;
}

function bowAsset(asset: string) {
  return asset.startsWith("present-") ? `${asset}-bow` : undefined;
}

function position({ x, y, width, aspect }: ChristmasTreePlacement): CSSProperties {
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    aspectRatio: 1 / aspect,
  };
}

export function ChristmasTreeStage({
  seed,
  node,
  renderToken,
  sceneRef,
  motion = "idle",
}: Pick<LessonStageProps, "node" | "renderToken"> &
  Partial<Pick<LessonStageProps, "sceneRef" | "motion">> & {
    seed: number;
  }) {
  const placements = useMemo(() => christmasTreePlacements(christmasTreeArrangement(seed)), [seed]);
  const kind = node?.presentation.kind as ChristmasTreeKind | undefined;
  const icon = kind && CHRISTMAS_TREE_ICONS[kind];
  const iconBow = icon && bowAsset(icon);
  const orderedSlots = placements
    .filter(item => item.kind === kind)
    .sort((a, b) => a.placement.y - b.placement.y || a.placement.x - b.placement.x)
    .map(item => item.slot);
  const assets = [
    background,
    snow,
    ...Object.values(CHRISTMAS_TREE_FIXED).map(item => item.asset),
    ...placements.flatMap(({ placement: { asset } }) => [asset, bowAsset(asset)]),
    icon,
    iconBow,
  ];
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const pending = assets.some(asset => asset !== undefined && !loaded.has(asset));
  const unavailable = assets.some(asset => asset !== undefined && failed.has(asset));
  const events = (asset: string) => ({
    onLoad: () => setLoaded(previous => (previous.has(asset) ? previous : new Set(previous).add(asset))),
    onError: () => setFailed(previous => (previous.has(asset) ? previous : new Set(previous).add(asset))),
  });
  const artwork = (asset: string, width: number, height: number, className?: string, alt = "") => (
    <Image
      src={artPath(asset)}
      alt={alt}
      width={width}
      height={height}
      className={className}
      preload
      {...events(asset)}
    />
  );

  return (
    <div className={styles.frame}>
      <div
        ref={sceneRef}
        className={styles.stage}
        role="img"
        aria-label={node ? sceneLabel : finaleLabel}
        aria-busy={pending}
        data-render-token={renderToken}
        data-node-id={node?.id ?? "complete"}
        data-scene-id={node?.presentation.sceneId ?? "complete"}
        data-motion={motion}
      >
        <div className={styles.background} aria-hidden="true">
          {artwork(background, 1600, 900)}
        </div>
        <div className={styles.snow} aria-hidden="true">
          {artwork(snow, 32, 32)}
          {artwork(snow, 32, 32)}
          {artwork(snow, 32, 32)}
        </div>
        <div className={styles.objects} aria-hidden="true">
          {[CHRISTMAS_TREE_FIXED.tree, CHRISTMAS_TREE_FIXED.lights, CHRISTMAS_TREE_FIXED.star].map(placement => (
            <div
              key={placement.asset}
              className={`${styles.object} ${styles[placement.asset]}`}
              style={position(placement)}
            >
              {artwork(placement.asset, 800, Math.round(800 * placement.aspect))}
            </div>
          ))}
          {placements.map(({ kind: itemKind, slot, placement }) => {
            const asked = itemKind === kind;
            const { asset, aspect } = placement;
            const bow = bowAsset(asset);
            const imageHeight = Math.round(108 * aspect);
            return (
              <div
                key={`${itemKind}-${slot}`}
                className={styles.object}
                data-kind={itemKind}
                data-slot={slot}
                data-asked={asked}
                style={
                  { ...position(placement), "--order": asked ? orderedSlots.indexOf(slot) : undefined } as CSSProperties
                }
              >
                <div className={styles.item}>
                  {artwork(asset, 108, imageHeight)}
                  {bow && artwork(bow, 108, imageHeight, styles.bow)}
                </div>
              </div>
            );
          })}
        </div>
        {!node && <p className={styles.complete}>Beautiful work!</p>}
        {(pending || unavailable) && (
          <div className={styles.loading} aria-hidden="true" data-artwork-state={unavailable ? "error" : "loading"}>
            {unavailable ? "The picture couldn’t load. Ask a grown-up to reload." : "Getting the picture ready…"}
          </div>
        )}
      </div>
      {node && kind && icon && (
        <div
          key={`${node.id}-${renderToken ?? "preview"}`}
          className={styles.bubble}
          data-picture-cue={kind}
          data-opening-cue={node.id === CHRISTMAS_TREE_NODE_IDS[0] || undefined}
        >
          <div className={styles.item}>
            {artwork(icon, 72, 72, undefined, CHRISTMAS_TREE_NAMES[kind].plural)}
            {iconBow && artwork(iconBow, 72, 72, styles.bow)}
          </div>
        </div>
      )}
    </div>
  );
}
