"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CHIMNEY_INITIAL_PACE,
  CHIMNEY_FALL_MS,
  chimneyDropSequenceMs,
  chimneyReplayIntervalMs,
  chimneyRoundIntervalMs,
  type ChimneyStep,
} from "@/lib/lesson-runtime/down-the-chimney-plan";
import {
  ASSET_VIEWBOXES,
  BACKGROUND_ALIGNMENT,
  CHIMNEY_FIXED,
  CHIMNEY_DROP,
  PILE_SLOTS,
  assetPath,
  fireplaceRow,
  presentColour,
  type ChimneyAsset,
  type ChimneyPlacement,
} from "./down-the-chimney-scene";
import {
  chimneyMisses,
  countAlongDuration,
  introDelay,
  missReplayDelay,
  recordChimneySuccess,
  silenceReplayDelay,
  type PaceBook,
} from "./down-the-chimney-timeline";
import type { LessonStageProps } from "./lesson-screen";
import styles from "./down-the-chimney-stage.module.css";

type Phase = "preview" | "intro" | "dropping" | "waiting" | "peering" | "reveal" | "complete";
const assets = Object.keys(ASSET_VIEWBOXES) as ChimneyAsset[];
function position({ x, y, width, aspect }: ChimneyPlacement): CSSProperties {
  return { left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, aspectRatio: 1 / aspect };
}
export function DownTheChimneyStage(props: LessonStageProps) {
  const session = props.snapshot?.runtime?.runtimeId ?? "preview";
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <SessionStage
      key={session}
      {...props}
      session={session}
      loaded={loaded}
      failed={failed}
      setLoaded={setLoaded}
      setFailed={setFailed}
    />
  );
}
type AssetState = {
  loaded: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  setLoaded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  setFailed: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
};
function SessionStage(props: LessonStageProps & AssetState & { session: string }) {
  const [book, setBook] = useState<PaceBook>({
    session: props.session,
    pace: CHIMNEY_INITIAL_PACE,
    succeeded: new Set(),
  });
  const node = props.node;
  const interval = node ? chimneyRoundIntervalMs(node.presentation.step as ChimneyStep, book.pace) : 1500;
  const succeed = useCallback(
    (visit: string, missed: boolean) => {
      setBook(current => recordChimneySuccess(current, props.session, visit, missed));
    },
    [props.session],
  );
  return <RoundStage key={`${props.renderToken ?? "preview"}`} {...props} interval={interval} succeed={succeed} />;
}
function RoundStage({
  node,
  renderToken,
  snapshot,
  sceneRef,
  motion,
  beginCountAlong,
  interval,
  succeed,
  loaded,
  failed,
  setLoaded,
  setFailed,
}: LessonStageProps & AssetState & { interval: number; succeed: (visit: string, missed: boolean) => void }) {
  const state = snapshot?.runtime;
  const round = Number(node?.presentation.round ?? 9);
  const count = Number(node?.presentation.quantity ?? 0);
  const misses = chimneyMisses(snapshot, node);
  const [phase, setPhase] = useState<Phase>(node ? (renderToken ? "intro" : "preview") : "complete");
  const [drop, setDrop] = useState(-1);
  const [refused, setRefused] = useState(false);
  const [replay, setReplay] = useState(0);
  const [silenceReplays, setSilenceReplays] = useState(0);
  const [handledMisses, setHandledMisses] = useState(0);
  const [replySeen, setReplySeen] = useState(0);
  const [openingTimeout, setOpeningTimeout] = useState(false);
  const [dust, setDust] = useState(false);
  const [missFallback, setMissFallback] = useState(0);
  const peeringTurn = useRef<number | null | undefined>(null);
  const quiet = state?.outputActivity === "quiet";
  const eligible =
    snapshot?.status === "live" &&
    state?.phase === "active" &&
    !state.pendingRender &&
    !snapshot.awaitingSteering &&
    state.nodeId === node?.id &&
    quiet &&
    loaded.size + failed.size === assets.length;
  const success = motion === "success";
  const activePhase: Phase = !node ? "complete" : success ? "reveal" : phase;
  const replayInterval = chimneyReplayIntervalMs(interval, handledMisses);
  const sessionVisit = `${state?.visitId ?? renderToken}`;
  useEffect(() => {
    if (success) succeed(sessionVisit, misses > 0);
  }, [success, sessionVisit, misses, succeed]);
  useEffect(() => {
    if (phase !== "intro" || round !== 1 || !renderToken || snapshot?.status !== "live") return;
    const timer = setTimeout(() => setOpeningTimeout(true), 6500);
    return () => clearTimeout(timer);
  }, [phase, round, renderToken, snapshot?.status]);
  useEffect(() => {
    const delay = introDelay(round, !!state?.tutorOutputObserved, openingTimeout);
    if (phase !== "intro" || success || !eligible || delay === null) return;
    const timer = setTimeout(() => setPhase("dropping"), delay);
    return () => clearTimeout(timer);
  }, [phase, success, eligible, round, state?.tutorOutputObserved, openingTimeout]);
  useEffect(() => {
    if (phase !== "dropping" || success || !node) return;
    const duration = countAlongDuration(count, replayInterval);
    const accepted = beginCountAlong?.("drops", duration) ?? false;
    if (!accepted) {
      console.debug("Down the Chimney count-along window refused", { duration });
    }
    const timers: ReturnType<typeof setTimeout>[] = [setTimeout(() => setRefused(!accepted), 0)];
    for (let i = 0; i < count; i++) timers.push(setTimeout(() => setDrop(i), i * replayInterval));
    timers.push(
      setTimeout(
        () => {
          setDust(true);
          setPhase("waiting");
        },
        chimneyDropSequenceMs(count, replayInterval),
      ),
    );
    return () => timers.forEach(clearTimeout);
    // A replay is an immutable animation; snapshot updates must not restart its timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, replay, success]);
  useEffect(() => {
    if (phase !== "waiting" || drop < 0) return;
    const timer = setTimeout(() => setDrop(-1), 500);
    return () => clearTimeout(timer);
  }, [phase, drop]);
  useEffect(() => {
    if (!dust) return;
    const timer = setTimeout(() => setDust(false), 1200);
    return () => clearTimeout(timer);
  }, [dust]);
  useEffect(() => {
    if (phase !== "waiting" || misses <= handledMisses || state?.outputActivity !== "active") return;
    const timer = setTimeout(() => setReplySeen(misses), 0);
    return () => clearTimeout(timer);
  }, [phase, misses, handledMisses, state?.outputActivity]);
  useEffect(() => {
    if (phase !== "waiting" || misses <= handledMisses) return;
    const timer = setTimeout(() => setMissFallback(misses), 4000);
    return () => clearTimeout(timer);
  }, [phase, misses, handledMisses]);
  useEffect(() => {
    const delay = missReplayDelay(replySeen >= misses, missFallback >= misses);
    if (
      phase !== "waiting" ||
      success ||
      misses <= handledMisses ||
      !eligible ||
      state?.childSpeaking ||
      state?.childCandidate ||
      delay === null
    )
      return;
    const timer = setTimeout(() => {
      setHandledMisses(misses);
      setReplay(n => n + 1);
      setPhase("dropping");
    }, delay);
    return () => clearTimeout(timer);
  }, [
    phase,
    success,
    misses,
    handledMisses,
    replySeen,
    missFallback,
    eligible,
    state?.childSpeaking,
    state?.childCandidate,
  ]);
  useEffect(() => {
    const delay = silenceReplayDelay(silenceReplays);
    if (
      phase !== "waiting" ||
      success ||
      misses > handledMisses ||
      !eligible ||
      delay === null ||
      state?.childSpeaking ||
      state?.childCandidate
    )
      return;
    const timer = setTimeout(() => {
      peeringTurn.current = state?.childTurnId;
      setPhase("peering");
    }, delay);
    return () => clearTimeout(timer);
  }, [
    phase,
    success,
    misses,
    handledMisses,
    eligible,
    silenceReplays,
    state?.childSpeaking,
    state?.childCandidate,
    state?.childTurnId,
    state?.transcriptSource,
    state?.transcriptRevision,
  ]);
  useEffect(() => {
    if (
      phase !== "peering" ||
      success ||
      !eligible ||
      state?.childSpeaking ||
      state?.childCandidate ||
      state?.childTurnId !== peeringTurn.current ||
      misses > handledMisses
    )
      return;
    const timer = setTimeout(() => {
      setSilenceReplays(n => n + 1);
      setReplay(n => n + 1);
      setPhase("dropping");
    }, 1200);
    return () => clearTimeout(timer);
  }, [
    phase,
    success,
    eligible,
    state?.childSpeaking,
    state?.childCandidate,
    state?.childTurnId,
    misses,
    handledMisses,
  ]);
  useEffect(() => {
    if (
      phase !== "peering" ||
      (!state?.childSpeaking &&
        !state?.childCandidate &&
        state?.childTurnId === peeringTurn.current &&
        misses <= handledMisses)
    )
      return;
    const timer = setTimeout(() => setPhase("waiting"), 0);
    return () => clearTimeout(timer);
  }, [phase, state?.childSpeaking, state?.childCandidate, state?.childTurnId, misses, handledMisses]);
  const pending = loaded.size + failed.size < assets.length;
  const art = (asset: ChimneyAsset) => (
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
  const object = (
    placement: ChimneyPlacement,
    asset: ChimneyAsset = placement.asset,
    className = "",
    extra?: CSSProperties,
    key?: string,
  ) => (
    <div key={key ?? asset} className={`${styles.object} ${className}`} style={{ ...position(placement), ...extra }}>
      {art(asset)}
    </div>
  );
  const santa: ChimneyAsset = !node
    ? "santa-wave"
    : activePhase === "dropping"
      ? "santa-drop"
      : activePhase === "peering"
        ? "santa-peer"
        : dust
          ? "santa-dust"
          : "santa";
  return (
    <div className={styles.frame}>
      <div
        ref={sceneRef}
        className={styles.stage}
        role="img"
        aria-label={
          node
            ? "Santa beside a chimney on a snowy house, with a fireplace and Christmas tree inside"
            : "Santa waves beside a snowy house as a sleigh flies over a Christmas tree"
        }
        aria-busy={pending}
        data-render-token={renderToken}
        data-node-id={node?.id ?? "complete"}
        data-scene-id={node?.presentation.sceneId ?? "complete"}
        data-motion={motion}
        data-phase={activePhase}
        data-drop-interval={replayInterval}
        data-count-along={refused ? "refused" : undefined}
        style={
          {
            "--align-landscape": BACKGROUND_ALIGNMENT.landscape,
            "--align-portrait": BACKGROUND_ALIGNMENT.portrait,
          } as CSSProperties
        }
      >
        <div className={styles.background} aria-hidden="true">
          {art("night-house")}
        </div>
        <div className={styles.layer} aria-hidden="true">
          {object(CHIMNEY_FIXED.moon, "moon", styles.moon)}
          {object(CHIMNEY_FIXED.fireplace)}
          {(success || !node) && object(CHIMNEY_FIXED.fire, "fire", styles.fire)}
          {object(CHIMNEY_FIXED.tree)}
          {!node && object(CHIMNEY_FIXED.lights, "lights", styles.lights)}
          {object(CHIMNEY_FIXED.chimneyBack)}
          {object(CHIMNEY_FIXED.santa, santa)}
          {activePhase === "dropping" &&
            drop >= 0 &&
            object(
              CHIMNEY_DROP.start,
              `present-${presentColour(round, drop)}`,
              styles.falling,
              {
                "--fall-top": `${CHIMNEY_DROP.end.y * 100}%`,
                "--fall-ms": `${CHIMNEY_FALL_MS}ms`,
              } as CSSProperties,
              `drop-${replay}-${drop}`,
            )}
          {object(
            CHIMNEY_FIXED.chimneyFront,
            "chimney-front",
            (activePhase === "dropping" || activePhase === "waiting") && drop >= 0 ? styles.jolt : "",
          )}
          {(activePhase === "dropping" || activePhase === "waiting") &&
            drop >= 0 &&
            object(CHIMNEY_FIXED.snowPuff, "snow-puff", styles.puff, undefined, `puff-${replay}-${drop}`)}
          {success &&
            fireplaceRow(count).map((p, i) =>
              object(
                p,
                `present-${presentColour(round, i)}`,
                styles.reveal,
                { "--order": i } as CSSProperties,
                `reveal-${i}`,
              ),
            )}
          {PILE_SLOTS.slice(0, node ? round - 1 : 8).map((p, i) =>
            object(p, `present-${presentColour(i + 1, 0)}`, "", undefined, `pile-${i}`),
          )}
          {success &&
            object(PILE_SLOTS[round - 1], `present-${presentColour(round, 0)}`, styles.newPile, {
              "--pile-x": `${((800 / 1600 - PILE_SLOTS[round - 1].x) / PILE_SLOTS[round - 1].width) * 100}%`,
              "--pile-y": `${((762 / 900 - PILE_SLOTS[round - 1].y) / ((PILE_SLOTS[round - 1].width * PILE_SLOTS[round - 1].aspect * 1600) / 900)) * 100}%`,
            } as CSSProperties)}
          {!node &&
            object(CHIMNEY_FIXED.sleighStart, "sleigh", styles.sleigh, {
              "--sleigh-x": `${(CHIMNEY_FIXED.sleighEnd.x - CHIMNEY_FIXED.sleighStart.x) * 100}%`,
            } as CSSProperties)}
        </div>
        <div className={styles.preload} aria-hidden="true">
          {assets.map(asset => (
            <span key={asset}>{art(asset)}</span>
          ))}
        </div>
        {!node && <p className={styles.complete}>All the presents are under the tree!</p>}
        {(pending || failed.size > 0) && (
          <div className={styles.loading} aria-hidden="true">
            {failed.size ? "The picture couldn’t load. Ask a grown-up to reload." : "Getting the picture ready…"}
          </div>
        )}
      </div>
    </div>
  );
}
