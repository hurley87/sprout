/** Thin behavior wrapper around createSimulatedChild; all speech goes through say().
 * @param {{ speech: { say: (text: string) => Promise<unknown> }, observer: { snapshot: () => Promise<any>, checkpoint: () => Promise<number> }, lessonBehavior?: { correctAnswer: (state: { sceneId: string | null }) => any, wrongAnswer: (state: { sceneId: string | null }) => any }, page?: any, record?: ((entry: any) => Promise<unknown>) | null, sleep?: (ms: number) => Promise<unknown> }} options
 */
export function createReactiveChild({
  speech,
  observer,
  lessonBehavior,
  page = null,
  record = null,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
}) {
  if (!record && !page) throw new Error("Reactive child requires a browser page or action recorder");
  const log =
    record ??
    (entry =>
      page.evaluate(entry => {
        window.__liveLog.push({ ...entry, dir: "child", at: window.__liveNow() });
      }, entry));
  let queue = Promise.resolve();
  let sequence = 0;
  function action(type, choose) {
    const task = queue.then(async () => {
      const before = await observer.snapshot();
      const chosen = choose({ sceneId: before.scene });
      const evidence = {
        actionId: ++sequence,
        type,
        scene: before.scene,
        ...chosen,
        checkpointBefore: before.cursor,
        startedAt: Date.now(),
      };
      await log({ action: "child.action.started", ...evidence });
      try {
        if (chosen.text !== undefined) await speech.say(chosen.text);
        else await sleep(chosen.durationMs);
        evidence.checkpointAfterPlayback = await observer.checkpoint();
        evidence.finishedAt = Date.now();
        await log({ action: "child.action.finished", ...evidence });
        return evidence;
      } catch (error) {
        await log({ action: "child.action.failed", ...evidence, finishedAt: Date.now(), error: String(error) });
        throw error;
      }
    });
    queue = task.catch(() => {});
    return task;
  }
  function answer(type) {
    return action(type, state => {
      if (!lessonBehavior || typeof lessonBehavior[type] !== "function")
        throw new Error(
          `Cannot choose ${type} for scene ${JSON.stringify(state.sceneId)}: no lesson behavior supplied for this action`,
        );
      return lessonBehavior[type](state);
    });
  }
  function silence(type, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0)
      return Promise.reject(new Error("Child duration must be nonnegative milliseconds"));
    return action(type, () => ({ durationMs }));
  }
  return {
    say: text =>
      action("say", () => {
        if (typeof text !== "string" || !text.trim()) throw new Error("Speech must be nonempty text");
        return { text };
      }),
    correctAnswer: () => answer("correctAnswer"),
    wrongAnswer: () => answer("wrongAnswer"),
    dontKnow: () => action("dontKnow", () => ({ text: "I don't know." })),
    requestStop: () => action("requestStop", () => ({ text: "I am all done. I want to stop now." })),
    requestMore: () => action("requestMore", () => ({ text: "Can we do more?" })),
    wait: ms => silence("wait", ms),
    staySilent: ms => silence("staySilent", ms),
  };
}
