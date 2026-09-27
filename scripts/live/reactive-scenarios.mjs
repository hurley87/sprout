import { countingBehavior } from "./lesson-behaviors/counting.mjs";

function requireEvidence(condition, message, evidence) {
  if (!condition) throw new Error(`${message}; evidence: ${JSON.stringify(evidence)}`);
}

async function correct(ctx) {
  const action = await ctx.child.correctAnswer();
  const evaluation = await ctx.observer.waitForEvaluation({ after: action.checkpointBefore });
  await ctx.assertions.evaluated({ after: action, through: evaluation.cursor });
  await ctx.observer.waitForSceneAdvance({ after: evaluation.cursor });
  const response = await ctx.assertions.sproutRespondedAfter(evaluation);
  await ctx.assertions.sceneAdvancedExactlyOnce({ after: action, from: action.scene, through: response.cursor });
}

async function wrong(ctx) {
  const action = await ctx.child.wrongAnswer();
  const evaluation = await ctx.observer.waitForEvaluation({ after: action.checkpointBefore });
  await ctx.assertions.evaluated({ after: action, through: evaluation.cursor });
  const response = await ctx.assertions.sproutRespondedAfter(evaluation);
  await ctx.assertions.sceneStayed({ after: action, through: response.cursor });
}

async function actionWindow(ctx, action, response) {
  const events = (await ctx.observer.snapshot()).events.filter(
    e => e.cursor > action.checkpointBefore && e.cursor <= response.cursor,
  );
  requireEvidence(!events.some(e => e.kind === "session-end"), "Session ended before recovery", events);
  return events;
}

async function assertNoPrematureResponse(ctx, action, label) {
  const events = (await ctx.observer.snapshot()).events.filter(e => e.cursor > action.checkpointBefore);
  requireEvidence(
    !events.some(e => e.kind === "scene" && e.from !== null && e.to !== null),
    `${label}: scene changed during the intentional pause`,
    events,
  );
  // Provider transcript can be generated while the app keeps its output gate
  // closed. That transcript is diagnostic and does not prove audible playback.
  requireEvidence(
    !events.some(e => e.kind === "session-end"),
    `${label}: session ended during the intentional pause`,
    events,
  );
}

function childTranscriptEvents(events, after, through) {
  return events.filter(e => e.kind === "child-transcript" && e.cursor > after && e.cursor <= through);
}

export async function spokenNonAnswer(ctx, action) {
  const transcript = await ctx.observer.waitForChildTranscript({ after: action.checkpointBefore });
  const response = await ctx.assertions.sproutRespondedAfter(transcript);
  await ctx.assertions.sceneStayed({ after: action, through: response.cursor });
  const events = await actionWindow(ctx, action, response);
  requireEvidence(
    events.some(e => e.kind === "child-transcript"),
    "Child speech was not transcribed",
    events,
  );
  requireEvidence(!events.some(e => e.kind === "evaluation"), "Unexpected evaluation of non-counting speech", events);
}

export async function silentOpportunity(ctx, action) {
  // Support may already be retained by the time the intentional silent timer ends.
  const response = await ctx.assertions.sproutRespondedAfter({ cursor: action.checkpointBefore });
  await ctx.assertions.sceneStayed({ after: action, through: response.cursor });
  const events = await actionWindow(ctx, action, response);
  requireEvidence(!events.some(e => e.kind === "evaluation"), "Unexpected evaluation during silence", events);
  requireEvidence(
    !events.some(e => e.kind === "child-transcript"),
    "Fabricated child transcript during silence",
    events,
  );
}

/** Scene evidence is inspected again at playback onset: synthesis may cross commit.
 * Playback is a conservative onset boundary, not a claim about VAD/audio timestamps.
 * Provider output transcripts alone never prove that application output released.
 */
