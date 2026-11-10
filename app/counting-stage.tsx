"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type CSSProperties, type Ref } from "react";
import { countingScene } from "./counting-scenes";
import type { CountingTheme } from "./counting-themes";
import type { StageMotion } from "./lesson-presentation";
import styles from "./counting-stage.module.css";

type AssetImageProps = Omit<ImageProps, "src" | "alt" | "width" | "height"> & { theme: CountingTheme; asset: string };

/** Decorative theme artwork at its authored intrinsic size. */
function AssetImage({ theme, asset, ...props }: AssetImageProps) {
  if (!Object.hasOwn(theme.assets, asset)) throw new Error(`Counting theme has no artwork named ${asset}`);
  const { src, width, height } = theme.assets[asset];
  return <Image src={src} alt="" width={width} height={height} {...props} />;
}

function Backdrop({
  theme,
  background,
  plainBackdrop,
  soft,
  imageProps,
}: {
  theme: CountingTheme;
  background: string;
  plainBackdrop?: string;
  soft?: boolean;
  imageProps?: Omit<AssetImageProps, "theme" | "asset">;
}) {
  return (
    <div
      className={[styles.background, plainBackdrop && styles[plainBackdrop], soft && styles.soft]
        .filter(Boolean)
        .join(" ")}
      data-background={background}
      data-plain-backdrop={plainBackdrop}
      data-soft-backdrop={soft || undefined}
      aria-hidden="true"
    >
      {!plainBackdrop && <AssetImage theme={theme} asset={background} preload {...imageProps} />}
    </div>
  );
}

export function CountingStage({
  theme,
  node,
  renderToken,
  sceneRef,
  motion = "idle",
  effect,
}: {
  theme: CountingTheme;
  node: { id: string; sceneId: string; object: string; quantity: number } | null;
  renderToken?: string;
  sceneRef?: Ref<HTMLDivElement>;
  /** Presentation only, derived from the runtime snapshot; it never gates render confirmation. */
  motion?: StageMotion;
  effect?: { className?: string; state: "before" | "playing" | "held"; key?: string };
}) {
  const scene = node ? countingScene(node, theme.scenes) : null;
  const worldEffect = scene?.effect && effect ? scene.effect : undefined;
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const assets = scene
    ? [...(scene.plainBackdrop ? [] : [scene.background]), ...scene.objects.map(object => object.asset)]
    : [];
  const pending = assets.some(asset => !loaded.has(asset));
  const unavailable = assets.some(asset => failed.has(asset));
  const imageEvents = (asset: string) => ({
    onLoad: () => setLoaded(previous => new Set(previous).add(asset)),
    onError: () => setFailed(previous => new Set(previous).add(asset)),
  });
  const aspect = (asset: string) => {
    const { width, height } = theme.assets[asset];
    return width === height ? "1" : `${width} / ${height}`;
  };

  return (
    <div
      ref={sceneRef}
      className={worldEffect && effect?.className ? `${styles.stage} ${effect.className}` : styles.stage}
      role="img"
      aria-label={
        node ? `${node.quantity} ${node.object}${node.quantity === 1 ? "" : "s"} to count` : "Lesson complete"
      }
      aria-busy={pending}
      data-render-token={renderToken}
      data-node-id={node?.id ?? "complete"}
      data-scene-id={node?.sceneId ?? "complete"}
      data-motion={motion}
      data-world-effect={worldEffect?.id}
      data-effect-state={worldEffect ? effect?.state : undefined}
    >
      {scene ? (
        <>
          <Backdrop
            theme={theme}
            background={scene.background}
            plainBackdrop={scene.plainBackdrop}
            soft={scene.softBackdrop}
            imageProps={imageEvents(scene.background)}
          />
          <div className={styles.objects} data-counting-objects aria-hidden="true">
            {worldEffect &&
              effect &&
              worldEffect.props.map((prop, index) =>
                effect.state === "before" ? (
                  <AssetImage
                    key={`preload:${index}`}
                    theme={theme}
                    asset={prop.asset}
                    preload
                    style={{ display: "none" }}
                  />
                ) : (
                  <div
                    key={`${effect.key ?? "effect"}:${index}`}
                    className={styles.object}
                    data-world-prop={prop.asset}
                    style={
                      {
                        left: `${prop.x * 100}%`,
                        top: `${prop.y * 100}%`,
                        width: `${prop.width * 100}%`,
                        aspectRatio: aspect(prop.asset),
                        transform: `translate(-50%, -50%) scaleX(${prop.flipped ? -1 : 1})`,
                        ["--i" as string]: index,
                      } as CSSProperties
                    }
                  >
                    <AssetImage theme={theme} asset={prop.asset} preload />
                  </div>
                ),
              )}
            {motion === "success" && (
              <div className={styles.numeral} data-success-numeral>
                {node!.quantity}
              </div>
            )}
            {scene.objects.map((object, index) => (
              <div
                key={`${node!.sceneId}:${index}`}
                className={styles.object}
                data-counting-object={scene.object}
                data-character={object.asset}
                style={
                  {
                    left: `${object.x * 100}%`,
                    top: `${object.y * 100}%`,
                    width: `${object.width * 100}%`,
                    aspectRatio: aspect(object.asset),
                    transform: `translate(-50%, -50%) scaleX(${object.flipped ? -1 : 1})`,
                    // Staggers entrances and keeps idle movement out of step.
                    ["--i" as string]: index,
                  } as CSSProperties
                }
              >
                <AssetImage
                  theme={theme}
                  asset={object.asset}
                  className={styles.character}
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
          <Backdrop theme={theme} background={theme.celebration.background} />
          {theme.celebration.confetti && (
            <div className={styles.confetti} aria-hidden="true" data-confetti>
              {Array.from({ length: 12 }, (_, index) => (
                <span key={index} style={{ "--i": index } as CSSProperties} />
              ))}
            </div>
          )}
          <div className={styles.objects} aria-hidden="true">
            {theme.celebration.decorations.map((decoration, index) => (
              <div
                key={index}
                className={styles.celebrationFlower}
                data-celebration-flower
                style={{ left: `${decoration.left}%`, ["--i" as string]: index } as CSSProperties}
              >
                <AssetImage theme={theme} asset={decoration.asset} className={styles.character} />
              </div>
            ))}
            {theme.celebration.friends.map((friend, index) => (
              <div
                key={`${friend.asset}:${index}`}
                className={styles.friend}
                data-celebration-character={friend.asset}
                style={
                  {
                    left: `${friend.x * 100}%`,
                    top: `${friend.y * 100}%`,
                    width: `${friend.width * 100}%`,
                    ["--i" as string]: index,
                  } as CSSProperties
                }
              >
                <AssetImage theme={theme} asset={friend.asset} className={styles.character} />
              </div>
            ))}
          </div>
          <p className={styles.complete}>{theme.celebration.message}</p>
        </>
      )}
    </div>
  );
}
