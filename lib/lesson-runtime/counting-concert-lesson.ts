import { buildCountingLesson } from "./counting-lesson";

export const COUNTING_CONCERT_NODE_IDS = [
  "count-1-microphone",
  "count-2-guitars",
  "count-3-bracelets",
  "count-3-stars",
  "count-4-lights",
  "count-5-beads",
  "count-6-butterflies",
] as const;

const rounds = [
  {
    object: "microphone",
    quantity: 1,
    prompt:
      "A microphone is ready for the show. How many microphones do you see? Success story idea: the show is getting ready.",
  },
  {
    object: "guitar",
    quantity: 2,
    prompt:
      "Colourful guitars are ready. How many guitars do you see? Success story idea: the guitars are ready to play.",
  },
  {
    object: "bracelet",
    quantity: 3,
    prompt:
      "Friendship bracelets are here. How many bracelets do you see? Success story idea: the bracelets are ready for the show.",
  },
  {
    object: "star",
    quantity: 3,
    prompt: "Stars are shining. How many stars do you see? Success story idea: the stage is sparkling.",
  },
  {
    object: "light",
    quantity: 4,
    prompt:
      "Stage lights are ready. How many lights do you see? Give extra time and invite pointing to each light one by one. Success story idea: the stage glows softly.",
  },
  {
    object: "bead",
    quantity: 5,
    prompt:
      "Loose colourful beads are here. How many beads do you see? Give extra time and invite pointing to each bead one by one. Success story idea: the show is getting colourful.",
  },
  {
    object: "concert-butterfly",
    quantity: 6,
    prompt:
      "Butterflies are dancing. How many butterflies do you see? Give extra time and invite pointing to each butterfly one by one. Success story idea: the concert is ready; warmly congratulate the child and say they are a superstar.",
  },
] as const;

export const COUNTING_CONCERT_LESSON = buildCountingLesson({
  id: "counting-concert",
  initialNodeId: COUNTING_CONCERT_NODE_IDS[0],
  singleItemExample: "a single microphone",
  addressLearnerByName: true,
  nodes: Object.fromEntries(
    rounds.map((round, index) => {
      const id = COUNTING_CONCERT_NODE_IDS[index];
      return [
        id,
        {
          id,
          presentation: { sceneId: id, object: round.object, quantity: round.quantity },
          learningObjective: `Identify the total of the displayed ${round.object} objects.`,
          tutorBrief: round.prompt,
          onSuccess:
            index === rounds.length - 1
              ? { kind: "complete" as const }
              : { kind: "node" as const, nodeId: COUNTING_CONCERT_NODE_IDS[index + 1] },
        },
      ];
    }),
  ),
});
