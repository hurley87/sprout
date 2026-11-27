"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  MITTEN_COLOURS,
  SNOWFLAKE_SHOWDOWN_ROUNDS,
  snowflakeLayout,
  type MittenColour,
} from "@/lib/lesson-runtime/snowflake-showdown-plan";
import {
  ASSET_VIEWBOXES,
  BACKGROUND_ALIGNMENT,
  FLURRY_PATH,
  MITTEN_BOUNDS,
  MITTEN_CUFF,
  MITTEN_CUFF_RADIUS,
  MITTEN_PALM,
  MITTEN_PLACEMENTS,
  STAR_ROW,
  assetPath,
  mittenAsset,
  pairingLines,
  snowflakePlacements,
  snowmanPlacement,
  type PairingLine,
  type SceneBox,
  type ScenePlacement,
  type SnowflakeShowdownAsset,
  type SnowmanPose,
} from "./snowflake-showdown-scene";
import {
  FLIP_MS,
  SILENCE_START,
  STREAK_START,
  SUCCESS_STAR_FLIGHT_MS,
  WIGGLE_MS,
  observeSilence,
  pairingSchedule,
  recordShowdownSuccess,
  recordWiggle,
  showsFlurry,
  snowflakeShowdownMisses,
  successTimeline,
  wiggleDueAtMs,
  type StreakBook,
} from "./snowflake-showdown-timeline";
import type { LessonStageProps } from "./lesson-screen";
import styles from "./snowflake-showdown-stage.module.css";

const ASSETS = Object.keys(ASSET_VIEWBOXES) as SnowflakeShowdownAsset[];
const sceneLabel = "A pair of mittens side by side next to a snowman in a snowy yard, under a row of stars";
const finaleLabel = "Stars swirl into a big snowflake while the snowman and both mittens dance in the snowy yard";
/** One tint per pair, shared by its line and its two rings. None is gold, which marks the leftovers. */
const PAIR_TINTS = ["#6f63e8", "#2f93d0", "#25a383", "#d0609a", "#8d5fd3"];
/** How far a pairing line stops short of each snowflake centre: the ring's radius, in background units. */
const LINE_TRIM = 25;
/** The finale's big snowflake, in the sky just above the mittens, clear of the centred Play again
 * button and the status pill at every crop. The stars swirl in to it from their row. */
const FINALE_FLAKE: ScenePlacement = { x: 0.5, y: 165 / 900, width: 170 / 1600, aspect: 1 };
const NO_SLOTS: Readonly<Record<MittenColour, readonly number[]>> = { blue: [], pink: [] };

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
const percent = (value: number) => `${value * 100}%`;
const classes = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/** The line between two ringed snowflakes, in background units, stopping at each ring. */
function trimmed({ from, to }: PairingLine) {
  const [x1, y1, x2, y2] = [from.x * 1600, from.y * 900, to.x * 1600, to.y * 900];
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  return { x1: x1 + ux * LINE_TRIM, y1: y1 + uy * LINE_TRIM, x2: x2 - ux * LINE_TRIM, y2: y2 - uy * LINE_TRIM };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function reducedMotionNow() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION).matches
    : false;
}
/** Timers follow reduced motion too: the pairing appears at once and the star turns gold in place. */
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => false);
}

type AssetState = {
  loaded: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  setLoaded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  setFailed: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
};
type StreakState = { streak: StreakBook; succeed: (session: string, visit: string, missed: boolean) => void };

/**
 * Artwork and the session's streak live here, above the per-round key, so a new round never flashes
 * the loading cover and the streak survives from round to round. The streak is keyed by runtime id,
 * so Stop then Play starts it over.
 */
export function SnowflakeShowdownStage({ seed, ...props }: LessonStageProps & { seed: number }) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [streak, setStreak] = useState<StreakBook>(STREAK_START);
  const succeed = useCallback(
    (session: string, visit: string, missed: boolean) =>
      setStreak(book => recordShowdownSuccess(book, session, visit, missed)),
    [],
  );
  return (
    <RoundStage
      key={`${props.node?.id ?? "complete"}:${props.renderToken ?? "preview"}`}
      {...props}
      seed={seed}
      loaded={loaded}
      failed={failed}
      setLoaded={setLoaded}
      setFailed={setFailed}
      streak={streak}
      succeed={succeed}
    />
  );
}