async function delayedSecondTurn(ctx, first, text, answer) {
  const before = await ctx.observer.snapshot();
  const second = await ctx.child.say(text);
  const onsetSnapshot = await ctx.observer.snapshot();
  let events = onsetSnapshot.events.filter(e => e.cursor > first.checkpointBefore);
  const playback = events.find(e => e.kind === "playback-start" && e.cursor > second.checkpointBefore);
  requireEvidence(playback, "Second utterance has no playback onset evidence", events);
  let transitions = events.filter(e => e.kind === "scene" && e.from !== null && e.to !== null);
  const prior = transitions.filter(e => e.cursor < playback.cursor);
  requireEvidence(
    prior.length <= 1 && prior.every(e => e.from === first.scene),
    "Duplicate advance before the second turn",
    events,
  );
  const committed = prior.length === 1;
  const scene = committed ? prior[0].to : first.scene;
  const boundary = {
    scenario: text.startsWith("No,") ? "corrected-to-wrong" : "continuation",
    branch: committed ? "post-commit-new-turn" : "pre-commit-continuation",
    sceneBeforePauseEnded: before.scene,
    sceneAtSecondPlayback: scene,
    firstCheckpoint: first.checkpointBefore,
    secondCheckpoint: second.checkpointBefore,
    playbackCursor: playback.cursor,
    priorTransition: prior[0] ?? null,
  };
  await ctx.page.evaluate(boundary => {
    window.__liveLog.push({
      dir: "scenario",
      action: `stabilization.${boundary.branch}`,
      ...boundary,
      at: window.__liveNow(),
    });
  }, boundary);
  const transcript = await ctx.observer.waitForChildTranscript({ after: second.checkpointBefore });
  const evaluation = await ctx.observer.waitForEvaluation({ after: transcript.cursor });
  const response = await ctx.assertions.sproutRespondedAfter(evaluation);
  const snapshot = await ctx.observer.snapshot();
  events = snapshot.events.filter(e => e.cursor > first.checkpointBefore && e.cursor <= response.cursor);
  transitions = events.filter(e => e.kind === "scene" && e.from !== null && e.to !== null);
  requireEvidence(
    second.checkpointBefore > first.checkpointBefore,
    "Second action was not separately recorded",
    events,
  );
  requireEvidence(!events.some(e => e.kind === "session-end"), "Session ended during the second turn", events);
  requireEvidence(
    childTranscriptEvents(events, second.checkpointBefore, response.cursor).length > 0,
    "Second utterance was not transcribed",
    events,
  );
  const expected = countingBehavior.correctAnswer({ sceneId: scene });
  requireEvidence(
    evaluation.sceneIndex === expected.sceneIndex &&
      new RegExp(`\\b(?:${["", "one", "two", "three", "four", "five"][answer]}|${answer})\\b`, "i").test(
        evaluation.utterance,
      ),
    "Latest answer did not reach Jev in the current scene",
    events,
  );
  const afterOnset = transitions.filter(e => e.cursor > playback.cursor);
  requireEvidence(
    committed ||
      !events.some(e => e.kind === "answer-release" && e.cursor > playback.cursor && e.cursor < evaluation.cursor),
    "Stale answer released before the revised evaluation",
    events,
  );
  if (!committed) {
    // Both second utterances are wrong for the original one-duck scene.
    await ctx.assertions.sceneStayed({ after: first, through: response.cursor });
  } else {
    // A valid evaluation in the new scene may advance it, but cannot repeat or undo the old transition.
    requireEvidence(
      afterOnset.length <= 1 &&
        afterOnset.every(e => e.from === scene && e.to !== first.scene && e.cursor > evaluation.cursor),
      "Duplicate or retroactive advance after commit",
      events,
    );
    if (afterOnset.length)
      await ctx.assertions.sceneAdvancedExactlyOnce({ after: playback, from: scene, through: response.cursor });
    else await ctx.assertions.sceneStayed({ after: playback, scene, through: response.cursor });
  }
}

