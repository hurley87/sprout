"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { stockingColourAliases } from "@/lib/lesson-runtime/which-stocking-lesson";
import { STOCKING_COLOURS, THIRD_STOCKING_COLOUR, type StockingColour } from "@/lib/lesson-runtime/which-stocking-plan";
import {
  ASSET_VIEWBOXES,
  BACKGROUND_ALIGNMENT,
  TOY_ASSETS,
  TOY_PILE_SLOTS,
  WHICH_STOCKING_FIXED,
  assetPath,
  caneFan,
  stockingColourAsset,
  stockingSlots,
  type SceneBox,
  type ScenePlacement,
  type WhichStockingAsset,
} from "./which-stocking-scene";
import {
  highlightSequence,
  litCanes,
  missHighlight,
  stockingCounts,
  successTimeline,
  whichStockingMisses,
  type MissHighlight,
} from "./which-stocking-timeline";
import type { LessonStageProps } from "./lesson-screen";
import styles from "./which-stocking-stage.module.css";

const ASSETS: readonly WhichStockingAsset[] = [
  "living-room",
  "fire",
  "candy-cane",
  "snow",
  ...STOCKING_COLOURS.map(stockingColourAsset),
  ...TOY_ASSETS,
];
const ALIASES = stockingColourAliases(THIRD_STOCKING_COLOUR);
const SNOWFLAKES = 5;
const FINALE_CANES = 5;
const sceneLabel = "Stockings full of candy canes hang from a mantel above a warm fire, with toys beside the fireplace";
const finaleLabel = "Full stockings hang above a crackling fire as snow falls past the window and toys pile up";

