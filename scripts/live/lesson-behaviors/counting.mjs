import { COUNTING_SCENES } from "../../../lib/counting-scenes.mjs";

const words = ["One", "Two", "Three", "Four", "Five"];
function choose({ sceneId }, wrong) {
  const sceneIndex = COUNTING_SCENES.findIndex(scene => scene.id === sceneId);
  if (sceneIndex < 0)
    throw new Error(
      `Cannot choose a ${wrong ? "wrong" : "correct"} answer for scene ${JSON.stringify(sceneId)}: counting behavior does not recognize it`,
    );
  const expected = COUNTING_SCENES[sceneIndex].quantity;
  const answer = wrong ? (expected % words.length) + 1 : expected;
  return { text: `${words[answer - 1]}!`, expected, answer, sceneIndex };
}

export const countingBehavior = {
  correctAnswer: state => choose(state, false),
  wrongAnswer: state => choose(state, true),
};