const scenario = (run, timeoutMs = 120000) => ({ run, timeoutMs });
export const REACTIVE_SCENARIOS = {
  "happy-path": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    for (let i = 0; i < 3; i++) await correct(ctx);
  }, 180000),
  "incorrect-then-correct": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    await wrong(ctx);
    await correct(ctx);
  }),
  "incorrect-dont-know-correct": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    await wrong(ctx);
    await spokenNonAnswer(ctx, await ctx.child.dontKnow());
    await correct(ctx);
  }, 180000),
  "self-correction": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    const state = { sceneId: await ctx.observer.currentScene() };
    const right = countingBehavior.correctAnswer(state);
    const abandoned = countingBehavior.wrongAnswer(state);
    const action = await ctx.child.say(`${abandoned.text.replace("!", "")}... no, ${right.text}`);
    const evaluation = await ctx.observer.waitForEvaluation({ after: action.checkpointBefore });
    const response = await ctx.assertions.sproutRespondedAfter(evaluation);
    const events = (await ctx.observer.snapshot()).events.filter(
      e => e.cursor > action.checkpointBefore && e.cursor <= response.cursor,
    );
    const evaluations = events.filter(e => e.kind === "evaluation");
    const word = right.text.replace("!", "").toLowerCase();
    const finalAnswer = new RegExp(`\\b(?:${word}|${right.answer})\\b[.!?,\\s]*$`, "i");
    requireEvidence(
      evaluations.length === 1 &&
        evaluation.sceneIndex === right.sceneIndex &&
        /\bno\b/i.test(evaluation.utterance) &&
        finalAnswer.test(evaluation.utterance),
      "Self-correction was segmented or the settled answer did not reach Jev",
      events,
    );
    requireEvidence(
      !events.some(e => e.kind === "turn-start" && e.cursor < evaluation.cursor),
      "Sprout responded to an abandoned partial answer",
      events,
    );
    await ctx.assertions.sceneAdvancedExactlyOnce({ after: action, from: action.scene, through: response.cursor });
  }),
  "delayed-correction": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    const state = { sceneId: await ctx.observer.currentScene() };
    const wrong = countingBehavior.wrongAnswer(state);
    const right = countingBehavior.correctAnswer(state);
    const first = await ctx.child.say(wrong.text);
    await ctx.child.wait(1500);
    await assertNoPrematureResponse(ctx, first, "delayed correction");

    const correction = await ctx.child.say(`No, ${right.text}`);
    const evaluation = await ctx.observer.waitForEvaluation({ after: first.checkpointBefore });
    const response = await ctx.assertions.sproutRespondedAfter(evaluation);
    const events = (await ctx.observer.snapshot()).events.filter(
      e => e.cursor > first.checkpointBefore && e.cursor <= response.cursor,
    );
    const transcripts = childTranscriptEvents(events, first.checkpointBefore, response.cursor);
    const expectedWord = right.text.replace(/[.!?]/g, "").trim().toLowerCase();
    requireEvidence(transcripts.length >= 2, "Delayed correction did not produce both child utterances", events);
    requireEvidence(
      events.some(
        e => e.kind === "evaluation" && new RegExp(`\\b(?:${expectedWord}|${right.answer})\\b`).test(e.utterance),
      ),
      "Corrected answer never reached Jev",
      events,
    );
    await ctx.assertions.sceneAdvancedExactlyOnce({ after: first, from: first.scene, through: response.cursor });
    requireEvidence(
      correction.checkpointBefore > first.checkpointBefore,
      "Correction action was not separately recorded",
      events,
    );
  }, 150000),
  "corrected-to-wrong": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    const state = { sceneId: await ctx.observer.currentScene() };
    const right = countingBehavior.correctAnswer(state);
    const wrong = countingBehavior.wrongAnswer(state);
    const first = await ctx.child.say(right.text);
    await ctx.observer.waitForEvaluation({ after: first.checkpointBefore });
    await ctx.child.wait(1000);
    await delayedSecondTurn(ctx, first, `No, ${wrong.text}`, wrong.answer);
  }, 150000),
  continuation: scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    const first = await ctx.child.say("One!");
    await ctx.child.wait(2000);
    await delayedSecondTurn(ctx, first, "And two!", 2);
  }, 150000),
  "long-pause": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    await silentOpportunity(ctx, await ctx.child.staySilent(12000));
    await correct(ctx);
  }),
  "off-topic": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    await spokenNonAnswer(ctx, await ctx.child.say("I have a dinosaur named Rex!"));
    await correct(ctx);
  }),
  interruption: scenario(async ctx => {
    const turn = await ctx.observer.waitForSproutTurnStart();
    const action = await ctx.child.say("Wait!");
    const end = await ctx.observer.waitForSproutTurnEnd({ after: turn.cursor });
    const events = (await ctx.observer.snapshot()).events;
    const playback = events.find(e => e.kind === "playback-start" && e.cursor > action.checkpointBefore);
    requireEvidence(
      playback && playback.at >= turn.at && playback.at < end.at,
      "Child audio did not barge into the same Sprout turn",
      { turn, end, playback, action },
    );
    const window = events.filter(e => e.cursor > action.checkpointBefore && e.cursor <= end.cursor);
    requireEvidence(
      /\bwait\b/i.test(
        window
          .filter(e => e.kind === "child-transcript")
          .map(e => e.text)
          .join(""),
      ),
      "GPT-Live did not transcribe the interruption",
      window,
    );
    requireEvidence(
      !window.some(e => e.kind === "evaluation" || e.kind === "session-end"),
      "Interruption caused evaluation or ended the session",
      window,
    );
    await ctx.assertions.sceneStayed({ after: action, through: end.cursor });
    await correct(ctx);
  }),
  silence: scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    await silentOpportunity(ctx, await ctx.child.staySilent(30000));
    // A second silent opportunity proves sustained absence and has a bounded end.
    await silentOpportunity(ctx, await ctx.child.staySilent(12000));
  }, 150000),
  "explicit-stop": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    const action = await ctx.child.requestStop();
    const end = await ctx.observer.waitForSessionEnd({ after: action.checkpointBefore });
    await ctx.assertions.sessionEnded({ after: action, through: end.cursor });
    // Session end removes the scene; reject progression, not that UI removal.
    const events = (await ctx.observer.snapshot()).events.filter(e => e.cursor > action.checkpointBefore);
    requireEvidence(
      !events.some(e => e.kind === "scene" && e.from !== null && e.to !== null),
      "Stop advanced the lesson",
      events,
    );
    await ctx.page.getByRole("button", { name: "Start a new lesson" }).waitFor();
    const settled = await ctx.observer.snapshot();
    requireEvidence(
      !settled.events.some(e => e.kind === "turn-start" && e.cursor > end.cursor),
      "New tutor turn started after stop acceptance",
      settled,
    );
  }),
  "request-more": scenario(async ctx => {
    await ctx.observer.waitForSproutTurnEnd();
    await spokenNonAnswer(ctx, await ctx.child.requestMore());
    await correct(ctx);
  }),
};