function position({ x, y, width, aspect }: ScenePlacement): CSSProperties {
  return { left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, aspectRatio: 1 / aspect };
}
function region({ left, right, top, bottom }: SceneBox): CSSProperties {
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(right - left) * 100}%`,
    height: `${(bottom - top) * 100}%`,
  };
}

type AssetState = {
  loaded: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  setLoaded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  setFailed: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
};

/** Artwork state lives here, above the per-round key, so a new round never flashes the loading cover. */
export function WhichStockingStage(props: LessonStageProps) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <RoundStage
      key={`${props.node?.id ?? "complete"}:${props.renderToken ?? "preview"}`}
      {...props}
      loaded={loaded}
      failed={failed}
      setLoaded={setLoaded}
      setFailed={setFailed}
    />
  );
}

/**
 * One round. Idle until a miss; each new current-visit miss starts a highlight:
 * - a first (or third and later) miss lights the stocking she named, one cane a second, with `data-picked`
 *   on it while the highlight runs. No colour on screen means no highlight.
 * - the second miss lights each stocking in turn, left to right, then `data-hint="glow"` marks the right
 *   stocking until the round ends. This is the only place the answer is marked before success.
 * On success the right stocking jiggles, its canes pop in turn and a toy drops, all from CSS delays that
 * `successTimeline` sets. The complete render (`node === null`) is the finale.
 */
function RoundStage({
  node,
  renderToken,
  snapshot,
  sceneRef,
  motion,
  loaded,
  failed,
  setLoaded,
  setFailed,
}: LessonStageProps & AssetState) {
  const misses = whichStockingMisses(snapshot, node);
  const success = motion === "success" && node !== null;
  const [handled, setHandled] = useState(0);
  const [highlight, setHighlight] = useState<MissHighlight | null>(null);
  const [fired, setFired] = useState(0);
  const [ended, setEnded] = useState(0);
  const [glowing, setGlowing] = useState(false);
  // A new miss is read in the same render that reports it, while `snapshot.transcript` still ends with
  // the turn the classifier judged.
  if (node && misses > handled) {
    setHandled(misses);
    if (highlight?.kind === "sweep") setGlowing(true);
    setHighlight(missHighlight(misses, snapshot?.transcript ?? "", node, ALIASES));
    setFired(0);
  }
  const sequence = useMemo(() => (highlight && node ? highlightSequence(highlight, node) : null), [highlight, node]);
  useEffect(() => {
    if (!highlight || !sequence) return;
    if (!sequence.steps.length) {
      console.debug("Which Stocking: no stocking on screen matches the colour she named", { miss: highlight.miss });
      return;
    }
    console.debug("Which Stocking miss highlight", {
      miss: highlight.miss,
      kind: highlight.kind,
      ...(highlight.kind === "pick" ? { picked: highlight.colour, count: sequence.steps.length } : {}),
    });
    const timers = sequence.steps.map((step, index) => setTimeout(() => setFired(index + 1), step.atMs));
    timers.push(
      setTimeout(() => {
        setEnded(highlight.miss);
        if (highlight.kind === "sweep") setGlowing(true);
      }, sequence.endMs),
    );
    return () => timers.forEach(clearTimeout);
  }, [highlight, sequence]);

  const running = !!highlight && !!sequence?.steps.length && ended !== highlight.miss && !success;
  const lit = running ? litCanes(sequence!.steps, fired) : null;
  const picked = running && highlight?.kind === "pick" ? highlight.colour : null;
  // The documented exception to answer privacy: after the second miss's sweep, the answer glows.
  const hinted = glowing && node ? String(node.presentation.answer) : null;
  const answer = success ? String(node.presentation.answer) : null;
  const round = Number(node?.presentation.round ?? TOY_ASSETS.length + 1);
  const stockings = node
    ? stockingCounts(node)
    : STOCKING_COLOURS.map(colour => ({ colour: colour as string, count: FINALE_CANES }));
  const slots = stockingSlots(stockings.length as 2 | 3);
  const timeline = answer ? successTimeline(stockings.find(item => item.colour === answer)?.count ?? 0) : null;
  const pending = loaded.size + failed.size < ASSETS.length;

  const art = (asset: WhichStockingAsset) => (
    <Image
      src={assetPath(asset)}
      width={ASSET_VIEWBOXES[asset][0]}
      height={ASSET_VIEWBOXES[asset][1]}
      alt=""
      loading="eager"
      onLoad={() => setLoaded(old => (old.has(asset) ? old : new Set(old).add(asset)))}
      onError={() => setFailed(old => (old.has(asset) ? old : new Set(old).add(asset)))}
    />
  );
  const object = (placement: ScenePlacement, asset: WhichStockingAsset, className = "", extra?: CSSProperties) => (
    <div className={`${styles.object} ${className}`} style={{ ...position(placement), ...extra }}>
      {art(asset)}
    </div>
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
        data-highlight={running ? highlight!.kind : undefined}
        style={
          {
            "--align-landscape": BACKGROUND_ALIGNMENT.landscape,
            "--align-portrait": BACKGROUND_ALIGNMENT.portrait,
          } as CSSProperties
        }
      >
        <div className={styles.background} aria-hidden="true">
          {art("living-room")}
        </div>
        <div className={styles.layer} aria-hidden="true">
          {!node && (
            <div className={styles.snow} style={region(WHICH_STOCKING_FIXED.windowSnow)}>
              {Array.from({ length: SNOWFLAKES }, (_, flake) => (
                <span key={flake} style={{ "--flake": flake } as CSSProperties}>
                  {art("snow")}
                </span>
              ))}
            </div>
          )}
          <div className={styles.hearthGlow} style={region(WHICH_STOCKING_FIXED.glow)} />
          {object(WHICH_STOCKING_FIXED.fire, "fire", `${styles.fire} ${node ? "" : styles.crackle}`)}
          {stockings.map(({ colour, count }, index) => {
            const slot = slots[index];
            const right = colour === answer;
            const litCount = lit?.colour === colour ? lit.count : 0;
            const originX = ((slot.cuff.left + slot.cuff.right) / 2) * 100;
            return (
              <div
                key={colour}
                className={`${styles.stocking} ${right ? styles.jiggle : ""}`}
                data-colour={colour}
                data-picked={picked === colour ? colour : undefined}
                data-hint={hinted === colour ? "glow" : undefined}
                style={{ transformOrigin: `${originX}% ${slot.cuff.top * 100}%` }}
              >
                <div className={styles.fan} data-count={count}>
                  {caneFan(slot, count).map((cane, at) => (
                    <div
                      key={at}
                      className={`${styles.object} ${styles.cane} ${at < litCount ? styles.lit : ""} ${right ? styles.pop : ""} ${node ? "" : styles.fill}`}
                      data-lit={at < litCount || undefined}
                      style={
                        {
                          ...position(cane),
                          rotate: `${cane.rotation}deg`,
                          "--order": at,
                          ...(right && timeline ? { "--pop-at": `${timeline.popAtMs[at]}ms` } : {}),
                        } as CSSProperties
                      }
                    >
                      {art("candy-cane")}
                    </div>
                  ))}
                </div>
                {object(slot.stocking, stockingColourAsset(colour as StockingColour), styles.sock)}
              </div>
            );
          })}
          {TOY_PILE_SLOTS.slice(0, node ? round - 1 : TOY_ASSETS.length).map((slot, at) => (
            <div key={TOY_ASSETS[at]} className={styles.object} style={position(slot)}>
              {art(TOY_ASSETS[at])}
            </div>
          ))}
          {timeline &&
            object(TOY_PILE_SLOTS[round - 1], TOY_ASSETS[round - 1], styles.drop, {
              "--toy-at": `${timeline.toyAtMs}ms`,
            } as CSSProperties)}
        </div>
        <div className={styles.preload} aria-hidden="true">
          {ASSETS.map(asset => (
            <span key={asset}>{art(asset)}</span>
          ))}
        </div>
        {!node && <p className={styles.complete}>Every stocking is full!</p>}
        {(pending || failed.size > 0) && (
          <div className={styles.loading} aria-hidden="true">
            {failed.size ? "The picture couldn’t load. Ask a grown-up to reload." : "Getting the picture ready…"}
          </div>
        )}
      </div>
    </div>
  );
}