/**
 * One round.
 * - Before Play (no render token) both mittens show their backs. Once the round renders and the art
 *   has loaded they flip together (FLIP_MS) to their snowflake sides.
 * - The first current-visit miss starts the pairing: one line per pair about every half second, drawn
 *   above the snowflakes with a white casing, each pair's two snowflakes ringed in the line's tint,
 *   then the leftovers glow gold. It stays until the round ends; later misses leave it as it is.
 * - After SILENCE_WIGGLE_MS of quiet both mittens wiggle, at most MAX_WIGGLES times a round.
 * - On success the mitten with more dances, a star flies to her row and turns gold, and the snowman
 *   claps (blue) or shrugs happily (pink). The third clean round in a row adds a flurry.
 * - The complete render (`node === null`) is the finale: the stars swirl into a big snowflake while
 *   the snowman and both mittens dance.
 * Nothing names the side with more before success; the leftovers' `data-leftover` is on screen anyway.
 */
function RoundStage({
  seed,
  node,
  renderToken,
  snapshot,
  sceneRef,
  motion,
  loaded,
  failed,
  setLoaded,
  setFailed,
  streak,
  succeed,
}: LessonStageProps & AssetState & StreakState & { seed: number }) {
  const reduced = useReducedMotion();
  const state = snapshot?.runtime;
  const misses = snowflakeShowdownMisses(snapshot, node);
  const success = motion === "success" && node !== null;
  const round = Number(node?.presentation.round ?? SNOWFLAKE_SHOWDOWN_ROUNDS);
  const answer = success ? (String(node.presentation.answer) as MittenColour) : null;
  const pending = loaded.size + failed.size < ASSETS.length;

  const slots = useMemo(
    () =>
      node ? { blue: snowflakeLayout(seed, round, "blue"), pink: snowflakeLayout(seed, round, "pink") } : NO_SLOTS,
    [node, seed, round],
  );

  // The flip: backs before Play, then both turn together once the round has rendered and loaded.
  const canFlip = !!node && !!renderToken && !pending;
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!canFlip || flipped) return;
    const timer = setTimeout(() => setFlipped(true), FLIP_MS);
    return () => clearTimeout(timer);
  }, [canFlip, flipped]);
  const face = !node || flipped ? "palm" : canFlip ? "turning" : "back";

  // The pairing, started by the first new current-visit miss and kept until the round ends.
  const [handled, setHandled] = useState(0);
  if (node && misses > handled) setHandled(misses);
  const pairingStarted = handled > 0;
  const pairing = useMemo(() => (node ? pairingLines(slots.blue, slots.pink) : null), [node, slots]);
  const schedule = useMemo(() => (pairing ? pairingSchedule(pairing, reduced) : null), [pairing, reduced]);
  const [pairsFired, setPairsFired] = useState(0);
  const [pairingDone, setPairingDone] = useState(false);
  useEffect(() => {
    if (!pairingStarted || !schedule) return;
    console.debug("Snowflake Showdown pairing", { pairs: schedule.steps.length });
    const timers = schedule.steps.map((step, index) =>
      setTimeout(() => setPairsFired(fired => Math.max(fired, index + 1)), step.atMs),
    );
    timers.push(setTimeout(() => setPairingDone(true), schedule.endMs));
    return () => timers.forEach(clearTimeout);
  }, [pairingStarted, schedule]);
  const pairsDrawn = pairingDone ? (schedule?.steps.length ?? 0) : pairsFired;
  const pairOf = useMemo(() => {
    const pairs = { blue: new Map<number, number>(), pink: new Map<number, number>() };
    schedule?.steps.slice(0, pairsDrawn).forEach((step, index) => {
      pairs.blue.set(step.blue, index);
      pairs.pink.set(step.pink, index);
    });
    return pairs;
  }, [schedule, pairsDrawn]);
  const leftover = pairingDone ? schedule?.leftover : null;

  // Silence: the wait restarts at the latest of the flip ending, her turn ending and the tutor going
  // quiet; speech, a candidate or tutor output cancels it.
  const live =
    snapshot?.status === "live" &&
    state?.phase === "active" &&
    !state.pendingRender &&
    !snapshot.awaitingSteering &&
    state.nodeId === node?.id;
  const ready = !!node && live && face === "palm" && !success && !pending;
  const childSpeaking = !!state?.childSpeaking;
  const childCandidate = !!state?.childCandidate;
  const tutorActive = state?.outputActivity === "active";
  const childTurnId = state?.childTurnId ?? 0;
  const silence = useRef(SILENCE_START);
  const [wiggle, setWiggle] = useState({ count: 0, running: false });
  useEffect(() => {
    const now = Date.now();
    silence.current = observeSilence(
      silence.current,
      { ready, childSpeaking, childCandidate, tutorActive, childTurnId },
      now,
    );
    const due = wiggleDueAtMs(silence.current);
    if (due === null) return;
    const timer = setTimeout(
      () => {
        silence.current = recordWiggle(silence.current, Date.now());
        setWiggle(current => ({ count: current.count + 1, running: true }));
      },
      Math.max(0, due - now),
    );
    return () => clearTimeout(timer);
  }, [ready, childSpeaking, childCandidate, tutorActive, childTurnId, wiggle.count]);
  useEffect(() => {
    if (!wiggle.running) return;
    const timer = setTimeout(() => setWiggle(current => ({ ...current, running: false })), WIGGLE_MS);
    return () => clearTimeout(timer);
  }, [wiggle.running, wiggle.count]);
  const wiggling = wiggle.running && !success;

  // Success and the streak.
  const session = state?.runtimeId ?? "";
  const visit = `${session}:${state?.visitId ?? renderToken}`;
  const missed = handled > 0;
  useEffect(() => {
    if (success && session) succeed(session, visit, missed);
  }, [success, session, visit, missed, succeed]);
  const flurry = success && showsFlurry(streak, session, visit);
  const timeline = success ? successTimeline({ streak: flurry, reduced }) : null;
  const starGoldAtMs = timeline?.starGoldAtMs;
  const [starLanded, setStarLanded] = useState(false);
  useEffect(() => {
    if (starGoldAtMs === undefined) return;
    const timer = setTimeout(() => setStarLanded(true), starGoldAtMs);
    return () => clearTimeout(timer);
  }, [starGoldAtMs]);
  const earned = node ? round - 1 + (success && starLanded ? 1 : 0) : STAR_ROW.length;
  const pose: SnowmanPose = !node ? "dance" : answer === "blue" ? "clap" : answer === "pink" ? "shrug" : "idle";

  const art = (asset: SnowflakeShowdownAsset) => (
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
  const object = (placement: ScenePlacement, asset: SnowflakeShowdownAsset, className = "", extra?: CSSProperties) => (
    <div className={classes(styles.object, className)} style={{ ...position(placement), ...extra }}>
      {art(asset)}
    </div>
  );
  const snowman = snowmanPlacement(pose);

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
        data-pairing={pairingStarted ? (pairingDone ? "done" : "running") : undefined}
        data-wiggle={wiggling ? wiggle.count : undefined}
        style={
          {
            "--align-landscape": BACKGROUND_ALIGNMENT.landscape,
            "--align-portrait": BACKGROUND_ALIGNMENT.portrait,
            "--cuff-radius": MITTEN_CUFF_RADIUS,
          } as CSSProperties
        }
      >
        <div className={styles.background} aria-hidden="true">
          {art("snowy-yard")}
        </div>
        <div className={styles.layer} aria-hidden="true">
          {object(
            snowman,
            snowman.asset,
            classes(styles.snowman, node && pose !== "idle" && styles.react, !node && styles.jig),
            {
              "--snowman-at": `${timeline?.snowmanAtMs ?? 0}ms`,
            } as CSSProperties,
          )}
          {MITTEN_COLOURS.map(colour => {
            const placement = MITTEN_PLACEMENTS[colour];
            const flakes = snowflakePlacements(colour, slots[colour]);
            return (
              <div
                key={colour}
                className={classes(
                  styles.mitten,
                  face === "turning" && styles.turning,
                  answer === colour && styles.dance,
                  !node && styles.party,
                  wiggling && styles.wiggle,
                )}
                data-colour={colour}
                data-face={face}
                data-count={node ? slots[colour].length : undefined}
                style={
                  {
                    "--ox": percent(placement.x),
                    "--oy": percent(placement.y),
                    "--sway": colour === "blue" ? 1 : -1,
                  } as CSSProperties
                }
              >
                {face !== "palm" && (
                  <div className={classes(styles.face, styles.back)}>
                    {object(placement, mittenAsset(colour, "back"), styles.hand)}
                  </div>
                )}
                {face !== "back" && (
                  <div className={classes(styles.face, styles.palm)}>
                    {object(placement, mittenAsset(colour, "palm"), styles.hand)}
                    {flakes.map((flake, at) => {
                      const slot = slots[colour][at];
                      const pair = pairOf[colour].get(slot);
                      const left = leftover?.colour === colour && leftover.slots.includes(slot);
                      return (
                        <div
                          key={slot}
                          className={classes(
                            styles.object,
                            styles.flake,
                            pair !== undefined && styles.paired,
                            left && styles.leftover,
                          )}
                          data-pair={pair}
                          data-leftover={left || undefined}
                          style={
                            {
                              ...position(flake),
                              ...(pair !== undefined ? { "--pair": PAIR_TINTS[pair % PAIR_TINTS.length] } : {}),
                            } as CSSProperties
                          }
                        >
                          {art("snowflake")}
                        </div>
                      );
                    })}
                  </div>
                )}
                {colour === "pink" && face !== "turning" && (
                  <div className={styles.cuffGlow} style={region(MITTEN_CUFF.pink)} />
                )}
              </div>
            );
          })}
          {face === "turning" &&
            MITTEN_COLOURS.map(colour => (
              <div key={colour} className={styles.swish} style={region(MITTEN_BOUNDS[colour])} />
            ))}
          {schedule && pairsDrawn > 0 && (
            <svg className={styles.pairing} viewBox="0 0 1600 900" preserveAspectRatio="none">
              {schedule.steps.slice(0, pairsDrawn).map((step, index) => {
                const line = trimmed(pairing!.lines[index]);
                return (
                  <g
                    key={`${step.blue}-${step.pink}`}
                    data-line={index}
                    style={{ "--pair": PAIR_TINTS[index % PAIR_TINTS.length] } as CSSProperties}
                  >
                    <line className={styles.casing} pathLength={1} {...line} />
                    <line className={styles.line} pathLength={1} {...line} />
                  </g>
                );
              })}
            </svg>
          )}
          {node || reduced
            ? STAR_ROW.map((slot, index) => {
                const gold = index < earned;
                return (
                  <div
                    key={index}
                    className={classes(
                      styles.object,
                      styles.star,
                      success && gold && index === round - 1 && styles.landed,
                    )}
                    data-star={gold ? "gold" : "pale"}
                    style={position(slot)}
                  >
                    {art(gold ? "star-gold" : "star-pale")}
                  </div>
                );
              })
            : STAR_ROW.map((slot, index) => (
                <div
                  key={index}
                  className={styles.orbit}
                  style={
                    {
                      left: percent(FINALE_FLAKE.x),
                      top: percent(FINALE_FLAKE.y),
                      "--order": index,
                    } as CSSProperties
                  }
                >
                  <div
                    className={styles.swirl}
                    data-star="gold"
                    style={
                      {
                        "--w": slot.width,
                        "--dx": slot.x - FINALE_FLAKE.x,
                        "--dy": slot.y - FINALE_FLAKE.y,
                      } as CSSProperties
                    }
                  >
                    {art("star-gold")}
                  </div>
                </div>
              ))}
          {timeline && answer && !reduced && !starLanded && (
            <div
              className={styles.flight}
              style={
                {
                  "--from-x": percent(MITTEN_PLACEMENTS[answer].x),
                  "--from-y": percent((MITTEN_PALM[answer].top + MITTEN_PALM[answer].bottom) / 2),
                  "--to-x": percent(STAR_ROW[round - 1].x),
                  "--to-y": percent(STAR_ROW[round - 1].y),
                  "--w": percent(STAR_ROW[round - 1].width),
                  "--star-at": `${timeline.starAtMs}ms`,
                  "--flight": `${SUCCESS_STAR_FLIGHT_MS}ms`,
                } as CSSProperties
              }
            >
              {art("star-pale")}
              {art("star-gold")}
            </div>
          )}
          {timeline?.flurryAtMs != null &&
            object(FLURRY_PATH.from, "flurry", styles.flurry, {
              "--to-x": percent(FLURRY_PATH.to.x),
              "--flurry-at": `${timeline.flurryAtMs}ms`,
            } as CSSProperties)}
          {!node && object(FINALE_FLAKE, "snowflake", styles.bigFlake)}
        </div>
        <div className={styles.preload} aria-hidden="true">
          {ASSETS.map(asset => (
            <span key={asset}>{art(asset)}</span>
          ))}
        </div>
        {!node && <p className={styles.complete}>All ten stars are yours!</p>}
        {(pending || failed.size > 0) && (
          <div className={styles.loading} aria-hidden="true">
            {failed.size ? "The picture couldn’t load. Ask a grown-up to reload." : "Getting the picture ready…"}
          </div>
        )}
      </div>
    </div>
  );
}
